
import {initializeApp} from 'firebase-admin/app'
import {getAuth} from 'firebase-admin/auth'
import {getFirestore} from 'firebase-admin/firestore'
import {getStorage} from 'firebase-admin/storage'


// Admin SDK init — on Cloud Run this uses the service account and GCLOUD_PROJECT implicitly;
// locally the FIREBASE_*_EMULATOR_HOST/FIRESTORE_EMULATOR_HOST env vars redirect everything
// to the emulator suite (see .bin/serve_server)
const project = process.env['GCLOUD_PROJECT'] ?? process.env['GOOGLE_CLOUD_PROJECT'] ?? ''
export const admin_app = initializeApp({
    projectId: project,
    storageBucket: process.env['STORAGE_BUCKET'] ?? `${project}.firebasestorage.app`,
})
export const admin_auth = getAuth(admin_app)
export const admin_db = getFirestore(admin_app)
export const admin_bucket = getStorage(admin_app).bucket()
