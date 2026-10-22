
// The 3D pictures of the example designs' covers (see example_designs.ts), one set per UI locale
// since each cover carries the example's translated title. They're rendered ahead of time by
// .bin/gen_example_images and committed — a locale whose covers would read the same as English's
// gets no files of its own, and a locale not rendered yet falls back to English too


// Every rendered picture's URL, keyed by its path (only URLs are bundled, so a visitor downloads
// just the pictures their own locale shows)
const images = import.meta.glob<string>('../assets/images/examples/*/*.webp',
    {eager: true, query: '?url', import: 'default'})


// The picture of an example's cover in the given UI locale, else English's
export function example_image(id:string, locale:string):string{
    const path = (loc:string) => `../assets/images/examples/${loc}/${id}.webp`
    const url = images[path(locale)] ?? images[path('en')]
    if (!url){
        throw new Error(`No rendered picture for example "${id}" (run .bin/gen_example_images)`)
    }
    return url
}
