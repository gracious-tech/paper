
<template lang='pug'>

//- Predefined picture-story picker: a "write your own" escape hatch pinned at the top, then
//- significant stories (chronological), then every story grouped per book (also chronological)
v-dialog(:model-value='modelValue' @update:model-value='close' max-width='520')
    v-card
        v-card-title {{$t("Choose a picture story")}}
        v-divider
        v-card-text(class='py-0')
            v-progress-circular(v-if='loading' indeterminate color='secondary' class='my-8')
            p(v-else-if='error' class='text-body-small text-error my-4') {{ error }}
            v-list(v-else bg-color='transparent')
                v-list-item(@click='select_custom' color='primary')
                    template(#prepend)
                        app-icon(name='edit')
                    v-list-item-title {{$t("Write your own...")}}
                v-list-subheader(v-if='significant.length' class='mt-2') {{$t("Significant stories")}}
                v-list-item(v-for='story of significant' :key='"sig_" + story.id'
                        @click='select_story(story)')
                    v-list-item-title {{ story.heading }}
                    v-list-item-subtitle {{ story_reference_label(story) }}
                template(v-for='book of book_order' :key='book')
                    v-list-subheader(class='mt-2') {{ book_name(book) }}
                    v-list-item(v-for='story of by_book[book]' :key='story.id'
                            @click='select_story(story)')
                        v-list-item-title {{ story.heading }}
                        v-list-item-subtitle {{ story_reference_label(story) }}
        v-card-actions
            v-spacer
            v-btn(@click='close') {{$t("Cancel")}}

</template>


<script lang='ts' setup>

import {ref, computed, watch} from 'vue'
import {useI18n} from 'vue-i18n'

import {content} from '@/services/content'
import {report_error} from '@/services/errors'
import {fetch_stories, fetch_story_sections, get_story_significance, story_reference_label,
    story_canonical_cmp} from '@/services/stories'
import {books_ordered} from '@gracious.tech/fetch-client'

import type {Story} from '@/services/stories'


// modelValue-controlled dialog (mirrors DialogShareVersion.vue), plus a choice made by the user
const props = defineProps<{modelValue:boolean}>()
const emit = defineEmits<{
    (event:'update:modelValue', value:boolean):void
    (event:'select-story', story:Story):void
    (event:'select-custom'):void
}>()

const {t} = useI18n()


// Loaded data (fetched once per dialog open, cached across opens by the service module)
const loading = ref(false)
const error = ref('')
const stories = ref<Story[]>([])
const significance = ref(new Map<string, {importance:number, popularity:number}>())


// Fetch the story list + section significance whenever the dialog opens
watch(() => props.modelValue, async open => {
    if (!open || stories.value.length){
        return
    }
    loading.value = true
    error.value = ''
    try {
        const [fetched_stories, sections] = await Promise.all(
            [fetch_stories(), fetch_story_sections()])
        stories.value = fetched_stories
        significance.value = new Map(fetched_stories.map(
            story => [story.id, get_story_significance(story, sections)]))
    } catch (err){
        error.value = t("Couldn't load the story list — try again")
        report_error('silent', err, {context: {stage: 'picture_story_list'}})
    } finally {
        loading.value = false
    }
}, {immediate: true})


// Stories with both min importance and min popularity of 4, sorted chronologically
const significant = computed(() => {
    return stories.value
        .filter(story => {
            const sig = significance.value.get(story.id)
            return sig && sig.importance >= 4 && sig.popularity >= 4
        })
        .sort(story_canonical_cmp)
})


// Every story (including significant ones again), grouped per book, each sorted chronologically
const by_book = computed(() => {
    const groups:Record<string, Story[]> = {}
    for (const story of stories.value){
        (groups[story.book] ??= []).push(story)
    }
    for (const group of Object.values(groups)){
        group.sort(story_canonical_cmp)
    }
    return groups
})


// Books that actually have stories, in canonical Bible order
const book_order = computed(() => {
    return books_ordered.filter(book => by_book.value[book]?.length)
})


// Localized book name for a group's subheader
const book_name = (book:string):string => {
    const books = content.collection.get_books(
        content.collection.get_preferred_resource().id, {object: true, whole: true})
    return books[book]?.name ?? book
}


// Methods

const select_story = (story:Story) => {
    emit('select-story', story)
    emit('update:modelValue', false)
}

const select_custom = () => {
    emit('select-custom')
    emit('update:modelValue', false)
}

const close = () => {
    emit('update:modelValue', false)
}

</script>


<style lang='sass' scoped>

.v-card-text
    max-height: 60vh
    overflow-y: auto

</style>
