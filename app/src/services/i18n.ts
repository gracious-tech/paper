
// Minimal i18n: translation catalogs are flat maps of symbolic key -> plain string with
// {named} placeholders. No message-format library — the app is aimed at 800+ machine-
// translated locales, where ICU syntax only gets in the translator's way and CLDR plural
// data doesn't exist for most targets. Plural/branching is handled in calling code by
// picking the key. `eng` is bundled as the fallback; other locales load on demand.
// Catalogs are written by the tooling in app/i18n/ (see .claude/skills/translate/SKILL.md)

import {shallowRef} from 'vue'
import type {App} from 'vue'
import eng from '@/locales/eng.json'
import locales_meta from '@/locales.json'
import {detect_locale} from '@/services/locale'

export const SOURCE_LOCALE = 'eng'

type Catalog = Record<string, string>
type Params = Record<string, string|number>

// What the app knows about a locale without loading its catalog (see app/src/locales.json)
export interface LocaleInfo {
    name:string  // The language's name for itself, as shown in the language picker
    english:string  // Its English name (for the tooling and translator, not shown)
    dir:'ltr'|'rtl'
}

// Every locale the app can be shown in, the source locale included
export const LOCALES = locales_meta.locales as Record<string, LocaleInfo>

// Loaded catalogs, keyed by locale code; eng is always present
const catalogs:Record<string, Catalog> = {eng}

// The active locale (reactive so components re-render on change)
export const locale = shallowRef(SOURCE_LOCALE)

// Lazy loaders for every catalog except eng (which is bundled above)
const catalog_loaders = import.meta.glob<{default:Catalog}>(
    ['../locales/*.json', '!../locales/eng.json'],
)

// localStorage key holding a locale the user picked by hand, which beats browser detection
const CHOSEN_LOCALE_KEY = 'locale'

// Substitute {name} placeholders; an unmatched placeholder is left as-is
function interpolate(message:string, params?:Params):string {
    if (!params){
        return message
    }
    return message.replace(/\{(\w+)\}/g, (whole, name:string) => {
        return name in params ? String(params[name]) : whole
    })
}

// Translate a key in the active locale, falling back to eng, then to the key itself
export function translate(key:string, params?:Params):string {
    const message = catalogs[locale.value]?.[key] ?? catalogs[SOURCE_LOCALE]![key] ?? key
    return interpolate(message, params)
}

// The translator signature, for helpers that take `t` as an argument rather than importing it
export type Translate = typeof translate

// Singular/plural variant of a "{n} thing" phrase, keyed <stem>.one / <stem>.other
export function count_phrase(t:Translate, stem:string, n:number):string {
    return t(n === 1 ? `${stem}.one` : `${stem}.other`, {n})
}

// Text direction of a locale's UI (unknown codes are treated as left-to-right)
export function locale_dir(code:string):'ltr'|'rtl' {
    return LOCALES[code]?.dir ?? 'ltr'
}

// Load a locale's catalog (if not already loaded) and switch the app to it
export async function load_locale(code:string):Promise<void> {
    if (code !== SOURCE_LOCALE && !catalogs[code]){
        const load = catalog_loaders[`../locales/${code}.json`]
        if (!load){
            throw new Error(`no catalog for locale "${code}"`)
        }
        catalogs[code] = (await load()).default
    }
    locale.value = code
}

// The locale to boot in: the user's own pick if they made one, else the browser's best match
export function initial_locale():string {
    const targets = Object.keys(LOCALES).filter(code => code !== SOURCE_LOCALE)
    let chosen:string|null = null
    try {
        chosen = localStorage.getItem(CHOSEN_LOCALE_KEY)
    } catch {
        // Private mode / blocked storage — detection still works
    }
    return chosen && chosen in LOCALES ? chosen : detect_locale(targets, SOURCE_LOCALE)
}

// Switch to a locale the user picked by hand, remembering it for later visits
export async function choose_locale(code:string):Promise<void> {
    await load_locale(code)
    try {
        localStorage.setItem(CHOSEN_LOCALE_KEY, code)
    } catch {
        // Never fail over a cosmetic preference
    }
}

// Nested message tree, the shape Vuetify's locale adapter reads
export interface NestedMessages {
    [key:string]:NestedMessages|string
}

// Vuetify's own built-in strings (aria labels, "No data available") for a loaded locale. They
// live in our catalogs as `vuetify.*` keys so they're translated with everything else, then
// get re-nested here (`vuetify.input.clear` -> {input: {clear}}) for Vuetify to look up.
// Vuetify interpolates these itself with positional {0} placeholders, not {named} ones
export function vuetify_messages(code:string):NestedMessages {
    const tree:NestedMessages = {}
    const catalog = {...catalogs[SOURCE_LOCALE], ...catalogs[code]}
    for (const [key, message] of Object.entries(catalog)){
        if (!key.startsWith('vuetify.')){
            continue
        }
        const path = key.split('.').slice(1)
        let node = tree
        for (const part of path.slice(0, -1)){
            node = (node[part] ??= {}) as NestedMessages
        }
        node[path.at(-1)!] = message
    }
    return tree
}

// Composition-API accessor — mirrors the slice of vue-i18n's useI18n() the app relies on
export function useI18n():{t:typeof translate, locale:typeof locale} {
    return {t: translate, locale}
}

// Vue plugin: exposes $t() in templates
export const i18n = {
    install(app:App):void {
        app.config.globalProperties.$t = translate
    },
}

// Type $t for templates (vue-i18n used to provide this augmentation)
declare module 'vue' {
    interface ComponentCustomProperties {
        $t:typeof translate
    }
}
