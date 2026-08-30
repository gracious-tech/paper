
// Type declaration for the vendored/forked coloris.js (see that file for patch notes). Only
// covers the options this app actually passes to Coloris() — extend as needed

export interface ColorisSwatchGroup {
    label:string
    colors:string[]
}

export interface ColorisOptions {
    el?:string
    parent?:string | HTMLElement
    theme?:'default' | 'large' | 'polaroid' | 'pill'
    themeMode?:'light' | 'dark' | 'auto'
    rtl?:boolean
    wrap?:boolean
    margin?:number
    format?:'hex' | 'rgb' | 'hsl' | 'mixed' | 'auto'
    formatToggle?:boolean
    swatchGroups?:ColorisSwatchGroup[] // [FORK] replaces upstream's flat swatches?:string[]
    swatchesOnly?:boolean
    alpha?:boolean
    forceAlpha?:boolean
    focusInput?:boolean
    selectInput?:boolean
    inline?:boolean
    defaultColor?:string
    clearButton?:boolean
    clearLabel?:string
    closeButton?:boolean
    closeLabel?:string
    onChange?:(color:string, input:HTMLInputElement | undefined) => void
}

interface ColorisFn {
    (options:ColorisOptions | string): void
    set: (options:ColorisOptions) => void
    wrap: (selector:string) => void
    close: () => void
    updatePosition: () => void
}

declare const Coloris:ColorisFn
export default Coloris
