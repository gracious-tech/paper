
<template lang='pug'>

div.examples

    h2 {{ $t("display.examples.heading") }}
    p.intro {{ $t("display.examples.intro") }}

    div.new
        v-btn(@click='create_new' variant='flat' color='secondary' size='large')
            | {{ $t("display.examples.create_new") }}

    div.grid
        div.card(v-for='example of cards' :key='example.id' @click='create(example.id)'
                :class='{creating: creating === example.id}')
            img(:src='example.image' alt='')
            div.blurb {{ example.blurb }}
            v-progress-circular(v-if='creating === example.id' indeterminate color='secondary')

</template>


<script lang='ts' setup>

import {computed, ref} from 'vue'
import {useI18n} from '@/services/i18n'
import {useRouter} from 'vue-router'

import {EXAMPLE_DESIGNS, example_label, create_example_design} from '@/services/examples'
import {report_error} from '@/services/errors'
import {state} from '@/services/state'


// Example designs the empty preview pane offers — clicking one creates and opens a real design
// pre-filled to match (see services/examples.ts). Shown whenever the designs list itself is
// showing (not just when it's empty) so existing users can discover them too
const {t} = useI18n()
const router = useRouter()


// The example cards with their translated title/subtitle (baked into the cover image once
// artwork is supplied) and blurb (shown below it)
const cards = computed(() => {
    return EXAMPLE_DESIGNS.map(example => ({id: example.id, image: example.image,
        ...example_label(example.id, t)}))
})


// Which example is currently being created (disables the rest while in flight)
const creating = ref(null as string|null)


// Start from scratch instead — opens the new-design wizard (same entry point as the navbar's
// "New" button; the wizard creates the design and routes to it itself on finish)
const create_new = () => {
    state.new_design = true
}


// Create and open the clicked example
const create = async (id:string) => {
    if (creating.value){
        return
    }
    creating.value = id
    try {
        const design_id = await create_example_design(id, t)
        await router.push({name: 'design', params: {id: design_id}})
    } catch (error){
        report_error('banner', error)
    } finally {
        creating.value = null
    }
}

</script>


<style lang='sss' scoped>

.examples
    width: 100%
    height: 100%
    overflow: auto
    padding: 48px
    // Cards size to this pane, not the viewport (the app column beside it has a fixed width)
    container: examples / inline-size
    color: rgb(var(--v-theme-on-surface))
    background-color: rgb(var(--v-theme-surface))

h2
    margin-bottom: 12px
    text-align: center

.intro
    color: rgba(var(--v-theme-on-surface), 0.7)
    margin-bottom: 24px
    text-align: center

.new
    display: flex
    justify-content: center
    margin-bottom: 24px

// Flex rather than grid so a last row with fewer cards centers (grid items always snap to
// their column tracks, leaving an orphan row left-aligned)
.grid
    display: flex
    flex-wrap: wrap
    justify-content: center
    gap: 16px

// Cards are sized to an exact 1/2/3 per row (minus the gaps) so rows are always balanced,
// rather than letting flex fit as many as happen to fit
.card
    flex: 0 1 100%
    max-width: 360px
    position: relative
    cursor: pointer
    border-radius: 8px
    overflow: hidden
    transition: transform 0.15s ease
    padding: 12px

    &:hover
        background-color: rgba(var(--v-theme-primary), 0.08)

    &.creating
        pointer-events: none

    img
        display: block
        width: 100%
        aspect-ratio: 6 / 9
        object-fit: cover

    .blurb
        padding: 16px 12px 24px
        font-size: 1.2rem
        text-align: center
        opacity: 0.8
        line-height: 1.2

    .v-progress-circular
        position: absolute
        top: 50%
        left: 50%
        transform: translate(-50%, -50%)

    @container examples (min-width: 640px)
        flex-basis: calc((100% - 16px) / 2)

    @container examples (min-width: 980px)
        flex-basis: calc((100% - 32px) / 3)

</style>
