
// Minimal i18n: translation catalogs are flat maps of symbolic key -> plain string with
// {named} placeholders. No message-format library — the app is aimed at 800+ machine-
// translated locales, where ICU syntax only gets in the translator's way and CLDR plural
// data doesn't exist for most targets. Plural/branching is handled in calling code by
// picking the key. `eng` is bundled as the fallback; other locales load on demand.

import {shallowRef} from 'vue'
import type {App} from 'vue'
import eng from '@/locales/eng.json'

export const SOURCE_LOCALE = 'eng'

type Catalog = Record<string, string>
type Params = Record<string, string|number>

// Loaded catalogs, keyed by locale code; eng is always present
const catalogs:Record<string, Catalog> = {eng}

// The active locale (reactive so components re-render on change)
export const locale = shallowRef(SOURCE_LOCALE)

// Lazy loaders for every catalog except eng (which is bundled above)
const catalog_loaders = import.meta.glob<{default:Catalog}>(
    ['../locales/*.json', '!../locales/eng.json'],
)

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
