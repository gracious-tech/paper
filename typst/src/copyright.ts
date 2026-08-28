
// Build the document's copyright / attribution statement as Typst markup. The licensing
// conditions are computed from the selected translations (+ study notes + the creator's own
// material), then rendered into a small footer-style block.

import {escape_typst_str} from 'typst-utils'

import {escape_typst} from './helpers.js'
import {gen_qr_typst} from './qr.js'

import type {Blueprint} from './types.js'
import type {GetResourcesItem, RuntimeLicense} from '@gracious.tech/fetch-client'


// A single attribution row in the copyright statement
interface CopyrightResource {
    text:string         // e.g. "World English Bible — Public Domain"
    license:string      // e.g. "CC BY-SA"
    url:string          // License URL
}


// Format-agnostic copyright details computed from the current blueprint
interface CopyrightData {
    // Blanket copying statement to show: 'none' = something isn't openly licensed (the creator
    // reserved rights, or a translation needs permission) so no blanket claim is made;
    // 'modify' = everything permits modification/translation (share-alike included);
    // 'share' = free to copy and share but at least one resource forbids modification outright
    statement:'none'|'modify'|'share'
    resources:CopyrightResource[]   // Attribution rows
    app_link:boolean                // Whether to add the "Created with paper.bible" line
}


// The blanket copying statement for each non-'none' outcome
const STATEMENT:Record<'modify'|'share', string> = {
    modify: "This material can be freely copied, modified, and translated.",
    share: "This material can be freely copied and shared.",
}


// Gather the licensing conditions and attributions for the current blueprint
function compute_copyright(
    blue:Blueprint, resources:Record<string, GetResourcesItem>,
):CopyrightData {

    // Collect restriction sets and attribution rows
    const conditions:RuntimeLicense['restrictions'][] = []
    const resource_rows:CopyrightResource[] = []

    // Bible translations
    for (const bible of blue.bibles) {
        const meta = resources[bible]!
        const license = meta.licenses[0]!
        conditions.push(license.restrictions)
        resource_rows.push({
            text: `${meta.name_local || meta.name_english} — ${meta.attribution}`,
            license: license.name,
            // Only show url if not creative commons or public domain
            url: license.id ? '' : license.url,
        })
    }

    // Study notes
    if (blue.notes) {
        // TODO Get from collection manifest rather than hard-code
        conditions.push({
            forbid_attributionless: true,
            forbid_commercial: false,
            forbid_derivatives: 'same-license',
            forbid_other: false,
            forbid_limitless: false,
        })
        resource_rows.push({
            text: "Study notes — Tyndale House Publishers",
            license: "CC BY-SA",
            url: '',
        })
    }

    // Conditions for the creator's own material: either dedicated to the public domain (no
    // restrictions) or all-rights-reserved (copying requires permission). Its attribution is
    // rendered as a closing line, not a list row (see gen_copyright_typst)
    const custom:RuntimeLicense['restrictions'] = {
        forbid_attributionless: !blue.public_domain,
        forbid_commercial: !blue.public_domain,
        forbid_derivatives: !blue.public_domain,
        forbid_limitless: !blue.public_domain,
        forbid_other: !blue.public_domain,
    }
    conditions.push(custom)

    // Reduce to a single blanket statement (or none). Anything that forbids "other" uses — a
    // translation needing permission, or the creator keeping rights (public_domain off) — means
    // no blanket claim is made. Otherwise the only distinction that matters is whether
    // modification (and thus translation) is allowed — share-alike still counts as modifiable,
    // only an outright no-derivatives term downgrades to 'share'.
    const forbid_other = conditions.some(c => c.forbid_other)
    const forbid_derivatives = conditions.some(c => c.forbid_derivatives === true)
    const statement:CopyrightData['statement'] =
        forbid_other ? 'none' : forbid_derivatives ? 'share' : 'modify'

    return {statement, resources: resource_rows, app_link: blue.app_link}
}


// Generate the copyright statement as Typst markup. `share_url` (when given, and when the
// blueprint opts in via design_link) is the production URL of this document's design or version
// — rendered as a link plus a QR code so a reader can open, tweak and reprint it themselves
export function gen_copyright_typst(
    blue:Blueprint, resources:Record<string, GetResourcesItem>, share_url?:string,
):string {
    const data = compute_copyright(blue, resources)

    // Build paragraphs/lists, separated by blank lines
    const parts:string[] = []
    if (data.app_link) {
        parts.push('#align(center)[#text(weight: "bold", size: 1.3em)[Created with '
            + '#link("https://paper.bible")[/paper.bible/]]]')
    }

    // Link + QR code back to this design/version so a reader can customise and reprint it —
    // sits right below the "Created with" line, above the licensing detail; a centered 2-column
    // grid with the QR on the left and the instruction + link on the right
    if (blue.design_link && share_url) {
        const qr = gen_qr_typst(share_url)
        const invite = escape_typst("Customize and print this yourself")
        const link = `#link("${escape_typst_str(share_url)}")[${escape_typst(share_url)}]`
        parts.push('#align(center, grid(\n'
            + '    columns: 2,\n'
            + '    column-gutter: 4mm,\n'
            + '    align: (center + horizon, left + horizon),\n'
            + `    ${qr},\n`
            + `    [#text(weight: "bold")[${invite}] #linebreak() ${link}],\n`
            + '))')
    }

    if (data.statement !== 'none') {
        parts.push(escape_typst(STATEMENT[data.statement]))
    }
    parts.push(escape_typst("Resources used:"))
    parts.push(data.resources
        .map(r => {
            // Surface any license URL except Creative Commons (its terms are widely known)
            const row = `- ${escape_typst(r.text)} (${escape_typst(r.license)})`
            return r.url ? `${row} #linebreak() ${escape_typst(r.url)}` : row
        })
        .join('\n'))

    // Closing line for the creator's own material
    if (blue.public_domain) {
        parts.push(escape_typst(
            "All other material is dedicated to the public domain (freely.giving/free)"))
    }

    // Attribution text — block content so the overrides stay scoped to the copyright block:
    // no first-line indent, and forced 1.5 line/paragraph spacing (leading is the whole
    // baseline-to-baseline advance here — see the leading note in preamble.ts)
    return `#[\n#set par(first-line-indent: 0em, leading: 1.5em, spacing: 1.5em)\n\n`
        + `${parts.filter(Boolean).join('\n\n')}\n]`
}
