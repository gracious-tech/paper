
# Paper Bible (paper.bible)

Web application for creating customized, printable Bible documents in professional
book/booklet format. Users select Bible passages from 800+ languages, customize
styling (fonts, margins, columns), add decorative title pages and custom content,
then generate print-ready PDFs via a serverless backend.

Live at [paper.bible](https://paper.bible). MIT No Attribution license.


## Architecture & Data Flow

**Frontend:** Vue 3 SPA (Vite + Vuetify 3 + TypeScript)
**Backend:** AWS Lambda (Python) triggered by S3 uploads, renders HTML to PDF with
WeasyPrint

### Data flow: user input to PDF

1. User configures a `Blueprint` (passages, translations, styling, layout) in the
   Create tab
2. Reactive watchers auto-save the draft to IndexedDB and pre-fetch Bible content
3. On "Create", the app generates HTML/CSS for each content item via the render
   services, producing an array of `Subjob` tuples
4. The full `PaperRequest` JSON is uploaded to S3 `requests/` folder via
   unauthenticated `@aws-sdk/client-s3`
5. S3 ObjectCreated event triggers the Lambda function
6. Lambda renders each subjob's HTML to PDF via WeasyPrint, arranges pages
   (booklet folding, page numbers, duplex metadata), compresses, and uploads to
   S3 `creations/`
7. The app polls `creations/{id}.result.json` every 2 seconds (up to 600s timeout)
8. When available, the PDF is displayed in an iframe; user can download, edit as
   new, or delete

### Key architectural patterns

- **No authentication:** S3 bucket has public read for `creations/` and `requests/`.
  The creation_id (derived from request_id + S3 etag) serves as an unguessable token
- **Serverless:** No servers to manage; Lambda handles all PDF generation
- **Offline-capable state:** IndexedDB persists drafts and creation history across
  sessions, with graceful fallback for private tabs
- **Reactive pre-fetching:** Watchers on `blue.bibles` and `blue.content` eagerly
  fetch book metadata and HTML content as the user makes selections


## Tech Stack

| Dependency | Purpose |
|---|---|
| Vue 3.3 | UI framework (Composition API, reactivity) |
| Vuetify 3.7 | Material Design 3 component library |
| Vite 4 | Build tool and dev server |
| TypeScript | Type safety (strict mode) |
| Pug 3 | HTML templating for index page |
| Sass | CSS preprocessing |
| `@gracious.tech/fetch-client` | Bible content API client (fetches translations, books, HTML) |
| `@gracious.tech/bible-references` | Passage reference parsing |
| `@aws-sdk/client-s3` | Uploads PDF requests to S3 (unauthenticated) |
| `idb` | IndexedDB wrapper for persistent local state |
| `vue-i18n` 11 | Internationalization (English default, Vietnamese supported) |
| `vuedraggable` | Drag-and-drop content item reordering |
| `@tinymce/tinymce-vue` | WYSIWYG HTML editor for custom content pages |
| `core-js` | Polyfills (Array.at, Object.hasOwn for Vuetify) |
| `lodash-es` | Utilities (cloneDeep, debounce) |
| `vite-svg-loader` | Import SVGs as Vue components |
| `vite-plugin-vuetify` | Vuetify tree-shaking and auto-import |
| `@volar/vue-language-plugin-pug` | Pug support in Vue SFCs via Volar |

**Backend (Python Lambda):**

| Dependency | Purpose |
|---|---|
| WeasyPrint | HTML/CSS to PDF rendering engine |
| pypdf | PDF manipulation (merge, booklet reorder, compress, metadata) |
| reportlab | Generates page number overlay PDFs |
| boto3 | AWS S3 access |


## File Structure & Entry Points

```
paper_bible2/
  .bin/                     # Shell scripts for dev/deploy
    serve_app               # Dev server (vite)
    serve_app_prod          # Build + preview (vite build && vite preview)
    setup                   # Install deps (python venv + npm install)
    deploy_generator        # Deploy Lambda via SAM CLI
    debug_generator         # Docker debug for Lambda
    detect_i18n_strings     # Extract i18n keys from Vue files
  app/
    package.json            # Dependencies (no scripts, use .bin/ instead)
    vite.config.ts          # Vite config with custom pug plugin, SVG, Vuetify
    vite_plugin_index.ts    # Custom Vite plugin: renders index.pug as HTML
    tsconfig.json           # Strict TS, path alias @/ -> src/
    src/
      init.ts               # ** APP ENTRY POINT ** - bootstraps everything
      styles.sass            # Global styles
      locales.json           # Supported locale list: ["vi"]
      locales/               # i18n JSON files (en.json has empty values)
      comp/
        AppRoot.vue          # Root component (3-tab layout + display panel)
        global/
          AppIcon.vue        # SVG icon system (Material Symbols + custom)
          AppHtml.vue        # TinyMCE editor wrapper
        tabs/
          TabCreate.vue      # Main creation form + generate button
          TabEditor.vue      # Dynamic editor popup mount point
          TabHistory.vue     # Creation history list
          TabHelp.vue        # User guide
          assets/
            TabHistoryItem.vue  # Single history row
        editors/
          EditorPassage.vue  # Book/passage selector
          EditorTitle.vue    # Title page editor (icon, pattern, colors)
          EditorCustom.vue   # HTML editor (TinyMCE)
          EditorBible.vue    # Translation picker
        options/
          OptionsContent.vue # Draggable content list
          OptionsBibles.vue  # Primary/secondary translation selectors
          OptionsPaper.vue   # Paper size (A4/Letter/custom)
          OptionsPreset.vue  # Quick presets
          OptionsFeatures.vue # Toggle headings/chapters/verses/footnotes/woj
          OptionsStudy.vue   # Study notes and cross-references
          OptionsStyle.vue   # Font, size, line-height, justify, columns
          OptionsLayout.vue  # Margins, binding swap, column gap
          OptionsPrint.vue   # Booklet/page numbers/blank pages
          OptionsLegal.vue   # License and attribution
        display/
          DisplayPreview.vue    # Live preview in iframe (first page)
          DisplayCreation.vue   # PDF result display (pending/available/failed)
          DisplaySplash.vue     # First-visit welcome screen
          DisplayHelp.vue       # Help/tutorial content
        reuseable/
          AnimatedBook.vue      # Animated book during generation
      services/
        types.ts             # Core data models (Blueprint, Creation, ContentItem)
        state.ts             # Global reactive state + computed properties
        db.ts                # IndexedDB persistence (config + creations stores)
        content.ts           # Bible data service (fetch-client wrapper)
        blueprints.ts        # Default blueprint factory + validation/sanitization
        watchers.ts          # Reactive auto-save, auto-fetch, expiration detection
        backend.ts           # S3 client (put_request, delete_creation, gen_url)
        create.ts            # PDF generation monitor (polls S3 for result)
        patterns.ts          # 16 decorative SVG patterns for title pages
        emoji.ts             # Biblical-themed emoji catalog
        errors.ts            # Global error handling + Rollbar reporting
        utils.ts             # Helpers (base64, tokens, compress, escape, debounce)
        render/
          render.ts          # Orchestrator: gen_subjobs() + gen_combined_css()
          render_base.ts     # @page rules, body fonts, paragraph spacing
          render_passage.ts  # Bible passage HTML (1-2 translations, notes, columns)
          render_title.ts    # Decorative title page with SVG corner patterns
          render_custom.ts   # User HTML + AUTO-COPYRIGHT placeholder replacement
          render_lines.ts    # Ruled paper for note-taking pages
  generator/
    template.yaml            # AWS SAM CloudFormation (Lambda + S3 bucket)
    src/
      main.py                # Lambda handler (HTML->PDF via WeasyPrint, booklet)
  branding/
    icon.svg                 # App icon
    social.svg               # Social media image
    splash/                  # Splash screen assets
```

### Where to start reading

- **App bootstrap:** `app/src/init.ts` - loads DB, fetches collection, mounts Vue
- **Data model:** `app/src/services/types.ts` - `Blueprint`, `Creation`, `ContentItem`
- **State:** `app/src/services/state.ts` - reactive `blue` (draft), `creations`
- **PDF generation trigger:** `app/src/comp/tabs/TabCreate.vue` - `generate()` method
- **Render pipeline:** `app/src/services/render/render.ts` -> individual renderers
- **Backend PDF creation:** `generator/src/main.py` - Lambda entry + booklet logic


## Development Setup & Commands

### Prerequisites

- Node.js (for the app)
- Python 3 (for the generator)
- AWS credentials (for deploying the generator)

### Initial setup

```bash
.bin/setup    # Creates Python venv, installs SAM CLI, runs npm install
```

### Config files needed

Copy and rename these templates (values discovered while setting up backend):
- `app/.env.development.local.template` -> `app/.env.development.local`
- `generator/config.yaml.template` -> `generator/config.yaml`

### Development commands

```bash
.bin/serve_app          # Dev server (Vite, hot reload)
.bin/serve_app_prod     # Build + preview production bundle
.bin/deploy_generator   # Deploy Lambda (pass AWS creds as env vars)
.bin/deploy_generator prod  # Deploy to production
.bin/debug_generator    # Docker shell for debugging Lambda
.bin/detect_i18n_strings    # Extract i18n keys from .vue files
```

**Note:** `package.json` has no `scripts` section. All commands go through `.bin/`.
Vite and other tools are invoked via `node_modules/.bin/` within the shell scripts.

### Dev endpoints

- App dev server hits `http://localhost:8430/` for Bible content (fetch-bible API)
- Error reports go to `http://localhost:7777/` in dev (instead of Rollbar)

### Backend limitations

The backend cannot be run locally due to S3 API access and request size limits.
Deploy a dev version with `.bin/deploy_generator` for testing PDF generation.


## Code Style & Conventions

### TypeScript / Vue

- **No semicolons** to end lines
- **snake_case** for variables and functions, **CamelCase** for classes
- **4-space indentation**
- **Single quotes** for strings, **double quotes** for UI-displayed text
- **No space** between colon and type: `name:string`, not `name: string`
- **Import spacing:** `import {a, b} from 'x'`
- **No inline if statements:** always put return/continue on a new line
- **Line length:** 100 characters (may exceed in HTML/Markdown)
- **Empty line** at the start and end of each file
- **Comment** every function/class and before every chunk of code
- Vue SFCs use Pug for templates and Sass for styles
- `@/` path alias maps to `app/src/`

### Component naming

- `Tab*` - top-level tab views
- `Editor*` - popup editors for content items
- `Options*` - settings sections within TabCreate
- `Display*` - right-side display panels
- `App*` - globally registered components (AppIcon, AppHtml)

### State management pattern

- Global reactive state in `state.ts` (no Vuex/Pinia)
- `blue` is the reactive draft blueprint, auto-saved via watcher
- `content` holds cached Bible data (collection, translations, books, HTML)
- Computed properties for derived state (page dimensions, copyright checks)
- Watchers in `watchers.ts` handle side effects (save, fetch, expire)

### Render pipeline pattern

Each content type has its own render module exporting `gen_*_html()` and
`gen_*_css()`. The orchestrator in `render.ts` combines them into subjobs and
merged CSS. The HTML is self-contained (inline styles, embedded CSS) for
WeasyPrint rendering.


## Common Tasks & Examples

### Add a new content type

1. Add interface to `types.ts` (e.g., `ContentNewType`)
2. Add to `ContentItem` union type
3. Create `render/render_newtype.ts` with `gen_newtype_html()` and `gen_newtype_css()`
4. Add case in `render.ts` `gen_subjobs()` switch
5. Add CSS to `gen_combined_css()` call chain
6. Create `editors/EditorNewType.vue` for the editor UI
7. Add to `TabEditor.vue` component mapping
8. Add "add" button in `OptionsContent.vue`
9. Handle in `gen_content_name()` in `blueprints.ts`

### Add a new blueprint option

1. Add property to `Blueprint` interface in `types.ts`
2. Set default in `get_default_blueprint()` in `blueprints.ts`
3. Add UI control in appropriate `Options*.vue` component
4. Use the value in the relevant render module
5. If it needs DB migration, bump `DATABASE_VERSION` in `db.ts` and add migration

### Add a new Options section

1. Create `options/OptionsNewSection.vue`
2. Import and place in `TabCreate.vue` (inside the advanced block if appropriate)

### Add a new locale

1. Create `app/src/locales/{code}.json` with translated strings
2. Add the locale code to `app/src/locales.json` `supported` array
3. Run `.bin/detect_i18n_strings` to find missing keys


## Testing & Quality

- **No test framework configured.** The project has no automated tests.
- **TypeScript strict mode** catches type errors at build time
  (`noUnusedLocals`, `noImplicitReturns`, `exactOptionalPropertyTypes`)
- **Error monitoring:** Rollbar in production for runtime errors
  (env var `VITE_ROLLBAR_TOKEN`)
- **Linting:** No ESLint config found (the `eslint-disable` comments in `db.ts`
  suggest it was used at some point)
- **Build validation:** `vite build` will catch compilation errors
- **i18n validation:** `.bin/detect_i18n_strings` checks for missing translation keys


## Troubleshooting & Known Issues

### IndexedDB unavailability

Some private tabs, webviews, and Safari contexts don't support IndexedDB. The app
falls back to a no-op fake database (see `db.ts` catch handler). Drafts and history
won't persist in these contexts.

### Safari connection termination

Safari may close IndexedDB connections after inactivity. The `terminated` callback
in `db.ts` automatically reconnects.

### Blueprint validation

`clean_blueprint()` in `blueprints.ts` has a `TODO` noting that nested content items
are not fully validated. Only top-level keys are checked against defaults.

### PDF generation timeout

Lambda timeout is 600 seconds (10 minutes). The app's polling timeout matches at
610 seconds. If Lambda's timeout changes, update both `generator/template.yaml` and
`app/src/services/create.ts`.

### WeasyPrint rendering vs screen preview

The preview in `DisplayPreview.vue` is a browser-rendered approximation. Fonts,
line breaks, and spacing may differ in the WeasyPrint-generated PDF. Users should
print a test page.

### Content item icon null

`ContentTitle.icon` may be null for some users due to a historical bug. The type
definition and renderers handle this gracefully.

### DB migrations

The `upgrade_database()` function in `db.ts` handles schema migrations. A bug in
DBv2 forgot to update draft passage properties, which is patched in the DBv3
migration.

### S3 file expiration

- Requests expire after 90 days
- Creations (PDFs) expire after 365 days
- The app detects expiration via HEAD requests (403/404) and updates status


## Notable Dependencies

### @gracious.tech/fetch-client (Bible data)

- Provides `BibleClient` and `BibleCollection` for accessing Bible translations
- In dev, it connects to `localhost:8430`; in prod, `https://v1.fetch.bible/`
- The collection provides book metadata, translation info, license restrictions, and
  rendered HTML for Bible passages

### WeasyPrint (PDF generation)

- CSS-based HTML-to-PDF engine used in the Lambda function
- Requires significant memory (Lambda configured with 2048MB)
- Network access is explicitly blocked via a custom `url_fetcher` for security
- All fonts and styles must be embedded in the HTML; no external resource loading
- Output can be very large before compression (115MB -> 14MB observed)

### pypdf (PDF manipulation)

- Handles page merging, booklet page reordering, compression, and metadata
- Each blank page must be a new `PageObject` to avoid printer confusion
- Booklet mode reorders pages for correct folding (multiples of 4)

### vuedraggable

- Version 4.1 used (compatible with Vue 3)
- Provides drag-and-drop reordering for the content item list

### TinyMCE (via @tinymce/tinymce-vue)

- WYSIWYG HTML editor for custom content pages
- Loaded via CDN (not bundled)
- Limited toolbar: bold, italic, tables, lists, subscript, page breaks


## Performance & Debugging

### Frontend performance

- **Debounced watchers** prevent excessive IndexedDB writes and API calls
- **Lazy locale loading:** Non-English locale files imported dynamically
- **Pre-caching:** Bible book HTML is fetched as soon as passages are added, before
  the user hits "Create"
- **Reactive computed properties** minimize recalculation

### Backend performance

- **Lambda memory:** 2048MB required for WeasyPrint rendering
- **PDF compression:** `compress_content_streams()` reduces output by ~87%
- **Timeout:** 600 seconds; large documents (many books) may approach this limit

### Debugging

- **Dev error reports** go to `localhost:7777` (inspect with a local HTTP server)
- **`report_error`** is exposed on `self` for console testing
- **Generator debugging:** `.bin/debug_generator` opens a Docker shell in the
  Lambda container image
- **Browser DevTools:** Vue reactivity state is fully inspectable; `blue` object
  in `state.ts` drives the entire UI


## Future Improvements

### Known TODOs in code

- `blueprints.ts`: Nested content item validation in `clean_blueprint()` is incomplete
- `state.ts`: Parse study note license restrictions from collection data (currently
  assumes all require attribution)
- `main.py`: Remove backward-compat defaults for `booklike` and `show_pages` args
  once app is updated
- `main.py`: Refactor `*show_pages` unpacking once confident 4th arg is always present

### Potential improvements

- Add automated tests (unit tests for render pipeline, integration tests for
  blueprint validation)
- Run the generator locally (currently blocked by S3 API access requirements)
- Full nested validation in `clean_blueprint()`
- Add more supported locales beyond Vietnamese
- ESLint/Prettier configuration for consistent code formatting
