
# Paper Bible (paper.bible)

Web application for creating customized, printable Bible documents in professional
book/booklet format. Users select Bible passages from 800+ languages, customize
styling (fonts, margins, columns), add decorative title pages and custom content,
then generate print-ready PDFs — compiled in the browser via Typst (WASM), with a
server fallback for low-memory devices.

Live at [paper.bible](https://paper.bible). MIT No Attribution license.


## Architecture & Data Flow

**Frontend:** Vue 3 SPA (Vite + Vuetify 3 + TypeScript + vue-router), hosted on Firebase Hosting
**Data:** Firebase Auth (anonymous by default) + Firestore (designs, version metadata)
  + Cloud Storage (PDFs, custom fonts)
**PDF engine:** Typst — in the browser via a WASM worker, and on a Cloud Run container
  (Typst CLI) as fallback/regeneration path
**API:** one server codebase deployed as two Cloud Run services (`SERVER_ROLES` env picks
  routes): `paper-bible-api` (light: share/redeem/copy/merge, 256Mi) and
  `paper-bible-compile` (`/api/compile` only, 2Gi/2cpu, assets bucket mounted via GCS FUSE)
**Shared assets:** the public assets bucket (`https://assets.paper.bible/`) is owned and
  published by the separate [bookcover repo](https://github.com/gracious-tech/bookcover) —
  top-level dirs: `fonts/` (curated set + Noto fallbacks), `docs/`/`frames/`/`backgrounds/`
  (bookcover generator assets), and `typst/<npm version>/` (vendored typst.ts WASM, write-once
  since consumers pin version dirs with immutable caching). In dev the bookcover repo's dev
  server serves the same tree at `http://localhost:5301/generator_assets/` (see `ASSETS_PREFIX`
  in `app/src/services/typst.ts`); the compile service reads the bucket as a mounted volume
  instead of baking anything into the image

### Data flow: user input to PDF

1. Every visitor is signed in anonymously (`ensure_signed_in()` in `auth.ts`); sign-in
   with Google/email-link upgrades the account in place (work retained)
2. The user edits a design's `Blueprint` — the reactive `blue` singleton mirrors the
   currently open Firestore `designs/{id}` doc (`designs.ts` syncs both directions, debounced
   field-level writes so co-editors don't clobber each other)
3. `DisplayPreview.vue` compiles a truncated preview in the browser as they edit
4. On "Create" (`ViewDesignEditor.vue`), the design is force-flushed then frozen into an
   immutable `versions/{id}` doc (blueprint + custom-font snapshot + the design's current
   `save_token`), then compiled in the browser and uploaded to Storage
   (`versions.ts: compile_and_upload`)
5. If the in-browser (WASM) compile fails, the client calls `POST /api/compile` and the
   Cloud Run server compiles the same frozen blueprint with the Typst CLI
6. PDFs live in Storage for 1 year (GCS lifecycle rule); metadata stays forever and the
   PDF can be regenerated (same hybrid path) after expiry
7. Designs can be shared via a secret invite link (adds the recipient as an editor); versions
   are public by id alone — sharing them is just sharing the `/designs/{id}/{version}` URL, no
   token involved. Viewing someone else's version (without edit access) records a
   `users/{uid}/viewed/{design_id}` entry, surfaced as "Read access" on `/designs`

### Key architectural patterns

- **Anonymous-first auth:** everyone is a real Firebase Auth user; linking keeps the
  uid, credential conflicts trigger a server-side account merge (`/api/merge_account`)
- **Immutable versions:** Firestore rules forbid changing `blueprint`/`owner`/`created`/
  `design_id`/`copied_from`/`custom_fonts`/`save_token`; only lifecycle fields
  (status/pages/expiry) may change. "Keep own copy" creates both a new design and a new
  version under the recipient (server-mediated, Admin SDK, since it writes under a different
  owner) — see `handle_copy_version()` in `server/src/share.ts`
- **Design co-editing:** designs store `content_items` (map keyed by item id) +
  `content_order` (array) so concurrent edits to different items/fields merge cleanly;
  same-field conflicts are last-write-wins (see converters in `designs.ts`, and the shared
  `split_blueprint_doc()`/`join_blueprint_doc()` in `typst/src/blueprint_doc.ts` that both the
  client and server use so the two never drift apart on how a `Blueprint` maps to these fields)
- **`save_token` (has-unrendered-changes detection):** `designs.ts` writes a fresh opaque
  token (`generate_token()`) alongside `modified` on every flush; `versions.ts` copies it
  verbatim onto each new version at freeze time. `design_needs_editor` (in `versions.ts`)
  compares the two by *equality*, not a timestamp/order comparison — comparing two
  independently-resolved `serverTimestamp()`s by order can't be relied on across two different
  docs, but copying one exact value and checking equality sidesteps that entirely
- **Design invite links vs. public versions:** design ids are not enough on their own —
  editing is a permission grant, so invite links carry a separate `share_token` that a server
  route (`/api/redeem_design_invite`) validates before adding the caller to `editor_uids`.
  Versions are read-only and already keyed by an unguessable url64 id (`generate_token()`), so
  the id itself is the whole capability — Firestore/Storage rules allow public read directly,
  no server hop or token needed to view metadata or download the PDF
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
  firestore.rules          # Designs/versions/users access rules
  firestore.indexes.json   # designs editor_uids+modified, versions design_id+created
  firebase_storage.rules            # PDFs create-once-by-owner, font paths (cross-service get())
  firebase_storage_lifecycle.json   # Deletion of versions/ (365d) + errors/ (90d) (applied via gcloud)
  .bin/                    # All dev/deploy commands (package.json has no scripts)
    setup                  # npm install
    setup_typst            # Download the Typst CLI binary into .bin/
    setup_firebase         # One-time per-project GCP setup (lifecycle, assets-bucket mount IAM)
    build_typst            # Build all local TS packages in dependency order
    serve_app              # Vite dev server (port 5300)
    serve_emulators        # Firebase emulator suite (auth 9099, firestore 8080, storage 9199)
    serve_server           # Local API server against the emulators (port 8788)
    deploy_app             # vite build + firebase deploy (hosting, rules)
    build_server           # Stage server/deploy/ (allowlisted Docker build context)
    deploy_server          # Runs build_server, gcloud run deploy of both services from one build
    i18n_status/_sync/_check/_extract  # Translation tooling (logic in app/i18n/); see i18n section
    test_e2e               # Playwright e2e tests (needs the dev stack running; see e2e/)
    audit_stress         # Compile stress ladder, browser (WASM) + server (see e2e/tiers.ts)
    errors                 # Download + triage error reports (TUI; claude groups them)
  app/                     # The Vue SPA (workspace)
    src/
      init.ts              # ** APP ENTRY POINT ** auth → content → designs → router → mount
      comp/                # Components: View*/Editor*/Options*/Display*/Dialog*/App*
        nav/               # AppNavbar (last 3 designs, "View all", "New")
        views/             # Route components (ViewDesigns, ViewDesign, ViewDesignEditor, ...)
          assets/          # DesignListItem, DesignVersionsList, DesignVersionItem
        dialogs/           # DialogAccount, DialogInviteEditor, DialogShareVersion,
                            #   DialogViewedDesign
      services/
        i18n.ts            # Homegrown i18n (no lib): flat catalog lookup + {placeholder} + $t
        locale.ts          # Browser BCP-47 → ISO 639-3 locale detection
        firebase.ts        # Firebase init (config committed; emulators in dev)
        auth.ts            # Anonymous auth, Google/email-link upgrade, merge trigger
        api.ts             # fetch wrapper for /api/* with ID token
        router.ts           # vue-router instance: /designs, /designs/:id[/:version], /help, ...
        state.ts           # Reactive `blue` (open design), `state` (splash/editor/toasts)
        designs.ts          # Multi-design sync: converters, debounced diff writes, sharing,
                            #   viewed-designs ("Read access") sync
        versions.ts         # Version lifecycle: freeze, compile+upload, regen, sharing,
                            #   design_needs_editor / latest_version computeds
        custom_fonts.ts    # Uploaded fonts: reactive set + online library + snapshots
        content.ts         # Bible data service (fetch-client via paper-bible-typst)
        blueprints.ts      # Default blueprint + clean_blueprint() validation
        typst.ts           # TypstWorkerClient (WASM worker mgmt, worn-worker recycle)
        typst_worker.ts    # The worker: WASM compiler via paper-bible-typst-web
        watchers.ts        # Auto-fetch book content as the design changes
    i18n/                  # Translation tooling (node, own tsconfig; excluded from app tsconfig)
                            #   lib/status/sync/check/extract + context.json/glossary.json
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
  typst/                   # paper-bible-typst: core (Blueprint→TypstRequest, typst gen,
                            #   split_blueprint_doc/join_blueprint_doc for Firestore doc shape)
  typst-web/               # paper-bible-typst-web: WASM wrapper (browser)
  typst-node/              # paper-bible-typst-node: Typst CLI wrapper (server)
  assets/                  # Local copy/symlink of the bookcover repo's assets tree (untracked;
                            #   fonts/ + docs/ used by serve_server for local compiles)
```

The `pm-to-typst`, `typst-utils` and `typst-fonts` packages (formerly the `generic/`
workspaces) now live in the bookcover repo and are consumed from npm.


## Firestore data model

```
users/{uid}/fonts/{font_id}   {family, style, files:[storage paths]}   # font library
users/{uid}/viewed/{design_id}   {design_id, title, last_version_id, last_viewed}  # read access

designs/{design_id}           # editable, multi-user
    owner, editor_uids (includes owner), editors:{uid:{joined}}, share_token|null  # edit invite
    name, save_token, created, modified
    blueprint:{...options}    # Blueprint minus content (title is user-editable, no separate
                               #   rename field — see save_token note above)
    content_items:{id:item}, content_order:[id]

versions/{version_id}         # immutable once created, publicly readable by id (no share_token)
    design_id                 # FK to the parent design (not a subcollection — see below)
    owner, created, title, status: pending|available|failed
    blueprint (frozen), pages, pdf_path, pdf_expires, error
    copied_from|null, save_token   # copied verbatim from the parent design at freeze time
    custom_fonts:[{family, style, files:[versions/{id}/fonts/... paths]}]
```

`versions` is a flat collection + `design_id` FK, not a physical subcollection of `designs` —
versions need independent public-read-by-id ACLs and to be queried both by parent design
(`ViewDesign.vue`'s version list) and standalone (a bare version link); a subcollection would
make the ACL story worse (`get()`-based ownership resolution) for no benefit.

Storage: `versions/{id}/doc.pdf` + `versions/{id}/fonts/*` (both swept by the same 365-day
lifecycle rule, since fonts are nested under the version), `user_fonts/{uid}/{font_id}/*`.
All publicly readable by path (ids are unguessable url64 tokens); Storage rules resolve
ownership for writes via `firestore.get()`.


## Development

```bash
.bin/setup && .bin/setup_typst   # once (plus symlink/copy the bookcover repo's assets/ here)
.bin/serve_emulators    # terminal 1: Firebase emulators (persists to .emulator_data/)
.bin/serve_server       # terminal 2: API server on :8788 (against emulators)
.bin/serve_app          # terminal 3: app on :5300 (auth/firestore/storage → emulators)
```

- The app connects to emulators automatically when `import.meta.env.DEV`
- Static assets (fonts, WASM, bookcover) are fetched from the bookcover repo's dev server at
  `http://localhost:5301/generator_assets/` — run it alongside the stack above; the embedded
  cover editor widget is the same origin
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
2. Publish the assets bucket from the bookcover repo (it owns bucket creation, CORS and
   content — the compile service mounts it and the app fetches from it)
3. `.bin/setup_firebase <project-id>` — lifecycle rule + assets-bucket volume-mount IAM
4. `.bin/deploy_server <project-id>`, `.bin/deploy_app [alias]`


## Code Style & Conventions

- **No semicolons**, **snake_case** functions/variables, **CamelCase** classes
- **4-space indent**, 100-char lines (may exceed in Pug/markup)
- **Single quotes**; **double quotes** for UI-displayed text (always via `$t("...")`)
- **No space** before types: `name:string`; imports like `import {a, b} from 'x'`
- **Comment** every function/class and before every chunk of code
- Vue SFCs: Pug templates, Sass styles, template → script → style order
- `@/` alias → `app/src/`. Components: `View*` (routed), `Editor*`, `Options*`, `Display*`,
  `Dialog*`, `App*` (global)
- State: module-level Vue reactives in services (no Pinia); `blue` is the open design;
  routing is vue-router (`services/router.ts`), not a reactive field


## Gotchas

- **`blue` is replaced wholesale** when switching designs — watch sources must be
  functions (`() => blue`) to survive replacement (see `watchers.ts`, `designs.ts`)
- **Firestore field paths with item ids** need `FieldPath` (ids are url64 and contain
  `-_~`), not dotted strings — see `gen_updates()` in `designs.ts`
- **Snapshot echoes:** design sync skips `metadata.hasPendingWrites` snapshots and
  advances its `synced` base optimistically on flush — read `designs.ts` before touching
- **Storage create-once:** clients can never overwrite/delete `versions/*/doc.pdf`;
  regen works because the lifecycle rule deleted the object (create passes again)
- **Deleting a version doc orphans its PDF** intentionally — it becomes unreachable
  instantly and the lifecycle rule collects it within the year
- **PDF_LIFETIME_MS** (client `versions.ts`, server `compile.ts`/`share.ts`) must match
  `firebase_storage_lifecycle.json` (365 days)
- **`generate()` (`ViewDesignEditor.vue`) must force-flush before freezing** — it calls the
  exported `flush_changes()` from `designs.ts` immediately before cloning `blue`, so the
  `save_token` written to the new version always matches what the design was just persisted
  with (the debounced autosave alone can't guarantee this at click-time)
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
- **Compile assets come from the bucket mount** (`ASSETS_DIR=/mnt/assets` via GCS FUSE, set
  in `deploy_server`; fonts default to `<assets_dir>/fonts`) — new fonts/templates are
  published from the bookcover repo, not a server redeploy; locally `serve_server` points at
  the untracked `assets/` dir (a copy/symlink of the bookcover repo's assets tree)
- **Server caches are per-instance best-effort** (like the per-uid compile throttle):
  `server/src/content.ts` keeps the fetch.bible collection (1h TTL) and an LRU of fetched
  books warm across compiles, but a fresh instance starts cold — never rely on them


## i18n

- **No i18n library.** `services/i18n.ts` is a ~70-line homegrown module: `translate(key,
  params?)` does a flat catalog lookup with `{named}` placeholder substitution and `eng`
  fallback; `useI18n()` returns `{t, locale}`; the default export is a Vue plugin that adds
  `$t`. Rationale: the app targets 800+ machine-translated locales, where an ICU/format
  library is dead weight (MT mangles ICU syntax; CLDR plural data doesn't exist for most
  targets) — see [[i18n-symbolic-keys-migration]].
- **Symbolic keys**, not English strings: `$t('options.style.justify')`. Catalogs are flat
  JSON keyed by ISO 639-3 (`app/src/locales/eng.json` = source of truth with real English,
  `vie.json` = Vietnamese, ...). `eng` is bundled + is the fallback; other locales load on
  demand. `services/locale.ts` maps the browser's BCP-47 tag to a locale code.
  `app/src/locales.json` lists `source` + `supported` (not `eng`).
- **Messages are plain strings** with `{named}` placeholders only — no ICU, no plural/select
  syntax. Plurals / branching are done in calling code by picking the key
  (`t(n === 1 ? 'x.one' : 'x.other', {n})` — see `count_phrase()` in `blueprints.ts`) or
  designed out (label:value). Keys assembled at runtime like that are invisible to the
  usage scanner — list their prefix in `app/i18n/dynamic_keys.json` so they don't read as
  unused.
- `app/src/locales/.state/<loc>.json` records the English each translation was made from,
  so staleness is detectable when the source string is reworded.
- Tooling (`app/i18n/`, run via `.bin/i18n_*`):
  - `.bin/i18n_status` — per-locale coverage: missing / stale / orphan, plus source-level
    undefined (`$t` key not in `eng.json`) and unused keys
  - `.bin/i18n_extract [--prune]` — reconcile `eng.json` with `$t()` call sites
  - `.bin/i18n_sync [--bless [key ...]]` — canonicalise all catalogs + drop orphans;
    `--bless` records current English as the translation base after a translation batch
  - `.bin/i18n_check [--allow-missing]` — CI gate: canonical form, no undefined/unused,
    no orphan/stale, `{placeholder}` parity. `--allow-missing` tolerates untranslated keys
    while a locale is still being filled in
- **Adding a UI string:** wrap it as `$t('namespace.key')`, add `namespace.key` → English to
  `eng.json`, optionally note usage in `app/i18n/context.json`, then translate (or run
  `.bin/i18n_status` to see the gap). **Renaming English:** edit `eng.json`, `i18n_status`
  flags every locale as stale, retranslate, then `.bin/i18n_sync --bless`.
