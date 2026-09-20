
// The Blueprint (user-selected options) and content-item types live in the core typst package
// so the same options can drive both the in-browser and server pipelines. Re-exported here so
// existing `@/services/types` imports keep working.
export type {Blueprint, CoverConfig, ContentItem, ContentTitle, ContentPassage,
    ContentPassageImage, ContentImageRef, ContentCustom, ContentPictureStory,
    PictureStorySlide, ImageStyle, MeasureUnit} from 'paper-bible-typst'

import type {Blueprint, MeasureUnit, StoredFontMeta} from 'paper-bible-typst'

import type {WizardState} from '@/services/new_design'


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
    paper:{service_id:string, size_id:string, custom_unit:MeasureUnit, custom_trim_width:number,
        custom_trim_height:number, booklet:boolean, bibles:string[]}
    // The uploads this design owns that another design can offer for reuse (see
    // asset_suggestions.ts — passage images deliberately aren't among them). Derived from the
    // same doc the row is built from, so it costs no extra reads and can't drift from what the
    // design actually holds. `cover_bg` is null unless the cover uses an upload — a builtin is
    // a reference to a publicly-hosted image, and has no bytes of this design's own
    assets:{fonts:StoredFontMeta[], cover_bg:{path:string, hash:string}|null}
}


// An immutable rendered snapshot of a design. Carries the design's wizard state frozen at the
// same moment as the blueprint (WizardState's own fields, under the same names the design doc
// uses), so copying this version into a new design is a straight passthrough and restores a
// simple design as simple — reading the parent design's live state instead could describe
// edits made after this version was frozen
export interface Version extends WizardState {
    id:string
    design_id:string
    owner:string
    created:Date
    compile_started:Date|null  // Start of the latest compile attempt (stuck-pending detection)
    title:string
    blueprint:Blueprint
    status:'pending'|'failed'|'available'
    // Cover render outcome, tracked separately from `status` so an interior that compiled fine
    // still publishes when only the wraparound cover failed. null = no cover configured
    cover_status:'available'|'failed'|null
    // bookcover's RENDER_VERSION at freeze time (null = no cover). A regeneration under a
    // different value is a cover that may not match the PDF the user originally got
    cover_render_version:number|null
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
