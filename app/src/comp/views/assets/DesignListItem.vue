
<template lang='pug'>

v-list-item.design-item(@click='open' color='primary')
    v-list-item-title
        | {{ design.name || $t("Unnamed design") }}
        span.needs-version(v-if='needs_version' class='ml-2'
                :title='$t("This design has changes since its last created version")')
            app-icon(name='edit')
    v-list-item-subtitle
        div.subtitle-row
            span.contents(v-if='design.content_summary') {{ design.content_summary }}
            span.modified {{ modified_label }}
    div.chips
        v-chip(size='small' variant='tonal' color='primary') {{ paper_size_label }}
        v-chip(v-if='pages_label' size='small' variant='tonal' color='primary') {{ pages_label }}
        v-chip(size='small' variant='tonal' color='primary') {{ service_label }}
        v-chip(v-if='bibles_label' size='small' variant='tonal' color='primary') {{ bibles_label }}
    template(#append)
        app-icon(v-if='design.shared' name='group' class='mr-2' :title='$t("Shared design")')
        v-menu
            template(#activator='{props}')
                v-btn(v-bind='props' icon variant='text' color='black' @click.stop)
                    app-icon(name='more_vert')
            v-list
                v-list-item(@click='rename')
                    v-list-item-title {{$t("Rename")}}
                v-list-item(@click='duplicate')
                    v-list-item-title {{$t("Duplicate")}}
                v-list-item(v-if='is_owner' @click='show_category = true')
                    v-list-item-title {{$t("Category…")}}
                v-list-item(@click='show_invite = true')
                    v-list-item-title
                        | {{ is_owner ? $t("Invite an editor") : $t("People with access") }}
                v-list-item(v-if='is_owner' @click='remove')
                    v-list-item-title {{$t("Delete")}}
    DialogInviteEditor(v-model='show_invite' :id='design.id')
    DialogSetCategory(v-if='is_owner' v-model='show_category' :id='design.id'
        :categories='categories')

</template>


<script lang='ts' setup>

import {computed, ref} from 'vue'
import {useI18n} from 'vue-i18n'
import {useRouter} from 'vue-router'

import DialogInviteEditor from '@/comp/dialogs/DialogInviteEditor.vue'
import DialogSetCategory from '@/comp/dialogs/DialogSetCategory.vue'
import {user} from '@/services/auth'
import {confirm_dialog, prompt_dialog} from '@/services/state'
import {rename_design, duplicate_design, delete_design} from '@/services/designs'
import {design_needs_version} from '@/services/versions'
import {format_paper_size, format_service_label, format_pages_label} from '@/services/blueprints'
import {content} from '@/services/content'
import {format_relative_time} from '@/services/utils'

import type {DesignMeta} from '@/services/types'


const {t} = useI18n()
const router = useRouter()


const props = defineProps<{design:DesignMeta, categories:string[]}>()


// Whether the current user owns this design (only owners may delete/invite, per security rules)
const is_owner = computed(() => props.design.owner === user.value?.uid)


// Whether the invite-editor / category dialogs are open
const show_invite = ref(false)
const show_category = ref(false)


// Whether this design has no rendered version yet, or unrendered changes since its latest one
const needs_version = computed(() => design_needs_version(props.design))


// Last-modified label, relative ("3 hours ago") rather than a raw timestamp
const modified_label = computed(() => format_relative_time(props.design.modified))


// Stat chip labels, resolved from the design's live blueprint fields (not a rendered version's
// frozen ones — page count is the only figure that needs the latest version, see pages_label).
// Shortened (no dimensions/explanatory text) to keep the row compact
const paper_size_label = computed(() => format_paper_size(props.design.paper, true))
const service_label = computed(() => format_service_label(props.design.paper, t, true))
const pages_label = computed(() => {
    return format_pages_label(props.design.latest_version?.pages ?? null,
        props.design.paper.booklet, t)
})
const bibles_label = computed(() => {
    return props.design.paper.bibles.map(id => {
        const trans = content.translations[id]
        return trans ? trans.name_abbrev : id
    }).join(' + ')
})


const open = () => {
    void router.push({name: 'design', params: {id: props.design.id}})
}

const rename = async () => {
    const title = await prompt_dialog(t("Rename design"), props.design.name)
    if (title !== null){
        void rename_design(props.design.id, title)
    }
}

const duplicate = async () => {
    const new_id = await duplicate_design(props.design.id)
    await router.push({name: 'design', params: {id: new_id}})
}

const remove = async () => {
    if (await confirm_dialog(t("Delete this design? This cannot be undone."))){
        void delete_design(props.design.id)
    }
}

</script>


<style lang='sass' scoped>

.design-item
    padding-top: 14px
    padding-bottom: 14px
    margin-bottom: 4px

.needs-version
    display: inline-flex
    align-items: center
    justify-content: center
    width: 20px
    height: 20px
    border-radius: 50%
    background: rgb(var(--v-theme-warning))
    vertical-align: middle

    :deep(.icon)
        width: 12px
        height: 12px
        fill: white

.subtitle-row
    display: flex
    align-items: baseline
    gap: 8px

.contents
    min-width: 0
    white-space: nowrap
    overflow: hidden
    text-overflow: ellipsis

.modified
    margin-left: auto
    flex-shrink: 0
    white-space: nowrap

.chips
    display: flex
    flex-wrap: wrap
    gap: 6px
    margin-top: 8px

</style>
