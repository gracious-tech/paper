
<template lang='pug'>

div(ref='container')
    div(v-for='(element, index) of list' :key='get_key(element)')
        slot(name='item' :element='element' :index='index')

</template>


<script lang='ts' setup generic='T'>

import {ref} from 'vue'
import {useSortable} from '@vueuse/integrations/useSortable'


// Drag-to-reorder list backed directly by SortableJS (rather than vuedraggable, which keeps its
// own internal clone of the list and desyncs — silently breaking future drags — whenever the
// list changes from outside the drag gesture, e.g. a co-editor's Firestore snapshot landing).
// `useSortable` instead mutates `list` in place and lets Vue's own re-render reconcile the DOM,
// so there's no separate cache to go stale
const props = defineProps<{list:T[], item_key:(element:T) => string, handle?:string}>()


// Stable key for a row, used by v-for and to correlate DOM elements back to array indices
const get_key = (element:T):string => props.item_key(element)


const container = ref<HTMLElement>()


// forceFallback swaps out native HTML5 drag-and-drop (which renders its own translucent drag
// image that can appear misaligned or duplicated, especially inside flex/list layouts) for
// SortableJS's own cursor-following clone, giving a single, precisely-positioned drag visual
useSortable(container, props.list, {
    handle: props.handle,
    animation: 150,
    forceFallback: true,
    fallbackOnBody: true,
    ghostClass: 'app_draggable_ghost',
    chosenClass: 'app_draggable_chosen',
    fallbackClass: 'app_draggable_fallback',
})

</script>


<style lang='sass'>
// Unscoped so these classes (assigned by SortableJS to the actual list-item elements rendered
// via the #item slot) can reach into the parent's markup

.app_draggable_ghost
    opacity: 0.4

.app_draggable_chosen
    background-color: rgba(var(--v-theme-primary), 0.1)

.app_draggable_fallback
    opacity: 0.9

</style>
