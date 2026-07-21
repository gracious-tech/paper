
<template lang='pug'>

div
    p(class='mb-3 text-body-2 text-medium-emphasis') {{ $t("What do you want it to look like?") }}
    div.grid
        NewDesignCard(v-for='item of types' :key='item.id' :image='item.image' :label='item.label'
            :subtitle='item.subtitle' :selected='draft.type === item.id'
            @select='draft.type = item.id')

</template>


<script lang='ts' setup>

import {computed} from 'vue'
import {useI18n} from 'vue-i18n'

import {TYPE_PRESETS} from '@/services/new_design'
import NewDesignCard from '@/comp/dialogs/assets/NewDesignCard.vue'

import type {NewDesignDraft} from '@/services/new_design'


// Wizard step 1: pick the type of Bible (each maps to a preset diff over the blank defaults)
const props = defineProps<{draft:NewDesignDraft}>()
const draft = props.draft

const {t} = useI18n()


// Display labels/subtitles per type, joined with each preset's image
const labels:Record<string, {label:string, subtitle:string}> = {
    regular: {
        label: t("Regular Bible"),
        subtitle: t("How most bibles look, with verse numbers and headings"),
    },
    reading: {
        label: t("Reading Bible"),
        subtitle: t("No verse numbers, like a normal book"),
    },
    notes: {
        label: t("Notes Bible"),
        subtitle: t("Lots of space to write notes"),
    },
    study: {
        label: t("Study Bible"),
        subtitle: t("Extensive footnotes to guide readers"),
    },
    bilingual: {
        label: t("Bilingual Bible"),
        subtitle: t("Two translations side by side"),
    },
}
const types = computed(() => TYPE_PRESETS.map(preset => ({
    id: preset.id,
    image: preset.image,
    ...labels[preset.id]!,
})))


</script>


<style lang='sass' scoped>

.grid
    display: grid
    grid-template-columns: 1fr 1fr
    gap: 12px

</style>
