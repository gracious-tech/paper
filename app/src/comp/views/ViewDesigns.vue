
<template lang='pug'>

div.cont

    div.header
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

    div(v-if='!has_any_unfiltered' class='pa-4 text-center text-medium-emphasis')
        | {{$t("view.designs.no_designs_yet")}}
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

</template>


<script lang='ts' setup>

import {computed, ref} from 'vue'
import {useI18n} from '@/services/i18n'
import {useRouter} from 'vue-router'

import DesignListItem from './assets/DesignListItem.vue'
import {user} from '@/services/auth'
import {designs, viewed_designs, rename_category, clear_category} from '@/services/designs'
import {confirm_dialog, prompt_dialog} from '@/services/state'
import {format_relative_time} from '@/services/utils'

import type {DesignMeta, ViewedDesign} from '@/services/types'


const {t} = useI18n()
const router = useRouter()


// Sort criterion, applied per-group (Uncategorized/each category/Shared edit/Shared read)
const sort_by = ref<'modified'|'name'>('modified')

// Search box — filters every group by name, before any grouping/sorting below
const search_query = ref('')

const matches_search = (name:string):boolean => {
    const query = search_query.value.trim().toLowerCase()
    return !query || name.toLowerCase().includes(query)
}

const sort = <T extends {name:string, modified:Date}>(list:T[]):T[] => {
    return [...list].sort((a, b) => {
        return sort_by.value === 'name'
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


const open_viewed = (viewed:ViewedDesign) => {
    void router.push({name: 'design', params: {id: viewed.design_id, version: viewed.last_version_id}})
}

</script>


<style lang='sass' scoped>

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

</style>
