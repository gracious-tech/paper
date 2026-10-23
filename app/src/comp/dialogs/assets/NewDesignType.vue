
<template lang='pug'>

div
    p(class='mb-3 text-body-medium text-medium-emphasis') {{ $t("wizard.type.question") }}
    div.grid
        NewDesignCard(v-for='item of types' :key='item.id' :image='item.image' :label='item.label'
            :subtitle='item.subtitle' :selected='draft.type === item.id' :tint='item.tint'
            :disabled='item.disabled' @select='select(item.id)')

</template>


<script lang='ts' setup>

import {computed} from 'vue'
import {useI18n} from '@/services/i18n'
import {intl_tag} from '@/services/locale'

import {TYPE_PRESETS, type_preset_image, wizard_type_label} from '@/services/new_design'
import NewDesignCard from '@/comp/dialogs/assets/NewDesignCard.vue'

import type {NewDesignDraft, NewDesignType} from '@/services/new_design'


// Wizard step 1: pick the type of Bible (each maps to a preset diff over the blank defaults)
const props = defineProps<{draft:NewDesignDraft}>()
const draft = props.draft
const emit = defineEmits<{select:[]}>()

const {t, locale} = useI18n()


// Set the chosen type and always notify the parent, even if re-selecting the same type
// (the parent auto-advances on this event rather than on a `draft.type` value change, since
// picking the same type twice in a row wouldn't otherwise trigger a watcher)
const select = (id:NewDesignType) => {
    draft.type = id
    emit('select')
}


// Month the picture_story type is due to be published (shown, but not selectable, until then)
const PICTURE_STORY_RELEASE = new Date(2026, 11)


// Labels/subtitles per type (shared with the simple-mode summary row), joined with each
// preset's picture for the current locale
// NOTE picture_story is disabled as not yet published (still a valid/functional type otherwise)
const types = computed(() => TYPE_PRESETS.map(preset => {
    const unreleased = preset.id === 'picture_story'
    const label = wizard_type_label(preset.id, t)
    return {
        id: preset.id,
        image: type_preset_image(preset.image, locale.value),
        tint: preset.id === 'picture_story' ? 'yellow' as const : 'blue' as const,
        disabled: unreleased,
        label: label.label,
        subtitle: unreleased ? t("wizard.type.coming", {date: release_month()}) : label.subtitle,
    }
}))


// The picture_story release month in the UI's language (e.g. "Dec 2026")
const release_month = () => PICTURE_STORY_RELEASE.toLocaleDateString(intl_tag(locale.value),
    {month: 'short', year: 'numeric'})


</script>


<style lang='sss' scoped>

.grid
    display: grid
    grid-template-columns: 1fr 1fr
    gap: 12px

</style>
