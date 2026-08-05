
<template lang='pug'>

div
    template(v-if='draft.book_mode === "books"')
        v-progress-circular(v-if='loading' indeterminate color='secondary' class='my-8')
        p(v-else-if='error' class='text-body-small text-error my-4') {{ error }}
        template(v-else)
            p(class='mb-3 text-body-medium text-medium-emphasis')
                | {{ $t("Choose the Bible stories you want included — each comes with its own illustrations.") }}
            div.mode_switch
                v-btn(size='small' variant='text' @click='draft.book_mode = "passages"')
                    | {{ $t("Specify exact passages instead") }}
            v-list(density='compact' bg-color='transparent')
                v-list-subheader(v-if='significant.length') {{$t("Significant stories")}}
                v-list-item(v-for='story of significant' :key='"sig_" + story.id' density='compact'
                        :active='draft.stories.includes(story.id)' color='primary'
                        @click='toggle(story.id)')
                    v-list-item-title {{ story.heading }}
                    v-list-item-subtitle {{ story_reference_label(story) }}
                    template(#append)
                        app-icon(v-if='draft.stories.includes(story.id)' name='check')
                template(v-for='book of book_order' :key='book')
                    v-list-subheader(class='mt-2') {{ book_name(book) }}
                    v-list-item(v-for='story of by_book[book]' :key='story.id' density='compact'
                            :active='draft.stories.includes(story.id)' color='primary'
                            @click='toggle(story.id)')
                        v-list-item-title {{ story.heading }}
                        v-list-item-subtitle {{ story_reference_label(story) }}
                        template(#append)
                            app-icon(v-if='draft.stories.includes(story.id)' name='check')

    template(v-else)
        NewDesignPassages(:draft='draft' :hint='passages_hint')
            template(#switch)
                v-btn(size='small' variant='text' @click='draft.book_mode = "books"')
                    | {{ $t("Choose predefined stories instead") }}

</template>


<script lang='ts' setup>

import {ref, computed, onMounted} from 'vue'
import {useI18n} from 'vue-i18n'
import {books_ordered} from '@gracious.tech/fetch-client'

import {content} from '@/services/content'
import {report_error} from '@/services/errors'
import {fetch_stories, fetch_story_sections, get_story_significance, story_reference_label,
    story_canonical_cmp} from '@/services/stories'
import NewDesignPassages from '@/comp/dialogs/assets/NewDesignPassages.vue'

import type {NewDesignDraft} from '@/services/new_design'
import type {Story} from '@/services/stories'


// Wizard step 2 for the picture_story type: pick from the predefined illustrated stories (each
// already comes with its own images), or fall back to a custom passage list like the regular
// books step — but without any image controls, since those are only ever added afterward via the
// full picture-story editor (Advanced settings)
const props = defineProps<{draft:NewDesignDraft}>()
const draft = props.draft

const {t} = useI18n()


// Kept as a script constant (rather than inline in the template) since Pug's attribute-value
// parsing trips over the escaped quotes an inline $t(...) call here would need
const passages_hint = t(
    "List the passages you want, one per line, e.g. \"Genesis 1:1-5\" or \"Matthew 5\", " +
    "then click Add. You can add images to each afterward from Advanced settings.")


// Loaded data (fetched once per mount; the wizard resets on every open so no need to cache
// across opens the way DialogPictureStoryPicker does)
const loading = ref(true)
const error = ref('')
const stories = ref<Story[]>([])
const significance = ref(new Map<string, {importance:number, popularity:number}>())

onMounted(async () => {
    try {
        const [fetched_stories, sections] = await Promise.all(
            [fetch_stories(), fetch_story_sections()])
        stories.value = fetched_stories
        significance.value = new Map(fetched_stories.map(
            story => [story.id, get_story_significance(story, sections)]))
    } catch (err){
        error.value = t("Couldn't load the story list — try again")
        report_error('silent', err, {context: {stage: 'new_design_stories'}})
    } finally {
        loading.value = false
    }
})


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


// Toggle a single story in/out of the selection
const toggle = (id:string) => {
    const index = draft.stories.indexOf(id)
    if (index === -1){
        draft.stories.push(id)
    } else {
        draft.stories.splice(index, 1)
    }
}


</script>


<style lang='sass' scoped>

.mode_switch
    display: flex
    align-items: center
    gap: 8px

</style>
