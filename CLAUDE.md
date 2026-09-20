
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
  + Cloud Storage (PDFs, uploaded fonts and images, error reports)
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
6. PDFs live in Storage for 1 year (GCS lifecycle rule); *only the PDFs expire* — the
   metadata and the design's frozen `version_assets/` snapshots stay, so the PDF can be
   regenerated (same hybrid path) afterwards
7. Designs can be shared via a secret invite link (adds the recipient as an editor); versions
   are public by id alone — sharing them is just sharing the `/designs/{id}/{version}` URL, no
   token involved. Viewing someone else's version (without edit access) records a
   `users/{uid}/viewed/{design_id}` entry, surfaced as "Read access" on `/designs`

### Key architectural patterns

- **Anonymous-first auth:** everyone is a real Firebase Auth user; linking keeps the
  uid, credential conflicts trigger a server-side account merge (`/api/merge_account`)
- **Immutable versions:** Firestore rules forbid changing `blueprint`/`owner`/`created`/
  `design_id`/`copied_from`/`custom_fonts`/`save_token`/`wizard_draft`/`simple_mode`/
  `pdf_path`/`title`/`cover_render_version`; only lifecycle fields (status/pages/expiry/
  error) may change. "Keep own copy" creates both a new design and a new version under the
  recipient (server-mediated, Admin SDK, since it writes under a different owner) — see
  `handle_copy_version()` in `server/src/share.ts`
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
  to the light service (Vite proxies everything to `localhost:8788` in dev) — no CORS anywhere.
  Light routes: `design_invite_preview`, `redeem_design_invite`, `design_editors`,
  `copy_version`, `duplicate_design`, `delete_design`, `delete_version`,
  `reconcile_design_assets`, `touch_assets`, `merge_account`, `report_error`
  (unauthenticated), plus `health` on both
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
  firebase_storage.rules            # Per-design asset prefixes + create-once version PDFs;
                                    #   no delete anywhere (server-only), no list
  firebase_storage_lifecycle.json   # Deletes versions/**.pdf (365d), design_cache/ (90d),
                                    #   errors/ (90d) — applied via gcloud, see setup_firebase
  .bin/                    # All dev/deploy commands (package.json has no scripts)
    setup                  # npm install
    setup_typst            # Download the Typst CLI binary to .bin/typst (gitignored)
    setup_firebase         # One-time per-project GCP setup (lifecycle, Firestore TTL policies,
                            #   assets-bucket mount IAM)
    build_typst            # Build all local TS packages in dependency order
    serve_app              # Vite dev server (port 5300)
    serve_emulators        # Firebase emulator suite (auth 9099, firestore 8080, storage 9199)
    serve_server           # Local API server against the emulators (port 8788)
    deploy_app             # vite build + firebase deploy (hosting, rules)
    build_server           # Stage server/deploy/ (allowlisted Docker build context)
    deploy_server          # Runs build_server, gcloud run deploy of both services from one build
    i18n_status/_sync/_check/_extract  # Translation tooling (logic in app/i18n/); see i18n section
    audit_e2e              # Playwright e2e tests (needs the dev stack running; see e2e/)
    audit_stress           # Compile stress ladder, browser (WASM) + server (see e2e/tiers.ts)
    audit_errors           # Download + triage error reports (TUI; claude groups them)
    gen_lulu_prices        # Refresh Lulu's print prices (run by deploy_app)
  app/                     # The Vue SPA (workspace)
    src/
      init.ts              # ** APP ENTRY POINT ** auth → content → designs → router → mount
      comp/                # Components: View*/Editor*/Options*/Display*/Dialog*/App*
        nav/               # AppNavbar (last 3 designs, "View all", "New")
        views/             # Route components (ViewDesigns, ViewDesign, ViewAbout,
                            #   ViewDesignInvite, ViewVersionShortlink) + the two editor
                            #   modes ViewDesignSimple / ViewDesignEditor
          assets/          # DesignListItem, DesignVersionsList, DesignVersionItem
        dialogs/           # All mounted once in AppRoot (DialogConfirm/Prompt/Alert,
                            #   DialogAccount, DialogNewDesign, DialogCoverEditor, ...)
          assets/          # The new-design wizard's per-step panels (NewDesign*)
      services/
        i18n.ts            # Homegrown i18n (no lib): flat catalog lookup + {placeholder} + $t
        locale.ts          # Browser BCP-47 → ISO 639-3 locale detection
        firebase.ts        # Firebase init (config committed; emulators in dev)
        auth.ts            # Anonymous auth, Google/email-link upgrade, merge trigger
        account.ts         # Account switching: release/reload user data, deferred email-link
        api.ts             # fetch wrapper for /api/* with ID token
        router.ts          # vue-router: /designs, /designs/:id[/:version],
                            #   /designs/:id/invite/:token, /v/:id, /about
        state.ts           # Reactive `blue` (open design), `state` (splash/editor/dialogs/toasts)
        designs.ts         # Multi-design sync: converters, debounced diff writes, sharing,
                            #   wizard state, viewed-designs ("Read access") sync
        versions.ts        # Version lifecycle: freeze, compile+upload, regen, sharing,
                            #   design_needs_editor / latest_version computeds, compile_stats
        new_design.ts      # The creation wizard: NewDesignDraft + WizardState, type presets,
                            #   step validation, build_new_blueprint()
        custom_fonts.ts    # Uploaded fonts: reactive set + online library + version snapshots
        content_images.ts  # Uploaded passage images: upload, styling, version snapshots
        image_frame.ts     # Canvas masking for the painted/torn image styles
        design_assets.ts   # Asset copy/existence plumbing + request_reconcile()
        asset_suggestions.ts  # Reusing a font / cover bg from the user's other designs
        version_assets.ts  # Client-side inverse of the freeze: snapshot → design's own prefix
        cover.ts           # Cover config, bookcover widget bridge, render cache, snapshots
        cover_worker.ts    # The cover render worker
        minimal_cover.ts   # The no-cover "minimal ink" title/copyright content pages
        stories.ts         # Predefined picture stories (fetch + slide assembly)
        content.ts         # Bible data service (fetch-client via paper-bible-typst)
        blueprints.ts      # Default blueprint + clean_blueprint() validation + display helpers
        printing_services.ts  # Service picker items over printing-services
        print_cost.ts      # Lulu cost estimates: Blueprint→POD package id, quote, country guess
        lulu_prices.ts     # Price/page-limit lookups over lulu_prices.json (generated)
        lulu_skus.ts       # Blueprint options <-> Lulu POD package ids (shared with tools/)
        lulu_countries.ts  # Destinations Lulu delivers to + which currency to quote each in
        typst.ts           # TypstWorkerClient (WASM worker mgmt, worn-worker recycle)
        typst_worker.ts    # The worker: WASM compiler via paper-bible-typst-web
        watchers.ts        # Auto-fetch book content as the design changes
        errors.ts          # Error capture/reporting (imported first, before everything)
        coloris.ts / color_palette.ts / icons.ts / fonts.ts / display.ts / examples.ts /
          utils.ts         # Pickers, icon + font manifests, breakpoints, examples, tokens
    i18n/                  # Translation tooling (node, own tsconfig; excluded from app tsconfig)
                            #   lib/status/sync/check/extract + context.json/glossary.json
    tools/                 # Other node tooling (own tsconfig): gen_lulu_prices.ts
  server/                  # Cloud Run API server (workspace; run directly by node)
    Dockerfile             # Cloud Run image: node + workspaces + typst CLI (no fonts baked)
    deploy/                # Staged build context (gitignored; written by .bin/build_server)
    src/index.ts           # Hono routes, gated by SERVER_ROLES: compile | light (share/merge)
    src/compile.ts         # compile_pdf_from_blueprint + upload + doc update
    src/quota.ts           # per-uid daily caps on the expensive routes (compile, copy_version)
    src/content.ts         # Shared BibleContent: collection TTL + LRU book cache
    src/share.ts           # Share-token redemption, shared views, keep-own-copy
    src/assets.ts          # Asset path collection, copying, sweeping + reconcile/touch
    src/designs.ts         # Design lifecycle: delete design/version, duplicate design
    src/batch.ts           # ChunkedBatch (shared by merge + design deletion)
    src/merge.ts           # Guest→existing account data merge
    src/auth.ts            # ID-token verification for authed routes
    src/firebase.ts        # Admin SDK init (admin_db / admin_bucket / admin_auth)
    src/config.ts          # Env-derived config (roles, ports, assets dir, dev flag)
    src/errors.ts          # ErrorRecord + save_error() → errors/{fingerprint}/{id}.json
  errors/             # .bin/audit_errors internals: bucket sync, claude clustering, triage TUI
  branding/           # Source icon/social/splash artwork
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
users/{uid}/viewed/{design_id}   {design_id, title, last_version_id, last_viewed}  # read access

