
// SugarSS ships no types of its own — it is simply a PostCSS parser
declare module 'sugarss' {
    import {Parser, Root} from 'postcss'
    const parser:Parser<Root>
    export default parser
}
