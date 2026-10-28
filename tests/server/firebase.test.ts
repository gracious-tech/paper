
// The Admin SDK's production credential. Every other suite runs against the emulators, where no
// credential is passed at all, so the path Lambda takes — fetching the GCP service-account key
// from Secrets Manager at module load — is only reachable by loading firebase.ts afresh with the
// emulator variable cleared and the AWS and Firebase SDKs replaced by stand-ins

import {describe, it, expect, beforeEach, afterEach, vi} from 'vitest'


// What the stand-ins were asked for, per load
let sent:{region:string|undefined, secret_id:string}[] = []
let initialised:Record<string, unknown>[] = []

// What the secret holds this test (undefined for a secret with no string value)
let secret_string:string|undefined

// The key the secret normally holds, as downloaded from GCP (snake_case fields)
const KEY = {type: 'service_account', project_id: 'paper-bible', client_email: 'x@y.z',
    private_key: '-----BEGIN PRIVATE KEY-----'}


// Load firebase.ts with production's environment: the given variables, and no emulator
async function load(env:Record<string, string>):Promise<void>{
    vi.stubEnv('FIRESTORE_EMULATOR_HOST', undefined)
    vi.stubEnv('AWS_REGION', undefined)
    vi.stubEnv('STORAGE_BUCKET', undefined)
    for (const [name, value] of Object.entries(env)){
        vi.stubEnv(name, value)
    }
    await import('../../server/src/firebase.ts')
}


beforeEach(() => {
    sent = []
    initialised = []
    secret_string = JSON.stringify(KEY)
    vi.resetModules()

    // Secrets Manager: records the region and secret asked for, answers with secret_string
    vi.doMock('@aws-sdk/client-secrets-manager', () => ({
        SecretsManagerClient: class {
            region:string|undefined
            constructor(options:{region?:string}){
                this.region = options.region
            }
            async send(command:{input:{SecretId:string}}){
                sent.push({region: this.region, secret_id: command.input.SecretId})
                return {SecretString: secret_string}
            }
        },
        GetSecretValueCommand: class {
            input:{SecretId:string}
            constructor(input:{SecretId:string}){
                this.input = input
            }
        },
    }))

    // The Admin SDK: records what the app was initialised with, and hands back inert handles
    vi.doMock('firebase-admin/app', () => ({
        initializeApp: (options:Record<string, unknown>) => {
            initialised.push(options)
            return {}
        },
        cert: (key:unknown) => ({cert: key}),
    }))
    vi.doMock('firebase-admin/auth', () => ({getAuth: () => ({})}))
    vi.doMock('firebase-admin/firestore', () => ({getFirestore: () => ({})}))
    vi.doMock('firebase-admin/storage', () => ({getStorage: () => ({bucket: () => ({})})}))
})

afterEach(() => {
    vi.unstubAllEnvs()
    for (const name of ['@aws-sdk/client-secrets-manager', 'firebase-admin/app',
        'firebase-admin/auth', 'firebase-admin/firestore', 'firebase-admin/storage']){
        vi.doUnmock(name)
    }
    vi.resetModules()
})


describe('the production credential', () => {

    it('is the service-account key the named secret holds, fetched in the given region', async () => {
        await load({GCP_CREDENTIALS_SECRET_ARN: 'arn:aws:secretsmanager:secret:gcp',
            AWS_REGION: 'eu-west-1', GCLOUD_PROJECT: 'paper-bible',
            STORAGE_BUCKET: 'paper-bible.appspot.com'})

        expect(sent).toEqual([{region: 'eu-west-1', secret_id: 'arn:aws:secretsmanager:secret:gcp'}])
        expect(initialised).toEqual([{projectId: 'paper-bible',
            storageBucket: 'paper-bible.appspot.com', credential: {cert: KEY}}])
    })

    it('defaults to the stack\'s region, and the project\'s own bucket', async () => {
        await load({GCP_CREDENTIALS_SECRET_ARN: 'arn:secret', GCLOUD_PROJECT: 'paper-bible'})

        expect(sent[0]?.region).toBe('us-west-2')
        expect(initialised[0]?.['storageBucket']).toBe('paper-bible.firebasestorage.app')
    })

    it('stops the module loading when no secret is named', async () => {
        vi.stubEnv('GCP_CREDENTIALS_SECRET_ARN', undefined)
        await expect(load({})).rejects.toThrow(/GCP_CREDENTIALS_SECRET_ARN is required/)
        expect(initialised).toEqual([])
    })

    it('stops the module loading when the secret holds no string', async () => {
        secret_string = undefined
        await expect(load({GCP_CREDENTIALS_SECRET_ARN: 'arn:secret'}))
            .rejects.toThrow('Secret arn:secret has no string value')
        expect(initialised).toEqual([])
    })

})
