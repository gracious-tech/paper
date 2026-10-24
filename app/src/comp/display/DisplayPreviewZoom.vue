
<template lang='pug'>

//- A preview's zoom, for its toolbar, as the bookcover editor has it: a button opening a vertical
//- slider (on a log scale, so each step looks the same), with buttons for print size (a
//- desktop's) and for fitting the width again. While it's open a desktop also shows how wide A4
//- and US Letter paper are at the zoom shown, to hold a sheet against and so find the zoom at
//- which this screen shows the book at its true size
div.zoom
    v-menu(v-model='open' :close-on-content-click='false' location='bottom start')
        template(#activator='{props: activator}')
            v-btn(v-bind='activator' icon size='small' variant='text' color='white'
                    :aria-label='label' :title='label')
                app-icon(name='zoom_in')
        v-card.zoom_menu
            div.percent {{ percent }}
            v-slider(direction='vertical' :min='Math.log(limits.min)' :max='Math.log(limits.max)'
                :model-value='Math.log(shown)' @update:model-value='set_log' hide-details
                :aria-label='label' color='primary')
            v-btn(v-if='physical' @click='zoom = 1' size='small' variant='outlined'
                :title='$t("display.preview.print_size")' class='print_size') 1×
            v-btn(@click='zoom = null' icon size='small' variant='text'
                    :aria-label='$t("display.preview.fit_width")'
                    :title='$t("display.preview.fit_width")')
                app-icon(name='fit_width')

    Teleport(to='body')
        transition(name='fade')
            div.paper_scale(v-if='open && physical')
                div.paper_line(v-for='line of lines' :key='line.kind' :style='{width: `${line.px}px`}')
                    div.rule(:class='line.kind')
                    span {{ line.label }}
                p.overflow(v-if='overflows') {{ $t("display.preview.lines_overflow") }}
                p.hint
                    | {{ $t("display.preview.measure_hint") }}
                    br
                    | {{ $t("display.preview.measure_note") }}

</template>


<script lang='ts' setup>

import {ref, computed} from 'vue'
import {useDisplay} from 'vuetify'

import {useI18n} from '@/services/i18n'
import {intl_tag} from '@/services/locale'
import {PX_PER_PT, A4_WIDTH_IN, LETTER_WIDTH_IN, zoom_limits, clamp_zoom}
    from '@/services/preview_zoom'


const props = defineProps<{
    // The zoom that fits the pane's width (see DisplayPreviewPages' `fit` event)
    fit:number
    // Whether the zoom is physical (a desktop's, which offers print size and the paper widths)
    physical:boolean
}>()

// The zoom chosen, or null to fit the width, shared with the pages it zooms
const zoom = defineModel<number|null>({default: null})

const {t, locale} = useI18n()
const {width: window_width} = useDisplay()


// Whether the slider is open (and with it, on a desktop, the paper widths)
const open = ref(false)

const limits = computed(() => zoom_limits(props.physical, props.fit))

// The zoom shown, whether chosen or fitting the pane
const shown = computed(() => zoom.value ?? props.fit)

// The zoom as a percentage in the UI's own way of writing one
const percent = computed(() => new Intl.NumberFormat(intl_tag(locale.value),
    {style: 'percent', maximumFractionDigits: 0}).format(shown.value))
const label = computed(() => t("display.preview.zoom", {percent: percent.value}))


function set_log(value:number):void{
    // Set the zoom from the slider, whose scale is the zoom's logarithm
    zoom.value = clamp_zoom(Math.exp(value), limits.value)
}


// A4 and US Letter's widths at the zoom shown, in CSS pixels (a CSS inch is 96 of them)
const lines = computed(() => {
    const px_per_in = 72 * PX_PER_PT * shown.value
    return [
        {kind: 'a4', label: t("display.preview.a4_width"), px: A4_WIDTH_IN * px_per_in},
        {kind: 'letter', label: t("display.preview.letter_width"), px: LETTER_WIDTH_IN * px_per_in},
    ]
})

// Whether a line is too wide for the window, so can't be measured against (its box's padding
// included)
const overflows = computed(() => lines.value.some(line => line.px + 48 > window_width.value))

</script>


<style lang='sss' scoped>

.zoom_menu
    display: flex
    flex-direction: column
    align-items: center
    gap: 8px
    padding: 12px

    .percent
        min-width: 4em
        text-align: center
        font-size: 13px
        font-variant-numeric: tabular-nums

    // A vertical slider is 300px long unless told otherwise
    :deep(.v-slider.v-input--vertical)
        margin: 0

        .v-input__control
            min-height: 0
            height: 200px

    .print_size
        font-family: monospace

// The paper widths, along the bottom of the window and never in the way of the pointer
.paper_scale
    position: fixed
    bottom: 24px
    left: 50%
    transform: translateX(-50%)
    z-index: 1999
    max-width: calc(100vw - 16px)
    display: flex
    flex-direction: column
    align-items: center
    gap: 12px
    padding: 16px 24px
    border-radius: 12px
    color: rgba(255, 255, 255, 0.8)
    background-color: rgba(0, 0, 0, 0.6)
    backdrop-filter: blur(4px)
    pointer-events: none

    .paper_line
        display: flex
        flex-direction: column
        align-items: center
        flex-shrink: 0
        font-size: 12px
        white-space: nowrap

    .rule
        width: 100%
        border-top: 2px solid
        margin-bottom: 4px

        &.a4
            border-color: rgba(96, 165, 250, 0.8)

        &.letter
            border-color: rgba(251, 191, 36, 0.8)

    p
        margin: 0
        max-width: 480px
        font-size: 12px
        text-align: center

    .overflow
        color: rgb(251, 191, 36)

    .hint
        color: rgba(255, 255, 255, 0.6)

.fade-enter-active, .fade-leave-active
    transition: opacity 0.2s ease

.fade-enter-from, .fade-leave-to
    opacity: 0

</style>
