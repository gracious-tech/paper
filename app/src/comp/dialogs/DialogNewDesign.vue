
<template lang='pug'>

v-dialog(:model-value='state.new_design' @update:model-value='cancel' :fullscreen='fullscreen'
        :max-width='fullscreen ? undefined : 800' height='1000' max-height='1000' scrollable no-click-animation)
    v-card.wizard(:class='{fullscreen}')

        v-stepper.stepper-progress(:model-value='step_index + 1' @update:model-value='set_step'
                hide-actions flat :alt-labels='!fullscreen' editable)
            v-stepper-header
                template(v-for='(id, i) in STEPS' :key='id')
                    v-divider(v-if='i > 0')
                    v-stepper-item(:value='i + 1' :title='fullscreen ? undefined : step_labels[id]'
                            :complete='is_step_valid(id)'
                            :color='is_step_valid(id) || id === step ? "secondary" : ""')

        v-divider

        v-card-text
            v-window(v-model='step')
                v-window-item(value='type')
                    NewDesignType(:draft='draft')
                v-window-item(value='books')
                    NewDesignBooks(:draft='draft')
                v-window-item(value='bibles')
                    NewDesignBibles(:draft='draft' @busy='busy = $event')
                v-window-item(value='print')
                    NewDesignPrint(:draft='draft')
                v-window-item(value='cover')
                    NewDesignCover(:draft='draft')

        v-divider

        v-card-actions(v-if='!busy')
            v-btn(v-if='step_index === 0' @click='cancel' color='')
                | {{ $t("Cancel") }}
            v-btn(v-else @click='back' color='')
                | {{ $t("Prev") }}
            v-spacer
            span.text-medium-emphasis(v-if='step === "books"') {{ books_selected_label }}
            v-spacer
            v-btn(v-if='step !== "type"' @click='next'
                    :disabled='step === "cover" ? !all_steps_valid : !step_valid'
                    :loading='creating' color='secondary' variant='flat')
                | {{ step === 'cover' ? $t("Create") : $t("Next") }}

</template>


<script lang='ts' setup>

import {computed, reactive, ref, watch} from 'vue'
import {useI18n} from 'vue-i18n'
import {useRouter} from 'vue-router'
import {useDisplay} from 'vuetify'

import {state} from '@/services/state'
import {create_design} from '@/services/designs'
import {get_default_draft, build_new_blueprint} from '@/services/new_design'
import {report_error} from '@/services/errors'
import NewDesignType from '@/comp/dialogs/assets/NewDesignType.vue'
import NewDesignBooks from '@/comp/dialogs/assets/NewDesignBooks.vue'
import NewDesignBibles from '@/comp/dialogs/assets/NewDesignBibles.vue'
import NewDesignPrint from '@/comp/dialogs/assets/NewDesignPrint.vue'
import NewDesignCover from '@/comp/dialogs/assets/NewDesignCover.vue'


// The new-design wizard: five steps that build up a draft of selections, only turned into an
// actual design (Firestore doc) when the final step's "Create" is confirmed — cancelling at
// any point creates nothing. Opened via state.new_design (navbar "New" / first-run splash)
const {t} = useI18n()
const router = useRouter()


// Steps in order
const STEPS = ['type', 'books', 'bibles', 'print', 'cover'] as const


// State
const step = ref<typeof STEPS[number]>('type')
const draft = reactive(get_default_draft())
const busy = ref(false)  // A step subview (e.g. translation picker) is covering navigation
const creating = ref(false)


// Fullscreen below the app's own mobile breakpoint (where AppRoot stops width-capping
// .v-application at 500px, so fullscreen covers the real viewport)
const {width} = useDisplay()
const fullscreen = computed(() => width.value <= 900)


// Position of the current step
const step_index = computed(() => STEPS.indexOf(step.value))


// Short label shown under each step's progress indicator
const step_labels = computed(() => {
    return {
        type: t("Type"),
        books: t("Books"),
        bibles: t("Translations"),
        print: t("Print"),
        cover: t("Cover"),
    }
})


// Whether a given step's choices are complete enough to move on
const is_step_valid = (id:typeof STEPS[number]):boolean => {
    if (id === 'type'){
        return draft.type !== null
    }
    if (id === 'books'){
        if (draft.book_mode === 'passages'){
            return draft.passages.some(passage => passage.book !== null)
        }
        return draft.books.length >= 1
    }
    if (id === 'bibles'){
        const bibles = draft.bibles.filter(id => id)
        const distinct = new Set(bibles).size === bibles.length
        const two_if_bilingual = draft.type !== 'bilingual' || bibles.length === 2
        return bibles.length >= 1 && distinct && two_if_bilingual
    }
    if (id === 'print'){
        return draft.service_id !== null && draft.size_id !== null
    }
    return draft.cover !== null
}


// Whether the current step's choices are complete enough to move on
const step_valid = computed(() => {
    return is_step_valid(step.value)
})


// Count of books/passages selected, shown alongside the nav buttons on the books step
const books_selected_label = computed(() => {
    const count = draft.book_mode === 'passages'
        ? draft.passages.filter(passage => passage.book !== null).length
        : draft.books.length
    return `${count} ${t("included")}`
})


// Whether every step is complete (required before the final "Create" is enabled, since the
// stepper header allows jumping between steps out of order)
const all_steps_valid = computed(() => {
    return STEPS.every(is_step_valid)
})


// Reset to a fresh draft every time the wizard opens (each run is a brand new design)
watch(() => state.new_design, opened => {
    if (opened){
        Object.assign(draft, get_default_draft())
        step.value = 'type'
        busy.value = false
    }
})


// Auto-advance from the type step as soon as a type is picked (no "Next" click needed there)
watch(() => draft.type, type => {
    if (step.value === 'type' && type !== null){
        next()
    }
})


// Methods

// Close without creating anything (disabled while the design is being created)
const cancel = () => {
    if (creating.value){
        return
    }
    state.new_design = false
}


// Go back one step
const back = () => {
    step.value = STEPS[step_index.value - 1]!
}


// Jump directly to a step (clicked in the header, 1-indexed to match v-stepper's model)
const set_step = (value:number) => {
    step.value = STEPS[value - 1]!
}


// Advance to the next step, or create the design from the completed draft on the last one
const next = async () => {
    if (step.value !== 'cover'){
        step.value = STEPS[step_index.value + 1]!
        return
    }
    creating.value = true
    try {
        const id = await create_design(build_new_blueprint(draft))
        state.new_design = false
        await router.push({name: 'design', params: {id}})
    } catch (error){
        report_error('banner', error)
    } finally {
        creating.value = false
    }
}


</script>


<style lang='sass' scoped>

.wizard
    height: min(700px, 90vh)

    &.fullscreen
        height: 100%

    .v-card-title
        font-size: 1.2rem

    // Keep the header/actions at their natural size, so only .v-card-text scrolls
    > .v-divider, > .v-card-actions
        flex: none

    .stepper-progress
        flex: none

</style>
