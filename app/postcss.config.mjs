
import postcss_nested from 'postcss-nested'


// Shared-assets base URL for stylesheets (fonts etc) — same dev/prod switch as ASSETS_PREFIX
// in services/typst.ts, but CSS can't read import.meta.env so it's substituted here instead
const ASSETS_PREFIX = process.env['NODE_ENV'] === 'development'
    ? 'http://localhost:5301/generator_assets'
    : 'https://assets.paper.bible'


// Replace `$assets_prefix` in any declaration value with the environment's assets base URL
const plugin_assets_prefix = {
    postcssPlugin: 'assets-prefix',
    Declaration(decl){
        if (decl.value.includes('$assets_prefix')){
            decl.value = decl.value.replaceAll('$assets_prefix', ASSETS_PREFIX)
        }
    },
}


// Styles are authored in SugarSS (indented CSS), so nesting is flattened here rather than by a
// preprocessor — Vite selects the SugarSS parser itself for `.sss` files and `lang='sss'` blocks
export default {
    plugins: [postcss_nested, plugin_assets_prefix],
}
