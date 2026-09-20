
// Storage paths for a design's uploaded assets, shared so the app and the server can never
// disagree about where anything lives.
//
// Everything a user uploads belongs to a design rather than to an account, because the design
// is the only scope in which "is anything still referencing this?" has an answer — which is
// what makes deleting an asset possible at all. Three prefixes, all keyed by design id:
//
//   design_assets/{design_id}/   what the live design references. Mutable set: the server
//                                sweeps whatever the design doc stops naming
//   version_assets/{design_id}/  frozen snapshots, shared by every version of the design.
//                                Append-only, so editing the design can never change or
//                                remove the bytes an already-rendered version depends on
//   design_cache/{design_id}/    derived painted/torn variants — regenerable, so a lifecycle
//                                rule sweeps them by age and nothing tracks them
//
// Basenames are content-addressed (sha256 of the bytes + extension), which does two jobs: a
// path can never change meaning, so a frozen reference stays valid without being immutable at
// the storage layer; and the *same* basename identifies an asset in all three prefixes. That
// second property is what reduces freezing to a prefix swap plus an existence check, with no
// bytes moved when a design is re-rendered unchanged.

import type {FontStyle} from 'typst-fonts'


export const DESIGN_ASSETS = 'design_assets'
export const VERSION_ASSETS = 'version_assets'
export const DESIGN_CACHE = 'design_cache'


// Metadata for one persisted custom font family. Stored per design (as a map on the design
// doc) and per version (as an array on the version doc) — two lifecycles, one shape
export interface StoredFontMeta {
    family:string
    style:FontStyle
    files:string[]  // Storage object paths
}


export function design_assets_prefix(design_id:string):string {
    // Where the live design's uploads live
    return `${DESIGN_ASSETS}/${design_id}/`
}


export function version_assets_prefix(design_id:string):string {
    // Where the design's frozen snapshots live — shared by all of its versions
    return `${VERSION_ASSETS}/${design_id}/`
}


export function design_cache_prefix(design_id:string):string {
    // Where the design's regenerable derived images live
    return `${DESIGN_CACHE}/${design_id}/`
}


export function asset_basename(path:string):string {
    // The content-addressed filename an asset path ends in — the part that's identical across
    // all three prefixes, and the only part of a client-supplied path that's ever trusted
    return path.slice(path.lastIndexOf('/') + 1)
}


export function to_version_asset(path:string, design_id:string):string {
    // The frozen counterpart of a live design asset. Takes only the basename, so a path
    // pointing anywhere unexpected still resolves inside this design's own prefix rather than
    // reaching somewhere it shouldn't
    return version_assets_prefix(design_id) + asset_basename(path)
}


export function to_design_asset(path:string, design_id:string):string {
    // The live counterpart of a frozen asset — the inverse of to_version_asset(), for turning
    // a version back into an editable design
    return design_assets_prefix(design_id) + asset_basename(path)
}
