
import {initializeApp, cert} from 'firebase-admin/app'
import {getAuth} from 'firebase-admin/auth'
import {getFirestore} from 'firebase-admin/firestore'
import {getStorage} from 'firebase-admin/storage'
import {SecretsManagerClient, GetSecretValueCommand} from '@aws-sdk/client-secrets-manager'

import {config} from './config.ts'

import type {ServiceAccount} from 'firebase-admin/app'


// Fetch the GCP service-account key from Secrets Manager. Off-GCP (Lambda), there's no ambient
// credential the way Cloud Run's attached service account gave it for free via Application
// Default Credentials, so it has to be fetched explicitly. A single GetSecretValue call is fast
// (tens to low hundreds of ms) — comfortably inside Lambda's ~10s module-INIT budget, unlike the
// much larger font sync in lambda_bootstrap.ts, which is why that one has to be deferred to a
// request instead of awaited here at module load
async function load_credential():Promise<ServiceAccount>{
    const secret_arn = process.env['GCP_CREDENTIALS_SECRET_ARN']
    if (!secret_arn){
        throw new Error('GCP_CREDENTIALS_SECRET_ARN is required outside the emulator')
    }
    const client = new SecretsManagerClient({region: process.env['AWS_REGION'] ?? 'us-west-2'})
    const response = await client.send(new GetSecretValueCommand({SecretId: secret_arn}))
    if (!response.SecretString){
        throw new Error(`Secret ${secret_arn} has no string value`)
    }
    // firebase-admin's cert() accepts the raw downloaded service-account JSON's snake_case
    // field names directly, despite the camelCase ServiceAccount type
    return JSON.parse(response.SecretString) as ServiceAccount
}


// Admin SDK init — locally/in tests (FIRESTORE_EMULATOR_HOST set, see config.dev) the
// FIREBASE_*_EMULATOR_HOST env vars redirect everything to the emulator suite (see
// .bin/serve_server) and no credential is needed at all; in production it's fetched above
const project = process.env['GCLOUD_PROJECT'] ?? process.env['GOOGLE_CLOUD_PROJECT'] ?? ''
export const admin_app = initializeApp({
    projectId: project,
    storageBucket: process.env['STORAGE_BUCKET'] ?? `${project}.firebasestorage.app`,
    // Omit the key entirely in dev rather than passing credential: undefined — firebase-admin
    // validates the key's presence, not its truthiness, so an explicit undefined still fails
    ...(config.dev ? {} : {credential: cert(await load_credential())}),
})
export const admin_auth = getAuth(admin_app)
export const admin_db = getFirestore(admin_app)
export const admin_bucket = getStorage(admin_app).bucket()
