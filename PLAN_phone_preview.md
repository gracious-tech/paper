# Plan: phone preview + server compiles for phones

Handover notes, so any session can pick this up. Delete this file once phase 2 is merged and
CLAUDE.md describes it.

## Goal

On phones (below the 900px `is_mobile` breakpoint, where there's no live preview pane) the
editor's button is **Preview**, not Build it. It opens a full-screen view (no app bar) with a top
bar: **Keep editing** | **Build it**. Pages are shown one at a time, top to bottom, each a
standalone SVG `<img>` (phones can't show PDFs inline). A phone that can't cope is switched to
compiling **everything** on the server, permanently: phase 1 did the browser side and the
switch, phase 2 adds server-rendered previews so server-mode phones get previews too.

## Decisions already made by the user (don't re-ask)

- SVG pages (not pdf.js, not server PNGs); single pages only, never spreads, on phones
- Page assembly is shared between PDF and SVG (refactor, not a simplified SVG path)
- Front cover as page 1; ~30-page window (`ESTIMATE_CHAR_LIMIT`), from the start only, no
  Start/Middle/End toggle
- Browser preview over 20s (`PREVIEW_TIMEOUT_MS`): abandon it, switch the device to server mode,
  and (phase 2) request the same preview from the server straight away
- Any browser compile on a phone (preview, build, estimate, cover) that dies with its tab counts
  as a crash → server mode. Normal tab close doesn't (pagehide clears the marker)
- Server mode is permanent (TODO in `compile_mode.ts` to re-evaluate in a few months with data)
- In server mode estimates come only from previews and builds — no background server compiles
  while editing; the cover editor may ask the server once if its estimate is stale
- Two phases, committed separately. User wants to be prompted for any further decisions

## Phase 1 — DONE (commit 140b3d2)

- `typst/src/assemble.ts` — output-neutral page assembly (`PageBackend<D>`, `PageRef`); used by
  `pdf_postprocess.ts` (print) and `svg_pages.ts` (`generate_svg_preview`, `split_typst_svg`,
  `svg_page_markup`, `SvgPage {inner, x, width, height}`)
- `typst-web`: `compile_svg_preview()` (vector compile → typst.ts renderer → `split_typst_svg`)
- app: `services/compile_mode.ts` (localStorage `compile_on_server`, crash marker
  `compile_in_flight`, `track_browser_compile`, `switch_to_server`, `compiles_on_server()`),
  `services/phone_preview.ts` (`compile_phone_preview`, `SlowPreviewError`),
  `services/build.ts` (`build_design` extracted from BtnGenerate),
  `comp/dialogs/DialogPhonePreview.vue`, `TypstWorkerClient.abandon()`/`compile_svg_preview()`
- Server mode in phase 1: no preview; BtnGenerate builds straight away and
  `compile_and_upload` hands the version straight to `/api/compile` (`ServerModeHandover`);
  browser estimates and covers are skipped
- e2e: `e2e/mobile.test.ts` covers preview→build, Keep editing, server mode, crash marker

## Phase 2 — server previews

### Server

1. **typst-node**: `compile_svg_preview(request, options):Promise<SvgPage[]>` — CLI compile per
   source with output `out-{p}.svg` in the temp dir (Typst pads `{p}` when there are 10+ pages,
   so read the dir and sort numerically), each file parsed by a new core helper
   `parse_standalone_svg(svg):SvgPage` (in `svg_pages.ts`: inner = between the root `<svg>` open
   tag and the last `</svg>`; width/height from the viewBox). CLI pages are already
   self-contained (own `<defs>`), so no subsetting. Also export a `preview_from_blueprint`-style
   helper or do resolve + `truncate_for_preview` in the server
2. **Route** `POST /api/preview {design_id}` (light, via `authed_post`):
   - caller must be in the design's `editor_uids`
   - validate the design doc like `check_version` does a version (it's client-written by any
     co-editor): fonts under `design_assets_prefix(design_id)`, cover bg custom path under it /
     builtin id shape, passage image URLs `is_fetchable_image_url`
   - daily quota `QUOTA_PREVIEW = 'preview_quota'` (generous, e.g. 300/day). **A new quota
     collection needs three things**: `QUOTA_COLLECTIONS` entry, a `gcloud firestore fields ttls`
     line in `.bin/deploy_firebase_initial`, the `quota_allows()` call
   - no compile lock (a preview mustn't wait on a build, and they're cheap/short)
   - create `previews/{preview_id}` (Admin SDK): `{owner, design_id, status: 'pending', created,
     expires (now + 1 day), pages: null, page_estimate: null, truncated: null, path: null,
     error_id: null}`, dispatch, answer `202 {preview_id}`
3. **Job**: `CompileJob` becomes a union with `kind: 'preview'` (`{kind, uid, preview_id,
   design_id, client_ip, user_agent}`); `lambda.ts`'s compile handler and `dispatch_compile`
   route by kind. Old payloads without `kind` are version compiles
4. **run_preview**: re-check (design may have changed), `ensure_assets_synced`, read design doc →
   `join_blueprint_doc` (migrates), download design fonts (`fonts` map on the design doc),
   `shared_content.resolve(...)` with share_url `${app_url}/designs/${design_id}`,
   `truncate_for_preview(request, 'start', ESTIMATE_CHAR_LIMIT)`, `compile_svg_preview`,
   estimate = `max(2, round(pages * total_chars / window_chars / 2) * 2)` (same as
   `phone_preview.ts`), cover front via bookcover-node `generate({format: 'svg', split: true})`
   → `split_paths.front` (reuse `render_cover`'s setup; it currently only does PDF). Store
   `{pages: string[], truncated, page_estimate}` as gzipped JSON at
   `design_cache/{design_id}/preview_{preview_id}.json` (public by path, 90-day lifecycle already)
   and update the doc `{status: 'available', path, pages, page_estimate, truncated}`; on failure
   `{status: 'failed', error_id}` + `save_error`. Record a `compile_stats` row (`kind: 'preview'`)
5. **Painted/torn images**: the server can't mask. Client calls `resolve_content_for_style`
   before requesting (uploads variants to `design_cache/{id}/{style}_v{n}_{hash}.png`); server
   substitutes that path when it exists (same variant numbering as `resolve_content_for_style`),
   else uses the plain image. URL images without `hash` stay unmasked (acceptable)
6. **Rules/infra**: `firestore.rules` `previews/{id}`: read if `resource == null ||
   resource.data.owner == request.auth.uid` (null-resource rule, see memory), no client writes.
   TTL on `previews.expires` in `deploy_firebase_initial`. Account deletion sweeps `previews` by
   owner (`delete_user_records` in `account.ts`); design deletion can rely on TTL + design_cache
   sweep
7. **Tests**: `tests/server/` handler tests for refusals (not editor, bad paths, quota), a
   `run_preview` test with the Typst renderer stubbed like `run_compile.test.ts`, routes.test.ts
   for the new route's auth/fields and role gating, `tests/rules/` for `previews` read rules,
   typst-node test for `compile_svg_preview` (real CLI, like `compile.test.ts`), core test for
   `parse_standalone_svg`

### App

1. `phone_preview.ts`: `compile_phone_preview` branches: `compiles_on_server()` → server path:
   flush (`flush_changes`), `resolve_content_for_style` (uploads masked variants), remember
   `render_signature()`, `api('/api/preview', {design_id})` (use `retry_network` +
   `api_unreachable`-style handling), listen to `previews/{id}`, then `getBytes` the JSON, set the
   estimate if the signature still matches. Timeout waiting for the doc (~3 min) → failed state
   with retry
2. On `SlowPreviewError` in the browser path: switch (already done) **and immediately** continue
   with the server path, with a progress line like "This device is too slow for previews, so our
   servers are making it" (new string; the current `dialog.phone_preview.too_slow` text changes
   — reword + retranslate via `.claude/skills/translate`)
3. `BtnGenerate.vue`: `previews` = `is_mobile` (server mode previews too now)
4. Estimates in server mode: `DialogCoverEditor`'s `ensure_page_estimate` asks the server once
   when stale (a preview request whose pages are ignored); OptionsPaper stays without live
   estimates
5. CSP: nothing new (Storage bucket path already allowed; JSON fetched via Firebase SDK)
6. e2e: server-mode phone preview with `/api/preview` stubbed or real (real needs local
   `assets/` fonts, which e2e doesn't have — the journeys stub server compiles, "no journey
   compiles on the server"); stub the route and seed the preview doc + JSON with the Admin SDK
7. CLAUDE.md: data flow step 3, routes list (`preview`), Firestore data model (`previews`), the
   quota/TTL lists, Storage layout (`design_cache/.../preview_*.json`)

### Phase 2 decisions (asked 2026-10-24)

- Preview quota: **300/day** per uid (`preview_quota`)
- Server previews recorded in `compile_stats` with `kind: 'preview'`
- **Desktop gets server previews too**: its live preview falls back to the server when the
  browser fails or takes over **10s** (TODO note to reassess with data). A device-type failure
  switches the desktop to server mode exactly like a phone
- **Classify, then confirm**: only device-type failures switch a device — out of memory / WASM
  trap ("Document too large…" after the retry), over the time limit, a tab crash, the engine
  failing to start. Typst errors from our own generated source and network errors never switch.
  A switch is **provisional** until the server succeeds at the same kind of job; if the server
  fails too, the fault is likely the document or our code, so the device switches back. Any
  browser preview failure (device-type or not) still falls back to the server for that one job
- Desktop server preview = **the same spread PDF** as the browser makes (server runs
  `generate_pdf_spread_preview`; strips, cover slot label and cover merge done server-side too,
  from labels/locale the client sends, so a desktop whose engine can't start still gets them —
  move `prepend_cover` from `typst_worker.ts` into the typst core so both share it)
- Desktop in server mode: **no auto recompile** — a Refresh button in the preview toolbar (plus
  one compile when the pane opens)

### Phase 2 task order

1. core: `parse_standalone_svg`; `prepend_cover` shared
2. typst-node: `compile_svg_preview`; standalone compiles (strips, cover slot) via the CLI
3. server: `/api/preview {design_id, format: 'svg'|'pdf', section?, labels?}`, job union,
   `run_preview`, rules, quota + TTL + account sweep, tests
4. app: compile_mode provisional/confirm + classification; phone server path; DisplayPreview
   10s timeout + server fallback + Refresh in server mode; BtnGenerate previews on every phone;
   cover editor estimate; engine-start failure switches instead of the health banner
5. i18n (translate skill), e2e, CLAUDE.md
