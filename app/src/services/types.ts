
// The Blueprint (user-selected options) and content-item types live in the core typst package
// so the same options can drive both the in-browser and server pipelines. Re-exported here so
// existing `@/services/types` imports keep working.
export type {Blueprint, ContentItem, ContentTitle, ContentPassage, ContentCustom,
    } from 'paper-bible-typst'

import type {Blueprint} from 'paper-bible-typst'


// A generated document, tracked in the app's local history (app-only concept)
export interface Creation {
    request_id:string
    created:Date
    blueprint:Blueprint
    status:'pending'|'failed'|'available'
    pages:number|null
    pdf_url:string|null
}