designs/{design_id}           # editable, multi-user
    schema, owner, editor_uids (includes owner), editors:{uid:{joined}}
    share_token|null          # edit invite (always set at create)
    name, name_auto, save_token, created, modified, category|null
    latest_version:{status, pages, save_token}|null   # denormalized newest-version summary,
                               #   kept current by every compile path (see design_needs_version)
    blueprint:{...options}    # Blueprint minus content + name (see split_blueprint_doc)
    content_items:{id:item}, content_order:[id]
    wizard_draft|null, simple_mode   # WizardState — see new_design.ts
    fonts:{font_id:{family, style, files:[design_assets/... paths]}}   # uploaded fonts, a
                               #   merge-safe map like content_items (see custom_fonts.ts)

versions/{version_id}         # immutable once created, publicly readable by id (no share_token)
    schema, design_id         # FK to the parent design (not a subcollection — see below)
    owner, created, compile_started, title
    status: pending|available|failed, pages, error|null, error_id|null
    blueprint (frozen), pdf_path, pdf_expires
    cover_status: available|failed|null, cover_render_version|null  # bookcover RENDER_VERSION
    copied_from|null, save_token   # copied verbatim from the parent design at freeze time
    custom_fonts:[{family, style, files:[version_assets/{design_id}/... paths]}]
    wizard_draft|null, simple_mode   # frozen from the design, same field names (WizardState)

