
# Paper Bible (paper.bible)

Web application for creating customized, printable Bible documents in professional
book/booklet format. Users select Bible passages from 800+ languages, customize
styling (fonts, margins, columns), add decorative title pages and custom content,
then generate print-ready PDFs — compiled in the browser via Typst (WASM), with a
server fallback for low-memory devices.

Live at [paper.bible](https://paper.bible). MIT No Attribution license.


## Architecture & Data Flow

**Frontend:** Vue 3 SPA (Vite + Vuetify 3 + TypeScript), hosted on Firebase Hosting
**Data:** Firebase Auth (anonymous by default) + Firestore (drafts, creation metadata)
  + Cloud Storage (PDFs, custom fonts)
**PDF engine:** Typst — in the browser via a WASM worker, and on a Cloud Run container
  (Typst CLI) as fallback/regeneration path
**API:** one server codebase deployed as two Cloud Run services (`SERVER_ROLES` env picks
  routes): `paper-bible-api` (light: share/redeem/copy/merge, 256Mi) and
  `paper-bible-compile` (`/api/compile` only, 2Gi/2cpu, fonts bucket mounted via GCS FUSE)
**Fonts:** curated font set served from a dedicated public bucket at
  `https://fonts.paper.bible/` (dev: served by a Vite middleware from `fonts/`); the compile
  service reads the same bucket as a mounted volume instead of baking fonts into the image

### Data flow: user input to PDF

1. Every visitor is signed in anonymously (`ensure_signed_in()` in `auth.ts`); sign-in
   with Google/email-link upgrades the account in place (work retained)
2. The user edits a draft `Blueprint` — the reactive `blue` singleton mirrors the
   currently open Firestore draft doc (`drafts.ts` syncs both directions, debounced
   field-level writes so co-editors don't clobber each other)
3. `DisplayPreview.vue` compiles a truncated preview in the browser as they edit
4. On "Create", the draft is frozen into an immutable `creations/{id}` doc (blueprint +
   custom-font snapshot), then compiled in the browser and uploaded to Storage
   (`creations.ts: compile_and_upload`)
5. If the in-browser (WASM) compile fails, the client calls `POST /api/compile` and the
   Cloud Run server compiles the same frozen blueprint with the Typst CLI
6. PDFs live in Storage for 1 year (GCS lifecycle rule); metadata stays forever and the
   PDF can be regenerated (same hybrid path) after expiry
7. Drafts can be shared via a secret invite link (adds the recipient as an editor); creations
   are public by id alone — sharing them is just sharing the URL, no token involved

### Key architectural patterns

- **Anonymous-first auth:** everyone is a real Firebase Auth user; linking keeps the
  uid, credential conflicts trigger a server-side account merge (`/api/merge_account`)
- **Immutable creations:** Firestore rules forbid changing `blueprint`/`owner`/
  `created`/`copied_from`/`custom_fonts`; only lifecycle fields (status/pages/expiry) may
  change. "Keep own copy" duplicates doc + PDF under the recipient (server-mediated, Admin SDK,
  since it writes under a different owner)
- **Draft co-editing:** drafts store `content_items` (map keyed by item id) +
  `content_order` (array) so concurrent edits to different items/fields merge cleanly;
  same-field conflicts are last-write-wins (see converters in `drafts.ts`)
- **Draft invite links vs. public creations:** draft ids are not enough on their own — editing
  is a permission grant, so invite links carry a separate `share_token` that a server route
  (`/api/redeem_draft`) validates before adding the caller to `editor_uids`. Creations are read-
  only and already keyed by an unguessable url64 id (`generate_token()`), so the id itself is
  the whole capability — Firestore/Storage rules allow public read directly, no server hop or
  token needed to view metadata or download the PDF
- **Same-origin API:** Hosting rewrites `/api/compile` to the compile service and `/api/**`
  to the light service (Vite proxies everything to `localhost:8788` in dev) — no CORS anywhere
- **Static-content skew:** Bible translations (1000+ in prod) and Noto fallback fonts (192
  families) are barely-changing content with heavily skewed popularity — the compile service
  fetches both on demand (fonts via the bucket mount, books via fetch.bible) and keeps books
  warm in a per-instance LRU (`server/src/content.ts`) rather than baking anything in


## Monorepo layout (npm workspaces)

```
paper_bible/
  firebase.json            # Hosting (app/dist, /api rewrite), Firestore/Storage rules refs
  .firebaserc              # Project aliases (default/dev/prod)
  firestore.rules          # Drafts/creations/users access rules
  firestore.indexes.json   # drafts editor_uids+modified, creations owner+created
  firebase_storage.rules            # PDFs create-once-by-owner, font paths (cross-service get())
  firebase_storage_lifecycle.json   # Deletion of creations/ (365d) + errors/ (90d) (applied via gcloud)
  .bin/                    # All dev/deploy commands (package.json has no scripts)
    setup                  # npm install
    setup_typst            # Download the Typst CLI binary into .bin/
    setup_firebase         # One-time per-project GCP setup (lifecycle, fonts bucket, CORS)
    download_fonts         # Download curated fonts into fonts/ (gitignored)
    build_typst            # Build all local TS packages in dependency order
    serve_app              # Vite dev server (port 5300)
    serve_emulators        # Firebase emulator suite (auth 9099, firestore 8080, storage 9199)
    serve_server           # Local API server against the emulators (port 8788)
    deploy_app             # vite build + firebase deploy (hosting, rules)
    deploy_fonts           # rsync fonts/ to the public fonts bucket
    build_server           # Stage server/deploy/ (allowlisted Docker build context)
    deploy_server          # Runs build_server, gcloud run deploy of both services from one build
    detect_i18n_strings    # Extract i18n keys from .vue files into en.json
    test_e2e               # Playwright e2e tests (needs the dev stack running; see e2e/)
    audit_stress         # Compile stress ladder, browser (WASM) + server (see e2e/tiers.ts)
    errors                 # Download + triage error reports (TUI; claude groups them)
  app/                     # The Vue SPA (workspace)
    src/
      init.ts              # ** APP ENTRY POINT ** auth → content → share links → drafts
      comp/                # Components: Tab*/Editor*/Options*/Display*/Dialog*/App*
        dialogs/           # DialogAccount, DialogShare, DialogSharedCreation
      services/
        firebase.ts        # Firebase init (config committed; emulators in dev)
        auth.ts            # Anonymous auth, Google/email-link upgrade, merge trigger
        api.ts             # fetch wrapper for /api/* with ID token
        state.ts           # Reactive `blue` (open draft), `creations`, `state`
        drafts.ts          # Multi-draft sync: converters, debounced diff writes, sharing
        creations.ts       # Creation lifecycle: freeze, compile+upload, regen, sharing
        custom_fonts.ts    # Uploaded fonts: reactive set + online library + snapshots
        content.ts         # Bible data service (fetch-client via paper-bible-typst)
        blueprints.ts      # Default blueprint + clean_blueprint() validation
        typst.ts           # TypstWorkerClient (WASM worker mgmt, worn-worker recycle)
        typst_worker.ts    # The worker: WASM compiler via paper-bible-typst-web
        watchers.ts        # Auto-fetch book content as the draft changes
  server/                  # Cloud Run API server (workspace; run directly by node)
    Dockerfile             # Cloud Run image: node + workspaces + typst CLI (no fonts baked)
    deploy/                # Staged build context (gitignored; written by .bin/build_server)
    src/index.ts           # Hono routes, gated by SERVER_ROLES: compile | light (share/merge)
    src/compile.ts         # compile_pdf_from_blueprint + upload + doc update
    src/content.ts         # Shared BibleContent: collection TTL + LRU book cache
    src/share.ts           # Share-token redemption, shared views, keep-own-copy
    src/merge.ts           # Guest→existing account data merge
    src/errors.ts          # ErrorRecord + save_error() → errors/{fingerprint}/{id}.json
  errors/             # .bin/errors internals: bucket sync, claude clustering, triage TUI
  typst/                   # paper-bible-typst: core (Blueprint→TypstRequest, typst gen)
  typst-web/               # paper-bible-typst-web: WASM wrapper (browser)
  typst-node/              # paper-bible-typst-node: Typst CLI wrapper (server)
  generic/                 # Reusable packages: pm-to-typst, typst-utils, typst-fonts
  fonts/                   # Curated fonts (gitignored; download_fonts / deploy_fonts)
```


## Firestore data model

```
users/{uid}/fonts/{font_id}   {family, style, files:[storage paths]}   # font library

drafts/{draft_id}             # editable, multi-user
    owner, editor_uids (includes owner), editors:{uid:{joined}}, share_token|null  # edit invite
    name, created, modified
    blueprint:{...options}    # Blueprint minus content
    content_items:{id:item}, content_order:[id]

creations/{creation_id}       # immutable once created, publicly readable by id (no share_token)
    owner, created, title, status: pending|available|failed
    blueprint (frozen), pages, pdf_path, pdf_expires, error
    copied_from|null
    custom_fonts:[{family, style, files:[creations/{id}/fonts/... paths]}]
```

Storage: `creations/{id}/doc.pdf` + `creations/{id}/fonts/*` (both swept by the same 365-day
lifecycle rule, since fonts are nested under the creation), `user_fonts/{uid}/{font_id}/*`.
All publicly readable by path (ids are unguessable url64 tokens); Storage rules resolve
ownership for writes via `firestore.get()`.


## Development

```bash
.bin/setup && .bin/setup_typst && .bin/download_fonts   # once
.bin/serve_emulators    # terminal 1: Firebase emulators (persists to .emulator_data/)
.bin/serve_server       # terminal 2: API server on :8788 (against emulators)
.bin/serve_app          # terminal 3: app on :5300 (auth/firestore/storage → emulators)
```

- The app connects to emulators automatically when `import.meta.env.DEV`
- Bible content comes from `http://localhost:8430/` in dev, `https://v1.fetch.bible/`
  in prod (`app/src/services/content.ts`; server via `FETCH_ENDPOINT` env)
- The server workspace has no build step — node runs `server/src/*.ts` directly
  (erasable-syntax TS; typecheck with `npx tsc -p server/tsconfig.json`)
- **No unit-test framework in the app.** `typst-node`/`typst` have vitest suites. Emulator
  integration is tested manually; `vite build` catches compile errors
- **Playwright e2e/stress** lives in `e2e/` (run via `.bin/test_e2e`, needs the dev stack
  running). Browsers install into `e2e/browsers/` (gitignored) — keep them inside the
  repo, apt/system state doesn't persist across dev-container rebuilds. The compile stress
  harness (`.bin/audit_stress`, results in `e2e/results/`) compiles the same size tiers in
  the browser (WASM worker) and the server pipeline; `STRESS_BOOKS="psa,pro"` probes a custom
  book set. A layout-option matrix (`e2e/matrix.ts`) isolates which blueprint options drive
  Typst memory — run `node e2e/stress_matrix.ts` (server) or `.bin/test_e2e
  stress_matrix.test.ts` (browser), filtered via `STRESS_CONFIGS="psa_col1,full_col1"`

### Deployment (per project alias: dev/prod)

1. Firebase console: create project, Blaze plan, enable Auth (Anonymous/Google/Email
   link), Firestore, Storage; copy the web config into `app/src/services/firebase.ts`
2. `.bin/setup_firebase <project-id>` — lifecycle rule, fonts bucket + CORS + volume IAM
3. `.bin/deploy_fonts`, `.bin/deploy_server <project-id>`, `.bin/deploy_app [alias]`
   (deploy fonts before the server — the compile service reads them from the bucket)
4. Point `fonts.paper.bible` at the fonts bucket (LB backend-bucket or CDN proxy)


## Code Style & Conventions

- **No semicolons**, **snake_case** functions/variables, **CamelCase** classes
- **4-space indent**, 100-char lines (may exceed in Pug/markup)
- **Single quotes**; **double quotes** for UI-displayed text (always via `$t("...")`)
- **No space** before types: `name:string`; imports like `import {a, b} from 'x'`
- **Comment** every function/class and before every chunk of code
- Vue SFCs: Pug templates, Sass styles, template → script → style order
- `@/` alias → `app/src/`. Components: `Tab*`, `Editor*`, `Options*`, `Display*`,
  `Dialog*`, `App*` (global)
- State: module-level Vue reactives in services (no Pinia); `blue` is the open draft


## Gotchas

- **`blue` is replaced wholesale** when switching drafts — watch sources must be
  functions (`() => blue`) to survive replacement (see `watchers.ts`, `drafts.ts`)
- **Firestore field paths with item ids** need `FieldPath` (ids are url64 and contain
  `-_~`), not dotted strings — see `gen_updates()` in `drafts.ts`
- **Snapshot echoes:** draft sync skips `metadata.hasPendingWrites` snapshots and
  advances its `synced` base optimistically on flush — read `drafts.ts` before touching
- **Storage create-once:** clients can never overwrite/delete `creations/*/doc.pdf`;
  regen works because the lifecycle rule deleted the object (create passes again)
- **Deleting a creation doc orphans its PDF** intentionally — it becomes unreachable
  instantly and the lifecycle rule collects it within the year
- **PDF_LIFETIME_MS** (client `creations.ts`, server `compile.ts`/`share.ts`) must match
  `firebase_storage_lifecycle.json` (365 days)
- **Lambda-era leftovers** live under `.private/generator/` — dead code, ignore
- **WASM memory:** the Typst worker leaks per unique source; `TypstWorkerClient`
  recycles worn workers automatically (see `typst.ts`)
- **clean_blueprint()** (`blueprints.ts`) validates untrusted blueprints (Firestore
  docs from co-editors) — nested content-item validation is still TODO
- **Error reporting is self-hosted:** browser errors POST to `/api/report_error`
  (unauthenticated OK, uid attached when known, IP recorded server-side) and everything
  lands in the bucket as `errors/{fingerprint}/{id}.json` (90-day lifecycle). The
  fingerprint only dedupes identical messages — semantic grouping happens in `.bin/errors`
  (claude clusters fingerprints into issues; triage state in gitignored `errors/records/`).
  Critical failures show the report id in a gracious.tech/contact link
- **SERVER_ROLES gates routes, Hosting gates traffic** — both must agree: `/api/compile`
  is rewritten to `paper-bible-compile` (role `compile`), everything else to
  `paper-bible-api` (role `light`); dev defaults to both roles on one port
- **Compile fonts come from the bucket mount** (`FONTS_DIR=/mnt/fonts/fonts` via GCS FUSE,
  set in `deploy_server`) — new fonts need `.bin/deploy_fonts`, not a server redeploy;
  locally `serve_server` points at the `fonts/` dir
- **Server caches are per-instance best-effort** (like the per-uid compile throttle):
  `server/src/content.ts` keeps the fetch.bible collection (1h TTL) and an LRU of fetched
  books warm across compiles, but a fresh instance starts cold — never rely on them


## i18n

- Keys are the English strings; `en.json` maps them to `""` (test locale), `vi.json`
  holds Vietnamese; missing keys fall back to the key text
- After adding UI strings run `.bin/detect_i18n_strings` (watch for its escaped-quote
  duplicates — remove any `\\'` keys it adds)
