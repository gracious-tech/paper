
// The printing-service picker's list.
//
// printing-services knows every service's name, where it prints and what it can bind, but not
// how to pitch it to someone who has never chosen a printer before. So this assembles both: a
// hand-written line for the service-less modes and the global services the app has an opinion
// about, and for every other service a description derived from the bindings it offers and how
// long a document they take. Names always come from printing-services itself, never restated
// here, so a service renamed upstream renames here too.

import {list_services} from 'printing-services'

import {country_namer, locale_to_bcp47} from '@/services/locale'

import type {ServicePublic} from 'printing-services'
import type {Translate} from '@/services/i18n'


// How many pages a home-printed booklet can run to — 10 sheets folded in half, about as much as
// an ordinary stapler bites through (a long-arm stapler manages more, but few people own one)
export const HOME_BOOKLET_MAX_PAGES = 40


// Services with a hand-written pitch, by service id. Anything else is described from its
// bindings, so a service added upstream still gets a useful subtitle without being listed here
const SERVICE_DESC_KEYS:Record<string, string> = {
    lulu: 'options.paper.service_desc_lulu',
    kdp: 'options.paper.service_desc_kdp',
}


// One entry in the picker: a selectable service/mode, a group heading, or the rule above one.
// Vuetify's select renders 'subheader'/'divider' items itself and skips them when selecting or
// navigating, so grouping needs nothing of the component beyond the items it's given
export interface ServiceItem {
    title:string
    value?:string
    subtitle?:string
    type?:'subheader'|'divider'
    props?:{color:string, class:string}
}


// Headings take the theme colour and a heavier weight so they read as structure rather than as
// yet another option (Vuetify's default is the same grey as the descriptions beneath them)
const HEADING_PROPS = {color: 'primary', class: 'font-weight-bold'}


// Describe a service by what it can bind. A service that can only staple can't make a real book
// at all, which is the one thing worth saying up front; anything else is summarised by the
// longest document its bindings take
function describe_service(service:ServicePublic, t:Translate):string{
    const limits = Object.values(service.raw.binding_types)
    const pages = Math.max(...limits.map(binding => binding.max_pages))
    const stitch_only = Object.keys(service.raw.binding_types)
        .every(id => id === 'paperback_stitch')
    if (stitch_only){
        return t("options.paper.service_desc_stitch", {pages})
    }
    return t("options.paper.service_desc_bindings", {pages})
}


// One service's entry in the list
function service_item(service:ServicePublic, t:Translate):ServiceItem{
    const described = SERVICE_DESC_KEYS[service.id]
    return {
        value: service.id,
        title: service.name,
        subtitle: described ? t(described) : describe_service(service, t),
    }
}


// A group of services: a rule and a heading, then the services themselves
function group_items(title:string, services:ServicePublic[], t:Translate):ServiceItem[]{
    return [
        {title: '', type: 'divider'},
        {title, type: 'subheader', props: HEADING_PROPS},
        ...services.map(service => service_item(service, t)),
    ]
}


// The country the browser's language tags place the user in, so their local services sort to the
// top of the country groups. Only a hint — every service is listed either way
function browser_country():string|null{
    const tags = navigator.languages?.length ? navigator.languages : [navigator.language]
    for (const tag of tags){
        const region = tag.split('-')[1]
        if (region){
            return region.toLowerCase()
        }
    }
    return null
}


// Every printing option, in the order the picker shows them: the two service-less modes first
// (unheaded — neither is a printing service), then services that print worldwide, then a group
// per country that a service is limited to, the user's own country leading
export function service_select_items(t:Translate, locale:string):ServiceItem[]{
    const services = list_services()
    const items:ServiceItem[] = []

    // Home printing and the custom (service-less) mode
    items.push({
        value: 'home',
        title: t("options.paper.service_home"),
        subtitle: t("options.paper.service_desc_home", {pages: HOME_BOOKLET_MAX_PAGES}),
    })
    items.push({
        value: 'custom',
        title: t("common.custom_menu"),
        subtitle: t("options.paper.service_desc_custom"),
    })

    // Services that ship anywhere
    const global = services.filter(service => service.countries === null)
    if (global.length){
        items.push(...group_items(t("options.paper.services_global"), global, t))
    }

    // Then the country-limited ones, grouped under the country's name in the user's language
    const country_name = country_namer(locale)
    const tag = locale_to_bcp47(locale)
    const own_country = browser_country()
    const countries = [...new Set(services.flatMap(service => service.countries ?? []))]
    countries.sort((a, b) => {
        if (a === own_country || b === own_country){
            return a === own_country ? -1 : 1
        }
        return country_name(a).localeCompare(country_name(b), tag)
    })
    for (const country of countries){
        items.push(...group_items(country_name(country),
            services.filter(service => service.countries?.includes(country)), t))
    }

    return items
}
