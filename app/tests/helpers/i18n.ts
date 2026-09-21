
// A translator that echoes what it was asked for instead of translating.
//
// The helpers under test take `t` as an argument precisely so they don't depend on the active
// locale, and asserting against real English would make every test a hostage to the wording.
// This renders "key(name=value, other=2)", which stays readable when one call's result is
// substituted into another's.

import type {Translate} from '@/services/i18n'


export const echo_t:Translate = (key, params) => {
    if (!params){
        return key
    }
    const pairs = Object.entries(params).map(([name, value]) => `${name}=${String(value)}`)
    return `${key}(${pairs.join(', ')})`
}
