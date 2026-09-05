
<template lang='pug'>

//- Lists data recovered from the PREVIOUS version of the app (see legacy.ts)
//- WARN Temporary — strings are hardcoded in English so there is nothing to unpick on removal
v-dialog(v-model='legacy.open' max-width='520' scrollable)
    v-card(title="Old Creations")
        v-card-text

            p(class='mb-2 text-body-medium')
                | These creations from the old version of Paper Bible are not compatible with this new version. Please download the ones you'd like to keep, as they will eventually be deleted.

            div(v-for='item of legacy.items' :key='item.id' class='item')
                div(class='item_title')
                    strong {{ item.title }}
                    span(class='text-body-small text-medium-emphasis') {{ meta_line(item) }}
                div
                    //- A plain link — the stored PDF is public and already named after its title
                    v-btn(v-if='item.pdf_url' :href='item.pdf_url' target='_blank' rel='noopener'
                        variant='tonal' size='small' class='mr-2') PDF
                    v-btn(@click='download_legacy_html(item)' variant='tonal' size='small')
                        | Content (HTML)

        v-card-actions
            v-spacer
            v-btn(@click='legacy.open = false') Close

</template>


<script lang='ts' setup>

import {legacy, download_legacy_html} from '@/legacy/legacy'

import type {LegacyItem} from '@/legacy/legacy'


// The date and page count for an item (the draft has neither, so it says what it is instead)
const meta_line = (item:LegacyItem):string => {
    if (item.is_draft){
        return "Never made into a PDF"
    }
    const parts:string[] = []
    if (item.created){
        parts.push(item.created.toLocaleDateString())
    }
    if (item.pages){
        parts.push(`${item.pages} pages`)
    }
    return parts.join(' · ')
}

</script>


<style lang='sass' scoped>

.item
    display: flex
    align-items: center
    justify-content: space-between
    gap: 12px
    padding: 12px 0
    border-top: 1px solid rgba(var(--v-theme-on-surface), 0.12)

    .item_title
        display: flex
        flex-direction: column
        min-width: 0

        strong
            overflow: hidden
            text-overflow: ellipsis
            white-space: nowrap

</style>
