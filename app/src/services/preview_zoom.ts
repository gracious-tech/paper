
// Zooming a preview (DisplayPreviewPages.vue, with DisplayPreviewZoom.vue as its control). A
// desktop's zoom is physical, as the bookcover editor's is: 1 shows the book at its printed size
// (a CSS inch is 96px and a point 1/72in, so a point is 4/3px), which is what the A4/US Letter
// lines measure against. A phone's is relative to the pages filling its width, since a printed
// page is wider than any phone. Either way `null` means fitting the width, followed as it changes


// CSS pixels per point at a physical zoom of 1
export const PX_PER_PT = 96 / 72

// Paper widths the measurer draws, in inches
export const A4_WIDTH_IN = 210 / 25.4
export const LETTER_WIDTH_IN = 8.5


// The range a zoom may take
export interface ZoomLimits {
    min:number
    max:number
}


export function zoom_limits(physical:boolean, fit:number):ZoomLimits{
    // How far a preview may zoom, either side of fitting its pane (`fit`, which for a phone is 1
    // by definition). A desktop goes from a quarter of print size to four times it, and always far
    // enough to fit whatever the pane's width; a phone only zooms in, as its pages already fill it
    if (!physical){
        return {min: 1, max: 4}
    }
    return {min: Math.min(0.25, fit), max: Math.max(4, fit)}
}


export function clamp_zoom(zoom:number, limits:ZoomLimits):number{
    // A zoom within its limits
    return Math.min(limits.max, Math.max(limits.min, zoom))
}


export function wheel_zoom(zoom:number, event:{deltaY:number, deltaMode:number}):number{
    // The zoom after one Ctrl+wheel event: multiplicative, so each step looks the same at any
    // zoom. A trackpad's pinch arrives as many small deltas, a mouse's notch as one large one, so
    // a delta is capped to keep a notch to a modest step. Line and page deltas (Firefox's mouse
    // wheel) are converted to pixels first
    const pixels = event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? 400 : 1)
    const capped = Math.min(25, Math.max(-25, pixels))
    return zoom * Math.exp(-capped * 0.01)
}


// A box in client coordinates, as getBoundingClientRect() gives one
type Box = Pick<DOMRect, 'left'|'top'|'width'|'height'>


export function anchored_scroll(before:Box, after:Box, focus:{x:number, y:number})
        :{x:number, y:number}{
    // How far to scroll so that the point of the content under `focus` (client coordinates)
    // before a zoom is under it again after, given the content's box before and after
    const u = (focus.x - before.left) / (before.width || 1)
    const v = (focus.y - before.top) / (before.height || 1)
    return {x: after.left + u * after.width - focus.x, y: after.top + v * after.height - focus.y}
}
