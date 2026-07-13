
// Environment-driven config for the API server (defaults match the Cloud Run container;
// .bin/serve_server overrides them for local development against the emulators)
// SERVER_ROLES splits deployment into two services from the one codebase: 'light' (share/merge
// routes, tiny instance) and 'compile' (typst + fonts, big instance) — dev serves both
export const config = {
    port: Number(process.env['PORT'] ?? 8788),
    typst_path: process.env['TYPST_PATH'] ?? 'typst',
    fonts_dir: process.env['FONTS_DIR'] ?? '/app/fonts',
    endpoint: process.env['FETCH_ENDPOINT'] ?? 'https://v1.fetch.bible/',
    roles: (process.env['SERVER_ROLES'] ?? 'light,compile').split(','),
}
