
import type {TextDir} from './types.js'


// ISO 639-3 (what fetch.bible tags translations with) to ISO 639-1, which is what Typst's `lang`
// actually resolves: a 3-letter code is accepted without complaint but matches no known language,
// so it gets no hyphenation patterns and falls back to English quote style (verified against
// Typst 0.14). Anything not listed here passes its 639-3 code through unchanged — that is still
// the honest tag for the text, and leaving such a language unhyphenated is correct, where
// defaulting it to English would hyphenate it by another language's rules.
const ISO_639_1:Record<string, string> = {
    // Typst has hyphenation patterns for these (probed against 0.14 — the rest do not hyphenate
    // whatever code they are given)
    afr: 'af', bel: 'be', bul: 'bg', cat: 'ca', ces: 'cs', dan: 'da', deu: 'de', ell: 'el',
    eng: 'en', est: 'et', fin: 'fi', fra: 'fr', hrv: 'hr', hun: 'hu', isl: 'is', ita: 'it',
    kat: 'ka', lat: 'la', lit: 'lt', mon: 'mn', nld: 'nl', nno: 'nn', nob: 'nb', nor: 'no',
    pol: 'pl', por: 'pt', rus: 'ru', slk: 'sk', slv: 'sl', spa: 'es', sqi: 'sq', srp: 'sr',
    swe: 'sv', tuk: 'tk', tur: 'tr', ukr: 'uk',
    // No patterns, but a language Typst knows, so the tag still buys the right quote style
    ara: 'ar', aze: 'az', ben: 'bn', bos: 'bs', cym: 'cy', eus: 'eu', fas: 'fa', gla: 'gd',
    gle: 'ga', glg: 'gl', guj: 'gu', hat: 'ht', hau: 'ha', heb: 'he', hin: 'hi', hye: 'hy',
    ind: 'id', jav: 'jv', jpn: 'ja', kan: 'kn', kaz: 'kk', khm: 'km', kin: 'rw', kir: 'ky',
    kor: 'ko', lao: 'lo', lav: 'lv', ltz: 'lb', mal: 'ml', mar: 'mr', mkd: 'mk', mlg: 'mg',
    mlt: 'mt', msa: 'ms', mya: 'my', nep: 'ne', nya: 'ny', ori: 'or', pan: 'pa', ron: 'ro',
    sin: 'si', som: 'so', sna: 'sn', sot: 'st', swa: 'sw', tam: 'ta', tel: 'te', tgk: 'tg',
    tgl: 'tl', tha: 'th', urd: 'ur', uzb: 'uz', vie: 'vi', xho: 'xh', yor: 'yo', zho: 'zh',
    zul: 'zu',
    // Individual languages fetch.bible tags separately from the macrolanguage listed above
    // (Ancient Hebrew and Standard Arabic included: same script and quote style)
    arb: 'ar', cmn: 'zh', hbo: 'he', pes: 'fa', swh: 'sw', zsm: 'ms',
}


// The Typst `lang` code for a translation's ISO 639-3 language, defaulting to English when the
// translation's language isn't known at all (an unlabelled resource, or no translation yet).
// An unmapped code passes through only if Typst will accept it: `lang` takes a two or three
// letter code and *errors* on anything else, which would fail the whole compile over a single
// oddly-tagged translation
export function resolve_lang(language:string|undefined):string {
    const mapped = language && ISO_639_1[language]
    if (mapped) {
        return mapped
    }
    return language && /^[a-z]{2,3}$/.test(language) ? language : 'en'
}


// Extra `text()` arguments giving a nested scope its own language and direction, or '' to
// inherit the document's (both null). Direction is always passed explicitly, since Typst only
// infers it from `lang` — see TypographyConfig.dir
export function gen_locale_args(lang:string|null, dir:TextDir|null):string {
    return (lang ? `, lang: "${lang}"` : '') + (dir ? `, dir: ${dir}` : '')
}


// Living scripts written right to left. JS regexes can't match on Unicode's Bidi_Class, so the
// strong-RTL characters are approximated by script — every letter in these is R or AL
const RTL_LETTER = new RegExp('[' + [
    'Hebrew', 'Arabic', 'Syriac', 'Thaana', 'Nko', 'Samaritan', 'Mandaic', 'Adlam',
    'Hanifi_Rohingya', 'Yezidi', 'Mende_Kikakui',
].map(script => `\\p{Script=${script}}`).join('') + ']', 'u')


// The direction of a piece of text from its first letter, the way a browser resolves
// `dir="auto"` (Unicode's first-strong-character rule): digits, punctuation and spaces are
// skipped, so "3. ...", say, takes the direction of what follows. Null when there's no letter at
// all, leaving the text to inherit whatever direction surrounds it
export function detect_dir(text:string):TextDir|null {
    const letter = /\p{L}/u.exec(text)?.[0]
    if (!letter) {
        return null
    }
    return RTL_LETTER.test(letter) ? 'rtl' : 'ltr'
}


// Extra `text()` arguments giving a run of text the direction detected from it (see detect_dir),
// or '' to inherit — for short standalone strings like titles, whose whole paragraph is that one
// run, so the run's direction is the paragraph's
export function gen_detected_dir_arg(text:string):string {
    const dir = detect_dir(text)
    return dir ? `, dir: ${dir}` : ''
}

