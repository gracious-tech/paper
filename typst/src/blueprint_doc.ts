
import {migrate_blueprint_doc} from './migrate.js'

import type {Blueprint, ContentItem, CoverConfig} from './types.js'


// The cover widget's form key holding the first front-cover title line — the one a design's
// name is written into when the cover title follows it
export const COVER_TITLE_KEY = 'title1'


// All three front-cover title lines, in order. The widget lays them out as separate lines so
// each can carry its own font/size/colour, but together they read as one title
const COVER_TITLE_KEYS = [COVER_TITLE_KEY, 'title2', 'title3']


// The cover's full printed title: its title lines joined by spaces, matching how bookcover
// itself builds the spine title from the same three fields (default_spine_title). '' when there
// is no cover or no title. The form is an opaque widget snapshot (Record<string, unknown>), so
// every read is defensive
export function get_cover_title_from_form(form:Record<string, unknown>):string{
    return COVER_TITLE_KEYS
        .map(key => typeof form[key] === 'string' ? (form[key] as string) : '')
        .filter(line => line)
        .join(' ')
        .trim()
        .replace(/ +/g, ' ')
}


export function get_cover_title(cover:CoverConfig|null|undefined):string{
    // The cover's full printed title (see get_cover_title_from_form), or '' when there's no cover
    return cover ? get_cover_title_from_form(cover.form) : ''
}


// The name to display for a design, resolved from the three places a name can come from, in
// priority order. Deliberately takes plain strings rather than a doc or a Blueprint: both the
// client and the server resolve names, and neither should need the Bible collection loaded to
// do it (name_auto is derived once, where the collection already is, and cached on the design)
export function resolve_design_name(name:string, cover_title:string, name_auto:string):string{
    return name.trim() || cover_title.trim() || name_auto.trim()
}


// The Firestore fields a Blueprint is split into. Content items are keyed by id (+ a separate
// order array) so different editors' item edits never clobber each other, and only whole scalar
// options collide (last write wins). `name` is split out for a different reason: it's what the
// design is *called*, not part of how it renders, so it belongs beside the doc's other
// identity fields (name_auto, category) rather than among the layout options
export interface BlueprintDocFields {
    blueprint:Record<string, unknown>
    content_items:Record<string, ContentItem>
    content_order:string[]
    name:string
}


// Split a blueprint into the three Firestore fields that represent it. Pure reshaping, no
// validation or cloning — callers on both sides own those concerns (the client validates
// against untrusted co-editor data via clean_blueprint(); the server copies already-validated
// data verbatim)
export function split_blueprint_doc(blueprint:Blueprint):BlueprintDocFields{
    // `content` defaults to [] — callers pass frozen version blueprints straight from Firestore
    // (e.g. handle_copy_version), which the security rules only require to be a map, not a
    // fully-shaped Blueprint, so a missing/malformed content array must degrade gracefully
    // rather than throw
    const {content, name, ...options} = blueprint
    const content_list = Array.isArray(content) ? content : []
    return {
        blueprint: options,
        content_items: Object.fromEntries(content_list.map(item => [item.id, item])),
        content_order: content_list.map(item => item.id),
        name: typeof name === 'string' ? name : '',
    }
}


// Reassemble a blueprint from its Firestore fields (the inverse of split_blueprint_doc), bringing
// it up to the current schema on the way out.
//
// `schema` is the doc's own `schema` field (docs predating it are 1) and is deliberately required
// rather than defaulted: every caller reads a stored doc, and a new one that forgot to pass it
// would silently skip migrations — the exact data loss the chain exists to prevent. Migration
// runs on the joined shape, after content items are back in place, so a step can reach inside
// them; validation is the caller's own concern and comes after (see clean_blueprint)
export function join_blueprint_doc(fields:{blueprint:Record<string, unknown>,
        content_items:Record<string, ContentItem>, content_order:string[],
        name:string, schema:number}):Blueprint{
    const content = fields.content_order.map(id => fields.content_items[id]).filter(
        (item):item is ContentItem => item !== undefined)
    const joined = {...fields.blueprint, content, name: fields.name}
    migrate_blueprint_doc(joined, fields.schema)
    return joined as Blueprint
}
