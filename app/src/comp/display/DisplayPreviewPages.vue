
<template lang='pug'>

//- A preview's pages, each an <img> of its own standalone SVG (so its styles stay inside it).
//- A phone shows them one under another, its front and back covers first. A desktop shows them
//- as the book opens, everything at one scale as a PDF viewer would: the whole cover, then
//- facing-page spreads, with a note at either end where the window leaves part of the book out.
//- Both scroll within this, and zoom by pinching or Ctrl+wheel (see preview_zoom.ts)
div.viewport(ref='viewport' :class='[layout, {pannable, panning}]' @wheel='on_wheel'
        @touchstart='on_touch_start' @touchmove='on_touch_move' @touchend='on_touch_end'
        @touchcancel='on_touch_end' @gesturestart='on_gesture' @gesturechange='on_gesture'
        @pointerdown='on_pointer_down' @pointermove='on_pointer_move' @pointerup='on_pointer_up'
        @pointercancel='on_pointer_up')

    div.pages(v-if='layout === "column"' ref='content' :style='{"--width": `${column_width}px`}')
        img.page(v-for='(url, i) of column' :key='url' :src='url' alt='' draggable='false'
            :loading='i < 2 ? "eager" : "lazy"' decoding='async')
        //- More of the document follows the pages shown, which only the built PDF has
        div.end(v-if='preview.dropped_after')
            strong {{ $t("display.preview.end_of_preview") }}
            div {{ $t("display.preview.build_for_rest") }}

    div.pages(v-else ref='content' :style='{"--pt": `${pt_px}px`}')
        //- The window left out what comes before it (a preview showing the whole book needs no
        //- note: it's plainly not a PDF to print from)
        div.strip(v-if='preview.dropped_before' :style='{width: pt(page_size.width * 0.8)}')
            strong {{ $t("display.preview.start_of_preview") }}
            div {{ $t("display.preview.build_for_rest") }}

        img.page(v-if='urls.covers[0]' :src='urls.covers[0]' alt='' draggable='false'
            :style='{width: pt(cover_width)}')

        template(v-for='(row, r) of rows' :key='r')
            img.page(v-if='row.kind === "single"' :src='row.url' alt='' draggable='false'
                :loading='r < 2 ? "eager" : "lazy"' decoding='async'
                :style='{width: pt(page_size.width)}')
            //- Left to right whatever the UI's direction, as binding is always on the left
            div.spread(v-else dir='ltr' :style='{width: pt(page_size.width * 2)}')
                template(v-for='(slot, s) of row.slots' :key='s')
                    img(v-if='slot.kind === "page"' :src='slot.url' alt='' draggable='false'
                        :loading='r < 2 ? "eager" : "lazy"' decoding='async')
                    //- The inside of a cover: a real surface of the book, with nothing printed
                    div.inside(v-else :style='{aspectRatio: page_ratio}')
                        span(v-if='slot.label' dir='auto') {{ $t("display.preview.inside_cover") }}

        div.strip(v-if='preview.dropped_after' :style='{width: pt(page_size.width * 0.8)}')
            strong {{ $t("display.preview.end_of_preview") }}
            div {{ $t("display.preview.build_for_rest") }}

</template>


<script lang='ts' setup>

import {ref, computed, shallowRef, watch, nextTick, onMounted, onUnmounted} from 'vue'

import {PX_PER_PT, zoom_limits, clamp_zoom, wheel_zoom, anchored_scroll}
    from '@/services/preview_zoom'

import type {Preview} from '@/services/preview'


const props = defineProps<{
    preview:Preview
    layout:'column'|'spreads'
}>()

const emit = defineEmits<{
    // The zoom that fits the pane's width, for the zoom control (always 1 for a phone's column)
    fit:[zoom:number]
}>()

// The zoom chosen, or null to fit the pane's width (see preview_zoom.ts for what it measures)
const zoom = defineModel<number|null>('zoom', {default: null})


// One half of a spread: a page (by object URL), or the inside of a cover (the front's labelled)
type Slot = {kind:'page', url:string}|{kind:'inside', label:boolean}

// A row of the desktop's book: a page on its own, or a spread of two
type Row = {kind:'single', url:string}|{kind:'spread', slots:[Slot, Slot]}


// Object URLs of the preview's pages and cover(s), replaced along with the preview
const urls = shallowRef<{pages:string[], covers:string[]}>({pages: [], covers: []})


function to_url(markup:string):string{
    // An object URL for one standalone SVG document
    return URL.createObjectURL(new Blob([markup], {type: 'image/svg+xml'}))
}


function revoke():void{
    // Release the object URLs of the preview shown
    for (const url of [...urls.value.pages, ...urls.value.covers]){
        URL.revokeObjectURL(url)
    }
}


// A fresh set of URLs for each preview, the last set released
watch(() => props.preview, preview => {
    revoke()
    urls.value = {pages: preview.pages.map(to_url), covers: preview.covers.map(to_url)}
}, {immediate: true})

