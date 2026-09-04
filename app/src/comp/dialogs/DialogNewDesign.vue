
<template lang='pug'>

v-dialog(:model-value='mode !== null' @update:model-value='cancel' :fullscreen='fullscreen'
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
                    NewDesignType(:draft='draft' @select='next')
                v-window-item(value='books')
                    NewDesignStories(v-if='draft.type === "picture_story"' :draft='draft')
                    NewDesignBooks(v-else :draft='draft')
                v-window-item(value='bibles')
                    NewDesignBibles(:draft='draft')
                v-window-item(value='print')
                    NewDesignPrint(:draft='draft')
                v-window-item(value='cover')
                    NewDesignCover(:draft='draft')

        v-divider

        v-card-actions
            v-btn(v-if='mode === "edit" || step_index === 0' @click='cancel' color=''
                    variant='tonal' size='large')
                | {{ $t("common.cancel") }}
            v-btn(v-else @click='back' color='' variant='tonal' size='large')
                | {{ $t("common.prev") }}
            v-spacer
            span.text-medium-emphasis(v-if='step === "books"') {{ books_selected_label }}
            v-spacer
            v-btn(v-if='mode === "edit"' @click='finish' :disabled='!all_steps_valid'
                    :loading='creating' color='secondary' variant='flat' size='large')
                | {{ $t("common.save") }}
            v-btn(v-else-if='step !== "type"' @click='next'
                    :disabled='step === "cover" ? !all_steps_valid : !step_valid'
                    :loading='creating' color='secondary' variant='flat' size='large')
                | {{ step === 'cover' ? $t("common.create") : $t("common.next") }}

</template>


<script lang='ts' setup>

import {computed, reactive, ref, watch} from 'vue'
import {cloneDeep} from 'lodash-es'
import {useI18n} from '@/services/i18n'
import {useRouter} from 'vue-router'

import {state} from '@/services/state'
import {create_design, design_wizard, apply_wizard_edit, current_design_id}
    from '@/services/designs'
import {get_default_draft, build_new_blueprint, WIZARD_STEPS, is_wizard_step_valid,
    all_wizard_steps_valid} from '@/services/new_design'
import {report_error} from '@/services/errors'
import {use_is_mobile} from '@/services/display'
import NewDesignType from '@/comp/dialogs/assets/NewDesignType.vue'
import NewDesignBooks from '@/comp/dialogs/assets/NewDesignBooks.vue'
import NewDesignStories from '@/comp/dialogs/assets/NewDesignStories.vue'
import NewDesignBibles from '@/comp/dialogs/assets/NewDesignBibles.vue'
import NewDesignPrint from '@/comp/dialogs/assets/NewDesignPrint.vue'
import NewDesignCover from '@/comp/dialogs/assets/NewDesignCover.vue'

import type {WizardStep} from '@/services/new_design'


// The new-design wizard: five steps that build up a draft of selections. In "create" mode
// (state.new_design), the draft only becomes an actual design (Firestore doc) once the final
// step's "Create" is confirmed — cancelling at any point creates nothing. In "edit" mode
// (state.wizard_edit, opened from ViewDesignSimple's Type row — the one wizard step whose change
// can invalidate another step), it reopens the same stepper seeded from the open design's
// existing wizard_draft, letting the stepper's own cross-step validation surface anything that
// needs fixing before "Save" applies the changes back to the open design
const {t} = useI18n()
const router = useRouter()


// Steps in order (STEPS/is_step_valid alias the hoisted new_design.ts exports so template calls
// below don't need to change)
const STEPS = WIZARD_STEPS


// State
const step = ref<WizardStep>('type')
const draft = reactive(get_default_draft())
const creating = ref(false)


// Whether the dialog is creating a new design, editing the open design's wizard draft, or closed
const mode = computed<'create'|'edit'|null>(() => {
    if (state.new_design){
        return 'create'
    }
    if (state.wizard_edit){
        return 'edit'
    }
    return null
})


// Fullscreen below the app's own mobile breakpoint (where AppRoot stops width-capping
// .v-application at 500px, so fullscreen covers the real viewport)
const fullscreen = use_is_mobile()


// Position of the current step
const step_index = computed(() => STEPS.indexOf(step.value))


// Short label shown under each step's progress indicator (the "books" step becomes a story
// picker for the picture_story type, so its label follows suit)
const step_labels = computed(() => {
    return {
        type: t("common.type"),
        books: draft.type === 'picture_story' ? t("common.stories") : t("common.books"),
        bibles: t("common.translations"),
        print: t("common.print"),
        cover: t("common.cover"),
    }
})


// Whether a given step's choices are complete enough to move on (hoisted to new_design.ts so
// EditorWizardStep.vue's single-step Save button can reuse the exact same check)
const is_step_valid = (id:WizardStep):boolean => {
    return is_wizard_step_valid(draft, id)
}


// Whether the current step's choices are complete enough to move on
const step_valid = computed(() => {
    return is_step_valid(step.value)
})


// Count of books/stories/passages selected, shown alongside the nav buttons on the books step
const books_selected_label = computed(() => {
    let count = draft.books.length
    if (draft.book_mode === 'passages'){
        count = draft.passages.filter(passage => passage.book !== null).length
    } else if (draft.type === 'picture_story'){
        count = draft.stories.length
    }
    return `${count} ${t("wizard.included")}`
})


// Whether every step is complete (required before the final "Create"/"Save" is enabled, since
// the stepper header allows jumping between steps out of order)
const all_steps_valid = computed(() => {
    return all_wizard_steps_valid(draft)
})


// Reset (create mode) or seed from the open design's existing draft (edit mode) every time the
// dialog opens. cloneDeep is essential in edit mode — design_wizard.draft is the same object
// read from the last Firestore snapshot, so assigning its arrays in by reference would let
// in-progress (uncommitted) edits here mutate it directly, corrupting the "cancel discards
// changes" guarantee and the ViewDesignSimple summary before Save is ever clicked
watch(mode, m => {
    if (m === 'create'){
        Object.assign(draft, get_default_draft())
        step.value = 'type'
    } else if (m === 'edit'){
        Object.assign(draft, cloneDeep(design_wizard.draft) ?? get_default_draft())
        step.value = state.wizard_edit!.step
    }
})


// Methods

// Close without applying anything (disabled while create/save is in progress)
const cancel = () => {
    if (creating.value){
        return
    }
    state.new_design = false
    state.wizard_edit = null
}


// Go back one step
const back = () => {
    step.value = STEPS[step_index.value - 1]!
}


// Jump directly to a step (clicked in the header, 1-indexed to match v-stepper's model)
const set_step = (value:number) => {
    step.value = STEPS[value - 1]!
}


// Create the new design (create mode) or apply the edited draft back to the currently open one
// (edit mode)
const finish = async () => {
    creating.value = true
    try {
        if (mode.value === 'edit'){
            await apply_wizard_edit(current_design_id.value!, draft)
            state.wizard_edit = null
        } else {
            const id = await create_design(await build_new_blueprint(draft), cloneDeep(draft))
            state.new_design = false
            await router.push({name: 'design', params: {id}})
        }
    } catch (error){
        report_error('banner', error)
    } finally {
        creating.value = false
    }
}


// Advance to the next step (create mode's "Next" button), or finish (create mode's "Create" on
// the last step). In edit mode, the only auto-navigation is the type step's auto-select emit
// jumping to "books" — every other step's own action is the explicit "Save" button, not a forced
// march through the rest of the steps
const next = async () => {
    if (mode.value === 'edit'){
        if (step.value === 'type'){
            step.value = STEPS[step_index.value + 1]!
        }
        return
    }
    if (step.value !== 'cover'){
        step.value = STEPS[step_index.value + 1]!
        return
    }
    await finish()
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
