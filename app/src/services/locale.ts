
// Locale detection. The app keys translations by ISO 639-3 code (eng, vie, ...) to match the
// fetch.bible platform; browsers report BCP-47 tags (en, en-US, vi, zh-Hant), so map between them.

// ISO 639-1 (and a few 639-2/T) primary subtags -> ISO 639-3. Extend as locales are added.
const ISO_1_TO_3:Record<string, string> = {
    aa: 'aar', ab: 'abk', af: 'afr', ak: 'aka', am: 'amh', ar: 'ara', as: 'asm', ay: 'aym',
    az: 'aze', be: 'bel', bg: 'bul', bm: 'bam', bn: 'ben', bo: 'bod', br: 'bre', bs: 'bos',
    ca: 'cat', cs: 'ces', cy: 'cym', da: 'dan', de: 'deu', dv: 'div', dz: 'dzo', ee: 'ewe',
    el: 'ell', en: 'eng', eo: 'epo', es: 'spa', et: 'est', eu: 'eus', fa: 'fas', ff: 'ful',
    fi: 'fin', fj: 'fij', fo: 'fao', fr: 'fra', fy: 'fry', ga: 'gle', gd: 'gla', gl: 'glg',
    gn: 'grn', gu: 'guj', gv: 'glv', ha: 'hau', he: 'heb', hi: 'hin', hr: 'hrv', ht: 'hat',
    hu: 'hun', hy: 'hye', id: 'ind', ig: 'ibo', is: 'isl', it: 'ita', ja: 'jpn', jv: 'jav',
    ka: 'kat', kk: 'kaz', kl: 'kal', km: 'khm', kn: 'kan', ko: 'kor', ku: 'kur', kw: 'cor',
    ky: 'kir', la: 'lat', lb: 'ltz', lg: 'lug', ln: 'lin', lo: 'lao', lt: 'lit', lv: 'lav',
    mg: 'mlg', mi: 'mri', mk: 'mkd', ml: 'mal', mn: 'mon', mr: 'mar', ms: 'msa', mt: 'mlt',
    my: 'mya', nb: 'nob', ne: 'nep', nl: 'nld', nn: 'nno', no: 'nor', ny: 'nya', oc: 'oci',
    om: 'orm', or: 'ori', pa: 'pan', pl: 'pol', ps: 'pus', pt: 'por', qu: 'que', rm: 'roh',
    rn: 'run', ro: 'ron', ru: 'rus', rw: 'kin', sd: 'snd', sg: 'sag', si: 'sin', sk: 'slk',
    sl: 'slv', sm: 'smo', sn: 'sna', so: 'som', sq: 'sqi', sr: 'srp', ss: 'ssw', st: 'sot',
    su: 'sun', sv: 'swe', sw: 'swa', ta: 'tam', te: 'tel', tg: 'tgk', th: 'tha', ti: 'tir',
    tk: 'tuk', tl: 'tgl', tn: 'tsn', to: 'ton', tr: 'tur', ts: 'tso', tt: 'tat', ug: 'uig',
    uk: 'ukr', ur: 'urd', uz: 'uzb', ve: 'ven', vi: 'vie', wo: 'wol', xh: 'xho', yi: 'yid',
    yo: 'yor', zh: 'zho', zu: 'zul',
}

// A BCP-47 tag whose script subtag matters -> a distinct ISO 639-3 based locale code
const SCRIPT_OVERRIDES:Record<string, string> = {
    'zh-hant': 'zho-Hant',
    'zh-hans': 'zho',
}

// Turn one BCP-47 tag into our locale code (e.g. "en-US" -> "eng", "zh-Hant-TW" -> "zho-Hant")
export function bcp47_to_locale(tag:string):string|null {
    const lower = tag.toLowerCase()
    const parts = lower.split('-')
    const primary = parts[0] ?? ''
    // Script-sensitive languages first (Chinese traditional vs simplified)
    if (parts[1] && SCRIPT_OVERRIDES[`${primary}-${parts[1]}`]){
        return SCRIPT_OVERRIDES[`${primary}-${parts[1]}`]!
    }
    return ISO_1_TO_3[primary] ?? (primary.length === 3 ? primary : null)
}

// Pick the best supported locale for this browser, falling back to the source locale
export function detect_locale(supported:string[], fallback = 'eng'):string {
    const wanted = navigator.languages?.length ? navigator.languages : [navigator.language]
    for (const tag of wanted){
        const code = bcp47_to_locale(tag)
        if (code && (code === fallback || supported.includes(code))){
            return code
        }
    }
    return fallback
}
