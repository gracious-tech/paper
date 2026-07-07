
// Shared types for the per-app font download flow

export interface CuratedFontSpec {
    family:string
    // Category group shown as a subheading in a font chooser UI
    group:string
    style:'serif' | 'sans'
}

export interface FontsConfig {
    // Label for the mandatory Noto Serif/Sans base entries (default: 'Noto')
    noto_group?:string
    // Additional fonts beyond the mandatory Noto Serif/Sans + full script fallback set
    curated?:CuratedFontSpec[]
}

export interface DownloadOptions {
    // Directory to download font binaries + write manifest.json into
    fonts_dir:string
    config?:FontsConfig
}