compile_stats/{id}   # write-only telemetry, one row per interior compile attempt (browser or
                     #   server). Never read in-app; analysed offline via Firestore export
compile_quota/{uid}  # cross-instance per-user daily cap on server compiles
copy_quota/{uid}     # ditto for "keep own copy" (/api/copy_version)
                     #   Both are {day, count, expires}, Admin SDK only and matching no client
                     #   rule, so a caller can neither read nor reset their own count.
                     #   One helper: quota_allows() in server/src/quota.ts
```

Every `compile_stats` and `*_quota` row carries an `expires` field with a Firestore native
TTL policy on it (enabled by `.bin/setup_firebase`): ~1 year and ~1 week respectively.
**A new quota collection needs three things or it leaks**: an entry in `QUOTA_COLLECTIONS`
(so account deletion sweeps it), a `gcloud firestore fields ttls` line in `.bin/setup_firebase`
(so rows expire), and a `quota_allows()` call on the route itself.

`versions` is a flat collection + `design_id` FK, not a physical subcollection of `designs` —
versions need independent public-read-by-id ACLs and to be queried both by parent design
(`ViewDesign.vue`'s version list) and standalone (a bare version link); a subcollection would
make the ACL story worse (`get()`-based ownership resolution) for no benefit.

Storage:

Uploads belong to a **design**, not an account — the design is the only scope in which "is
anything still referencing this?" is answerable, which is what makes deletion possible at all.
Basenames are content-addressed (sha256 + ext), and the *same* basename identifies an asset in
each prefix, so freezing a version is a prefix swap plus an existence check rather than a copy
(see `typst/src/asset_paths.ts`, shared by client and server).

```
design_assets/{design_id}/{hash}.{ext}    # what the live design references (images + fonts).
                                          #   Swept by the server when the design stops naming it
