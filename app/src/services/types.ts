
// The Blueprint (user-selected options) and content-item types live in the core typst package
// so the same options can drive both the in-browser and server pipelines. Re-exported here so
// existing `@/services/types` imports keep working.
export type {Blueprint, ContentItem, ContentTitle, ContentPassage, ContentCustom,
    } from 'paper-bible-typst'

import type {Blueprint} from 'paper-bible-typst'


// Summary of a draft for the drafts list (the open draft's content lives in `blue`)
export interface DraftMeta {
    id:string
    name:string
    owner:string
    shared:boolean
    editor_count:number
    share_token:string|null
    created:Date
    modified:Date
}


// An immutable generated document — metadata lives in Firestore forever, the PDF in Storage
// for 1 year (regenerable from the frozen blueprint after expiry)
export interface Creation {
    id:string
    owner:string
    created:Date
    title:string
    blueprint:Blueprint
    status:'pending'|'failed'|'available'
    pages:number|null
    pdf_path:string
    pdf_expires:Date|null  // null until first generated
    copied_from:string|null  // Source creation id if this is a kept copy
    custom_fonts:{family:string, style:'serif'|'sans', files:string[]}[]  // Snapshot paths
    error:string|null
    error_id:string|null  // Id of the saved error report (for support links)
}
