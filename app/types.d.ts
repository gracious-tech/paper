
// Injected by vite.config.mts — whether to use production services instead of local dev servers
interface ImportMetaEnv {
    readonly USE_PROD_SERVICES:boolean
}


// SugarSS ships no types of its own — it is simply a PostCSS parser
declare module 'sugarss' {
    import {Parser, Root} from 'postcss'
    const parser:Parser<Root>
    export default parser
}
