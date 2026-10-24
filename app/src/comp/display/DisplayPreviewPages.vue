
<template lang='pug'>

//- A preview's pages, each an <img> of its own standalone SVG (so its styles stay inside it).
//- A phone shows them one under another, its front cover first. A desktop shows them as the
//- book opens, everything at one scale as a PDF viewer would: a note that it's only a preview,
//- the whole cover, then facing-page spreads, and a closing note when the window stops short
div.pages(:class='layout')

    template(v-if='layout === "column"')
        img.page(v-for='(url, i) of column' :key='url' :src='url' alt=''
            :loading='i < 2 ? "eager" : "lazy"' decoding='async')
        //- More of the document follows the pages shown, which only the built PDF has
        div.end(v-if='preview.dropped_after')
            strong {{ $t("display.preview.end_of_preview") }}
            div {{ $t("display.preview.build_for_rest") }}

    div.book(v-else :style='{"--pt": `calc(100cqw / ${scale_width})`}')
        //- "Only a preview", or "start of preview" when the window left out what comes before
        div.strip(:style='{width: pt(page_size.width * 0.8)}')
            strong {{ preview.dropped_before ? $t("display.preview.start_of_preview") : $t("display.preview.banner_title") }}
            div {{ preview.dropped_before ? $t("display.preview.build_for_rest") : $t("display.preview.banner_subtitle") }}

        img.page(v-if='urls.cover' :src='urls.cover' alt='' :style='{width: pt(cover_width)}')

        template(v-for='(row, r) of rows' :key='r')
            img.page(v-if='row.kind === "single"' :src='row.url' alt=''
                :loading='r < 2 ? "eager" : "lazy"' decoding='async'
                :style='{width: pt(page_size.width)}')
            div.spread(v-else :style='{width: pt(page_size.width * 2)}')
                template(v-for='(slot, s) of row.slots' :key='s')
                    img(v-if='slot.kind === "page"' :src='slot.url' alt=''
                        :loading='r < 2 ? "eager" : "lazy"' decoding='async')
                    //- The inside of a cover: a real surface of the book, with nothing printed
                    div.inside(v-else :style='{aspectRatio: page_ratio}')
                        span(v-if='slot.label') {{ $t("display.preview.inside_cover") }}

        div.strip(v-if='preview.dropped_after' :style='{width: pt(page_size.width * 0.8)}')
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


// One half of a spread: a page (by object URL), or the inside of a cover (the front's labelled)
type Slot = {kind:'page', url:string}|{kind:'inside', label:boolean}

// A row of the desktop's book: a page on its own, or a spread of two
type Row = {kind:'single', url:string}|{kind:'spread', slots:[Slot, Slot]}


// Object URLs of the preview's pages and cover, replaced along with the preview
const urls = shallowRef<{pages:string[], cover:string|null}>({pages: [], cover: null})


function to_url(markup:string):string{
    // An object URL for one standalone SVG document
    return URL.createObjectURL(new Blob([markup], {type: 'image/svg+xml'}))
}


function revoke():void{
    // Release the object URLs of the preview shown
    for (const url of [...urls.value.pages, urls.value.cover]){
        if (url){
            URL.revokeObjectURL(url)
        }
    }
}


// A fresh set of URLs for each preview, the last set released
watch(() => props.preview, preview => {
    revoke()
    urls.value = {pages: preview.pages.map(to_url),
        cover: preview.cover && to_url(preview.cover)}
}, {immediate: true})

onUnmounted(revoke)


function svg_size(markup:string|null|undefined):{width:number, height:number}{
    // An SVG document's size in points, from its root's viewBox
    const view_box = /viewBox="([^"]+)"/.exec(markup ?? '')?.[1] ?? '0 0 0 0'
    const [, , width, height] = view_box.trim().split(/[\s,]+/).map(Number)
    return {width: width || 1, height: height || 1}
}


// A phone's column: the front cover, then the pages
const column = computed(() => [...urls.value.cover ? [urls.value.cover] : [],
    ...urls.value.pages])


