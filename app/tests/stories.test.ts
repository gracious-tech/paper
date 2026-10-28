// Predefined picture stories (stories.ts): how one is ranked, ordered, labelled and turned into
// the slides a user then edits. The story list and sections are fetched from outside services,
// so the fetches are stand-ins here and what's under test is what's done with the data

import {describe, it, expect, afterEach, vi} from 'vitest'

import {content, reset_content} from './stubs/content'
import {fetch_stories, get_story_significance, image_endpoint, story_canonical_cmp,
    story_reference_label, story_to_slides} from '@/services/stories'

import type {SectionData} from '@gracious.tech/fetch-client'
import type {Story, StoryVerse} from '@/services/stories'


// A story spanning the given range, illustrated as each verse says
function make_story(overrides:Partial<Story> = {}):Story {
    return {
        id: 'story',
        book: 'luk',
        heading: 'The shepherds',
        start_chapter: 2,
        start_verse: 8,
        end_chapter: 2,
        end_verse: 20,
        collections: ['wildbible'],
        verses: [],
        ...overrides,
    }
}


// A verse with wildbible images (or none)
function verse(chapter:number, verse_num:number, images:string[] = []):StoryVerse {
    return {chapter, verse: verse_num, images: images.length ? {wildbible: images} : {}}
}


// A stand-in for fetch-client's sections, returning the given overlaps for any reference
function sections_with(overlapping:{importance:number, popularity:number}[]):SectionData {
    return {get_for_ref: () => overlapping} as unknown as SectionData
}


afterEach(() => {
    reset_content()
    vi.unstubAllGlobals()
})


describe('get_story_significance', () => {

    it('defaults to 3/3 when no section overlaps the story', () => {
        expect(get_story_significance(make_story(), sections_with([])))
            .toEqual({importance: 3, popularity: 3})
    })

    it('takes the highest of each across every overlapping section, independently', () => {
        // A story spanning several finer sections ranks by the most significant part of it
        const sections = sections_with([
            {importance: 2, popularity: 5},
            {importance: 4, popularity: 1},
        ])
        expect(get_story_significance(make_story(), sections))
            .toEqual({importance: 4, popularity: 5})
    })

    it('asks about the story\'s whole passage', () => {
        // The reference handed to the sections is the story's own range
        const get_for_ref = vi.fn(() => [])
        get_story_significance(make_story({book: 'gen', start_chapter: 1, start_verse: 1,
            end_chapter: 2, end_verse: 3}), {get_for_ref} as unknown as SectionData)
        expect(get_for_ref).toHaveBeenCalledWith(expect.objectContaining({book: 'gen',
            start_chapter: 1, start_verse: 1, end_chapter: 2, end_verse: 3}))
    })

})


describe('story_canonical_cmp', () => {

    it('orders by book in canonical order, then chapter, then verse', () => {
        const stories = [
            make_story({id: 'jhn', book: 'jhn', start_chapter: 1, start_verse: 1}),
            make_story({id: 'luk2:20', book: 'luk', start_chapter: 2, start_verse: 20}),
            make_story({id: 'gen', book: 'gen', start_chapter: 50, start_verse: 1}),
            make_story({id: 'luk2:8', book: 'luk', start_chapter: 2, start_verse: 8}),
            make_story({id: 'luk1', book: 'luk', start_chapter: 1, start_verse: 30}),
        ]
        expect(stories.sort(story_canonical_cmp).map(story => story.id))
            .toEqual(['gen', 'luk1', 'luk2:8', 'luk2:20', 'jhn'])
    })

})


