
// Constants shared between the app and the server (single source so they can never drift)


// Version marker written onto designs/versions docs at create time, so future format changes
// can branch on it when reading old docs (docs without the field are implicitly schema 1)
export const SCHEMA_VERSION = 1


// How long generated PDFs are kept in Storage before the bucket's lifecycle rule deletes them
// WARN Must match the age in firebase_storage_lifecycle.json
export const PDF_LIFETIME_MS = 365 * 24 * 60 * 60 * 1000


// How long a compile_stats telemetry row is kept before Firestore's TTL policy deletes it —
// written onto each row as `expires` (see record_compile_stat in the app and server)
// WARN The TTL policy on the `expires` field is created by .bin/setup_firebase
export const COMPILE_STATS_LIFETIME_MS = 365 * 24 * 60 * 60 * 1000
