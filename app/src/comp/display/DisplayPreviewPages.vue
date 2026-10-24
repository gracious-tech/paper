
<template lang='pug'>

//- A preview's pages: one under another on a phone, as facing-page spreads on a desktop. Each
//- page is an <img> of its own standalone SVG, so its styles stay inside it
div.pages(:class='layout')

    //- "Only a preview", or "start of preview" when the window left out what comes before it
    div.note
        strong {{ preview.dropped_before ? $t("display.preview.start_of_preview") : $t("display.preview.banner_title") }}
        div {{ preview.dropped_before ? $t("display.preview.build_for_rest") : $t("display.preview.banner_subtitle") }}

    template(v-if='layout === "column"')
        img.page(v-for='(url, i) of column' :key='url' :src='url' alt=''
            :loading='i < 2 ? "eager" : "lazy"' decoding='async')

    template(v-else)
        div.spread(v-for='(row, r) of spreads' :key='r')
            template(v-for='(slot, s) of row' :key='s')
                img.page(v-if='slot.kind === "page"' :src='slot.url' alt=''
                    :loading='r < 2 ? "eager" : "lazy"' decoding='async')
                //- The inside of a cover: a real surface of the book, but nothing's printed on it
                div.inside(v-else-if='slot.kind === "inside"' :style='{aspectRatio: page_ratio}')
                    span(v-if='slot.label') {{ $t("display.preview.inside_cover") }}
                div(v-else)

    div.note(v-if='preview.dropped_after')
        strong {{ $t("display.preview.end_of_preview") }}
        div {{ $t("display.preview.build_for_rest") }}

</template>


<script lang='ts' setup>

import {computed, shallowRef, watch, onUnmounted} from 'vue'

import type {Preview} from '@/services/preview'


const props = defineProps<{
    preview:Preview
    layout:'column'|'spreads'
}>()


// One place in a spread: a page or cover panel (by object URL), the inside of a cover (the
// front's labelled), or nothing at all
type Slot = {kind:'page', url:string}|{kind:'inside', label:boolean}|{kind:'empty'}


// Object URLs of the preview's pages and cover panels, replaced along with the preview
const urls = shallowRef<{pages:string[], front:string|null, back:string|null}>(
    {pages: [], front: null, back: null})


function to_url(markup:string):string{
    // An object URL for one standalone SVG document
    return URL.createObjectURL(new Blob([markup], {type: 'image/svg+xml'}))
}


function revoke():void{
    // Release the object URLs of the preview shown
    const {pages, front, back} = urls.value
    for (const url of [...pages, front, back]){
        if (url){
            URL.revokeObjectURL(url)
        }
    }
}


// A fresh set of URLs for each preview, the last set released
watch(() => props.preview, preview => {
    revoke()
    urls.value = {
        pages: preview.pages.map(to_url),
        front: preview.front_cover && to_url(preview.front_cover),
        back: preview.back_cover && to_url(preview.back_cover),
    }
}, {immediate: true})

onUnmounted(revoke)


// A phone's column: the front cover, the pages, the back cover
const column = computed(() => {
    const {pages, front, back} = urls.value
    return [...front ? [front] : [], ...pages, ...back ? [back] : []]
})


// A page's width over its height, for the slots that stand in for one (taken from the first
// page's viewBox, since every page of a book is the same size)
const page_ratio = computed(() => {
    const view_box = /viewBox="([^"]+)"/.exec(props.preview.pages[0] ?? '')?.[1]
    const [, , width, height] = (view_box ?? '0 0 1 1.414').split(/[\s,]+/).map(Number)
    return `${width} / ${height}`
})


// A desktop's spreads, as the book opens: the front cover alone on the right, then the inside of
// the cover facing page 1, each pair of pages after, and the inside of the back cover facing the
// last page when that's on the left, then the back cover alone on the left. Without a front
// cover (none, or a window that left out the start) page 1 stands alone on the right, a book
// opening on a recto, and without a back cover a final left page stands alone too. Binding is
// always on the left, whatever the text's direction, so this never mirrors
const spreads = computed(() => {
    const {pages, front, back} = urls.value
    const rows:Slot[][] = []
    if (front){
        rows.push([{kind: 'empty'}, {kind: 'page', url: front}])
    }
    const slots:Slot[] = [front ? {kind: 'inside', label: true} : {kind: 'empty'},
        ...pages.map(url => ({kind: 'page' as const, url}))]
    if (slots.length % 2 === 1){
        slots.push(back ? {kind: 'inside', label: false} : {kind: 'empty'})
    }
    for (let i = 0; i < slots.length; i += 2){
        rows.push([slots[i]!, slots[i + 1]!])
    }
    if (back){
        rows.push([{kind: 'page', url: back}, {kind: 'empty'}])
    }
    return rows
})

</script>


<style lang='sss' scoped>

.pages
    display: flex
    flex-direction: column
    align-items: center
    gap: 12px
    padding: 12px

    // A page as wide as its place allows, keeping its own proportions, on white like paper
    .page
        display: block
        width: 100%
        height: auto
        background-color: white

    // Short notes at either end, light orange so they read as notes rather than pages
    .note
        max-width: 600px
        padding: 12px 16px
        border-radius: 8px
        text-align: center
        color: rgb(26, 26, 26)
        background-color: rgb(255, 224, 178)

.column
    .page
        max-width: 600px
        box-shadow: 0 2px 8px rgba(0, 0, 0, 0.4)

// Two pages side by side, meeting at the spine, like an open book
.spreads
    .spread
        display: grid
        grid-template-columns: 1fr 1fr
        align-items: start
        gap: 1px
        width: 100%
        max-width: 1100px

        .page
            box-shadow: 0 2px 8px rgba(0, 0, 0, 0.4)

    .inside
        display: flex
        align-items: center
        justify-content: center
        padding: 10%
        text-align: center
        font-size: 18px
        color: rgb(140, 140, 140)
        background-color: rgb(230, 230, 230)

</style>
