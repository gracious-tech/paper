
import {describe, it, expect} from 'vitest'

import {gen_picture_story} from '../src/content_picture_story.js'

import {TEST_PAGE, make_slide, make_story} from './fixtures.js'

import type {TypstPictureStorySlide} from '../src/types.js'


// The arguments after the story itself never vary across most tests — only the layout flags do
function gen(story:Parameters<typeof gen_picture_story>[0],
        layout:'single'|'grid' = 'single', alternate = false,
        image_style:Parameters<typeof gen_picture_story>[2] = 'padded'):string {
    return gen_picture_story(story, TEST_PAGE, image_style, layout, alternate, 1.5, '10pt',
        'Noto Serif', '10pt', ['serif'], null)
}


// A slide with an image (and optionally a body)
function image_slide(filename:string, body:string|null = 'Text'):TypstPictureStorySlide {
    return make_slide({image: {filename, bytes: new Uint8Array()}, body})
}


// How many pages the generated markup spans
function page_count(source:string):number {
    return source.split('#pagebreak()').length
}


describe('single layout', () => {

    it('puts each slide on its own page', () => {
        const out = gen(make_story({slides: [make_slide(), make_slide(), make_slide()]}))
        expect(page_count(out)).toBe(3)
    })

    it('renders a single slide with no page break', () => {
        expect(gen(make_story()).includes('#pagebreak()')).toBe(false)
    })

    it('renders an empty story as empty markup', () => {
        expect(gen(make_story({slides: []}))).toBe('')
    })

    it('centres a body-only slide on the page', () => {
        const out = gen(make_story({slides: [make_slide({body: 'Once upon a time.'})]}))
        expect(out).toContain('align(center + horizon')
        expect(out).toContain('Once upon a time.')
    })

    it('reserves a full page for a slide with neither image nor body', () => {
        const out = gen(make_story({slides: [make_slide({body: null})]}))
        expect(out).toContain('#block(width: 100%, height: 210mm - 15mm - 15mm)')
        expect(out).not.toContain('image(')
    })

    it('fills the page with an image-only slide', () => {
        const out = gen(make_story({slides: [image_slide('pic.jpg', null)]}))
        expect(out).toContain('image("pic.jpg"')
        expect(out).toContain('#place(top + left,')
    })

    it('splits the page between an image and a body', () => {
        const out = gen(make_story({slides: [image_slide('pic.jpg', 'Body text')]}))
        expect(out).toContain('image("pic.jpg"')
        expect(out).toContain('Body text')
        // The body half is clipped as a last-resort overflow guard
        expect(out).toContain('clip: true')
    })

    it('always puts the image on top when not alternating', () => {
        const out = gen(make_story({slides: [image_slide('a.jpg'), image_slide('b.jpg')]}),
            'single', false)
        // dy: 0pt on the image place means the top half for both slides
        expect(out.match(/#place\(top \+ left, dy: 0pt,\n {4}block/g)).toHaveLength(2)
    })

    it('alternates the image between top and bottom when asked', () => {
        const out = gen(make_story({slides: [image_slide('a.jpg'), image_slide('b.jpg')]}),
            'single', true)
        const [first, second] = out.split('#pagebreak()')
        // The first slide's image sits at dy 0 (top), the second's is offset by half the page
        expect(first).toContain('dy: 0pt,\n    block(width: 100%, height: (210mm - 15mm - 15mm) / 2')
        expect(second).toContain(
            'dy: (210mm - 15mm - 15mm) / 2,\n    block(width: 100%, height: (210mm - 15mm - 15mm) / 2')
    })

    it('escapes a quote in an image filename rather than breaking out of the string', () => {
        const out = gen(make_story({slides: [image_slide('evil".jpg', null)]}))
        expect(out).toContain('image("evil\\".jpg"')
    })
})


describe('image styles', () => {

    it('crops a padded image inside the margins', () => {
        const out = gen(make_story({slides: [image_slide('p.jpg', null)]}), 'single', false,
            'padded')
        expect(out).toContain('fit: "cover"')
        expect(out).not.toContain('dx: -15mm')
    })

    it('contains a pre-masked painted image so its irregular edge survives', () => {
        const out = gen(make_story({slides: [image_slide('p.jpg', null)]}), 'single', false,
            'painted')
        expect(out).toContain('fit: "contain"')
    })

    it('contains a torn image too', () => {
        const out = gen(make_story({slides: [image_slide('p.jpg', null)]}), 'single', false,
            'torn')
        expect(out).toContain('fit: "contain"')
    })

    it('bleeds a borderless image past the margins to the page edge', () => {
        const out = gen(make_story({slides: [image_slide('p.jpg', null)]}), 'single', false,
            'borderless')
        expect(out).toContain('dx: -15mm')
        expect(out).toContain('dy: -15mm')
        expect(out).toContain('width: 148mm')
        expect(out).toContain('height: 210mm')
    })

    it('bleeds only the bottom half for an alternated borderless image', () => {
        const out = gen(make_story({slides: [image_slide('a.jpg'), image_slide('b.jpg')]}),
            'single', true, 'borderless')
        const second = out.split('#pagebreak()')[1]!
        expect(second).toContain('#place(bottom + left, dx: -15mm')
    })
})


describe('grid layout', () => {

    it('packs four slides onto one page', () => {
        const slides = Array.from({length: 4}, (_, i) => image_slide(`${i}.jpg`))
        expect(page_count(gen(make_story({slides}), 'grid'))).toBe(1)
    })

    it('starts a new page on the fifth slide', () => {
        const slides = Array.from({length: 5}, (_, i) => image_slide(`${i}.jpg`))
        expect(page_count(gen(make_story({slides}), 'grid'))).toBe(2)
    })

    it('starts a third page on the ninth slide', () => {
        const slides = Array.from({length: 9}, (_, i) => image_slide(`${i}.jpg`))
        expect(page_count(gen(make_story({slides}), 'grid'))).toBe(3)
    })

    it('offsets each row by one cell height', () => {
        const slides = Array.from({length: 4}, (_, i) => image_slide(`${i}.jpg`))
        const out = gen(make_story({slides}), 'grid')
        for (const row of [0, 1, 2, 3]){
            expect(out).toContain(`dy: (((210mm - 15mm - 15mm) / 4)) * ${row}`)
        }
    })

    it('always puts the image on the left when not alternating', () => {
        const slides = Array.from({length: 2}, (_, i) => image_slide(`${i}.jpg`))
        const out = gen(make_story({slides}), 'grid', false)
        // Both images placed at dx 0 (the left cell), each followed by its image block
        const image_places = [...out.matchAll(
            /#place\(top \+ left, dx: (.+?), dy: .+?\n {4}block\(.+?\n {8}image\("(\d)\.jpg"/g)]
        expect(image_places.map(match => match[1])).toEqual(['0pt', '0pt'])
        expect(image_places.map(match => match[2])).toEqual(['0', '1'])
    })

    it('alternates the image side across page boundaries, not per page', () => {
        // Slide 4 is the first of page two and the fifth overall, so it keeps the global
        // even/odd sequence rather than restarting on the left
        const slides = Array.from({length: 5}, (_, i) => image_slide(`${i}.jpg`))
        const out = gen(make_story({slides}), 'grid', true)
        const second_page = out.split('#pagebreak()')[1]!
        expect(second_page).toContain('image("4.jpg"')
        expect(second_page).toContain('dx: 0pt')
    })

    it('spans the full row width for an image-only slide', () => {
        const out = gen(make_story({slides: [image_slide('solo.jpg', null)]}), 'grid')
        expect(out).toContain('(148mm) - (15mm) - (15mm)')
    })

    it('emits nothing for a row with neither image nor body', () => {
        const out = gen(make_story({slides: [make_slide({body: null})]}), 'grid')
        expect(out).not.toContain('#place(')
    })

    it('insets the text away from the image it sits beside', () => {
        const out = gen(make_story({slides: [image_slide('a.jpg', 'Body')]}), 'grid')
        expect(out).toContain('inset: (left: 15mm)')
    })
})


describe('body fitting', () => {

    it('binary-searches a size within the configured bounds', () => {
        const out = gen(make_story({slides: [image_slide('a.jpg', 'Body')]}))
        // Floor is font_size * FIT_MIN_SIZE_RATIO, ceiling font_size * FIT_MAX_SIZE_RATIO
        expect(out).toContain('let lo = 3.5pt')
        expect(out).toContain('let hi = 30pt')
    })

    it('shares one state key across every slide, so they all render at one size', () => {
        const slides = [image_slide('a.jpg', 'Short'), image_slide('b.jpg', 'Much longer body')]
        const out = gen(make_story({slides}))
        const keys = [...out.matchAll(/state\("(story-fit-[^"]+)"/g)].map(m => m[1])
        expect(keys).toHaveLength(2)
        expect(new Set(keys).size).toBe(1)
    })

    it('gives each story its own key so two stories never share a size', () => {
        const key_of = (source:string) => source.match(/state\("(story-fit-[^"]+)"/)![1]
        expect(key_of(gen(make_story({slides: [image_slide('a.jpg')]}))))
            .not.toBe(key_of(gen(make_story({slides: [image_slide('a.jpg')]}))))
    })

    it('renders at the story-wide minimum, not each slide\'s own fit', () => {
        const out = gen(make_story({slides: [image_slide('a.jpg', 'Body')]}))
        expect(out).toContain('story_size.update(old => calc.min(old, lo))')
        expect(out).toContain('render(story_size.final())')
    })

    it('targets a bigger fill fraction in a cramped grid cell than a half page', () => {
        const single = gen(make_story({slides: [image_slide('a.jpg', 'Body')]}), 'single')
        const grid = gen(make_story({slides: [image_slide('a.jpg', 'Body')]}), 'grid')
        expect(single).toContain(') * 0.5')
        expect(grid).toContain(') * 0.8')
    })

    it('stacks a second translation below the first and scales it by the size ratio', () => {
        const story = make_story({slides: [image_slide('a.jpg', 'First')]})
        story.slides[0]!.body2 = 'Second'
        const out = gen_picture_story(story, TEST_PAGE, 'padded', 'single', false, 1.5, '10pt',
            'Noto Serif', '12pt', ['serif'], 'es')
        expect(out).toContain('First')
        expect(out).toContain('Second')
        expect(out).toContain('size: size * 1.2')
        expect(out).toContain('lang: "es"')
    })

    it('omits the second-translation scope when the slide has only one body', () => {
        const out = gen(make_story({slides: [image_slide('a.jpg', 'Only')]}))
        expect(out).toContain('let body2_content = none')
    })

    it('applies the document line height as a multiple of the fitted size', () => {
        const out = gen(make_story({slides: [image_slide('a.jpg', 'Body')]}))
        expect(out).toContain('leading: 1.5em')
    })

    it('stacks both bodies at fixed size on a body-only slide', () => {
        const story = make_story({slides: [make_slide({body: 'First', body2: 'Second'})]})
        const out = gen(story)
        expect(out).toContain('First')
        expect(out).toContain('Second')
        // The body-only path centres rather than fit-searching
        expect(out).not.toContain('let lo = ')
    })
})
