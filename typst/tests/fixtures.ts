
import type {
    TypstRequest, PageConfig, TypographyConfig,
    TypstPassage, TypstTitlePage, TypstCustomPage, TypstLinesPage,
} from '../src/types.js'


// Reusable test page config
export const TEST_PAGE:PageConfig = {
    width: '148mm',
    height: '210mm',
    margin_top: '15mm',
    margin_bottom: '15mm',
    margin_left: '15mm',
    margin_right: '15mm',
    margin_swap: false,
}


// Reusable test typography config
export const TEST_TYPOGRAPHY:TypographyConfig = {
    font_family: 'Crimson Pro',
    font_fallbacks: ['Georgia', 'serif'],
    font_size: '10pt',
    line_height: 1.75,
    justify: true,
}


// Minimal passage for testing
export function make_passage(overrides:Partial<TypstPassage> = {}):TypstPassage {
    return {
        type: 'passage',
        bibles: [{content: '#v(1)In the beginning God created the heavens and the earth.'}],
        multi_layout: 'columns',
        half_blank: null,
        show_headings: true,
        show_chapters: true,
        show_chapters_style: 'divider',
        show_verses: true,
        show_footnotes: true,
        show_footnote_calls: true,
        show_woj: false,
        show_lines: false,
        columns: 1,
        column_gap: '5mm',
        book: 'gen',
        passage_title: null,
        alone: false,
        ...overrides,
    }
}


// Minimal title page for testing
export function make_title(overrides:Partial<TypstTitlePage> = {}):TypstTitlePage {
    return {
        type: 'title',
        title: 'Holy Bible',
        subtitle: 'New International Version',
        icon: null,
        pattern_svg: null,
        color_primary: '#333333',
        color_secondary: '#666666',
        alone: true,
        ...overrides,
    }
}


// Minimal custom page for testing
export function make_custom(overrides:Partial<TypstCustomPage> = {}):TypstCustomPage {
    return {
        type: 'custom',
        content: 'Copyright 2024. All rights reserved.',
        position: 'bottom',
        ...overrides,
    }
}


// Minimal lines page for testing
export function make_lines(overrides:Partial<TypstLinesPage> = {}):TypstLinesPage {
    return {
        type: 'lines',
        spacing: '10mm',
        ...overrides,
    }
}


// Minimal request for testing
export function make_request(overrides:Partial<TypstRequest> = {}):TypstRequest {
    return {
        title: 'Test Bible',
        page: TEST_PAGE,
        typography: TEST_TYPOGRAPHY,
        content: [make_passage()],
        arrangement: 'normal',
        show_pages: true,
        ...overrides,
    }
}