describe('story_reference_label', () => {

    // The book names the default Bible gives, as the real collection would
    function set_book_names(names:Record<string, string>):void {
        const collection = content.collection as unknown as Record<string, unknown>
        collection['get_books'] = () => Object.fromEntries(
            Object.entries(names).map(([id, name]) => [id, {id, name}]))
    }

    it('labels a story within one chapter with a verse range', () => {
        set_book_names({luk: 'Luke'})
        expect(story_reference_label(make_story())).toBe('Luke 2:8-20')
    })

    it('labels a story crossing chapters with both chapters', () => {
        set_book_names({gen: 'Genesis'})
        expect(story_reference_label(make_story({book: 'gen', start_chapter: 37, start_verse: 1,
            end_chapter: 39, end_verse: 6}))).toBe('Genesis 37:1-39:6')
    })

    it('falls back to the book id when the Bible has no name for it', () => {
        set_book_names({})
        expect(story_reference_label(make_story())).toBe('luk 2:8-20')
    })

})


describe('story_to_slides', () => {

    it('makes one unillustrated slide of the whole story when no verse has an image', () => {
        const slides = story_to_slides(make_story({verses: [verse(2, 8), verse(2, 9)]}))
        expect(slides).toHaveLength(1)
        expect(slides[0]).toMatchObject({image: null, mode: 'passage', book: 'luk',
            start_chapter: 2, start_verse: 8, end_chapter: 2, end_verse: 20})
    })

    it('starts a slide at each illustrated verse, folding earlier verses into it', () => {
        // Verses 8-9 lead into 10's image; 11-13 into 14's; the trailing run joins the last
        const slides = story_to_slides(make_story({verses: [
            verse(2, 8), verse(2, 9), verse(2, 10, ['a']), verse(2, 11),
            verse(2, 14, ['b']), verse(2, 15),
        ]}))
        expect(slides.map(slide => [slide.start_chapter, slide.start_verse, slide.end_chapter,
            slide.end_verse])).toEqual([[2, 8, 2, 10], [2, 11, 2, 20]])
    })

    it('carries ranges across chapters', () => {
        const slides = story_to_slides(make_story({start_chapter: 1, start_verse: 30,
            end_chapter: 2, end_verse: 5, verses: [verse(1, 33, ['a']), verse(2, 2, ['b'])]}))
        expect(slides.map(slide => [slide.start_chapter, slide.start_verse, slide.end_chapter,
            slide.end_verse])).toEqual([[1, 30, 1, 33], [1, 34, 2, 5]])
    })

    it('uses each verse\'s first wildbible image, as a fetchable jpg', () => {
        // The 'decent' jpg variant, since Typst can't decode avif
        const slides = story_to_slides(make_story({verses: [
            {chapter: 2, verse: 10, images: {other: ['x'], wildbible: ['first', 'second']}},
        ]}))
        expect(slides[0]!.image).toEqual({source: 'url',
            url: `${image_endpoint}wildbible/first/decent.jpg`, path: null, hash: null,
            original: null})
    })

    it('ignores images from other collections', () => {
        const slides = story_to_slides(make_story({verses: [
            {chapter: 2, verse: 10, images: {other: ['x']}},
        ]}))
        expect(slides).toHaveLength(1)
        expect(slides[0]!.image).toBe(null)
    })

    it('gives every slide its own id and an empty, editable body', () => {
        const slides = story_to_slides(make_story({verses: [verse(2, 9, ['a']),
            verse(2, 12, ['b'])]}))
        expect(new Set(slides.map(slide => slide.id)).size).toBe(2)
        for (const slide of slides){
            expect(slide.doc).toEqual({type: 'doc', content: [{type: 'paragraph'}]})
        }
    })

})


describe('fetch_stories', () => {

    it('fetches the story list once and reuses it', async () => {
        const stories = [make_story()]
        const fetch = vi.fn(async () => new Response(JSON.stringify({stories})))
        vi.stubGlobal('fetch', fetch)
        expect(await fetch_stories()).toEqual(stories)
        expect(await fetch_stories()).toEqual(stories)
        expect(fetch).toHaveBeenCalledTimes(1)
        expect(fetch).toHaveBeenCalledWith(`${image_endpoint}stories.json`)
    })

})
