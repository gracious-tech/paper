
// Fetch, cache, and recolor SVG icons from the Iconify API.
// The title-page icon is stored as either an Iconify ID ("collection:name", e.g.
// "game-icons:holy-grail") or a raw "<svg>...</svg>" string. This resolves it to a single,
// fully recolored SVG that the renderer can embed as a Typst image. Used by both the in-browser
// and Node (server) pipelines, so it relies only on the global fetch.

// Module-level in-memory cache: iconify ID -> raw SVG string
const svg_cache = new Map<string, string>()


// Fetch an SVG from the Iconify API and cache by ID
async function fetch_icon_svg(iconify_id:string):Promise<string> {
    const cached = svg_cache.get(iconify_id)
    if (cached !== undefined) {
        return cached
    }

    // Iconify IDs are formatted as "collection:name"
    const colon = iconify_id.indexOf(':')
    if (colon < 1) {
        throw new Error(`Invalid iconify ID "${iconify_id}" — expected "collection:name"`)
    }
    const collection = iconify_id.slice(0, colon)
    const name = iconify_id.slice(colon + 1)
    const url = `https://api.iconify.design/${collection}/${name}.svg`

    // Fetch the icon, surfacing a clear error if it does not exist
    const response = await fetch(url)
    if (!response.ok) {
        if (response.status === 404) {
            throw new Error(`Icon does not exist: ${iconify_id}`)
        }
        throw new Error(
            `Failed to fetch icon "${iconify_id}": ${response.status} ${response.statusText}`)
    }

    // Strip the width/height attributes so the icon scales to whatever size the renderer asks
    const raw = await response.text()
    const svg = raw.replace(/<svg\b[^>]*>/, tag => tag.replace(/\s(?:width|height)="[^"]*"/g, ''))
    svg_cache.set(iconify_id, svg)
    return svg
}


// Replace currentColor references in an SVG with a CSS color string
function recolor_svg(svg:string, color:string):string {
    return svg.replace(/currentColor/g, color)
}


// Resolve an Iconify ID (or raw SVG) to a fully recolored SVG string
export async function resolve_icon(id_or_svg:string, color:string):Promise<string> {
    const svg = id_or_svg.trimStart().startsWith('<')
        ? id_or_svg
        : await fetch_icon_svg(id_or_svg)
    return recolor_svg(svg, color)
}