onUnmounted(revoke)


function svg_size(markup:string|null|undefined):{width:number, height:number}{
    // An SVG document's size in points, from its root's viewBox
    const view_box = /viewBox="([^"]+)"/.exec(markup ?? '')?.[1] ?? '0 0 0 0'
    const [, , width, height] = view_box.trim().split(/[\s,]+/).map(Number)
    return {width: width || 1, height: height || 1}
}


// A phone's column: the front and back covers, then the pages (the back straight after the
// front, as a desktop shows the whole cover at once)
const column = computed(() => [...urls.value.covers, ...urls.value.pages])


// Every page of a book is the same size, so the first one's stands for all of them
const page_size = computed(() => svg_size(props.preview.pages[0]))
const page_ratio = computed(() => `${page_size.value.width} / ${page_size.value.height}`)
// A desktop's one cover is the whole wraparound
const cover_width = computed(() => props.preview.covers[0]
    ? svg_size(props.preview.covers[0]).width : 0)


// The widest thing shown, in points, which fills the pane's width (so a spread or the cover does,
// and a single page is half as wide, just as a PDF viewer fitting to width showed them)
const scale_width = computed(() => Math.max(page_size.value.width * 2, cover_width.value))


function pt(points:number):string{
    // A length in the book's points, at the zoom shown (see the --pt property)
    return `calc(${points} * var(--pt))`
}


// The scrolling pane and the pages within it, which zooming anchors to
const viewport = ref<HTMLElement|null>(null)
const content = ref<HTMLElement|null>(null)

// The width the pages have to fill, kept current as the pane resizes (the padding either side
// of them excluded)
const PADDING_PX = 12
const available_width = ref(0)
let resize_observer:ResizeObserver|null = null

onMounted(() => {
    // Measured now, not when the observer first reports, so the first frame is already to scale
    const element = viewport.value!
    available_width.value = element.clientWidth - PADDING_PX * 2
    resize_observer = new ResizeObserver(() => {
        available_width.value = element.clientWidth - PADDING_PX * 2
    })
    resize_observer.observe(element)
})

onUnmounted(() => {
    resize_observer?.disconnect()
})


// The zoom that fits the pane's width: for a desktop the physical zoom at which the widest thing
// shown spans it, for a phone 1 by definition
const fit = computed(() => {
    if (props.layout === 'column'){
        return 1
    }
    return Math.max(available_width.value, 1) / (scale_width.value * PX_PER_PT)
})
watch(fit, value => emit('fit', value), {immediate: true})

const limits = computed(() => zoom_limits(props.layout === 'spreads', fit.value))

// The zoom shown, whether chosen or fitting the pane
const shown_zoom = computed(() => zoom.value ?? fit.value)

// One of the book's points in CSS pixels, at the zoom shown (a desktop's)
const pt_px = computed(() => shown_zoom.value * PX_PER_PT)

// A phone's page width: as wide as the pane allows (up to a comfortable width), times the zoom
const column_width = computed(() =>
    Math.min(Math.max(available_width.value, 1), 600) * shown_zoom.value)


// Where the next change of zoom is centred, in client coordinates: the pinch or the pointer, or
// when unset (the zoom control, a resize) the middle of the pane
let focus:{x:number, y:number}|null = null


function set_zoom(value:number, at:{x:number, y:number}):void{
    // Zoom to `value` (within limits), keeping the point of the pages under `at` where it is
    const clamped = clamp_zoom(value, limits.value)
    if (clamped !== shown_zoom.value){
        focus = at
        zoom.value = clamped
    }
}


// Keep what's under the focus in place as the zoom changes: the pages' box is taken before the
// DOM updates (a pre-flush watcher) and compared with it after
watch(shown_zoom, () => {
    const pane = viewport.value
    const pages = content.value
    if (!pane || !pages){
        return
    }
    const view = pane.getBoundingClientRect()
    const at = focus ?? {x: view.left + view.width / 2, y: view.top + view.height / 2}
    focus = null
    const before = pages.getBoundingClientRect()
    void nextTick(() => {
        const shift = anchored_scroll(before, pages.getBoundingClientRect(), at)
        pane.scrollLeft += shift.x
        pane.scrollTop += shift.y
    })
})


function on_wheel(event:WheelEvent):void{
    // Ctrl+wheel zooms (a trackpad's pinch arrives as one too), anything else scrolls as usual
    if (!event.ctrlKey){
        return
    }
    event.preventDefault()
    set_zoom(wheel_zoom(shown_zoom.value, event), {x: event.clientX, y: event.clientY})
}


// A two-finger pinch in progress: the fingers' distance apart and the zoom when it began
let pinch:{distance:number, zoom:number}|null = null


function touch_pair(event:TouchEvent):{distance:number, x:number, y:number}{
    // The distance between the first two touches, and the point midway between them
    const a = event.touches[0]!
    const b = event.touches[1]!
    return {distance: Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY),
        x: (a.clientX + b.clientX) / 2, y: (a.clientY + b.clientY) / 2}
}


