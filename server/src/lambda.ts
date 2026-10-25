import {handle} from 'hono/aws-lambda'

import {app} from './index.ts'
import {config} from './config.ts'
import {run_compile} from './compile.ts'
import {run_preview} from './preview.ts'
import {ensure_assets_synced} from './lambda_bootstrap.ts'

import type {CompileJob} from './compile.ts'
import type {PreviewJob} from './preview.ts'


// Production entry point (see infra/cloudformation.yml). One image backs both functions, and
// SERVER_ROLES picks which of these two handlers it exports


async function compile_handler(job:CompileJob|PreviewJob):Promise<void>{
    // The compile function isn't behind API Gateway at all: the light function's /api/compile
    // and /api/preview invoke it asynchronously with a job (see dispatch_job in dispatch.ts), so
    // this takes that job rather than an HTTP event. A preview says so in its `kind`; anything
    // else is a version compile. Its font/background assets are synced from S3 first (see
    // lambda_bootstrap.ts) — lazily here, never at module load, since Lambda's INIT phase has a
    // fixed ~10s budget the sync can exceed
    if ('kind' in job && job.kind === 'preview'){
        await run_preview(job, ensure_assets_synced)
    } else {
        await run_compile(job as CompileJob, ensure_assets_synced)
    }
}


// The light function wraps the same Hono app dev_server.ts serves locally, for API Gateway's
// Lambda proxy integration
export const handler = config.roles.includes('compile') ? compile_handler : handle(app)
