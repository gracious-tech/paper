
// Environment-driven config for the API server (defaults match the Cloud Run container;
// .bin/serve_server overrides them for local development against the emulators)
// SERVER_ROLES splits deployment into two services from the one codebase: 'light' (share/merge
// routes, tiny instance) and 'compile' (typst + fonts, big instance) — dev serves both

// Root of the shared assets tree published by the bookcover repo (fonts/, docs/, frames/,
// backgrounds/) — in production, the compile Lambda's own synced copy under /tmp (see
// lambda_bootstrap.ts; Lambda has no bucket-as-filesystem mount the way Cloud Run's GCS FUSE
// volume did), locally a plain directory (see .bin/serve_server)
const assets_dir = process.env['ASSETS_DIR'] ?? '/tmp/assets'

export const config = {
    port: Number(process.env['PORT'] ?? 8788),
    typst_path: process.env['TYPST_PATH'] ?? 'typst',
    assets_dir,
    fonts_dir: process.env['FONTS_DIR'] ?? `${assets_dir}/fonts`,
    endpoint: process.env['FETCH_ENDPOINT'] ?? 'https://v1.fetch.bible/',
    roles: (process.env['SERVER_ROLES'] ?? 'light,compile').split(','),
    // Running against the local emulator suite rather than real Firebase (see .bin/serve_server).
    // Relaxes checks that would otherwise reject the emulator's own plain-http localhost URLs
    dev: !!process.env['FIRESTORE_EMULATOR_HOST'],
    // Name of the Lambda function the light role hands accepted jobs to (see dispatch_job
    // in dispatch.ts). Unset when running from source, where the job runs in-process instead
    compile_function: process.env['COMPILE_FUNCTION'] ?? null,
    // Public origin of the web app — used to build the "customise this design" link + QR code
    // baked into a document's attribution block (see compile.ts)
    app_url: 'https://paper.bible',
    // Commit the image was built from (baked in by .bin/build_server_lambda), stamped onto
    // server-side error reports — null when running from source
    build: process.env['BUILD_COMMIT'] ?? null,
}