function on_touch_start(event:TouchEvent):void{
    // A second finger begins a pinch (the browser's own is disabled, see touch-action below)
    if (event.touches.length === 2){
        pinch = {distance: touch_pair(event).distance || 1, zoom: shown_zoom.value}
    }
}


function on_touch_move(event:TouchEvent):void{
    // Zoom by how far apart the fingers have moved since the pinch began, around their midpoint
    if (!pinch || event.touches.length !== 2){
        return
    }
    // Not cancelable once the browser is scrolling, when it's only asked not to
    if (event.cancelable){
        event.preventDefault()
    }
    const pair = touch_pair(event)
    set_zoom(pinch.zoom * pair.distance / pinch.distance, pair)
}


function on_touch_end(event:TouchEvent):void{
    // A pinch ends when a finger lifts
    if (event.touches.length < 2){
        pinch = null
    }
}


// The zoom when Safari's pinch began
let gesture_start = 1


function on_gesture(event:Event):void{
    // Safari's own pinch events (a Mac's trackpad, which elsewhere sends Ctrl+wheel): kept from
    // zooming the page, and zooming the preview instead, unless touches are already doing that
    event.preventDefault()
    const gesture = event as Event & {scale:number, clientX:number, clientY:number}
    if (pinch){
        return
    }
    if (event.type === 'gesturestart'){
        gesture_start = shown_zoom.value
        return
    }
    set_zoom(gesture_start * gesture.scale, {x: gesture.clientX, y: gesture.clientY})
}

// Zoomed wider than the pane, a mouse drags the pages around (as there's no other way to pan
// sideways but Shift+wheel). Touch pans natively, so this is a mouse's only
const content_width = ref(0)
const pannable = computed(() => content_width.value > available_width.value + PADDING_PX * 2)
watch([shown_zoom, available_width, () => props.preview], () => {
    void nextTick(() => {
        content_width.value = content.value?.offsetWidth ?? 0
    })
}, {immediate: true})

// A drag in progress: where it began, and the pane's scroll then
const panning = ref(false)
let pan_start = {x: 0, y: 0, left: 0, top: 0}


function on_pointer_down(event:PointerEvent):void{
    // Begin dragging, for the main mouse button over the pages (not the pane's scrollbars)
    const pane = viewport.value
    if (!pane || !pannable.value || event.pointerType !== 'mouse' || event.button !== 0){
        return
    }
    const rect = pane.getBoundingClientRect()
    if (event.clientX - rect.left >= pane.clientWidth
            || event.clientY - rect.top >= pane.clientHeight){
        return
    }
    panning.value = true
    pan_start = {x: event.clientX, y: event.clientY, left: pane.scrollLeft, top: pane.scrollTop}
    pane.setPointerCapture(event.pointerId)
}


function on_pointer_move(event:PointerEvent):void{
    // Scroll by how far the mouse has moved since the drag began
    const pane = viewport.value
    if (!panning.value || !pane){
        return
    }
    pane.scrollLeft = pan_start.left - (event.clientX - pan_start.x)
    pane.scrollTop = pan_start.top - (event.clientY - pan_start.y)
}


function on_pointer_up():void{
    // The drag is over
    panning.value = false
}


// The desktop's rows, as the book opens. With a cover, the inside of it faces page 1 and the
// inside of the back cover faces a last page left on its own. Without one there's no inside
// face to show a page against, so page 1 stands alone (a book opens on a recto), and so does a
// last page with nothing facing it. Binding is always on the left, whatever the text's
// direction, so this never mirrors
const rows = computed(() => {
    const pages = urls.value.pages.map(url => ({kind: 'page' as const, url}))
    const has_cover = urls.value.covers.length > 0
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

// The pane: scrolls both ways once zoomed in, with a gutter kept for the scrollbar so fitting the
// width doesn't change it as one comes and goes. Pinching is left to the handlers above, panning
// to the browser
.viewport
    overflow: auto
    scrollbar-gutter: stable
    touch-action: pan-x pan-y

    &.pannable
        cursor: grab

    &.panning
        cursor: grabbing
        user-select: none

// As wide as what's shown and centred, so zooming beyond the pane's width scrolls rather than
// clipping its left side
.pages
    width: max-content
    margin: 0 auto
    padding: 12px
    display: flex
    flex-direction: column
    align-items: center

// A phone's pages, one under another, each its column's width keeping its own proportions
.column .pages
    gap: 12px

    .page
        width: var(--width)
        height: auto
        background-color: white
        box-shadow: 0 2px 8px rgba(0, 0, 0, 0.4)

    .end
        width: var(--width)
        padding: 12px 16px
        border-radius: 8px
        text-align: center
        color: rgb(26, 26, 26)
        background-color: rgb(255, 224, 178)

// A desktop's book, laid out in its own points (--pt is one point at the zoom shown) so it keeps
// the proportions it would have in a PDF viewer
.spreads .pages
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
