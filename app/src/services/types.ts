
// The Blueprint (user-selected options) and content-item types live in the core typst package
// so the same options can drive both the in-browser and server pipelines. Re-exported here so
// existing `@/services/types` imports keep working.
export type {Blueprint, CoverConfig, ContentItem, ContentTitle, ContentPassage,
    ContentPassageImage, ContentCustom, ContentPictureStory,
    PictureStorySlide, ImageStyle} from 'paper-bible-typst'

import type {Blueprint} from 'paper-bible-typst'


// Summary of a design for the designs list (the open design's content lives in `blue`)
export interface DesignMeta {
    id:string
    name:string
    owner:string
    shared:boolean
    editor_count:number
    share_token:string|null
    save_token:string
    created:Date
    modified:Date
    category:string|null
    // Abbreviated, comma-joined preview of the design's content items (e.g. "Gen 1-3, Psalm 23"),
    // for a subtitle on the list row — empty string if the design has no content yet
    content_summary:string
    // Denormalized summary of the design's newest version (null before any version exists),
    // kept in sync by every compile path — see versions.ts/compile.ts/share.ts
    latest_version:{status:'pending'|'available'|'failed', pages:number|null, save_token:string}|null
    // Scalar blueprint fields needed for the list's stat chips — a raw slice of the doc's
    // `blueprint`, not the fully reassembled Blueprint (no need for join_blueprint_doc()/
    // clean_blueprint() just to read a few display fields)
    paper:{service_id:string, size_id:string, custom_unit:'mm'|'inch', custom_trim_width:number,
        custom_trim_height:number, booklet:boolean, bibles:string[]}
}


// An immutable rendered snapshot, nested under the design it came from
export interface Version {
    id:string
    design_id:string
    owner:string
    created:Date
    compile_started:Date|null  // Start of the latest compile attempt (stuck-pending detection)
    title:string
    blueprint:Blueprint
    status:'pending'|'failed'|'available'
    // Cover render outcome, tracked separately from `status` so an interior that compiled fine
    // still publishes when only the wraparound cover failed. null = no cover configured, or a
    // version created before cover failures were survivable (its cover, if any, succeeded)
    cover_status:'available'|'failed'|null
    pages:number|null
    pdf_path:string
    pdf_expires:Date|null  // null until first generated
    copied_from:string|null  // Source version id if this is a kept copy
    custom_fonts:{family:string, style:'serif'|'sans', files:string[]}[]  // Snapshot paths
    save_token:string  // Copied from the parent design's save_token at freeze time
    error:string|null
    error_id:string|null  // Id of the saved error report (for support links)
}


// A design the user viewed via a public version link but can't edit ("Read access" on /designs)
export interface ViewedDesign {
    design_id:string
    title:string
    last_version_id:string
    last_viewed:Date
}


// An owner/editor entry in a design's share dialog (resolved server-side via Admin Auth, since
// other users' auth profiles aren't client-readable)
export interface DesignEditorInfo {
    uid:string
    owner:boolean
    name:string|null
    email:string|null
}
