// Locale detection. The app's UI locales are browser language tags (BCP 47: "en", "pt-BR",
// "zh-Hans"), the convention browsers, Intl, Vuetify, Firebase Auth and the cover widget all
// share, so they pass straight through to each. Bible content is a separate thing keyed by
// fetch.bible's ISO 639-3 codes ("cmn", "pes"), which never stand in for a UI locale.


// The language and script a tag is written in, the two things a UI translation actually is
// (a region only picks spelling or vocabulary): "zh-TW" -> "zh-Hant", "pt-PT" -> "pt-Latn".
// null for a tag Intl can't parse
function written_in(tag:string):string|null {
    try {
        const full = new Intl.Locale(tag).maximize()
        return `${full.language}-${full.script}`
    } catch {
        return null
    }
}


// The supported locale that best serves one browser tag: the tag itself, else one written in the
// same language and script ("pt-PT" -> "pt-BR", "zh-TW" -> "zh-Hant" but never "zh-Hans"), else
// null. Tags are canonicalised first, so "EN-us" and a legacy ISO 639-3 "vie" are understood too
export function best_locale(tag:string, supported:readonly string[]):string|null {
    let canonical:string
    try {
        canonical = Intl.getCanonicalLocales(tag)[0]!
    } catch {
        return null
    }
    if (supported.includes(canonical)){
        return canonical
    }
    const wanted = written_in(canonical)
    return supported.find(code => written_in(code) === wanted) ?? null
}


// The browser's preferred language tags, most preferred first
function browser_tags():readonly string[] {
    return navigator.languages?.length ? navigator.languages : [navigator.language]
}


// The BCP-47 tag Intl formatters (dates, numbers) should use for one of our locales: the
// browser's own tag when it's served by this locale, so its regional conventions survive (en-GB
// dates rather than en-US ones), else the locale itself
export function intl_tag(locale:string):string {
    return browser_tags().find(tag => best_locale(tag, [locale]) === locale) ?? locale
}


// A function naming countries in the user's own language, e.g. "au" -> "Australia".
// Intl.DisplayNames throws on a tag it can't parse and has no data for many locales, so
// English stands behind it, and the code itself behind that
export function country_namer(locale:string):(code:string) => string {
    let names:Intl.DisplayNames|null = null
    try {
        names = new Intl.DisplayNames([locale, 'en'], {type: 'region'})
    } catch {
        names = null
    }
    return code => names?.of(code.toUpperCase()) ?? code.toUpperCase()
}


// Pick the best supported locale for this browser, falling back to the source locale
export function detect_locale(supported:readonly string[], fallback = 'en'):string {
    const candidates = [...supported, fallback]
    for (const tag of browser_tags()){
        const match = best_locale(tag, candidates)
        if (match){
            return match
        }
    }
    return fallback
}
