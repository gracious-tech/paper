
import type {Blueprint, ContentItem} from './types.js'


// The three Firestore fields a Blueprint is split into for concurrent-editor-safe storage —
// content items keyed by id (+ a separate order array) so different editors' item edits never
// clobber each other, only whole scalar options collide (last write wins)
export interface BlueprintDocFields {
    blueprint:Record<string, unknown>
    content_items:Record<string, ContentItem>
    content_order:string[]
}


// Split a blueprint into the three Firestore fields that represent it. Pure reshaping, no
// validation or cloning — callers on both sides own those concerns (the client validates
// against untrusted co-editor data via clean_blueprint(); the server copies already-validated
// data verbatim)
export function split_blueprint_doc(blueprint:Blueprint):BlueprintDocFields{
    const {content, ...options} = blueprint
    return {
        blueprint: options,
        content_items: Object.fromEntries(content.map(item => [item.id, item])),
        content_order: content.map(item => item.id),
    }
}


// Reassemble a blueprint from its three Firestore fields (the inverse of split_blueprint_doc)
export function join_blueprint_doc(fields:{blueprint:Record<string, unknown>,
        content_items:Record<string, ContentItem>, content_order:string[]}):Blueprint{
    const content = fields.content_order.map(id => fields.content_items[id]).filter(
        (item):item is ContentItem => item !== undefined)
    return {...fields.blueprint, content} as Blueprint
}
