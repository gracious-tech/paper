
import type {
    TypstRequest, PageConfig, TypographyConfig, TitlepageConfig, FeatureConfig,
    TypstPassage, TypstTitlePage, TypstCustomPage, TypstLinesPage, TypstPictureStory,
    TypstPictureStorySlide, Blueprint,
} from '../src/types.js'


// Reusable test page config
export const TEST_PAGE:PageConfig = {
    width: '148mm',
    height: '210mm',
    margin_top: '15mm',
    margin_bottom: '15mm',
    margin_left: '15mm',
    margin_right: '15mm',
}


// Reusable test typography config
export const TEST_TYPOGRAPHY:TypographyConfig = {
    font_text: 'Crimson Pro',
    font_text2: 'Crimson Pro',
    font_headings: 'Crimson Pro',
    font_headings2: 'Crimson Pro',
    font_fallbacks: ['Georgia', 'serif'],
    font_fallbacks2: ['Georgia', 'serif'],
    font_size: '10pt',
    font_size2: '10pt',
    footnote_size: '8.5pt',
    lang: 'en',
    lang2: null,
    line_height: 1.75,
    line_height2: 1,
    justify: true,
    hyphenate: true,
    poetry_outdent: true,
    text_color: null,
}


// Reusable test title-page style config
export const TEST_TITLEPAGE:TitlepageConfig = {
    font: 'Dancing Script',
    frame_svg: null,
    color_text: '#333333',
    color_frame: '#666666',
    text_size: 1,
    icon_size: 1,
    always: null,
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
        multi_align: 'paragraph',
        half_blank: null,
        show_headings: true,
        headings_bold: true,
        headings_italic: true,
        headings_size: 0.9,
        show_footnotes: true,
        show_lines: false,
        columns: 1,
        column_gap: '5mm',
        book: 'gen',
        book_name: 'Genesis',
        start_chapter: 1,
        passage_title: null,
        passage_subtitle: null,
        progress_label: 'Genesis 1:1',
        image: null,
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


// Minimal picture-story slide for testing
export function make_slide(overrides:Partial<TypstPictureStorySlide> = {}):TypstPictureStorySlide {
    return {
        image: null,
        body: 'Once there was a garden.',
        body2: null,
        ...overrides,
    }
}


// Minimal picture story for testing
export function make_story(overrides:Partial<TypstPictureStory> = {}):TypstPictureStory {
    return {
        type: 'picture_story',
        slides: [make_slide()],
        ...overrides,
    }
}


// A complete, valid Blueprint — the same shape get_default_blueprint() builds in the app, with a
// fixed bible id in place of the one it resolves from the live Bible collection. Kept here rather
// than imported because this package deliberately has no default of its own: callers supply one
// (see make_blueprint_schema), and a test needs a known-good starting point to mutate
export function make_blueprint(overrides:Partial<Blueprint> = {}):Blueprint {
    return {
        name: '',
        cover: null,

        // Printing
        service_id: 'home',
        size_id: 'a4',
        binding_type: 'paperback',
        ink_type: 'bw',
        paper_type: 'white',
        custom_unit: 'mm',
        custom_trim_width: 152,
        custom_trim_height: 229,
        custom_bleed: 3,
        custom_spine: 10,
        booklet: true,
        booklet_portrait: false,

        // Content
        content: [],
        last_item_at_end: false,
        bibles: ['eng_bsb'],
        bibles_layout: 'columns',
        bibles_align: 'paragraph',

        // Features
        show_headings: true,
        show_headings_bold: true,
        show_headings_italic: false,
        show_headings_size: 0.9,
        show_chapters: true,
        show_chapters_style: 'divider',
        show_verses: true,
        running_pages: true,
        running_headings: true,
        running_position: 'header',
        running_align: 'outer',
        show_footnotes: true,
        show_wj: false,
        show_wj_color: '#cc0000',
        show_wj_bold: false,
        show_wj_italic: false,
        show_lines: true,
        notes: null,
        half_blank: null,
        passage_title: 'heading',

        // Style
        font_text: 'Source Serif 4',
        font_text2: null,
        font_headings: null,
        font_size: 10,
        font_size2: 1,
        footnote_size: 0.85,
        line_height: 1.35,
        line_height2: 1,
        justify: null,
        hyphenate: true,
        poetry_outdent: true,
        text_color: null,
        columns: null,
        story_emphasis: true,
        story_emphasis_color: '#4862ad',
        story_layout: 'single',
        story_alternate: false,

        // Title pages
        titlepage_frame: 'subtle',
        titlepage_color_text: null,
        titlepage_color_icon: null,
        titlepage_color_frame: null,
        titlepage_font: null,
        titlepage_text_size: 1,
        titlepage_icon_size: 1,
        titlepage_always: 'right',

        // Images
        image_style: 'padded',

        // Spacing
        margin_unit: 'mm',
        margin_top: 20,
        margin_bottom: 20,
        margin_inner: 15,
        margin_outer: 15,
        margin_gutter_auto: true,
        column_gap: 6,

        // Legal
        public_domain: true,
        app_link: true,
        design_link: true,

        ...overrides,
    }
}


// Minimal request for testing
export function make_request(overrides:Partial<TypstRequest> = {}):TypstRequest {
    return {
        title: 'Test Bible',
        page: TEST_PAGE,
        typography: TEST_TYPOGRAPHY,
        titlepage: TEST_TITLEPAGE,
        features: TEST_FEATURES,
        content: [make_passage()],
        max_chapter: 1,
        arrangement: 'normal',
        last_item_at_end: false,
        running_pages: true,
        running_headings: false,
        running_position: 'footer',
        running_align: 'center',
        booklet_portrait: false,
        image_style: 'padded',
        story_layout: 'single',
        story_alternate: false,
        assets: {},
        ...overrides,
    }
}
