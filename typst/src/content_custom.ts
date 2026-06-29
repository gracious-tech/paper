
import type {TypstCustomPage} from './types.js'


// Generate Typst markup for a custom content page
export function gen_custom(custom:TypstCustomPage):string {
    switch (custom.position) {
        case 'top':
            // Content at top — just render directly
            return custom.content

        case 'middle':
            // Vertically centered on the page
            return `#block(height: 100%)[
    #align(horizon)[
        ${custom.content}
    ]
]`

        case 'bottom':
            // Aligned to bottom of page
            return `#block(height: 100%)[
    #align(bottom)[
        ${custom.content}
    ]
]`

        default:
            return custom.content
    }
}
