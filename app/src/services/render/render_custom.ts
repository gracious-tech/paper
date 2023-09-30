
import {content} from '@/services/content'
import {blue, page_height, translation_forbids_derivatives} from '@/services/state'

import type {ContentCustom} from '@/services/types'
import type {MetaRestrictions} from '@gracious.tech/fetch-client/dist/esm/shared_types'


// Render a custom page content item to html
export function gen_custom_html(content:ContentCustom):string{
    let html = content.html

    // Remove anything except copyright statement if ND condition
    if (translation_forbids_derivatives.value){
        html = html.includes('AUTO-COPYRIGHT') ? '<p>AUTO-COPYRIGHT</p>' : ''
    }

    html = html.replace(/AUTO-COPYRIGHT/g, '</p>' + gen_copyright_content() + '<p>')
    return `
        <div class='custom custom-${content.position}'>
            <div>
                ${html}
            </div>
        </div>
    `
}


// Generate CSS sepecific to custom pages
export function gen_custom_css(){
    // Vertical alignment isn't possible in screen preview, so only enable when printing
    return `

        .copyright {
            font-size: 10px;
            line-height: 1.25;
        }

        .copyright p {
            text-indent: 0;
        }

        .copyright ul {
            margin: 0;
        }

        .copyright li {
            margin: 6px;
        }

        @media print {

            .page-break {
                break-after: always;
                visibility: hidden;
                margin: 0;
                border-width: 0;
            }

            .custom-middle, .custom-bottom {
                display: flex;
                min-height: ${page_height.value - blue.margin_top - blue.margin_bottom}${blue.paper_unit};
            }
            .custom-middle > div, .custom-bottom > div {
                flex-grow: 1;
            }
            .custom-middle {
                align-items: center;
            }
            .custom-bottom {
                align-items: flex-end;
            }
        }
    `
}


// Generate copyright content for auto-insertion into a custom content item
export function gen_copyright_content(){

    // Collect details
    const conditions:MetaRestrictions[] = []
    let attribution = ''

    // Bible translations
    for (const bible of blue.bibles){
        const meta = content.translations[bible]!
        conditions.push(meta.licenses[0]!.restrictions)
        attribution += `
            <li>
                ${meta.name_local || meta.name_english} &mdash; ${meta.attribution}
                (${meta.licenses[0]!.name})
                <br>
                ${meta.licenses[0]!.url}
            </li>
        `
    }

    // Study notes
    if (blue.notes && !translation_forbids_derivatives.value){
        // TODO Get from collection manifest rather than hard-code
        conditions.push({
            forbid_attributionless: true,
            forbid_commercial: false,
            forbid_derivatives: 'same-license',
            forbid_other: false,
            limit_book_ratio: null,
            limit_content_ratio: null,
            limit_verses: null,
        })
        attribution += `
            <li>
                Study notes &mdash; Tyndale House Publishers (CC BY-SA)
                <br>
                https://creativecommons.org/licenses/by-sa/4.0/
            </li>
        `
    }

    // Conditions for creator
    let custom:MetaRestrictions = {
        forbid_attributionless: true,
        forbid_commercial: true,
        forbid_derivatives: true,
        forbid_other: true,
        limit_book_ratio: null,
        limit_content_ratio: null,
        limit_verses: null,
    }
    if (blue.license !== 'custom'){
        custom = {...content.collection._manifest.licenses[blue.license]!.restrictions}
    }
    if (!translation_forbids_derivatives.value){
        conditions.push(custom)
    }

    // Attribution for creator
    const license_name = content.collection._manifest.licenses[blue.license]?.name ?? "No license"
    let license_url = ''
    if (blue.license === 'public'){
        license_url = 'https://creativecommons.org/publicdomain/zero/1.0/'
    } else if (blue.license.startsWith('cc-')){
        license_url = `https://creativecommons.org/licenses/${blue.license.slice(3)}/4.0/`
    }
    if (!translation_forbids_derivatives.value){
        attribution += `
            <li>
                All other material &mdash;
                ${blue.license_attribution.trim() || "Anonymous"}
                (${license_name})
                <br>
                ${license_url}
            </li>
        `
    }

    // Work out what permissions remain
    const forbid_other = conditions.some(c => c.forbid_other)
    const forbid_attributionless = conditions.some(c => c.forbid_attributionless)
    const forbid_commercial = conditions.some(c => c.forbid_commercial)
    let forbid_derivatives:boolean|'same-license'
        = conditions.some(c => c.forbid_derivatives === true)
    if (!forbid_derivatives && conditions.some(c => c.forbid_derivatives === 'same-license')){
        forbid_derivatives = 'same-license'
    }

    // Explain license terms
    const no_conditions = [forbid_other, forbid_attributionless, forbid_commercial,
            forbid_derivatives].every(c => c === false)
    let explanation = ''
    if (forbid_other){
        explanation = "<p>This resource cannot be copied without permission.</p>"
    } else if (no_conditions){
        explanation = "<p>This resource can be copied and shared without restriction.</p>"
    } else {
        explanation = "<p>This resource can be copied and shared as long as:</p><ul>"
        if (forbid_attributionless){
            explanation += "<li>Attribution is given (as below)</li>"
        }
        if (forbid_commercial){
            explanation += "<li>This is not used for commercial purposes</li>"
        }
        if (forbid_derivatives === true){
            explanation += "<li>This is not modified</li>"
        } else if (forbid_derivatives === 'same-license'){
            explanation += "<li>Modifications use the same license</li>"
        }
        explanation += "</ul>"
    }

    return `
        <div class="copyright">
            ${explanation}
            <p>Resources used:</p>
            <ul>
                ${attribution}
            </ul>
            ${blue.app_link ? "<p>Created with /paper.bible/</p>" : ""}
        </div>
    `
}
