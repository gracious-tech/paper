
// The details shown under a translation in the Bible picker, from fetch.bible's manifest tags and
// its descriptions. Kept out of the picker so it can be tested without a DOM

import type {DistDescription, GetResourcesItem} from '@gracious.tech/fetch-client'
import type {Translate} from '@/services/i18n'


// A translation's details: facts for one line, and a one-line description (either may be empty)
export interface BibleDetails {
    facts:string[]
    description:string
}


// List what's known about a translation, for "year · literalness · provenance · NT text", and
// pick its description in its own language, else English. Provenance is only stated when
// fetch.bible described the translation, since one it doesn't list may well derive from another
// and "Original" would be a guess
export function bible_details(trans:Pick<GetResourcesItem, 'year'|'tags'>,
        description:DistDescription|undefined, t:Translate):BibleDetails {
    const facts:string[] = []

    // Year of the translation
    if (trans.year){
        facts.push(String(trans.year))
    }

    // Literalness (a translation has at most one tag, literal1 being the most literal)
    const literal = trans.tags.find(tag => /^literal[1-5]$/.test(tag))
    if (literal){
        const key = `svc.bible_details.${literal}`
        facts.push(t(key))
    }

    // What it derives from, else original
    if (description){
        facts.push(description.provenance
            ? t('svc.bible_details.derived_from', {source: description.provenance})
            : t('svc.bible_details.original'))
    }

    // Which New Testament source text it mostly follows (neither tag when mixed or unclear)
    if (trans.tags.includes('alex')){
        facts.push(t('svc.bible_details.alex'))
    } else if (trans.tags.includes('byz')){
        facts.push(t('svc.bible_details.byz'))
    }

    return {
        facts,
        description: description?.local ?? description?.english ?? '',
    }
}

