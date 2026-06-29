
// Build the document's copyright / attribution statement as Typst markup. The licensing
// conditions are computed from the selected translations (+ study notes + the creator's own
// material), then rendered into a small footer-style block.

import {escape_typst} from './helpers.js'

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
    // 'forbidden' = needs permission, 'free' = no restrictions, 'conditional' = with conditions
    mode:'forbidden'|'free'|'conditional'
    conditions:string[]             // Human-readable phrases (only for 'conditional' mode)
    resources:CopyrightResource[]   // Attribution rows
    app_link:boolean                // Whether to add the "Created with paper.bible" line
}


// Intro sentence for each copyright mode
const MODE_INTRO:Record<CopyrightData['mode'], string> = {
    forbidden: "This resource cannot be copied without permission.",
    free: "This resource can be copied and shared without restriction.",
    conditional: "This resource can be copied and shared as long as:",
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
        conditions.push(meta.licenses[0]!.restrictions)
        resource_rows.push({
            text: `${meta.name_local || meta.name_english} — ${meta.attribution}`,
            license: meta.licenses[0]!.name,
            url: meta.licenses[0]!.url,
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
            url: 'https://creativecommons.org/licenses/by-sa/4.0/',
        })
    }

    // Conditions + attribution for the creator's own material: either dedicated to the public
    // domain (no restrictions) or all-rights-reserved (copying requires permission)
    const custom:RuntimeLicense['restrictions'] = {
        forbid_attributionless: !blue.public_domain,
        forbid_commercial: !blue.public_domain,
        forbid_derivatives: !blue.public_domain,
        forbid_limitless: !blue.public_domain,
        forbid_other: !blue.public_domain,
    }
    conditions.push(custom)
    resource_rows.push({
        text: "All other material",
        license: blue.public_domain ? "Public Domain" : "permission required",
        url: blue.public_domain ? 'https://freely.giving/free' : '',
    })

    // Work out what permissions remain across all resources
    const forbid_other = conditions.some(c => c.forbid_other)
    const forbid_attributionless = conditions.some(c => c.forbid_attributionless)
    const forbid_commercial = conditions.some(c => c.forbid_commercial)
    let forbid_derivatives:boolean|'same-license'
        = conditions.some(c => c.forbid_derivatives === true)
    if (!forbid_derivatives && conditions.some(c => c.forbid_derivatives === 'same-license')) {
        forbid_derivatives = 'same-license'
    }

    // Reduce to a display mode and list of conditions
    let mode:CopyrightData['mode']
    const display_conditions:string[] = []
    if (forbid_other) {
        mode = 'forbidden'
    } else if (!forbid_attributionless && !forbid_commercial && !forbid_derivatives) {
        mode = 'free'
    } else {
        mode = 'conditional'
        if (forbid_attributionless) {
            display_conditions.push("Attribution is given (as below)")
        }
        if (forbid_commercial) {
            display_conditions.push("This is not used for commercial purposes")
        }
        if (forbid_derivatives === true) {
            display_conditions.push("This is not modified")
        } else if (forbid_derivatives === 'same-license') {
            display_conditions.push("Modifications use the same license")
        }
    }

    return {mode, conditions: display_conditions, resources: resource_rows, app_link: blue.app_link}
}


// Generate the copyright statement as Typst markup
export function gen_copyright_typst(
    blue:Blueprint, resources:Record<string, GetResourcesItem>,
):string {
    const data = compute_copyright(blue, resources)

    // Build paragraphs/lists, separated by blank lines
    const parts:string[] = []
    parts.push(escape_typst(MODE_INTRO[data.mode]))
    if (data.mode === 'conditional') {
        parts.push(data.conditions.map(c => `- ${escape_typst(c)}`).join('\n'))
    }
    parts.push(escape_typst("Resources used:"))
    parts.push(data.resources
        .map(r => `- ${escape_typst(r.text)} (${escape_typst(r.license)})`
            + ` #linebreak() ${escape_typst(r.url)}`)
        .join('\n'))
    if (data.app_link) {
        parts.push('Created with #link("https://paper.bible")[paper.bible]')
    }

    // Render in a smaller font so it fits as a footer-style block
    const body = parts.filter(Boolean).join('\n\n')
    return `#block[\n#set text(size: 8pt)\n\n${body}\n]`
}
