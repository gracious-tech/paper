
<template lang='pug'>

div.cont

    //- Searching and sorting only earn their space once the list is long enough to need them
    div.header(v-if='show_header')
        v-text-field.search(v-model='search_query' density='compact' variant='outlined'
                hide-details :placeholder='$t("view.designs.search_designs")')
            template(#prepend-inner)
                app-icon(name='search')
            template(v-if='search_query' #append-inner)
                v-btn(icon variant='text' size='small' @click='search_query = ""')
                    app-icon(name='close')
        v-btn-toggle(v-model='sort_by' density='compact' mandatory)
            v-btn(value='modified' size='small') {{$t("view.designs.recent")}}
            v-btn(value='name' size='small') {{$t("common.name")}}

    //- Only while the browser itself can install the app, and until dismissed (see install.ts).
    //-     Not on the empty-state page, where there's nothing to come back to yet
    div.install(v-if='offer_install && has_any_unfiltered')
        v-alert(variant='tonal' density='compact' color='primary' closable
                @click:close='dismiss_install')
            template(#prepend)
                app-icon(:name='is_mobile ? "install_mobile" : "install_desktop"')
            | {{$t("view.designs.install_prompt")}}
            v-btn(@click='install_app' variant='flat' color='secondary' size='small' class='ml-2')
                | {{$t("view.designs.install")}}

    //- Nothing at all yet — the navbar's "New" is easy to miss on an otherwise blank page
    div(v-if='!has_any_unfiltered' class='pa-4 mt-12 text-center')
        p(class='text-medium-emphasis') {{$t("view.designs.no_designs_yet")}}
        v-btn(@click='state.new_design = true' color='secondary' variant='tonal' class='mt-4')
            | {{$t("view.designs.create_first")}}
    div(v-else-if='!has_any_filtered' class='pa-4 text-center text-medium-emphasis')
        | {{$t("view.designs.no_matching_designs")}}

    v-list(v-else bg-color='transparent')

        template(v-for='group of own_groups' :key='group.name')
            div.subheader(v-if='group.key')
                v-list-subheader.group-heading {{ group.name }}
                v-menu
                    template(#activator='{props}')
                        v-btn(v-bind='props' icon variant='text' size='small')
                            app-icon(name='more_vert')
                    v-list
                        v-list-item(@click='rename_group(group.key)')
                            v-list-item-title {{$t("view.designs.rename_category")}}
                        v-list-item(@click='clear_group(group.key)')
                            v-list-item-title {{$t("view.designs.remove_category")}}
            DesignListItem(v-for='design of group.designs' :key='design.id' :design='design'
                :categories='all_categories')

        template(v-if='edit_access_sorted.length')
            div.subheader
                v-list-subheader.group-heading {{$t("view.designs.shared_edit_access")}}
            DesignListItem(v-for='design of edit_access_sorted' :key='design.id' :design='design'
                :categories='all_categories')

        template(v-if='viewed_sorted.length')
            div.subheader
                v-list-subheader.group-heading {{$t("view.designs.shared_read_access")}}
            v-list-item.design-item(v-for='viewed of viewed_sorted' :key='viewed.design_id'
                    @click='open_viewed(viewed)' color='primary')
                v-list-item-title {{ viewed.title || $t("common.unnamed_design") }}
                v-list-item-subtitle {{ format_relative_time(viewed.last_viewed) }}

    //- Guests only exist in this browser, so warn them their designs are one clear-data away
    //-     from being lost. Sits outside the list so searching/filtering can never hide it
    div.signin_warning(v-if='show_signin_warning')
        v-alert(type='info' variant='tonal' density='compact' class='')
            | {{$t("view.designs.signin_warning")}}
            v-btn(@click='state.account = true' variant='flat' color='secondary' size='small' class='ml-2')
                | {{$t("view.designs.signin_warning_action")}}

    //- Example designs, which desktop shows in the preview pane beside this list. Mobile has no
    //- such pane (see AppRoot), so they sit at the bottom here, behind a toggle so they don't
    //- bury the user's own designs. The toggle comes after them, so once they're shown "Hide"
    //- is what's left at the bottom of the page
    template(v-if='is_mobile')
        div(ref='suggestions_el')
            DisplayExamples(v-if='show_suggestions' inline)
        div.suggestions_toggle
            v-btn(@click='toggle_suggestions' variant='tonal' color='secondary')
                template(#prepend)
                    app-icon(:name='show_suggestions ? "expand_less" : "expand_more"')
                | {{ $t(show_suggestions ? 'view.designs.hide_suggestions' : 'view.designs.show_suggestions') }}

    //- LEGACY Remove with app/src/legacy/ once old data no longer needs recovering
    //- Sits outside the list so searching/filtering can never hide it
    div.legacy(v-if='legacy.available')
        VBtn(@click='legacy.open = true' color='warning' variant='flat')
            //- English only, like the legacy dialog it opens (i18n-ignore)
            | My Old Creations

</template>


<script lang='ts' setup>

import {computed, ref, watch, nextTick} from 'vue'
import {useI18n} from '@/services/i18n'
import {useRouter} from 'vue-router'

import DesignListItem from './assets/DesignListItem.vue'
import DisplayExamples from '@/comp/display/DisplayExamples.vue'
import {use_is_mobile} from '@/services/display'
import {user, is_anonymous} from '@/services/auth'
import {designs, viewed_designs, rename_category, clear_category} from '@/services/designs'
// LEGACY Remove with app/src/legacy/ once old data no longer needs recovering
import {legacy} from '@/legacy/legacy'
import {state, confirm_dialog, prompt_dialog} from '@/services/state'
import {format_relative_time} from '@/services/utils'
import {offer_install, dismiss_install, install_app} from '@/services/install'

import type {DesignMeta, ViewedDesign} from '@/services/types'


const {t} = useI18n()
const router = useRouter()


// How many designs the list must hold before the search box and sort toggle are shown
const HEADER_MIN_DESIGNS = 10

// localStorage key remembering the sort criterion last chosen, so the list opens sorted the same
const SORT_KEY = 'designs_sort'


// Read the remembered sort criterion, defaulting to most recent first
const read_sort = ():'modified'|'name' => {
    try {
        return localStorage.getItem(SORT_KEY) === 'name' ? 'name' : 'modified'
    } catch {
        // Private mode / blocked storage
        return 'modified'
    }
}


// Sort criterion, applied per-group (Uncategorized/each category/Shared edit/Shared read)
const sort_by = ref<'modified'|'name'>(read_sort())

// Remember each change of sort criterion
watch(sort_by, value => {
    try {
        localStorage.setItem(SORT_KEY, value)
    } catch {
        // Never fail over a cosmetic preference
    }
})

// Search box — filters every group by name, before any grouping/sorting below
const search_query = ref('')


// Whether the list is long enough to show the search box and sort toggle
const show_header = computed(() => designs.length + viewed_designs.length >= HEADER_MIN_DESIGNS)

// The search and sort in effect, which fall back to showing everything by most recent while
// their controls are hidden, so a list that shrinks can't stay filtered or sorted by a control
// the user can no longer see (the remembered sort returns with the toggle)
const effective_query = computed(() => show_header.value ? search_query.value : '')
const effective_sort = computed(() => show_header.value ? sort_by.value : 'modified')

const matches_search = (name:string):boolean => {
    const query = effective_query.value.trim().toLowerCase()
    return !query || name.toLowerCase().includes(query)
}

const sort = <T extends {name:string, modified:Date}>(list:T[]):T[] => {
    return [...list].sort((a, b) => {
        return effective_sort.value === 'name'
            ? a.name.localeCompare(b.name)
            : b.modified.getTime() - a.modified.getTime()
    })
}


const own = computed(() => designs.filter(item => item.owner === user.value?.uid))
const edit_access = computed(() => designs.filter(item => item.owner !== user.value?.uid))

const own_filtered = computed(() => own.value.filter(d => matches_search(d.name)))
const edit_access_sorted = computed(() => {
    return sort(edit_access.value.filter(d => matches_search(d.name)))
})
const viewed_sorted = computed(() => {
    return sort(viewed_designs
        .filter(v => matches_search(v.title))
        .map(v => ({...v, name: v.title, modified: v.last_viewed})))
})


// All distinct category names in use (for the category-picker dialog)
const all_categories = computed(() => {
    return [...new Set(own.value.map(d => d.category).filter((c):c is string => !!c))].sort()
})


// Owned designs grouped by category — Uncategorized always first, then alphabetical by name,
// designs within each group sorted per the shared Recent/Name toggle
const own_groups = computed(() => {
    const groups = new Map<string, DesignMeta[]>()
    for (const design of own_filtered.value){
        const key = design.category ?? ''
        if (!groups.has(key)){
            groups.set(key, [])
        }
        groups.get(key)!.push(design)
    }
    const category_names = [...groups.keys()].filter(name => name !== '').sort()
    const ordered_names = groups.has('') ? ['', ...category_names] : category_names
    return ordered_names.map(name => ({
        name: name || t("view.designs.uncategorized"),
        key: name,  // '' for Uncategorized — not renameable/removable, unlike real categories
        designs: sort(groups.get(name)!),
    }))
})


const rename_group = async (old_name:string) => {
    const new_name = await prompt_dialog(t("view.designs.rename_category"), old_name)
    if (new_name?.trim() && new_name.trim() !== old_name){
        void rename_category(old_name, new_name.trim())
    }
}

const clear_group = async (name:string) => {
    if (await confirm_dialog(t("view.designs.remove_category_confirm"))){
        void clear_category(name)
    }
}


// Whether the user has any designs/shared access at all, vs. the search box just filtering
// everything out (two different empty states)
const has_any_unfiltered = computed(() => designs.length > 0 || viewed_designs.length > 0)
const has_any_filtered = computed(() => {
    return own_groups.value.length > 0 || edit_access_sorted.value.length > 0
        || viewed_sorted.value.length > 0
})


// Only nag guests who actually have something to lose (not on the empty-state page)
const show_signin_warning = computed(() => is_anonymous.value && has_any_unfiltered.value)


// Whether the example designs are revealed at the bottom of the list (mobile only — desktop
// always shows them in the preview pane). Open from the start when there are no designs yet,
// since then there's no list for them to bury
const is_mobile = use_is_mobile()
const show_suggestions = ref(!has_any_unfiltered.value)
const suggestions_el = ref<HTMLElement|null>(null)


// Reveal or hide the example designs, scrolling them into view when revealed since they open
// below the fold of a long list
const toggle_suggestions = async () => {
    show_suggestions.value = !show_suggestions.value
    if (show_suggestions.value){
        await nextTick()
        suggestions_el.value?.scrollIntoView({behavior: 'smooth', block: 'start'})
    }
}


const open_viewed = (viewed:ViewedDesign) => {
    void router.push({name: 'design', params: {id: viewed.design_id, version: viewed.last_version_id}})
}

</script>


<style lang='sss' scoped>

.cont
    overflow: auto
    flex-grow: 1

.header
    display: flex
    align-items: center
    flex-wrap: wrap
    gap: 12px
    justify-content: space-between
    padding: 16px

.search
    flex-grow: 1
    max-width: 320px

.install
    padding: 16px 16px 0

// The search bar already spaces it from the top
.header + .install
    padding-top: 0

    .v-alert
        line-height: 1.5

.subheader
    display: flex
    align-items: center
    justify-content: space-between
    margin-top: 20px
    padding-right: 16px

    &:first-child
        margin-top: 0

.group-heading
    font-size: 1rem
    font-weight: 700
    opacity: 1
    color: rgb(var(--v-theme-on-surface))

.design-item
    padding-top: 14px
    padding-bottom: 14px
    margin-bottom: 4px

.signin_warning
    padding: 32px 16px 0

    .v-alert
        line-height: 1.5

.suggestions_toggle
    display: flex
    justify-content: center
    padding: 32px 16px 24px

// LEGACY Remove with app/src/legacy/ once old data no longer needs recovering
.legacy
    display: flex
    justify-content: center
    padding: 32px 16px 16px

</style>
