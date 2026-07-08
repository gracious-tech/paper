
# typst-fonts

Font manifest and Noto script-fallback resolution for Typst-based apps: lets users pick from a
curated font list while still rendering any script (CJK, Arabic, Devanagari, ...) via automatic
Noto fallback, plus a CLI to download both sets into an app's own fonts directory.

Works in browser and Node.

`npm install typst-fonts`

## Two font sets

- **Curated** — an app-specific list of first-class, user-selectable fonts (e.g. "Playfair
  Display", "Merriweather"). Not bundled with this package: each app downloads its own choices
  and supplies the resulting `manifest.json` at runtime via `init_fonts()`.
- **Noto** — the bundled, static fallback system covering every script Noto has a font for,
  plus regional CJK subsets (JP/KR/SC/TC/HK). Ships as package data (`generated/noto_manifest.json`,
  `generated/han_hints.json`) — no init call needed, and callers only fetch the specific
  fallback families a given piece of text actually needs, not the full ~150MB Noto set.

Both sets share one `manifest.json` shape (`BundledFont`/`NotoFont`: `family`, `files`, ...) so
resolution code (`resolve_font_dirs`, `font_urls_for`) treats them uniformly.

## Entry points

| Import | Environment | Contents |
|---|---|---|
| `typst-fonts` | Universal | Curated manifest lookups (`init_fonts`, `get_fonts`, `get_bundled_font`, `base_font`, `font_style`), Noto fallback resolution, `sfnt.ts` binary parsing |
| `typst-fonts/node` | Node | `load_fonts_dir`, `resolve_font_dirs` — read a manifest from disk, resolve `--font-path` directories for spawning `typst` |
| `typst-fonts/web` | Browser | `load_fonts_prefix`, `font_urls_for`, `register_preview_fonts`, `fetch_font_bytes`, `fonts_to_blob_urls` — fetch a manifest over HTTP, wire fonts into a browser-based compiler (e.g. typst.ts) or CSS `@font-face` previews |
| `typst-fonts/download` | Node | `run_download()` — programmatic entry to the download flow |

The root `typst-fonts` entry never imports Node-only or Web-only APIs, so it's safe to bundle
for either target.

## Downloading fonts

```bash
npx typst-fonts-download --fonts ./fonts [--config ./fonts.config.json]
```

Always downloads Noto Serif/Sans plus the full per-script Noto fallback set (from Google Fonts
and the package's bundled `noto_sources.json` respectively). `--config` adds an app's curated
fonts on top:

```json
{
    "noto_group": "Noto",
    "curated": [
        {"family": "Playfair Display", "group": "Display", "style": "serif"}
    ]
}
```

Output is `<fonts_dir>/manifest.json` (curated fonts) plus `<fonts_dir>/<family>/` and
`<fonts_dir>/_noto/<family>/` directories of `.ttf` files. Re-running skips families already on
disk.

## Resolving fonts for rendering

```ts
import {init_fonts, resolve_fallback_chain} from 'typst-fonts'
import {load_fonts_dir, resolve_font_dirs} from 'typst-fonts/node'

await load_fonts_dir('./fonts')  // calls init_fonts() internally

const chosen_font = 'Playfair Display'
const fallbacks = resolve_fallback_chain(text, 'SC', font_style(chosen_font))
const font_dirs = resolve_font_dirs('./fonts', [chosen_font, ...fallbacks])
// → pass font_dirs to `typst compile --font-path <dir>` for each
```

`resolve_fallback_chain` detects scripts present in the text and returns one Noto family per
script (CJK resolved to a region via `cjk_segments`/`detect_cjk_variant`, so mixed-language text
gets the right JP/KR/SC/TC family per sentence rather than one guess for the whole document).

## Custom (user-uploaded) fonts

`sfnt.ts` parses a TTF/OTF's `name` and `OS/2` tables directly, for fonts with no manifest
entry:

```ts
import {parse_font_family, parse_font_style} from 'typst-fonts'

const family = parse_font_family(font_bytes)  // from the file's own name table
const style = parse_font_style(font_bytes)    // 'serif' | 'sans' | null
```

## Maintenance scripts

`npm run update-noto-data` and `npm run update-han-hints` regenerate the bundled
`generated/*.json` files from upstream Noto and OpenCC data. Only needed when those upstream
sources change — not part of the normal build.
