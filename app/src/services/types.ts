
export interface Creation {
    request_id:string
    creation_id:string|null
    created:Date
    blueprint:Blueprint
    status:'pending'|'failed'|'available'|'expired'
    pages:number|null
}


export interface Blueprint {

    // Title used in PDF meta and download file name
    title:string

    // Printing
    paper_unit:'mm'|'in'
    paper_width:number
    paper_height:number
    page_arrangement:'normal'|'booklet'

    // Content
    content:ContentItem[]
    bibles:[string, ...string[]]
    bibles_layout:'alternate'|'columns'

    // Features
    show_headings:boolean
    show_chapters:boolean
    show_chapters_style:'divider'|'float'|'heading'
    show_verses:boolean
    show_footnotes:boolean
    show_woj:boolean
    show_lines:boolean
    notes:string|null
    crossref:'small'|'medium'|'large'|null
    half_blank:boolean

    // Style
    font_family:string
    font_size:number
    line_height:number
    justify:null|boolean
    columns:null|boolean

    // Spacing
    margin_unit:'mm'|'in'
    margin_top:number
    margin_bottom:number
    margin_left:number
    margin_right:number
    margin_swap:boolean
    column_gap:number

    // Legal
    license:'public'|'cc-by'|'cc-by-sa'|'cc-by-nc'|'cc-by-nc-sa'|'custom'
    license_attribution:string
    app_link:boolean
}


export type ContentItem = ContentTitle|ContentPassage|ContentCustom


export interface ContentTitle {
    type:'title'
    id:string
    title:string
    subtitle:string
    icon:string
    pattern:string
    color_primary:string
    color_secondary:string
    alone:boolean  // Ensure appears on own page with blank rear (and also not on rear of previous)
}


export interface ContentPassage {
    type:'passage'
    id:string
    book:string
    chapter_start:number|null
    chapter_end:number|null
    verse_start:number|null
    verse_end:number|null
    title:boolean
}


export interface ContentCustom {
    type:'custom'
    id:string
    name:string
    html:string
    position:'top'|'middle'|'bottom'
}


export interface PaperRequest {
    request_id:string
    title:string
    booklet:boolean
    blank_job:string
    subjobs:[string, string|null, boolean][]
    blue:string  // JSON
}
