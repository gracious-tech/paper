
// In-page stress harness: injected (as a module script) into a blank page on the Vite dev
// origin, so it can import the app's real service modules and drive the exact WASM compile
// path the app uses — without booting the whole app (no auth/Firestore involved).

// Encode PDF bytes chunk-wise for transport back to the test runner (structured clone of large
// typed arrays isn't supported by page.evaluate)
function to_base64(bytes){
    let binary = ''
    const chunk = 0x8000
    for (let i = 0; i < bytes.length; i += chunk){
        binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk))
    }
    return btoa(binary)
}


window.__stress = {

    // Compile one blueprint end-to-end: resolve its content (fetches books from the dev content
    // server) then compile it in a fresh worker. Returns plain JSON-safe data.
    async run_tier(blueprint, assets_prefix){
        const {bible_content} = await import('/src/services/content.ts')
        const {TypstWorkerClient} = await import('/src/services/typst.ts')

        // Resolve the blueprint into a TypstRequest (includes the collection fetch, matching
        // what a cold app session pays)
        const resolve_start = performance.now()
        let request
        try {
            await bible_content.init()
            request = await bible_content.resolve(blueprint, {})
        } catch (error){
            return {ok: false, stage: 'resolve', error: String(error)}
        }
        const resolve_ms = Math.round(performance.now() - resolve_start)

        // Compile in a fresh dedicated worker — same client class the app uses, including its
        // recycle-and-retry-once behaviour on a fatal (out of memory) trap
        const client = new TypstWorkerClient()
        await client.init(assets_prefix)
        const compile_start = performance.now()
        try {
            const bytes = await client.compile_pdf(request)
            return {
                ok: true,
                resolve_ms,
                compile_ms: Math.round(performance.now() - compile_start),
                pdf_base64: to_base64(bytes),
            }
        } catch (error){
            return {
                ok: false,
                stage: 'compile',
                resolve_ms,
                compile_ms: Math.round(performance.now() - compile_start),
                error: String(error),
            }
        }
    },
}
