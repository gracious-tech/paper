
<template lang='pug'>

div
    p(class='mb-3 text-body-medium text-medium-emphasis') {{ $t("What do you want it to look like?") }}
    div.grid
        NewDesignCard(v-for='item of types' :key='item.id' :image='item.image' :label='item.label'
            :subtitle='item.subtitle' :selected='draft.type === item.id' :tint='item.tint'
            @select='select(item.id)')

</template>


<script lang='ts' setup>

import {computed} from 'vue'
import {useI18n} from 'vue-i18n'

import {TYPE_PRESETS, wizard_type_label} from '@/services/new_design'
import NewDesignCard from '@/comp/dialogs/assets/NewDesignCard.vue'

import type {NewDesignDraft, NewDesignType} from '@/services/new_design'


// Wizard step 1: pick the type of Bible (each maps to a preset diff over the blank defaults)
const props = defineProps<{draft:NewDesignDraft}>()
const draft = props.draft
const emit = defineEmits<{select:[]}>()

const {t} = useI18n()


// Set the chosen type and always notify the parent, even if re-selecting the same type
// (the parent auto-advances on this event rather than on a `draft.type` value change, since
// picking the same type twice in a row wouldn't otherwise trigger a watcher)
const select = (id:NewDesignType) => {
    draft.type = id
    emit('select')
}


// Labels/subtitles per type (shared with the simple-mode summary row), joined with each
// preset's image
const types = computed(() => TYPE_PRESETS.map(preset => ({
    id: preset.id,
    image: preset.image,
    tint: preset.id === 'picture_story' ? 'yellow' as const : 'blue' as const,
    ...wizard_type_label(preset.id, t),
})))


</script>


<style lang='sass' scoped>

.grid
    display: grid
    grid-template-columns: 1fr 1fr
    gap: 12px

</style>
