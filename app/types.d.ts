
// Injected by vite.config.mts
interface ImportMetaEnv {
    // Whether to use production services instead of local dev servers
    readonly USE_PROD_SERVICES:boolean
    // Commit the build was made from ('dev' under the dev server), sent with error reports
    readonly BUILD_COMMIT:string
    // The Firebase emulators' ports, which the dev server connects to (from firebase.json, or
    // the config named by EMULATOR_CONFIG)
    readonly EMULATOR_PORTS:{auth:number, firestore:number, storage:number}
}


// SugarSS ships no types of its own — it is simply a PostCSS parser
declare module 'sugarss' {
    import {Parser, Root} from 'postcss'
    const parser:Parser<Root>
    export default parser
}
