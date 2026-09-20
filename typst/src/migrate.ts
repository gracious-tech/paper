
// Forward migration of stored Blueprints between schema versions.
//
// Docs are written with the SCHEMA_VERSION current at the time (docs predating the field are
// implicitly 1, see consts.ts) and are never rewritten to match a later one. Instead every read
// path runs the stored blueprint through the chain below, so the rest of the codebase only ever
// sees the current shape. That's what lets a Blueprint field be renamed or restructured without
// stranding the designs and versions already out there.
//
// Most changes need no entry here at all: clean_blueprint() parses against the current defaults,
// so a field added later simply arrives at its default on an older doc, and a field no longer
// declared is stripped. Only changes that would otherwise *lose* data belong below — renames,
// retypes, and anything where the old value has to be read to compute the new one. Without a
// step, those degrade silently to the default rather than failing loudly, which is exactly the
// failure this chain exists to prevent.

import {SCHEMA_VERSION} from './consts.js'

import type {Blueprint} from './types.js'


// A single step, upgrading a blueprint from version `n` to `n + 1`, mutating it in place.
// Deliberately typed against the loose record rather than Blueprint: a migration's whole job is
// to handle a shape the current Blueprint interface no longer describes
export type BlueprintMigration = (blueprint:Record<string, unknown>) => void


// The migration chain, keyed by the version each step upgrades *from*. Add a step in the same
// commit that changes the Blueprint shape, and bump SCHEMA_VERSION with it.
//
// A step must be pure, in-place, and tolerant of junk — it runs against client-written docs
// before clean_blueprint() has validated anything, so every read is a `typeof` check away from a
// crash. It also runs against *every* older doc forever, so it can never be edited afterwards,
// only followed by another step.
//
// Example, for a rename landing as schema 2:
//     1: blueprint => {
//         if (typeof blueprint['paper_width'] === 'number'){
//             blueprint['trim_width'] = blueprint['paper_width']
//         }
//         delete blueprint['paper_width']
//     },
export const MIGRATIONS:Record<number, BlueprintMigration> = {
}


export function migration_steps(from:number, to = SCHEMA_VERSION):number[]{
    // The versions to run a step for, in order, to get a doc from `from` up to `to`.
    //
    // Separate from the applying function below so the walk can be tested against arbitrary
    // target versions — while SCHEMA_VERSION is 1 there is no gap for a test to exercise through
    // migrate_blueprint_doc(), and this is precisely the logic that must still be right the first
    // time it matters.
    //
    // An unreadable or out-of-range `from` reads as 1, the oldest shape, rather than as current:
    // replaying a step against already-migrated data is a bug that shows up loudly in testing,
    // whereas silently skipping one is the quiet data loss this whole chain exists to prevent
    const start = Number.isFinite(from) ? Math.min(Math.max(1, Math.trunc(from)), to) : 1
    const steps:number[] = []
    for (let version = start; version < to; version++){
        steps.push(version)
    }
    return steps
}


export function migrate_blueprint_doc(blueprint:Record<string, unknown>, from:number):void{
    // Bring a stored blueprint up to the current schema, one step at a time, in place
    for (const version of migration_steps(from)){
        MIGRATIONS[version]?.(blueprint)
    }
}


export function migrate_version_blueprint(data:{blueprint?:unknown, schema?:unknown}):Blueprint{
    // A frozen version's blueprint, brought up to the current schema for this read only.
    //
    // Always works on a clone, and that's the whole point: a version's stored blueprint is
    // immutable by rule (firestore.rules) and by intent, so what a regeneration *renders* may be
    // upgraded while what's stored stays exactly as the user published it. Nothing returned from
    // here may be written back to the version doc it came from
    const stored = (data.blueprint ?? {}) as Record<string, unknown>
    const clone = structuredClone(stored)
    migrate_blueprint_doc(clone, typeof data.schema === 'number' ? data.schema : 1)
    // Asserted, not proven: the security rules only require a version's blueprint to be a map,
    // so this is exactly as trusted as the `data['blueprint'] as Blueprint` it replaces at every
    // call site. Callers that need it validated run clean_blueprint() over the result
    return clone as unknown as Blueprint
}