version_assets/{design_id}/{hash}.{ext}   # frozen snapshots shared by every version of the
                                          #   design. Append-only by rule, so a design edit can
                                          #   never change what a published version renders
design_cache/{design_id}/*.png            # regenerable painted/torn variants, swept at 90d
versions/{version_id}/doc.pdf, cover.pdf  # rendered output only — swept at 365d, then
                                          #   regenerated from the frozen blueprint + snapshots
errors/{fingerprint}/{id}.json            # error reports, swept at 90d
```

All publicly readable by path (ids are unguessable url64 tokens); writes authorise against the
*design* doc's `editor_uids` via `firestore.get()`. Nothing is listable, and **nothing grants
delete** — removal is Admin-SDK only (see `server/src/assets.ts`), which is what stops one
editor destroying the inputs another's published version renders from.


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
- **Playwright e2e/stress** lives in `e2e/` (run via `.bin/audit_e2e`, needs the dev stack
  running). Browsers install into `e2e/browsers/` (gitignored) — keep them inside the
  repo, apt/system state doesn't persist across dev-container rebuilds. The compile stress
  harness (`.bin/audit_stress`, results in `e2e/results/`) compiles the same size tiers in
  the browser (WASM worker) and the server pipeline; `STRESS_BOOKS="psa,pro"` probes a custom
  book set. A layout-option matrix (`e2e/matrix.ts`) isolates which blueprint options drive
  Typst memory — run `node e2e/stress_matrix.ts` (server) or `.bin/audit_e2e
  stress_matrix.test.ts` (browser), filtered via `STRESS_CONFIGS="psa_col1,full_col1"`

### Deployment (per project alias: dev/prod)

1. Firebase console: create project, Blaze plan, enable Auth (Anonymous/Google/Email
   link), Firestore, Storage; copy the web config into `app/src/services/firebase.ts`
2. Publish the assets bucket from the bookcover repo (it owns bucket creation, CORS and
   content — the compile service mounts it and the app fetches from it)
3. `.bin/setup_firebase <project-id>` — Storage lifecycle rules, Firestore TTL policies
   (`compile_stats`, `compile_quota`, `copy_quota`), assets-bucket volume-mount IAM
4. `.bin/deploy_server <project-id>`, `.bin/deploy_app [alias]`


## Code Style & Conventions

- **No semicolons**, **snake_case** functions/variables, **CamelCase** classes
- **4-space indent**, 100-char lines (may exceed in Pug/markup)
- **Single quotes**; **double quotes** for UI-displayed text (always via `$t("...")`)
- **No space** before types: `name:string`; imports like `import {a, b} from 'x'`
- **Comment** every function/class and before every chunk of code
- Vue SFCs: Pug templates, SugarSS styles (`<style lang='sss'>`), template → script → style
  order. SugarSS is indented *CSS* (a PostCSS syntax, not a preprocessor): nesting is expanded
  by `postcss-nested` (`app/postcss.config.mjs`) and there are no variables, mixins or
  functions — use CSS custom properties and `calc()`. The assets base URL for stylesheets is
  the one exception: `$assets_prefix` in a value is substituted per environment by that config
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
- **Deleting is server-only.** `/api/delete_design` and `/api/delete_version` exist because
  clients have no delete rule on any asset prefix, and because Firestore only lets a version's
  own creator delete it — so a shared design's co-editor versions would otherwise outlive it.
  Both are idempotent and delete the design/version doc *last*, so a partial failure leaves a
  retryable handle rather than orphans
- **Unreferenced assets are reclaimed by `/api/reconcile_design_assets`**, not by the client
  that made the change: the server re-reads the design doc, so it sees co-editors' concurrent
  edits. It also skips anything created in the last 10 minutes — an upload lands before the
  debounced doc write that names it, and a concurrent reconcile in that gap would otherwise
  delete a file the doc simply doesn't mention yet
- **PDF_LIFETIME_MS** (client `versions.ts`, server `compile.ts`/`share.ts`) must match
  `firebase_storage_lifecycle.json` (365 days)
- **A copy of a version yields two blueprints, not one** — the new *version* points at
  `version_assets/`, the new *design* at `design_assets/`, both under the new design's id
  (`repath_assets` in server/src/assets.ts; `version_assets.ts` client-side). And copy only
  the basenames that version *references*: a design's `version_assets/` prefix is shared by
  every version it ever had, so copying it wholesale would hand the recipient images from
  versions never shared with them
- **`generate()` (`ViewDesignEditor.vue`) must force-flush before freezing** — it calls the
  exported `flush_changes()` from `designs.ts` immediately before cloning `blue`, so the
  `save_token` written to the new version always matches what the design was just persisted
  with (the debounced autosave alone can't guarantee this at click-time)
- **Lambda-era leftovers** live under `.private/generator/` — dead code, ignore
- **WASM memory:** the Typst worker leaks per unique source; `TypstWorkerClient`
  recycles worn workers automatically (see `typst.ts`)
- **clean_blueprint()** (`blueprints.ts`) validates untrusted blueprints (Firestore docs
  from co-editors) via the zod schemas in `typst/src/blueprint_schema.ts`, content items
  included. Those schemas are type-locked to the interfaces in `typst/src/types.ts` with
  `satisfies z.ZodType<...>`, so adding a Blueprint field without a schema entry (or vice
  versa) is a compile error. `clean_wizard_draft()`/`read_wizard_state()` in `new_design.ts`
  do the same job for the wizard draft, which is stored beside the blueprint
- **Units are printing-services' spelling everywhere** (`MeasureUnit = 'mm'|'inch'`, used by
  both `custom_unit` and `margin_unit`). Typst wants `in`, not `inch` — `typst_unit()` in
  `typst/src/trim.ts` is the single place that converts, applied where a length *string* is
  built. Don't reintroduce a second unit vocabulary into the Blueprint
- **The cover editor's bg bytes round-trip unmodified**, and `handle_finished()` in
  `DialogCoverEditor.vue` depends on it: it hashes the returned File to tell an untouched
  background from a new one, so a re-encode on the widget's side would mint a fresh Storage
  object every time the editor was opened and closed. That's a contract of the embed protocol,
  documented on `FormState.bg_image` in bookcover-core — not an accident of the current build
- **Background suggestions are resolved lazily, and only from what was offered.** InitMessage
  carries `bg_suggestions` (thumbnail urls for backgrounds the user's *other* designs use);
  when one is picked the widget asks for the bytes by echoing back the id, and the app answers
  from the map it sent (`sent_bg_suggestions`), never from the live list and never from an
  arbitrary path the iframe names. Only custom uploads are ever suggested — routing a builtin
  through here would turn a reference to a shipped image into a private copy of its bytes
- **`touch_assets` is deliberately inert.** Opening a design fire-and-forgets
  `POST /api/touch_assets`, which stamps GCS `customTime` on every upload it depends on. No
  lifecycle rule reads it yet, and none should until the stamping has run long enough to be
  trusted — a `daysSinceCustomTime` rule turned on early would delete files that simply
  hadn't been visited
- **Error reporting is self-hosted:** browser errors POST to `/api/report_error`
  (unauthenticated OK, uid attached when known, IP recorded server-side) and everything
  lands in the bucket as `errors/{fingerprint}/{id}.json` (90-day lifecycle). The
  fingerprint only dedupes identical messages — semantic grouping happens in
  `.bin/audit_errors` (claude clusters fingerprints into issues; triage state in gitignored
  `errors/records/`).
  Critical failures show the report id in a gracious.tech/contact link
- **SERVER_ROLES gates routes, Hosting gates traffic** — both must agree: `/api/compile`
  is rewritten to `paper-bible-compile` (role `compile`), everything else to
  `paper-bible-api` (role `light`); dev defaults to both roles on one port
- **The CSP in `firebase.json` is enforced, and JSON can't hold comments** — so the reasoning
  lives here. It fails in production only, since Hosting headers never reach the Vite dev
  server. It's split two ways on purpose: **`default-src` is the content allowlist** (every
  origin the app loads images, fonts, video or fetch responses from — one list, rather than
  repeating the same hosts across `img-src`/`font-src`/`connect-src`), while every directive
  that can execute or be navigated to is **pinned separately and never inherits it**:
  - `script-src` — `'wasm-unsafe-eval'` is the Typst WASM compiler, i.e. the browser's whole
    render path. `apis.google.com` is Firebase Auth's popup plumbing
  - `frame-src` — `paper-bible.firebaseapp.com` is Auth's hidden iframe (the authDomain from
    `firebase.ts`, so it changes with the project alias); `blob:` is how every PDF preview
    renders. Drop either and sign-in or the preview dies
  - `worker-src 'self'` — deliberately without `blob:`, and explicit so it can't fall back to
    `script-src`. Vite emits both workers as same-origin chunks (check `dist/assets/`), so
    blob workers would be XSS surface bought for nothing
  - `style-src` needs `'unsafe-inline'` twice over: Vuetify's inline `style` attributes, and
    the loading-spinner `<style>` the index.pug plugin inlines into `dist/index.html`
  - `object-src`/`base-uri`/`form-action`/`frame-ancestors` — the cheap always-on locks

  `blob:` in `default-src` is load-bearing for `connect-src`: custom fonts become blob URLs
  that typst.ts then *fetches*. Custom font **previews** don't need it — those go through
  `new FontFace(family, bytes)`, which CSP doesn't govern at all.
  Three origins appear in the bundle and are deliberately *not* allowed, because nothing
  reaches them: `packages.typst.org` (no `@preview` imports exist in generated source),
  `cdn.jsdelivr.net` (typst.ts's default font assets, disabled by `{assets: false}` in
  `typst-web`), and `www.google.com/recaptcha` (Firebase Auth loads it only under reCAPTCHA
  Enterprise, which this project doesn't use). **Enabling reCAPTCHA Enterprise or SMS
  protections in the Firebase console would silently require adding `https://www.google.com`
  to `script-src` and `frame-src`** — a console change that breaks sign-in via a file nobody
  would think to edit
- **`Referrer-Policy` is load-bearing, not hygiene** — a version id *is* the capability to
  read that PDF (rules allow public read by id alone), so without it every outbound click
  from `/designs/{id}/{version}` hands the whole URL to the destination in `Referer`
- **Compile assets come from the bucket mount** (`ASSETS_DIR=/mnt/assets` via GCS FUSE, set
  in `deploy_server`; fonts default to `<assets_dir>/fonts`) — new fonts/templates are
  published from the bookcover repo, not a server redeploy; locally `serve_server` points at
  the untracked `assets/` dir (a copy/symlink of the bookcover repo's assets tree)
- **Server caches are per-instance best-effort** (like the per-uid compile throttle):
  `server/src/content.ts` keeps the fetch.bible collection (1h TTL) and an LRU of fetched
  books warm across compiles, but a fresh instance starts cold — never rely on them
- **Lulu cost estimates need no credentials, by design** (`print_cost.ts`): a quote is Lulu's
  published print price (`lulu_prices.ts`) plus a live delivery quote from their
  `/shipping-options/` endpoint, which is unauthenticated, CORS-open, and prices purely by
  country — a street address changes nothing, so none is sent. Both halves were verified
  byte-identical to Lulu's *authenticated* cost calculation, so this is the same arithmetic
  without the secret. It deliberately can't see sales tax or Lulu's handling fee; the estimate
  says it's pre-tax, and users buy on lulu.com retail where tax is presented separately anyway.
  Beware two traps: Lulu prices each currency **independently** (the AUD/USD ratio ranges 1.21
  to 2.11 across their catalogue), so never FX-convert one into another — pick the currency and
  read that column. Prices are never hand-written: `.bin/gen_lulu_prices` fetches Lulu's
  published spec sheet (a public .xlsx, unzipped and parsed with node built-ins — no library)
  and regenerates `lulu_prices.json`, and `deploy_app` runs it, so each deploy ships current
  prices and a Lulu re-price lands as a reviewable diff. They're only as fresh as the last
  deploy. The generated limits are also stricter than the ones printing-services models
  (landscape perfect-bound caps at 250 pages, not 800)


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
