
import type {
    TypstRequest, PageConfig, TypographyConfig, FeatureConfig,
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


// Reusable test feature config (document-wide chapter/verse/wj markers)
export const TEST_FEATURES:FeatureConfig = {
    show_chapters: true,
    show_chapters_style: 'divider',
    show_verses: true,
    show_wj: false,
    show_wj_color: '#cc0000',
    show_wj_bold: false,
    show_wj_italic: false,
}


// Minimal passage for testing
export function make_passage(overrides:Partial<TypstPassage> = {}):TypstPassage {
    return {
        type: 'passage',
        bibles: [{content: '#vn(1)In the beginning God created the heavens and the earth.'}],
        multi_layout: 'columns',
        half_blank: null,
        show_headings: true,
        show_footnotes: true,
        show_lines: false,
        columns: 1,
        column_gap: '5mm',
        book: 'gen',
        passage_title: null,
        alone: false,
        new_page: true,
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
        icon_size: 1,
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
        new_page: true,
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
        features: TEST_FEATURES,
        content: [make_passage()],
        arrangement: 'normal',
        show_pages: true,
        booklet_portrait: false,
        ...overrides,
    }
}
