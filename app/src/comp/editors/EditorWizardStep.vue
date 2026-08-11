
<template lang='pug'>

v-card-title(class='d-flex align-center')
    | {{ title }}
    v-spacer
    template(v-if='!busy')
        v-btn(@click='cancel' size='large' variant='text') {{$t("Cancel")}}
        v-btn(@click='done' :disabled='!valid || saving' :loading='saving' size='large'
                variant='text' color='secondary') {{$t("Done")}}

v-divider

v-card-text(class='flex-grow-1 d-flex flex-column')
    NewDesignStories(v-if='step === "books" && draft.type === "picture_story"' :draft='draft')
    NewDesignBooks(v-else-if='step === "books"' :draft='draft')
    NewDesignBibles(v-else-if='step === "bibles"' :draft='draft' @busy='busy = $event')
    NewDesignPrint(v-else-if='step === "print"' :draft='draft')
    NewDesignCover(v-else-if='step === "cover"' :draft='draft')

</template>


<script lang='ts' setup>

import {computed, reactive, ref} from 'vue'
import {cloneDeep} from 'lodash-es'
import {useI18n} from 'vue-i18n'

import {state} from '@/services/state'
import {design_wizard, current_design_id, apply_wizard_edit} from '@/services/designs'
import {get_default_draft, is_wizard_step_valid} from '@/services/new_design'
import {report_error} from '@/services/errors'
import NewDesignBooks from '@/comp/dialogs/assets/NewDesignBooks.vue'
import NewDesignStories from '@/comp/dialogs/assets/NewDesignStories.vue'
import NewDesignBibles from '@/comp/dialogs/assets/NewDesignBibles.vue'
import NewDesignPrint from '@/comp/dialogs/assets/NewDesignPrint.vue'
import NewDesignCover from '@/comp/dialogs/assets/NewDesignCover.vue'

import type {WizardStep} from '@/services/new_design'


// Single-step sidebar editor for a wizard-created design still in simple_mode — reuses the same
// step component the wizard dialog itself uses, but scoped to just this one step (unlike Type,
// whose "Change" reopens the full wizard dialog instead, since changing it can invalidate this
// step — see DialogNewDesign.vue/state.wizard_edit)
const props = defineProps<{step:Exclude<WizardStep, 'type'>}>()

const {t} = useI18n()


// A local copy of the design's wizard draft, edited freely and only applied on "Done" — cloned
// so cancelling never mutates design_wizard.draft (the same object other views read for their
// own summaries) before the change is actually saved
const draft = reactive(cloneDeep(design_wizard.draft ?? get_default_draft()))


// Whether a step subview (the translation picker) is covering navigation, matching the wizard
// dialog's own busy handling
const busy = ref(false)


// Whether the design is being saved (guards against a double click on "Done")
const saving = ref(false)


const title = computed(() => {
    if (props.step === 'books'){
        return draft.type === 'picture_story' ? t("Stories") : t("Content")
    }
    if (props.step === 'bibles'){
        return t("Bible translations")
    }
    if (props.step === 'print'){
        return t("Print")
    }
    return t("Cover")
})


const valid = computed(() => is_wizard_step_valid(draft, props.step))


const cancel = () => {
    state.editor = null
}

const done = async () => {
    saving.value = true
    try {
        await apply_wizard_edit(current_design_id.value!, draft)
        state.editor = null
    } catch (error){
        report_error('banner', error)
    } finally {
        saving.value = false
    }
}

</script>


<style lang='sass' scoped>


</style>