// Every page of a book is the same size, so the first one's stands for all of them
const page_size = computed(() => svg_size(props.preview.pages[0]))
const page_ratio = computed(() => `${page_size.value.width} / ${page_size.value.height}`)
const cover_width = computed(() => props.preview.cover ? svg_size(props.preview.cover).width : 0)


// The widest thing shown, in points, which fills the pane's width (so a spread or the cover does,
// and a single page is half as wide, just as a PDF viewer fitting to width showed them)
const scale_width = computed(() => Math.max(page_size.value.width * 2, cover_width.value))


function pt(points:number):string{
    // A length in the book's points, at the pane's scale (see the --pt property)
    return `calc(${points} * var(--pt))`
}


// The desktop's rows, as the book opens. With a cover, the inside of it faces page 1 and the
// inside of the back cover faces a last page left on its own. Without one there's no inside
// face to show a page against, so page 1 stands alone (a book opens on a recto), and so does a
// last page with nothing facing it. Binding is always on the left, whatever the text's
// direction, so this never mirrors
const rows = computed(() => {
    const pages = urls.value.pages.map(url => ({kind: 'page' as const, url}))
    const has_cover = !!urls.value.cover
    const result:Row[] = []
    const slots:Slot[] = has_cover ? [{kind: 'inside', label: true}, ...pages] : pages.slice(1)
    if (!has_cover && pages[0]){
        result.push({kind: 'single', url: pages[0].url})
    }
    let trailing:string|null = null
    if (slots.length % 2 === 1){
        if (has_cover){
            slots.push({kind: 'inside', label: false})
        } else {
            trailing = (slots.pop() as {url:string}).url
        }
    }
    for (let i = 0; i < slots.length; i += 2){
        result.push({kind: 'spread', slots: [slots[i]!, slots[i + 1]!]})
    }
    if (trailing){
        result.push({kind: 'single', url: trailing})
    }
    return result
})

</script>


<style lang='sss' scoped>

.pages
    padding: 12px

// A phone's pages, each as wide as the screen allows, keeping its own proportions
.column
    display: flex
    flex-direction: column
    align-items: center
    gap: 12px

    .page
        width: 100%
        max-width: 600px
        height: auto
        background-color: white
        box-shadow: 0 2px 8px rgba(0, 0, 0, 0.4)

    .end
        max-width: 600px
        padding: 12px 16px
        border-radius: 8px
        text-align: center
        color: rgb(26, 26, 26)
        background-color: rgb(255, 224, 178)

// A desktop's book, laid out in its own points (--pt is one point at the pane's scale) so it
// keeps the proportions it would have in a PDF viewer
.spreads
    container-type: inline-size

    .book
        display: flex
        flex-direction: column
        align-items: center
        gap: 8px

    .page, .spread
        display: block
        height: auto
        background-color: white
        box-shadow: 0 2px 8px rgba(0, 0, 0, 0.4)

    // Two pages side by side, with a thin seam down the middle
    .spread
        position: relative
        display: grid
        grid-template-columns: 1fr 1fr

        img
            display: block
            width: 100%
            height: auto

        &::after
            content: ''
            position: absolute
            top: 0
            bottom: 0
            left: calc(50% - 0.5 * var(--pt))
            width: var(--pt)
            background-color: rgb(230, 230, 230)

    // Gray, so it reads as no printed page rather than a blank one
    .inside
        display: flex
        align-items: center
        justify-content: center
        padding: 10%
        text-align: center
        font-size: calc(18 * var(--pt))
        color: rgb(140, 140, 140)
        background-color: rgb(230, 230, 230)

    // The light orange note at either end, only as tall as its text
    .strip
        display: flex
        flex-direction: column
        gap: calc(6 * var(--pt))
        padding: calc(11 * var(--pt))
        text-align: center
        font-size: calc(9.5 * var(--pt))
        color: rgb(77, 77, 77)
        background-color: rgb(255, 224, 178)

        strong
            font-size: calc(13 * var(--pt))
            color: rgb(26, 26, 26)

</style>
