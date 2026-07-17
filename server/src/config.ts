
// Environment-driven config for the API server (defaults match the Cloud Run container;
// .bin/serve_server overrides them for local development against the emulators)
// SERVER_ROLES splits deployment into two services from the one codebase: 'light' (share/merge
// routes, tiny instance) and 'compile' (typst + fonts, big instance) — dev serves both

// Root of the shared assets tree published by the bookcover repo (fonts/, docs/, frames/,
// backgrounds/) — the assets bucket mounted via GCS FUSE on Cloud Run
const assets_dir = process.env['ASSETS_DIR'] ?? '/mnt/assets'

export const config = {
    port: Number(process.env['PORT'] ?? 8788),
    typst_path: process.env['TYPST_PATH'] ?? 'typst',
    assets_dir,
    fonts_dir: process.env['FONTS_DIR'] ?? `${assets_dir}/fonts`,
    endpoint: process.env['FETCH_ENDPOINT'] ?? 'https://v1.fetch.bible/',
    roles: (process.env['SERVER_ROLES'] ?? 'light,compile').split(','),
}
