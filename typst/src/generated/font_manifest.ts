
// Manifest of fonts bundled in typst/assets/fonts/ (family → TTF filenames).
// The base font (Noto Sans) is always listed first; it is used for page footers and
// chapter dividers and so is always loaded. See helpers in ../fonts.js.
// To regenerate after changing the assets/fonts/ directory, list each family's *.ttf files.

export interface BundledFont {
    // Font family name exactly as Typst expects it (e.g. "Crimson Pro")
    family:string
    // TTF filenames within the family's directory under assets/fonts/<family>/
    files:string[]
}


// All bundled fonts — Noto Sans (base font) is always first
export const FONT_MANIFEST:BundledFont[] = [
    {
        family: 'Noto Sans',
        files: [
            'NotoSans-Bold.ttf',
            'NotoSans-BoldItalic.ttf',
            'NotoSans-Italic.ttf',
            'NotoSans-Regular.ttf',
        ],
    },
    {
        family: 'Crimson Pro',
        files: [
            'CrimsonPro-Bold.ttf',
            'CrimsonPro-BoldItalic.ttf',
            'CrimsonPro-Italic.ttf',
            'CrimsonPro-Regular.ttf',
        ],
    },
    {
        family: 'Dancing Script',
        files: [
            'DancingScript-Bold.ttf',
            'DancingScript-Regular.ttf',
        ],
    },
    {
        family: 'EB Garamond',
        files: [
            'EBGaramond-Bold.ttf',
            'EBGaramond-BoldItalic.ttf',
            'EBGaramond-Italic.ttf',
            'EBGaramond-Regular.ttf',
        ],
    },
    {
        family: 'Libre Baskerville',
        files: [
            'LibreBaskerville-Bold.ttf',
            'LibreBaskerville-BoldItalic.ttf',
            'LibreBaskerville-Italic.ttf',
            'LibreBaskerville-Regular.ttf',
        ],
    },
    {
        family: 'Libre Caslon Text',
        files: [
            'LibreCaslonText-Italic[wght].ttf',
            'LibreCaslonText[wght].ttf',
        ],
    },
    {
        family: 'Noto Emoji',
        files: [
            'NotoEmoji[wght].ttf',
        ],
    },
]
