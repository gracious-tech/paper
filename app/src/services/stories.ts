
import {FetchClient, PassageReference, books_ordered} from '@gracious.tech/fetch-client'

import {content, endpoint} from '@/services/content'
import {generate_token} from '@/services/utils'

import type {SectionData} from '@gracious.tech/fetch-client'
import type {PictureStorySlide} from '@/services/types'


// Only collection currently published by the image service
const WILDBIBLE = 'wildbible'


// Where the predefined story list + images are served from
export const image_endpoint = import.meta.env.PROD
    ? 'https://images.freely.giving/' : 'http://localhost:3009/'


// One verse of a predefined story, with any illustrating images keyed by collection
export interface StoryVerse {
    chapter:number
    verse:number
    images:Record<string, string[]>
}


// A predefined picture story, as published in stories.json
export interface Story {
    id:string
    book:string
    heading:string
    start_chapter:number
    start_verse:number
    end_chapter:number
    end_verse:number
    collections:string[]
    verses:StoryVerse[]
}


// A story's computed significance (defaults to 3/3 when no fetch.bible section overlaps it)
export interface StorySignificance {
    importance:number
    popularity:number
}


// Module-level caches so repeated dialog opens don't refetch
let stories_promise:Promise<Story[]>|null = null
let sections_promise:Promise<SectionData>|null = null


// Fetch the predefined story list (cached after first call)
export function fetch_stories():Promise<Story[]> {
    stories_promise ??= fetch(`${image_endpoint}stories.json`)
        .then(response => response.json())
        .then((data:{stories:Story[]}) => data.stories)
    return stories_promise
}


// Fetch fetch.bible's section importance/popularity data (cached after first call). A dedicated
// lightweight client is used (rather than reaching into `bible_content`'s private one) since
// sections are unrelated to the Bible-book fetching/caching that class exists for
export function fetch_story_sections():Promise<SectionData> {
    sections_promise ??= new FetchClient({endpoints: [endpoint], remember_fetches: false})
        .fetch_sections()
    return sections_promise
}


// A story's importance/popularity, taken as the max across every fetch.bible section that
// overlaps its passage range (a story often spans several finer-grained sections), defaulting to
// 3/3 when nothing overlaps
export function get_story_significance(story:Story, sections:SectionData):StorySignificance {
    const ref = new PassageReference({
        book: story.book,
        start_chapter: story.start_chapter,
        start_verse: story.start_verse,
        end_chapter: story.end_chapter,
        end_verse: story.end_verse,
    })
    const overlapping = sections.get_for_ref(ref)
    if (!overlapping.length){
        return {importance: 3, popularity: 3}
    }
    return {
        importance: Math.max(...overlapping.map(section => section.importance)),
        popularity: Math.max(...overlapping.map(section => section.popularity)),
    }
}


// Sort stories into canonical (book, chapter, verse) order
export function story_canonical_cmp(a:Story, b:Story):number {
    return books_ordered.indexOf(a.book) - books_ordered.indexOf(b.book)
        || a.start_chapter - b.start_chapter || a.start_verse - b.start_verse
}


// Human-readable reference label for a story, e.g. "Luke 2:8-20"
export function story_reference_label(story:Story):string {
    const books = content.collection.get_books(
        content.collection.get_preferred_resource().id, {object: true, whole: true})
    const book_name = books[story.book]?.name ?? story.book
    const verses = story.start_chapter === story.end_chapter
        ? `${story.start_chapter}:${story.start_verse}-${story.end_verse}`
        : `${story.start_chapter}:${story.start_verse}-${story.end_chapter}:${story.end_verse}`
    return `${book_name} ${verses}`
}


// Build the fetchable URL for one of the image service's images (always the 'decent' variant —
// Typst's image loader doesn't recognise avif, see typst/src/image_cache.ts)
function story_image_url(collection:string, image_id:string):string {
    return `${image_endpoint}${collection}/${image_id}/decent.jpg`
}


// Convert a predefined story into editable picture-story slides. Starts a new slide at every
// verse with a wildbible image (using its first listed image), folding any run of un-illustrated
// verses into the *following* image's slide (or the *last* slide, for a trailing run) so every
// generated slide is illustrated — mirrors what a user would build by hand with the existing
// slide-by-slide editor, and stays fully editable afterward
export function story_to_slides(story:Story):PictureStorySlide[] {
    const imaged = story.verses.filter(verse => verse.images[WILDBIBLE]?.length)
    if (!imaged.length){
        return [{
            id: generate_token(),
            image: null,
            mode: 'passage',
            book: story.book,
            start_chapter: story.start_chapter,
            start_verse: story.start_verse,
            end_chapter: story.end_chapter,
            end_verse: story.end_verse,
            doc: {type: 'doc', content: [{type: 'paragraph'}]},
        }]
    }

    const slides:PictureStorySlide[] = []
    let range_start = {chapter: story.start_chapter, verse: story.start_verse}
    for (const [index, verse] of imaged.entries()){
        const is_last = index === imaged.length - 1
        const image_id = verse.images[WILDBIBLE]![0]!
        slides.push({
            id: generate_token(),
            image: {source: 'url', url: story_image_url(WILDBIBLE, image_id), path: null, hash: null},
            mode: 'passage',
            book: story.book,
            start_chapter: range_start.chapter,
            start_verse: range_start.verse,
            end_chapter: is_last ? story.end_chapter : verse.chapter,
            end_verse: is_last ? story.end_verse : verse.verse,
            doc: {type: 'doc', content: [{type: 'paragraph'}]},
        })
        range_start = {chapter: verse.chapter, verse: verse.verse + 1}
    }
    return slides
}
