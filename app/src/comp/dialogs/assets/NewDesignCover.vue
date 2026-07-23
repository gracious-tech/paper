
<template lang='pug'>

div
    p(class='mb-3 text-body-medium text-medium-emphasis') {{ $t("What do you want the cover to look like?") }}
    div.grid
        NewDesignCard(v-for='item of covers' :key='item.id' :image='item.image' :label='item.label'
            :subtitle='item.subtitle' :selected='draft.cover === item.id'
            @select='draft.cover = item.id')

</template>


<script lang='ts' setup>

import {computed, watch} from 'vue'
import {useI18n} from 'vue-i18n'

import NewDesignCard from '@/comp/dialogs/assets/NewDesignCard.vue'

import type {NewDesignDraft, NewDesignCover} from '@/services/new_design'


// Wizard step 5: pick a cover style (seeded as a starting point; refined later in the cover
// editor). Home printing additionally offers "minimal ink" — a title page instead of a cover
const props = defineProps<{draft:NewDesignDraft}>()
const draft = props.draft

const {t} = useI18n()


// The offered cover styles (minimal ink only when printing at home)
const covers = computed(() => {
    const items:{id:NewDesignCover, image:string, label:string, subtitle:string}[] = [
        {id: 'photo', image: '/wizard/cover_photo.webp', label: t("Photo"),
            subtitle: t("A full cover photo (add your own image later)")},
        {id: 'pattern', image: '/wizard/cover_pattern.webp', label: t("Pattern"),
            subtitle: t("A decorative repeating pattern")},
        {id: 'icon', image: '/wizard/cover_icon.webp', label: t("Icon"),
            subtitle: t("A simple icon design")},
    ]
    if (draft.service_id === 'home'){
        items.push({id: 'minimal', image: '/wizard/cover_minimal.webp', label: t("Minimal ink"),
            subtitle: t("A title page instead of a cover, to save ink")})
    }
    return items
})


// If the user went back and switched away from home printing, a minimal-ink choice is no
// longer valid — clear it so they must choose again
watch(() => draft.service_id, () => {
    if (draft.cover === 'minimal' && draft.service_id !== 'home'){
        draft.cover = null
    }
})


</script>


<style lang='sass' scoped>

.grid
    display: grid
    grid-template-columns: 1fr 1fr
    gap: 12px

</style>
