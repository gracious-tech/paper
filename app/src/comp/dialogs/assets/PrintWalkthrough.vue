
<template lang='pug'>

div.walkthrough

    //- The active step's clip: silent, looping, auto-playing. Keyed on the index so switching
    //- steps remounts the element and the new source starts from the beginning
    div.stage(:style='{aspectRatio: props.aspect}')
        video(:key='active' autoplay loop muted playsinline preload='auto' :src='current.video')
        div.badge {{ active + 1 }} / {{ steps.length }}

    //- Caption for the active step, with an optional action button (external link or in-app
    //- handler, e.g. "Download the interior PDF")
    div.caption
        h4(class='text-title-medium') {{ $t(current.title) }}
        p(v-if='current.warning' class='text-body-medium warning')
            | {{ $t(current.warning.before) }}
            em {{ current.warning.value }}
            | {{ $t(current.warning.after) }}
        p(class='text-body-medium') {{ $t(current.body, current.body_params) }}
        v-btn(v-if='current.action' size='small' variant='tonal' class='action'
                :href='current.action.href' :target='current.action.href ? "_blank" : undefined'
                @click='current.action.on_click?.()')
            template(v-if='current.action.on_click' #prepend)
                app-icon(name='download')
            | {{ $t(current.action.label) }}

    //- Prev / numbered steps / next
    div.controls
        v-btn(icon variant='tonal' :disabled='active === 0' @click='go(active - 1)')
            app-icon(name='chevron_left')
        div.steps
            button(v-for='(step, index) of steps' :key='step.video' type='button' class='step'
                :class='{active: index === active}' @click='go(index)') {{ $t(step.label) }}
        v-btn(icon variant='tonal' :disabled='active === steps.length - 1'
            @click='go(active + 1)')
            app-icon(name='chevron_right')

</template>


<script lang='ts'>

// One walkthrough step: a short silent looping clip + symbolic caption keys. Clips live in
// app/public/walkthrough/ (one subfolder per printing service)
export interface WalkthroughStep {
    video:string
    label:string
    title:string
    body:string
    // Optional {named} substitutions for `body` (e.g. a value resolved from the open version)
    body_params?:Record<string, string|number>
    // Optional bold warning-coloured line shown above the body (e.g. a required setting) —
    // `value` is an already-resolved plain string (not a translation key), emphasised inline
    warning?:{before:string, value:string, after:string}
    // Optional action button shown under the caption — `href` for an external link (opens in a
    // new tab), `on_click` for an in-app handler (e.g. triggering a PDF download)
    action?:{label:string, href?:string, on_click?:() => void}
}

</script>


<script lang='ts' setup>

import {computed, ref} from 'vue'


// Ordered, non-empty list of steps (tuple type keeps `steps[0]` always defined) + the clips'
// own aspect ratio (a CSS `aspect-ratio` value) since it varies by service/recording
const props = withDefaults(
    defineProps<{steps:[WalkthroughStep, ...WalkthroughStep[]], aspect?:string}>(),
    {aspect: '16 / 9'},
)


// Index of the step currently on screen
const active = ref(0)


// The active step (falls back to the first, which the tuple type guarantees exists)
const current = computed(() => props.steps[active.value] ?? props.steps[0])


// Jump to another step (clamped to the valid range)
function go(index:number):void{
    active.value = Math.min(Math.max(index, 0), props.steps.length - 1)
}

</script>


<style lang='sass' scoped>

.walkthrough
    margin: 4px 0 8px

// Video with a rounded frame and a step counter in the corner. Aspect ratio is set inline (the
// `aspect` prop) since it varies by service — object-fit is only a fit-imprecision safety net
.stage
    position: relative
    border-radius: 8px
    overflow: hidden
    border: 1px solid rgba(var(--v-theme-on-surface), 0.12)
    background-color: rgba(var(--v-theme-on-surface), 0.06)

    video
        display: block
        width: 100%
        height: 100%
        object-fit: cover

    .badge
        position: absolute
        top: 8px
        right: 8px
        padding: 2px 8px
        border-radius: 999px
        font-size: 0.75rem
        font-variant-numeric: tabular-nums
        color: white
        background-color: rgba(0, 0, 0, 0.55)

.caption
    min-height: 5.5em
    margin-top: 12px

    h4
        margin-bottom: 4px

    // A required setting called out above the body text (e.g. "binding must be X")
    .warning
        font-weight: 700
        color: rgb(var(--v-theme-warning))

    .action
        margin-top: 8px

// Prev / dots / next row
.controls
    display: flex
    align-items: center
    justify-content: center
    gap: 12px
    margin-top: 8px

.steps
    display: flex
    align-items: center
    gap: 8px

// A labelled step marker — filled for the active step, outline for the rest
.step
    display: flex
    align-items: center
    justify-content: center
    height: 32px
    padding: 0 14px
    border-radius: 999px
    border: 1px solid rgb(var(--v-theme-primary))
    background-color: transparent
    color: rgb(var(--v-theme-primary))
    font-size: 0.875rem
    cursor: pointer
    transition: background-color 0.15s, color 0.15s
    user-select: none

    &.active
        background-color: rgb(var(--v-theme-primary))
        color: rgb(var(--v-theme-on-primary))

// On mobile the labels don't fit — collapse each step to a plain dot
@media (max-width: 900px)
    .step
        width: 10px
        height: 10px
        padding: 0
        font-size: 0
        border-radius: 50%

</style>
