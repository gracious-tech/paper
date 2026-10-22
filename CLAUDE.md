
# Paper Bible (paper.bible)

Web application for creating customized, printable Bible documents in professional
book/booklet format. Users select Bible passages from 1,000+ languages, customize
styling (fonts, margins, columns), add decorative title pages and custom content,
then generate print-ready PDFs — compiled in the browser via Typst (WASM), with a
server fallback for low-memory devices.

Live at [paper.bible](https://paper.bible). MIT No Attribution license.


## Architecture & Data Flow

**Frontend:** Vue 3 SPA (Vite + Vuetify 3 + TypeScript + vue-router), hosted on S3 + CloudFront
  (AWS, `us-west-2`, one CloudFormation stack — see `infra/cloudformation.yml`)
**Data:** Firebase Auth (anonymous by default) + Firestore (designs, version metadata)
  + Cloud Storage (PDFs, uploaded fonts and images, error reports) — these three stay on
  Firebase; only hosting and compute moved to AWS
**PDF engine:** Typst — in the browser via a WASM worker, and on a Lambda function (Typst CLI)
  as fallback/regeneration path
**API:** one server codebase deployed as two Lambda functions sharing one container image
  (`SERVER_ROLES` env picks the handler): `paper-bible-light` (every `/api` route, 512MB),
  behind one API Gateway HTTP API that CloudFront routes `/api/*` to, and `paper-bible-compile`
  (3GB/4GB ephemeral storage, fonts synced from S3 into `/tmp` on cold start — see
  `server/src/lambda_bootstrap.ts`), which has no HTTP route at all: light's `/api/compile`
  checks a compile and invokes it asynchronously
**Shared assets:** the public assets bucket (`https://assets.paper.bible/`, S3 + CloudFront,
  same AWS account) is owned and published by the separate
  [bookcover repo](https://github.com/gracious-tech/bookcover) — top-level dirs: `fonts/`
  (curated set + Noto fallbacks), `docs/`/`frames/`/`backgrounds/` (bookcover generator
  assets), and `typst/<npm version>/` (vendored typst.ts WASM, write-once since consumers pin
  version dirs with immutable caching). In dev the bookcover repo's dev server serves the same
  tree at `http://localhost:5301/generator_assets/` (see `ASSETS_PREFIX` in
  `app/src/services/typst.ts`); the compile Lambda syncs `fonts/`/`backgrounds/` from the
  bucket directly (same-account IAM, not a public fetch) into its own `/tmp` on first
  invocation per execution environment, since Lambda has no bucket-as-filesystem mount the way
  Cloud Run's GCS FUSE volume did

### Data flow: user input to PDF

1. Every visitor is signed in anonymously (`ensure_signed_in()` in `auth.ts`); sign-in
   with Google/email-link upgrades the account in place (work retained)
2. The user edits a design's `Blueprint` — the reactive `blue` singleton mirrors the
   currently open Firestore `designs/{id}` doc (`designs.ts` syncs both directions, debounced
   field-level writes so co-editors don't clobber each other)
3. `DisplayPreview.vue` compiles a truncated preview in the browser as they edit
4. On "Build it" (`BtnGenerate.vue`), the design is force-flushed then frozen into an
   immutable `versions/{id}` doc (blueprint + custom-font snapshot + the design's current
   `save_token`), then compiled in the browser and uploaded to Storage
   (`versions.ts: compile_and_upload`)
5. If the in-browser (WASM) compile fails, the client calls `POST /api/compile`, which answers
   `202` once it has accepted the job; the compile Lambda then compiles the same frozen
   blueprint with the Typst CLI and records the outcome on the version doc (see the
   async-compile gotcha)
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
- **Same-origin API:** CloudFront routes `/api/*` to one API Gateway HTTP API, which routes
  everything (`ANY /api/{proxy+}`) to the light Lambda (Vite proxies everything to
  `localhost:8788` in dev) — no CORS anywhere.
  Light routes: `compile` (accepts and dispatches only), `design_invite_preview`,
  `redeem_design_invite`, `design_editors`, `copy_version`, `duplicate_design`, `delete_design`, `delete_version`,
  `reconcile_design_assets`, `touch_assets`, `merge_account`, `report_error`
  (unauthenticated), plus `health` on both roles
- **Static-content skew:** Bible translations (1000+ in prod) and Noto fallback fonts (192
  families) are barely-changing content with heavily skewed popularity — the compile Lambda
  fetches both on demand (fonts via an S3 sync into `/tmp` on cold start, books via
  fetch.bible) and keeps books warm in a per-execution-environment LRU (`server/src/content.ts`)
  rather than baking anything in


## Monorepo layout (npm workspaces)

```
paper_bible/
  firebase.json            # Firestore/Storage rules refs + emulator ports only — hosting and
                            #   compute are AWS now (see infra/), not Firebase Hosting/Cloud Run
  .firebaserc              # Project aliases (default/dev/prod)
  .github/workflows/
    deploy.yml             # Every push to main: lulu → lulu_push (price check if due), build
                            #   (typecheck, audit_unit, plan, build) beside e2e (audit_e2e),
                            #   deploy (what changed) —
                            #   see "Deploys run in GitHub Actions" in Gotchas
  infra/
    github_ci.yml          # The CI stack (paper-bible-ci, deployed once by setup_ci_aws): the
                            #   OIDC-assumed deploy role + the CloudFormation service role
    cloudformation.yml     # The one AWS stack (us-west-2): S3+CloudFront for the app, API
                            #   Gateway + 2 Lambda functions (light/compile) for the server,
                            #   IAM, Secrets Manager (GCP creds), CloudWatch log groups. The ACM
                            #   cert and ECR repo are deliberately NOT resources here — both have
                            #   a chicken-and-egg problem with a from-scratch deploy (DNS
                            #   validation needs a human step; a fresh Lambda needs a real image
                            #   to reference at creation) — see .bin/deploy_aws
  firestore.rules          # Designs/versions/users access rules
  firestore.indexes.json   # designs editor_uids+modified, versions design_id+created
  firebase_storage.rules            # Per-design asset prefixes + create-once version PDFs;
                                    #   no delete anywhere (server-only), no list
  firebase_storage_lifecycle.json   # Deletes versions/**.pdf (365d), design_cache/ (90d),
                                    #   errors/ (90d) — applied via gcloud, see deploy_firebase_initial
  firebase_test.json       # Emulator config for the test suites only — same rules files, its
                            #   own ports, no import/export (see the Testing section)
  firebase_e2e.json        # Ditto for the Playwright journeys (e2e/), on ports of their own again
  .bin/                    # All dev/deploy commands (package.json has no scripts)
    setup                  # npm install
    setup_typst            # Download the Typst CLI binary to .bin/typst (gitignored)
    deploy_firebase_initial  # One-time per-project Firebase setup (Storage lifecycle rules,
                            #   Firestore TTL policies) — hosting/compute setup is deploy_aws now
    deploy_aws             # One-time (re-runnable) AWS provisioning: requests/finds the ACM
                            #   cert (us-east-1, DNS-validated at Porkbun — a human step, so
                            #   this stops and prints the record on a first run), seeds a
                            #   placeholder ECR image so the stack's Lambda functions have
                            #   something to reference on first create, then deploys
                            #   infra/cloudformation.yml
    build_typst            # Build all local TS packages in dependency order
    serve_app              # Vite dev server (port 5300)
    serve_emulators        # Firebase emulator suite (auth 9099, firestore 8080, storage 9199)
    serve_emulators_test   # The *test* emulators (auth 9098, firestore 8081, storage 9198) —
                            #   optional, keeps audit_unit warm between runs
    serve_simple           # One-command dev stack for quick fixes: in-memory emulators + app,
                            #   production fetch.bible/assets/cover widget (USE_PROD_SERVICES),
                            #   no API server
    serve_server           # Local API server against the emulators (port 8788; runs
                            #   server/src/dev_server.ts, not the Lambda entry point)
    build_app              # i18n_check + build_typst + vite build, into app/dist
    deploy_app             # Pure content shipping, no CloudFormation: build_app (unless
                            #   --prebuilt), sourcemaps to the site bucket's sourcemaps/, two-tier
                            #   `aws s3 sync` (immutable for hashed assets/, no-cache for
                            #   index.html etc), then a small CloudFront invalidation. Old
                            #   builds' assets/ stay 30 days past their last deploy (per-deploy
                            #   manifests in deploys/), so open tabs can still lazy-load chunks
    deploy_firebase        # firebase deploy --only firestore,storage — rules/indexes only,
                            #   run on every deploy (not one-time, unlike deploy_firebase_initial)
    build_server_lambda     # Stage server/deploy/ (allowlisted context for Dockerfile.lambda),
                            #   docker build tagged with the current commit hash (runs
                            #   setup_typst first if .bin/typst isn't the pinned version)
    push_server_lambda      # docker push the built image to ECR
    deploy_api              # build_server_lambda + push_server_lambda (handed to the host when
                            #   there's no docker daemon), then deploy_stack with the new image
    deploy_stack            # `cloudformation deploy` of the local template, overriding at most
                            #   ImageUri (every other parameter keeps its stack value)
    deploy_plan             # Which deploy steps HEAD needs, by diffing each step's inputs
                            #   against its deployed/<step> tag; mark_deployed moves the tag
    setup_ci_aws / setup_ci_gcp  # One-off: OIDC trust for GitHub Actions on each side, and the
                            #   repository variables deploy.yml reads
    i18n_status/_job/_apply/_check/_sync/_extract  # Translation tooling (logic in app/i18n/);
                            #   see the i18n section and .claude/skills/translate
    audit_unit             # Every unit/integration suite (typst, typst-node, app, rules,
                            #   server, i18n) — starts its own emulators; see the Testing section
    audit_e2e              # Playwright journeys, desktop + mobile — starts its own stack, runs
                            #   in CI (see e2e/ and the Testing section)
    audit_stress           # Compile stress ladder, browser (WASM) + server (see e2e/tiers.ts)
    audit_errors           # Move error reports out of the bucket + triage them (TUI; claude
                            #   groups, shortlists and auto-fixes them for review). Syncs the
                            #   site bucket's sourcemaps/ into errors/sourcemaps/ first
    gen_lulu_prices        # Regenerate Lulu's print prices
    gen_example_images     # Render the example designs' 3D cover pictures, per UI locale (see
                            #   "Example pictures" in Gotchas) — local only, results committed
    gen_type_images        # Render the new-design wizard's type pictures in each UI locale's
                            #   Bible (see "Type pictures" in Gotchas) — results committed
    refresh_lulu_prices    # gen_lulu_prices + commit a re-price, if the checked/lulu_prices
                            #   tag is over 30 days old. --due/--commit are the halves CI runs
                            #   in separate jobs
  app/                     # The Vue SPA (workspace)
    src/
      init.ts              # ** APP ENTRY POINT ** auth → content → designs → router → mount
      comp/                # Components: View*/Editor*/Options*/Display*/Dialog*/App*
        nav/               # AppNavbar (last 3 designs, "View all", "New")
        views/             # Route components (ViewDesigns, ViewDesign, ViewAbout,
                            #   ViewPrivacy, ViewPublishers, ViewDesignInvite,
                            #   ViewVersionShortlink) + the two editor modes
                            #   ViewDesignSimple / ViewDesignEditor
          assets/          # DesignListItem, DesignVersionsList, DesignVersionItem
        dialogs/           # All mounted once in AppRoot (DialogConfirm/Prompt/Alert,
                            #   DialogAccount, DialogNewDesign, DialogCoverEditor, ...)
          assets/          # The new-design wizard's per-step panels (NewDesign*)
      services/
        i18n.ts            # Homegrown i18n (no lib): flat catalog lookup + {placeholder} + $t
        locale.ts          # Matching the browser's language tags to the UI's (best_locale)
        firebase.ts        # Firebase init (config committed; emulators in dev)
        auth.ts            # Anonymous auth, Google/email-link upgrade, merge trigger
        account.ts         # Account switching: release/reload user data, deferred email-link
        api.ts             # fetch wrapper for /api/* with ID token
        router.ts          # vue-router: /designs, /designs/:id[/:version],
                            #   /designs/:id/invite/:token, /v/:id, /about, /privacy,
                            #   /publishers. The welcome splash shows on /designs only
                            #   (see show_splash in AppRoot.vue), so linked pages read first
        state.ts           # Reactive `blue` (open design), `state` (splash/editor/dialogs/toasts)
        designs.ts         # Multi-design sync: converters, debounced diff writes, sharing,
                            #   wizard state, viewed-designs ("Read access") sync
        versions.ts        # The read side: scoped list sync, status predicates, PDF access,
                            #   sharing, design_needs_editor / latest_version computeds
        version_compile.ts # The write side: freeze, compile+upload, regen, cover regen,
                            #   stuck-compile retry, compile_stats (imports versions.ts, not
                            #   the reverse)
        user_prefs.ts      # Account-wide prefs on users/{uid} (print-service warning seen)
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
        page_estimate.ts   # The page-count estimate from a preview-window compile: kept current
                            #   by the live preview on desktop; mobile mounts no preview, so
                            #   build/cover editor/Paper options ask for it (ensure_page_estimate)
        binding_advice.ts  # auto_binding / binding_page_issue / page_reduction_suggestions —
                            #   advice over a blueprint, never mutating one
        printing_services.ts  # Service picker items over printing-services
        print_cost.ts      # Lulu cost estimates: Blueprint→POD package id, quote, country guess
        lulu_prices.ts     # Price/page-limit lookups over lulu_prices.json (generated)
        lulu_skus.ts       # Blueprint options <-> Lulu POD package ids (shared with tools/)
        lulu_countries.ts  # Destinations Lulu delivers to + which currency to quote each in
        typst.ts           # TypstWorkerClient (WASM worker mgmt, worn-worker recycle)
        typst_worker.ts    # The worker: WASM compiler via paper-bible-typst-web
        watchers.ts        # Auto-fetch book content as the design changes
        errors.ts          # Error capture/reporting (imported first, before everything)
        example_designs.ts # The example designs (pure data + translated labels)
        examples.ts        # Building/creating a design from an example
        example_images.ts  # Each example's pre-rendered cover picture, by UI locale
        coloris.ts / color_palette.ts / icons.ts / fonts.ts / display.ts /
          utils.ts         # Pickers, icon + font manifests, breakpoints, tokens
    i18n/                  # Translation tooling (node, own tsconfig; excluded from app tsconfig)
                            #   lib/lint/status/job/apply/check/sync/extract + tests/, plus
                            #   context.json/glossary.json and style/<loc>.json;
                            #   jobs/ is transient (gitignored)
    tools/                 # Other node tooling (own tsconfig): gen_lulu_prices.ts,
                            #   gen_type_images.ts + type_images_manifest.ts,
                            #   gen_example_images.ts + example_images_manifest.ts; the
                            #   browser half, example_images/harness.ts, is app code (app tsconfig)
    tests/                 # Vitest suites for the service logic (vitest.config.mts aliases
                            #   services/content + services/state to stubs/); no component tests
  server/                  # API server (workspace) — one Hono app, three entry points onto it
    Dockerfile.lambda      # Lambda image: precompiles server/src (see tsconfig.build.json)
                            #   rather than running it directly, so the image's Node version is
                            #   decoupled from local dev's erasable-syntax-TS convention; typst
                            #   CLI baked in (no fonts — those sync from S3 at cold start)
    tsconfig.build.json    # noEmit:false / outDir:dist override of tsconfig.json, used only by
                            #   Dockerfile.lambda's build step
    deploy/                # Staged build context (gitignored; written by .bin/build_server_lambda)
    src/index.ts           # Builds and exports the bare Hono `app` — every route belongs to
                            #   the light role (compile serves none). Authed routes go
                            #   through authed_post(), which does the token + body-field checks
                            #   so a route can't be added without them
    src/dev_server.ts      # Entry point for local dev/tests: serve()s `app` over a real
                            #   listener (see .bin/serve_server, tests/server/routes.test.ts)
    src/lambda.ts           # Production entry point: light wraps `app` with hono/aws-lambda's
                            #   handle(); compile takes a CompileJob (async invocation from
                            #   light) and syncs fonts/backgrounds from S3 before compiling
    src/lambda_bootstrap.ts # The S3 sync itself (fonts/, backgrounds/ into ASSETS_DIR/tmp),
                            #   memoized per execution environment, retried on failure
    src/types.ts           # HandlerResult — what every handle_* returns
    src/compile.ts         # handle_compile (checks, lock, dispatch, 202) + run_compile
                            #   (compile_pdf_from_blueprint + upload + doc update)
    src/quota.ts           # per-uid daily caps on the expensive routes (compile, copy_version)
                            #   + the per-uid server compile lock
    src/content.ts         # Shared BibleContent: collection TTL + LRU book cache
    src/share.ts           # Share-token redemption, shared views, keep-own-copy
    src/assets.ts          # Asset path collection, copying, sweeping + reconcile/touch
    src/designs.ts         # Design lifecycle: delete design/version, duplicate design
    src/batch.ts           # ChunkedBatch (shared by merge + design deletion)
    src/merge.ts           # Guest→existing account data merge
    src/auth.ts            # ID-token verification for authed routes
    src/firebase.ts        # Admin SDK init (admin_db / admin_bucket / admin_auth) — credential
                            #   is implicit in dev (emulators) and fetched from Secrets Manager
                            #   in production, since Lambda has no Cloud-Run-style ambient ADC
    src/config.ts          # Env-derived config (roles, ports, assets dir, dev flag)
    src/errors.ts          # ErrorRecord + save_error() → errors/{fingerprint}/{id}.json
  tests/              # Emulator-backed suites (not a workspace; run via .bin/audit_unit)
    helpers/          #   emulator.ts (rules test env) + server.ts (Admin SDK fixtures)
    rules/            #   firestore.rules + firebase_storage.rules, asserted from a client
    server/           #   server/src handlers direct, plus routes.test.ts over real HTTP
  e2e/                # Playwright: one *.test.ts per area of the app (journeys + mobile), the
                      #   stack Playwright starts (stack.ts, api_server.ts), shared fixtures
                      #   (fixtures.ts), Admin SDK seeding (helpers/), plus the stress harness
  errors/             # .bin/audit_errors internals: bucket sync, claude clustering + ranking,
                      #   background fixer, triage TUI, triage.ts (the CLI its list-level
                      #   claude session applies decisions with)
  branding/           # Source icon/social/splash artwork
  typst/                   # paper-bible-typst: core (Blueprint→TypstRequest, typst gen,
                            #   split_blueprint_doc/join_blueprint_doc for Firestore doc shape)
    locales/, locales.json #   The strings it prints into books, by Bible language (the i18n
                            #   `doc` domain), compiled into src/generated/doc_strings.ts
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
compile_lock/{uid}   # {version_id, expires}: the one server compile a user may have running,
                     #   claimed by /api/compile, released by the compile (claim_compile_lock()
                     #   etc. in quota.ts). Listed in QUOTA_COLLECTIONS like the rows above
```

Every `compile_stats` and `*_quota` row carries an `expires` field with a Firestore native
TTL policy on it (enabled by `.bin/deploy_firebase_initial`): ~1 year and ~1 week respectively.
**A new quota collection needs three things or it leaks**: an entry in `QUOTA_COLLECTIONS`
(so account deletion sweeps it), a `gcloud firestore fields ttls` line in
`.bin/deploy_firebase_initial` (so rows expire), and a `quota_allows()` call on the route itself.

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

Uploads are also **type-pinned, not just size-capped**: the rules allowlist
`image/jpeg|png|webp` + `font/ttf|otf` (and `design_cache/` only `image/png`), so these prefixes
can't be used as general file hosting on a Google domain and the compile service's image
pipeline isn't fed arbitrary bytes. **Adding an upload format means editing the rules too.**
Fonts are stored under a type-neutral `.bin` basename, so `font_mime()` in `custom_fonts.ts`
sniffs the magic number (`OTTO` → otf) to label them — an upload left unlabelled gets the
browser's guess and is denied.


## Development

```bash
.bin/setup && .bin/setup_typst   # once (plus symlink/copy the bookcover repo's assets/ here)
.bin/serve_emulators    # terminal 1: Firebase emulators (persists to .emulator_data/)
.bin/serve_server       # terminal 2: API server on :8788 (against emulators)
.bin/serve_app          # terminal 3: app on :5300 (auth/firestore/storage → emulators)
```

- **Quick fixes:** `.bin/serve_simple` alone replaces all of the above. It sets
  `USE_PROD_SERVICES=true`, which `vite.config.mts` injects as `import.meta.env.USE_PROD_SERVICES`
  (always true in a build) — the one switch for fetch.bible, `ASSETS_PREFIX`, the cover widget
  and story images (plus `postcss.config.mjs` and `serve_server`'s `FETCH_ENDPOINT`). Firebase
  stays emulated, just without persistence; `/api` routes fail unless `serve_server` runs too
- The app connects to emulators automatically when `import.meta.env.DEV`
- Static assets (fonts, WASM, bookcover) are fetched from the bookcover repo's dev server at
  `http://localhost:5301/generator_assets/` — run it alongside the stack above; the embedded
  cover editor widget is the same origin
- Bible content comes from `http://localhost:8430/` in dev, `https://v1.fetch.bible/`
  in prod (`app/src/services/content.ts`; server via `FETCH_ENDPOINT` env)
- The server workspace has no build step — node runs `server/src/*.ts` directly
  (erasable-syntax TS; typecheck with `npx tsc -p server/tsconfig.json`)
- Everything but the Vue components is covered by tests — see the Testing section below
- **Playwright e2e/stress** lives in `e2e/` (journeys via `.bin/audit_e2e`, which needs nothing
  running — see the Testing section). Browsers install into `e2e/browsers/` (gitignored) — keep
  them inside the repo, apt/system state doesn't persist across dev-container rebuilds. The
  compile stress harness (`.bin/audit_stress`, results in `e2e/results/`) compiles the same
  size tiers in the browser (WASM worker) and the server pipeline, and unlike the journeys does
  need the dev content (:8430) and bookcover (:5301) servers; `STRESS_BOOKS="psa,pro"` probes a
  custom book set. A layout-option matrix (`e2e/matrix.ts`) isolates which blueprint options
  drive Typst memory — run `node e2e/stress_matrix.ts` (server) or `.bin/audit_e2e
  --project=stress stress_matrix.test.ts` (browser), filtered via
  `STRESS_CONFIGS="psa_col1,full_col1"`

### Deployment (per project alias: dev/prod)

Firestore/Auth/Storage (Firebase) and hosting/compute (AWS) are provisioned separately —
neither side knows about the other's setup process.

1. Firebase console: create project, Blaze plan, enable Auth (Anonymous/Google/Email
   link), Firestore, Storage; copy the web config into `app/src/services/firebase.ts`
2. Publish the assets bucket from the bookcover repo (it owns bucket creation, CORS and
   content — the compile Lambda reads it directly via same-account IAM, the app fetches from
   its CloudFront domain)
3. `.bin/deploy_firebase_initial <project-id>` — Storage lifecycle rules, Firestore TTL policies
   (`compile_stats`, `compile_quota`, `copy_quota`, `compile_lock`)
4. Create a GCP service account for the Lambda functions' Admin SDK credential (least
   privilege: `roles/datastore.user`, `roles/storage.objectAdmin` scoped to the Storage
   bucket, `roles/firebaseauth.admin`), download its key — `.bin/deploy_aws` prints where to
   put it (a Secrets Manager `put-secret-value` call) once the stack exists
5. `.bin/deploy_aws` — see `.bin/` list above; requests/validates the ACM cert (stops and
   prints a DNS record to add at Porkbun on a first run, re-run once added), then deploys
   `infra/cloudformation.yml`
6. Put the GCP service-account key from step 4 into the secret `.bin/deploy_aws` just created
7. `.bin/setup_ci_aws` and `.bin/setup_ci_gcp [project-id]` — let GitHub Actions deploy (OIDC
   on both sides, no stored keys) and set the repository variables `deploy.yml` reads
8. Push to `main`. The first run has no `deployed/*` tags, so it deploys everything
9. Point the domain's DNS at the printed CloudFront distribution (a Porkbun ALIAS record —
   DNS isn't on Route53, so this step is manual, not part of the CloudFormation stack)

After that, every push to `main` deploys itself. The scripts still work by hand
(`deploy_api`, `deploy_stack`, `deploy_app`, `deploy_firebase`) for a deploy outside CI.


## Testing

```bash
.bin/audit_unit                 # everything below (~1 min; starts its own emulators)
.bin/audit_unit app             # one group: typst | typst-node | app | rules | server | i18n
.bin/audit_unit rules storage   # a group plus a vitest filter
.bin/audit_e2e                  # Playwright journeys, desktop + mobile (starts its own stack)
.bin/audit_e2e cover.test.ts    # one file (any other playwright test arguments pass through)
```

| Suite | Where | Needs |
|---|---|---|
| `typst`, `typst-node` | `typst/tests/`, `typst-node/tests/` | nothing |
| app service logic | `app/tests/` | nothing |
| security rules | `tests/rules/` | the test emulators |
| server handlers + routes | `tests/server/` | the test emulators |
| user journeys | `e2e/*.test.ts` (compile and cover included) | nothing — own stack |
| compile stress | `e2e/stress_*` | the dev content + bookcover servers |

- **Emulator suites use `firebase_test.json`, never the dev emulators.** Own ports, same rules
  files, no import/export. They call `clearFirestore()` between cases, which against
  `.bin/serve_emulators` would delete whatever you were working on. `audit_unit` reuses those
  test ports if something is already listening (`.bin/serve_emulators_test`) and otherwise
  starts and stops its own
- **Every port in `firebase_test.json` is shifted, hub and logging included.** The hub (4400),
  logging (4500) and Firestore's websocket (9150) aren't derived from the emulator ports — left
  at their defaults, starting a test run while the dev stack is up **kills the dev emulators**,
  which surfaces as an unrelated "socket hang up" in whatever was talking to them
- **`env.clearStorage()` is not usable** — it only deletes objects `listAll()` reports at the
  bucket root and never descends into prefixes, so every object this app writes would survive
  it, silently inverting the create-once rules. Use `clear_storage()` from
  `tests/helpers/emulator.ts`
- **The rules suites assert from a *client* context.** Anything the server does bypasses rules
  via the Admin SDK, so it belongs in `tests/server/` instead — where the ownership checks are
  written in code and are the only thing enforcing them
- **`tests/server/routes.test.ts` spawns the real entry point** (twice, once per `SERVER_ROLES`
  value) and talks HTTP to it. It's the only way to see `authed_post()`'s token + field checks
  and the role gating, which are invisible when handlers are called directly
- **`at_later_time()`** (`tests/helpers/server.ts`) fakes only `Date`, never timers — the
  Firestore/Storage clients need real ones. It's what lets the 10-minute `SWEEP_GRACE_MS` in
  `assets.ts` be tested from both sides
- **The app suites alias two modules to stubs** (`app/vitest.config.mts`): `services/content`
  owns a live fetch-client and is null until boot, `services/state` is the open design's
  reactive singleton. Everything else is imported for real. There are **no component tests** —
  Pug + Vuetify would need a DOM and far more mocking than the assertions would be worth
- Two suites guard config that nothing imports, so drift is otherwise invisible until data goes
  missing: `typst/tests/consts.test.ts` ties `PDF_LIFETIME_MS` to
  `firebase_storage_lifecycle.json`, and `tests/server/quota.test.ts` ties `QUOTA_COLLECTIONS`
  to the `gcloud firestore fields ttls` lines in `.bin/deploy_firebase_initial`
- `app/tests/lulu_skus.test.ts` asserts the generated price table covers **every** product
  `list_app_pod_package_ids()` can produce — a gap there quotes "not printable" for an option
  the user can see in the dropdown
- **e2e seeds the other party with the Admin SDK** (`e2e/helpers/admin.ts`) — the browser can
  only ever be one user, and these journeys are about what someone *else* shared. The browser's
  own uid is read out of Firebase Auth's IndexedDB store, not guessed from recent writes
- **The journeys start their own stack and run in CI** (the `e2e` job in `deploy.yml`, which
  gates the deploy beside `build`). Playwright's `webServer` brings up the emulators on
  `firebase_e2e.json`'s ports, the API server (`e2e/api_server.ts`) and Vite, all on ports of
  their own (`e2e/stack.ts`), so a run is safe alongside the dev stack — locally it reuses a
  stack that's already listening on them, CI always starts fresh. Outside content is
  production's (`USE_PROD_SERVICES`): fetch.bible, assets.paper.bible and the cover widget are
  public and read-only, so no other repo's dev server is needed. CI retries a failure once, so
  a hiccup on one of those shows as "flaky" rather than red
- **Every journey fails if the app filed an error report** (the auto fixture in
  `e2e/fixtures.ts`). Errors are reported, not shown, so a journey whose clicks all landed can
  still have thrown along the way. A test that provokes one on purpose declares it with
  `test.use({expected_reports: [...]})`
- **Name buttons exactly** (`click_button()`, or `exact: true`): `getByRole` matches
  substrings, and "OK" is inside the wizard's "Books". A design's name also shows twice on most
  pages (the navbar's recent-designs tab and the list row), so scope text lookups
- **`e2e/compile.test.ts` is the main journey that renders anything** (`mobile.test.ts` builds
  once too, since with no preview pane the page estimate is measured on demand). It seeds the
  design rather than driving the new-design wizard — the subject is the compile, and five
  wizard steps in front of it would make a Typst failure look like a broken dropdown
- **The cover widget has no Cancel button.** Finished saves outright when nothing changed, and
  otherwise asks "Save changes to cover?": Discard is what posts `cancelled`
  (`e2e/cover.test.ts`). The widget is cover-widget.paper.bible's production build, so a change
  there can fail these journeys without a commit here
- **The stress suites assert only that every tier *resolved*.** A tier failing to compile is the
  measurement `stress_wasm`/`stress_matrix` exist to collect — that's where the server fallback
  takes over — so it records the row and moves on. A tier failing to **resolve** built no
  document at all and is always a harness fault, so that one fails the run. Without it a stale
  `build_blueprint()` in `e2e/tiers.ts` sat here for some time reporting `ok: false` for every
  single tier under a green tick
- **`e2e/` is typechecked** (`npx tsc -p e2e/tsconfig.json`) and needs to be: Playwright only
  transpiles, so the `:Blueprint` annotation on `build_blueprint()` caught nothing when the
  interface renamed a field out from under it, and `resolve_design_name()` reads `blue.name`
  unguarded. Nothing else in the repo imports these files


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
- **`footnote.entry` rules only work from the preamble.** A page resolves its footnote area
  against the style chain in force *before any content is laid out*, so a `#show footnote.entry`
  rule that follows the first piece of content on the page — including one emitted from a
  passage's own scoped block — is accepted and then silently ignored, with no warning and no
  visible difference (Typst's default entry looks close enough to hide it). Three rules sat dead
  in `gen_footnote_rules()` for a long time this way. Anything that styles the footnote area
  (size, separator, width cap) belongs in `gen_preamble()`; per-passage variation can only be
  expressed as a *binding*, like the `#let footnote(..args) = none` shadow that disables notes,
  which resolves where the content calls it rather than where the page lays the entry out.
  Preamble rules do stack: a `show footnote.entry: set text(...)` and a
  `show footnote.entry: it => box(...)` recipe compose fine. Entries also ignore the styles where
  the note was *called*: a footnote from an LTR scope, or one whose body opens with
  `set text(dir: ltr)`, still lays its entry out in the page's direction. That's why study notes
  carry a `<pb-studynote>` label, which a preamble rule picks out to give them their own
  language and direction (`gen_notes_locale()` in `preamble.ts`)
- **Text direction is always set explicitly, never inferred from `lang`.** Typst works direction
  out from `lang`, but only for a handful of ISO 639-1 codes: `hbo` (Ancient Hebrew), `arb`,
  `ckb`, `uig` etc. silently lay out LTR, and `pa` is assumed RTL though fetch.bible's Punjabi is
  Gurmukhi. The document takes fetch.bible's declared `direction` for the primary translation
  (`TypographyConfig.dir`/`dir2`); user-written text (custom pages, story text slides, titles)
  takes the direction of its own first letter instead (`detect_dir()` in `lang.ts`), since an
  RTL Bible often has English introductions. Two consequences: a paragraph's direction comes from
  the styles *all* its content shares, so a direction scope has to enclose the whole paragraph
  (`#[#set text(dir: rtl)\n...]`), not just the text inside it; and anything laid out by physical
  side has to account for RTL itself. `pad()` only takes physical sides (hence `pad_start`), and
  `grid` columns run in text direction (hence `gen_physical_row()` for the page furniture)
- **Never draw text with pdf-lib's built-in fonts** (`StandardFonts`): they encode WinAnsi only,
  so Vietnamese, Arabic, Chinese… throw and take the whole preview down, and nothing shapes
  scripts that need it. Preview notices in the UI's language (the start/end strip, the "inside of
  cover" slot) are typeset by Typst on typst-web's second, standalone compiler
  (`compile_standalone()`: the curated base font + `notice_fonts()`'s Noto fallbacks for the
  text's script), so they never displace the main compiler's fonts; pdf-lib only places the
  resulting page
- **Verify Typst output against a real compile, not a minimal `.typ`.** A hand-written repro puts
  the rule under test at the top of an otherwise empty document, which is exactly the position
  where the gotcha above *doesn't* bite — so the bug renders correctly in isolation and wrongly
  in the app. Drive `compile_pdf_from_blueprint` (typst-node) with a real passage instead. Note
  also that a green `typst-node` suite says nothing about the browser: it shells out to the
  Typst CLI and never touches the WASM engine the app actually compiles with
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
- **A cover background crosses the embed protocol as an id *or* bytes, never both.** A builtin
  travels as `bg_image_builtin: '<filename>'` with `bg_image: null`, both ways — the app never
  downloads it to open the editor, and never keys it on bytes or a hash (bookcover re-encodes
  builtins in place). The id is untrusted, so `handle_finished()` requires
  `is_known_builtin_background()` (shape + bookcover-core's baked table) and, with no bytes to
  fall back on, keeps the existing background when it fails. The server re-checks it before
  joining it onto a path (`render_cover()` in `server/src/compile.ts`); stored blueprints are
  only shape-checked, so a retired background costs a cover render, not the design's reference.
  Renders always pass the id as `image_builtin` so colours come from the baked table: previews
  use `BG_PREVIEW_DIR` (`backgrounds/previews_2700/`) plus `image_max_dpi`, the wizard cards
  `backgrounds/previews_800/`, final output the original `backgrounds/<id>`
- **Uploaded bg bytes round-trip unmodified**, and `handle_finished()` in
  `DialogCoverEditor.vue` depends on it: it hashes the returned File to tell an untouched
  background from a new one, so a re-encode on the widget's side would mint a fresh Storage
  object every time the editor was opened and closed. That's a contract of the embed protocol,
  documented on `FormState.bg_image` in bookcover-core — not an accident of the current build
- **The embedded widget is `cover-widget.paper.bible`, not `cover.paper.bible`** — the latter
  is a public site that wraps the widget in its own iframe and doesn't relay postMessage, so
  embedding it would silently leave the widget running standalone
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
  `.bin/audit_errors` (claude clusters fingerprints into issues and shortlists the open ones).
  **The bucket is only an inbox:** `audit_errors` deletes each report once its local copy in
  gitignored `errors/records/` is written and parses, so that directory (triage state
  included) is the *only* copy — back it up, and run the tool from one machine.
  The boot splash and a failed version show the report id in a gracious.tech/contact link.
  The cover widget's errors are relayed over the embed protocol (`{type: 'error'}`) and reported
  as `Cover widget: ...` with `context.source = 'cover_widget'`. Triage keeps them out of the
  fixer and fix-commit pinning, since their code and builds belong to the bookcover repo
- **Errors are reported, not shown.** An error can't say whether it affected the user, so
  uncaught errors (window, promise, Vue) are reported silently, and the user is told only
  about things known to matter: a failed boot (`report_error('splash')`, the one thing
  `errors.ts` still draws), something they just did failing (`report_failure()` in `state.ts`,
  a toast naming what didn't happen), or the app being unable to do its job until fixed
  (`health` in `state.ts`, a banner in `AppRoot.vue`: the open design's writes stalled or
  refused — tracked in `flush_changes()` — or the Typst engine failing to start). Severity
  `critical` means the user saw one of these, which is what triage weighs it by
- **Every report carries the `build` it came from** (short commit hash, `-dirty` if the tree
  was; `BUILD_COMMIT` from `vite.config.mts` for the browser, baked into the Lambda image by
  `.bin/build_server_lambda` for the server). An issue marked fixed/diagnosing is pinned to a
  commit, and `git merge-base --is-ancestor` decides each later report: from a build without the
  commit → filed quietly (stale caches); with it → the issue reopens as a regression. That
  relies on the fix commit surviving into the deployed history — a squash or rebase before
  deploying breaks the ancestry, and the issue's later reports then all read as stale.
  The background fixer (`errors/fix.ts`) refuses to start on uncommitted tracked changes, so
  each review is exactly one fix, and never touches git itself: accepting waits for your commit
- **SERVER_ROLES gates routes, API Gateway gates traffic** — both must agree: every route
  (`ANY /api/{proxy+}`) goes to `paper-bible-light` (role `light`), and the `compile` role
  serves no HTTP route at all; dev defaults to both roles on one port. This is asserted
  directly in `tests/server/routes.test.ts`, not just implied by the CloudFormation routes
  matching the deployed roles
- **Server compiles are async, because API Gateway can't wait for them.** An HTTP API caps an
  integration at 30s (a hard limit) and CloudFront's origin timeout is 60s at most without a
  quota request, while a large compile plus a cold-start asset sync can take minutes. So
  `/api/compile` (light) only runs the checks that can refuse a compile — ownership, `pending`,
  asset paths, the per-user lock, the daily quota — then invokes `paper-bible-compile` with
  `InvocationType: 'Event'` and answers `202`; the outcome only ever reaches the client through
  the version doc. Three timings must nest: the async event's max age (5 min, in
  `CompileInvokeConfig`) ≤ `COMPILE_LOCK_MS` (6 min, restarted when the compile begins) ≤
  `STUCK_MS` in the app (6 min), the last two above the function's 5-min timeout — so a queued event never
  starts after its lock lapsed, and a retry offered for a stuck version is never refused by
  the lock a dead compile left. Async retries are off (a retry would only compile again). From
  source there's no function to invoke (`COMPILE_FUNCTION` unset), so `dispatch_compile()`
  runs the compile in the same process — but only where that process serves the `compile`
  role too (dev's default). A light-only server without `COMPILE_FUNCTION` throws instead,
  since a Lambda is frozen the moment its response goes out
- **The CSP (`SecurityHeadersPolicy` in `infra/cloudformation.yml`) guards two things only:**
  injected script can't run (the threat is a shared design smuggling markup into a viewer's
  page — nothing renders user content as HTML today, so this is the backstop), and nothing the
  page loads, fetches or frames can reach a host we don't own (so a design can't make its
  viewers' browsers call an outside server). **`default-src` is the one allowlist** every
  resource type falls back to — images, fetch/XHR, fonts, media and frames alike — so nothing
  is unrestricted, and only directives that need something different (`script-src`,
  `style-src`, `worker-src`) are pinned separately. The cost: any origin the app (or the
  browser, or Google's sign-in code) starts using must be added there, and until it is it's
  blocked in production only. The per-source reasoning is in the comment beside the policy.
  Things that aren't obvious from it:
  - **It only changes with a stack deploy** (CI's stack step, or `.bin/deploy_stack`), never
    `.bin/deploy_app` — CloudFront adds the header, and it never reaches the Vite dev server, so
    a CSP mistake only ever shows in production
  - **Frames need `data:`** (it's in `default-src`, which frames fall back to; any future
    `frame-src` must keep it). A browser that can't show a PDF inline
    (Android Chrome-based browsers always, desktop Chrome set to download PDFs) frames its own
    placeholder page — a `data:` URL that `*` doesn't match — and reports it with an *empty*
    `blockedURI`. That was the long-running "frame-src violation with no URL" report, wrongly
    blamed on Brave at the time
  - `'unsafe-eval'` is required beside `'wasm-unsafe-eval'`: the latter only covers
    `WebAssembly.compile`/`instantiate`, and `@myriaddreamin/typst-ts-web-compiler`'s
    wasm-bindgen glue calls `new Function(...)` during `compiler.init()`, so without it every
    in-browser compile throws an `EvalError`. `'report-sample'` allows nothing; it only puts the
    start of a blocked inline script in the violation event
  - `worker-src 'self'` is explicit (it would otherwise fall back to `script-src`) and has no
    `blob:` — Vite emits both workers as same-origin chunks, so blob workers would be XSS
    surface bought for nothing
  - `blob:` in `default-src` is load-bearing for fetches: custom fonts become blob URLs that
    typst.ts *fetches*. Custom font previews don't need it (`new FontFace(family, bytes)` isn't
    governed by CSP)
  - Storage is allowed **by bucket path**, not host — `firebasestorage.googleapis.com` alone
    would let in any Firebase project's files. It must match `storageBucket` in
    `app/src/services/firebase.ts`. `storage.googleapis.com` is there for a published PDF's
    iframe, whose range requests Firebase Storage sometimes 302s to it (seen on Android
    Chrome); CSP ignores the path after a redirect, so its bucket path only constrains direct
    requests
  - Profile photos are allowed as `*.googleusercontent.com/a/` and `/a-/` only, since the rest
    of that host serves anyone's public images; a photo elsewhere falls back to the icon
    (`failed_photo` in `AppRoot.vue`)
  - `frame-ancestors` is `'self'`, not `'none'` — a `blob:` URL inherits its creator's CSP, and
    Safari enforces the inherited directive against `DisplayPreview.vue`'s own blob iframe
  - Three origins appear in the bundle and are deliberately *not* allowed, because nothing
    reaches them: `packages.typst.org` (no `@preview` imports in generated source),
    `cdn.jsdelivr.net` (typst.ts's default font assets, disabled by `{assets: false}` in
    `typst-web`), and `www.google.com/recaptcha` (Firebase Auth loads it only under reCAPTCHA
    Enterprise). **Enabling reCAPTCHA Enterprise or SMS protections in the Firebase console
    would silently require adding `https://www.google.com` to `script-src` and `default-src`**
  - Violations are reported by the listener at the bottom of `app/src/services/errors.ts`,
    which drops what the browser attributes to an extension (an extension-scheme `blockedURI`
    or `sourceFile`) and reports each distinct violation once per page load. Extensions that
    inject inline script into the page aren't attributed by any browser, so those still arrive,
    with the blocked code's opening in `context.sample` to judge them by
- **`Referrer-Policy` is load-bearing, not hygiene** — a version id *is* the capability to
  read that PDF (rules allow public read by id alone), so without it every outbound click
  from `/designs/{id}/{version}` hands the whole URL to the destination in `Referer`
- **Compile assets are synced from S3, not mounted** — Lambda has no equivalent of Cloud
  Run's GCS-FUSE bucket-as-filesystem mount, so `lambda_bootstrap.ts` downloads
  `fonts/` and the top level of `backgrounds/` (not its `previews_*/`/`thumbnails/`/`originals/`
  subdirectories — see `wanted_key()`) from the bookcover bucket (same-account IAM) into
  `ASSETS_DIR` (`/tmp/assets` in production) on the compile function's first invocation per
  execution environment, memoized after that; new fonts/templates are still published from the
  bookcover repo, not a server redeploy. This sync **must** run lazily inside the handler
  (see `lambda.ts`), never as top-level `await` — Lambda's module-INIT phase has a fixed
  ~10s budget the sync can easily exceed, unlike the single Secrets Manager call in
  `firebase.ts` which safely does run at top level. Locally `serve_server` points at the
  untracked `assets/` dir (a copy/symlink of the bookcover repo's assets tree) directly, no
  sync involved
- **Deploys run in GitHub Actions** (`.github/workflows/deploy.yml`), and only for what changed.
  Each step records the commit it last deployed from as a `deployed/<step>` tag on origin
  (moved by `.bin/mark_deployed` once the step succeeds). `.bin/deploy_plan` diffs each step's
  **input list** against its tag, so a failed step simply runs again on the next push. Four
  things follow:
  - **A file a step newly reads must be added to its list in `deploy_plan`**, or edits to it
    won't deploy. A new image always goes out through the stack, so the stack step runs then too
  - **One-off setup is idempotent scripts, not version numbers.** `deploy_firebase_initial`
    (Storage lifecycle/CORS, Firestore TTLs) and `deploy_aws` (certificate, every stack
    parameter) are inputs to their own steps, so editing one makes the next deploy re-run it
    once. A new one-off belongs in one of them (or a new script added to `deploy_plan`), and
    must stay safe to re-run
  - **Order is Firebase → server → app**, so the app never goes live ahead of the rules or API
    it expects. Tests (the e2e journeys included) and typechecks gate the whole run. Run the workflow by hand with "all"
    to redeploy everything
  - **No npm code runs where the credentials are.** A job is GitHub's only isolation boundary:
    every step in a job with `id-token: write` can request the OIDC token, and steps share one
    machine. So `npm ci`, the tests and the builds all run in jobs with no cloud access and a
    read-only repo token (`lulu`, `build`, `e2e`). The jobs that hold credentials run only deploy
    tools on what `build` produced: `deploy` (via artifacts and `--prebuilt`, with
    firebase-tools installed alone, pinned to the lockfile's version, without install scripts),
    and `lulu_push`, which commits the regenerated prices. Keep it that way: a step that needs
    the project's packages belongs in `build`, not `deploy`
  CI holds no keys: it assumes `paper-bible-github-deploy` (AWS) and `github-deploy@` (GCP)
  through OIDC, and only from `main`. On the AWS side it can't deploy the app stack with its
  own permissions: stack updates go through the `paper-bible-cloudformation` service role
  (`CFN_ROLE_ARN`). Once a stack has used that role, CloudFormation keeps using it, so a manual
  deploy needs `iam:PassRole` for it, which an admin already has. The CI's own roles live in
  `infra/github_ci.yml`, a separate stack, so an app deploy can never change them. Sourcemaps
  go to the site bucket's `sourcemaps/` prefix, not the deploying machine. They're kept out of
  `assets/`, whose `--delete` sync would drop old builds' maps. Like the error reports, that
  prefix is only an inbox (expired at 90 days): `audit_errors` syncs it down, never up, into
  `errors/sourcemaps/`, which is the lasting copy (gitignored, so back it up with `records/`)
- **Hono middleware registered after a route is composed after it, not before — even if
  the middleware is meant to gate that route.** `authed_post()` never calls `next()`, so an
  `app.use('/api/x', ...)` added from a module that imports (and therefore runs after)
  `index.ts` is unreachable for that route. Anything that must run before a specific route
  belongs inside its handler, or wrapping the exported Lambda handler
- **Server caches are per-execution-environment best-effort**: `server/src/content.ts` keeps the fetch.bible collection (1h TTL) and an LRU of
  fetched books warm across compiles, but a fresh Lambda environment starts cold — and unlike
  a Cloud-Run-style min-instances pool, concurrent invocations don't share this cache at all,
  so cold fills happen more often. Acceptable since `/api/compile` is a low-traffic fallback
  (most compiles run client-side), never rely on it for anything that needs to be warm
- **Example pictures are rendered locally and committed, one set per UI locale**
  (`app/src/assets/images/examples/<locale>/<id>.webp`), since each cover carries its example's
  translated title. `.bin/gen_example_images` serves the app through Vite with
  `USE_PROD_SERVICES`, and drives Chromium from `e2e/browsers/` with WebGL on SwiftShader. Its
  harness builds each example the way a click does (`build_example_blueprint`), renders the cover
  through the app's own worker (`render_cover_panels()`), and photographs it with
  bookcover-3d-web at the bookcover widget's default 3D view (azimuth -30°, elevation 20°, zoom
  0.75). The harness page is synthesised by a Playwright route, because `vite_plugin_index.mts`
  replaces *every* HTML page with the app's own index. `manifest.json` keys each picture by a hash
  of its cover form, background, `RENDER_VERSION` and the harness's `GENERATOR_VERSION`, so only
  what changed re-renders. A locale identical to English gets no file and the app falls back to
  English's. Bump `GENERATOR_VERSION` (or pass `--force`) after changing the camera or framing,
  or after a bookcover-3d-web upgrade worth showing, since neither is in the hash. Each example's
  `pages` is fixed (from a real compile in English) rather than measured per run, so the
  spine width never churns every picture when fetch.bible's content shifts
- **Type pictures are rendered, not translated** (`app/src/assets/images/design_types/`). The
  wizard's first step shows each type as a crop of a printed page: English's are hand-cropped
  screenshots (`type_<name>.avif`), and every other UI locale gets `<tag>/type_<name>.avif`,
  Genesis 1 in fetch.bible's preferred translation for its language (else the first in that
  language with Genesis), compiled through `BibleContent.resolve()` + the Typst CLI by
  `.bin/gen_type_images` (a few seconds per locale, no dev servers; fonts are cached in the
  gitignored `app/tools/.cache/`, along with a review sheet per locale). `type_preset_image()`
  in `new_design.ts` falls back to the screenshots. Each type's settings and crop in `TYPES`
  were calibrated by overlaying an English render on its screenshot, so they reproduce
  layouts the app no longer makes exactly (notes borrows the screenshot's dotted lines, since
  the lines now go on the facing page; study closes up the page's slack above its notes).
  Replacing a screenshot means recalibrating its entry. Footnotes are always off, the opening
  chapter numeral is forced on for standard, the bilingual picture pairs the locale's Bible
  with English, and study notes are English (Tyndale is the only notes resource).
  Right-to-left locales are cropped from the page's right edge, and a language whose text
  doesn't fit a layout gets a `LANGUAGE_OVERRIDES` entry (Tamil's long words widen bilingual)
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
  and regenerates `lulu_prices.json`. There's no schedule: a deploy re-checks them when the
  last check is over 30 days old (`.bin/refresh_lulu_prices`, before the tests), and commits a
  re-price to `main` as its own reviewable diff. That's pushed before the tests run, since only
  a job running no npm code may push; the generator refuses to write a sheet missing any product
  the app offers, and the tests still gate the deploy. Lulu being unreachable only warns. The check
  date is the `checked/lulu_prices` tag's own date, since the file only changes when Lulu's data
  does. So prices are as fresh as the last deploy, give or take a month. Builds only ship
  committed prices. The generated limits are also stricter than the ones printing-services models
  (landscape perfect-bound caps at 250 pages, not 800)


## i18n

Translation is done entirely by Claude, through the loop in **`.claude/skills/translate`** —
read it before touching a catalog. The design choices below all serve that: plain strings a model
can't mangle, a self-contained job per locale, and a validator between the model and the app.

Two catalog domains share all the tooling: **`ui`** (the app, `app/src/locales/`, by UI locale)
and **`doc`** (the strings the typst package prints into a book — copyright page, "Chapter N" —
`typst/locales/`, by the fetch.bible language of the book's primary translation, since a book
prints in its Bible's language whatever the UI's — passing over classical languages like `grc`/
`hbo`, so a Greek/English study edition still gets English front matter; see `doc_language()`). The rest of this section is about `ui` unless
it says otherwise.

- **No i18n library.** `services/i18n.ts` is a small homegrown module: `translate(key,
  params?)` does a flat catalog lookup with `{named}` placeholder substitution and `en`
  fallback; `useI18n()` returns `{t, locale}`; the default export is a Vue plugin that adds
  `$t`. Rationale: the app targets 800+ machine-translated locales, where an ICU/format
  library is dead weight (MT mangles ICU syntax; CLDR plural data doesn't exist for most
  targets) — see [[i18n-symbolic-keys-migration]].
- **Symbolic keys**, not English strings: `$t('options.style.justify')`. Catalogs are flat
  JSON keyed by browser language tag (`app/src/locales/en.json` = source of truth with real
  English, `vi.json`, `pt-BR.json`, `zh-Hans.json`, ...). `en` is bundled + is the fallback;
  other locales load during boot, in parallel with auth (`initial_locale()`: a hand-picked locale
  from the header menu's language dialog, remembered in localStorage, else browser detection).
  `app/src/locales.json` lists every locale, `en` included, with its own name and `dir`.
- **UI locales are browser tags; Bible content is fetch.bible's ISO 639-3** (`cmn`, `pes`), and
  the two never stand in for each other — the UI language is its own setting, never derived from
  the chosen Bible. Tags pass straight to everything that takes one (`<html lang>`, Intl,
  Vuetify, Firebase Auth, the bookcover widget's `InitMessage.locale`). `best_locale()` in
  `services/locale.ts` matches a browser tag to a catalog by language + script (`pt-PT` →
  `pt-BR`, `zh-TW` → `zh-Hant`, never `zh-Hans`), and also reads the ISO 639-3 codes the UI used
  to be keyed by, so a language picked before the switch (`vie`) is still honoured
- **Everything else follows the locale too** (the `watch(locale)` in `init.ts`): `<html lang
  dir>`, Vuetify's own strings and RTL layout (its strings live in our catalogs as `vuetify.*`,
  re-nested by `vuetify_messages()`), Firebase Auth's email language, dates via `intl_tag()`.
  The failure splash gets its translator through `set_error_translator()` (errors.ts must stay
  import-first). The bookcover widget has its own catalogs and matches the tag it's sent itself
- **Messages are plain strings** with `{named}` placeholders only — no ICU, no plural/select
  syntax. Plurals / branching are done in calling code by picking the key (`count_phrase()`
  in `i18n.ts`) or designed out (label:value). Markup or links inside a sentence go in
  `{placeholders}` filled by `AppSentence`'s slots — never fragments glued around elements. Keys
  passed by name or built at runtime are found by `scan_mentions()` (the literal key, its stem,
  or a template's start), so they need no registration
- **Untranslated UI text fails the build.** `.bin/i18n_check` (run by `audit_unit` and
  `deploy_app`) lints app/src (`app/i18n/lint.ts`): in TypeScript a double-quoted literal is UI
  text by the quoting convention, so it must go through `t()` or be single-quoted; Pug text and
  static UI attributes are lexed. Deliberate exceptions carry `i18n-ignore` (line) or
  `i18n-ignore-file`, with the reason
- **Catalogs are written by the tools, not by hand.** `.bin/i18n_job <loc>` writes
  `app/i18n/jobs/<domain>.<loc>.json` (strings + call-site context + glossary + the locale's style
  file); Claude writes a flat `.out.json` beside it; `.bin/i18n_apply` refuses anything that would
  render wrong (placeholders, tags, line breaks, keep-terms), merges the rest and records the English
  each entry was translated from in `app/src/locales/.state/<loc>.json` — which is how
  staleness is detected when English is reworded. `app/i18n/style/<language>.json` carries a
  locale's conventions and glossary renderings between batches, shared by both domains: it's
  keyed by written language (`style_key()` in `app/i18n/lib.ts`), since the UI's `de` and the
  document strings' `deu` are the same language under each domain's own convention
- **Document strings are compiled into the typst package** (`app/i18n/gen_doc.ts` →
  `typst/src/generated/doc_strings.ts`, regenerated by sync/apply/build_typst, checked by
  `i18n_check`), so the app's main thread, the server and the cover renderer all get them with no
  loader. `doc_translator(doc_language(blue, resources))` looks one up, English for a language
  with none. `doc_language()` adds the script where fetch.bible declares one (`cmn-Hant`), so a
  language whose Bibles come in two scripts keys its catalogs by script. Text the *worker* generates has to arrive resolved in the `TypstRequest`
  (`FeatureConfig.chapter_label`), since the worker never sees a Blueprint. Every language is
  bundled — fine for 8 short strings; load per language if it ever reaches hundreds
- Other tooling: `.bin/i18n_status [loc ...]` (one line per locale; naming locales lists keys),
  `.bin/i18n_extract [--prune]` (source catalogs vs call sites), `.bin/i18n_sync [--bless key ...]`
  (canonicalise, drop orphans; `--bless` marks a meaning-preserving English edit as current)
- **Adding a UI string:** `$t('namespace.key')` + the English in `en.json` (+ a note in
  `app/i18n/context.json` if the call site alone is ambiguous), then run the skill's loop for
  every locale (`.bin/i18n_job` with no arguments). **Rewording English** works the same: the
  locales go stale and the next job carries the old and new English plus the old translation.
- **The example designs' titles are printed on pictures**, so after their strings
  (`svc.examples.*_title`/`_subtitle`) change in any locale, run `.bin/gen_example_images` too.
  `i18n_check` warns (never fails, since CI can't render) about pictures whose titles no longer
  match their catalog
- **A new UI locale needs its wizard type pictures rendered**: `.bin/gen_type_images <tag>`
  (see "Type pictures" in Gotchas; `i18n_check` warns until it's run). Commit its
  `design_types/<tag>/` and the manifest with the catalog
