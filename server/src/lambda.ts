import {handle} from 'hono/aws-lambda'

import {app} from './index.ts'
import {config} from './config.ts'
import {run_compile} from './compile.ts'
import {ensure_assets_synced} from './lambda_bootstrap.ts'

import type {CompileJob} from './compile.ts'


// Production entry point (see infra/cloudformation.yml). One image backs both functions, and
// SERVER_ROLES picks which of these two handlers it exports


async function compile_handler(job:CompileJob):Promise<void>{
    // The compile function isn't behind API Gateway at all: the light function's /api/compile
    // invokes it asynchronously with a CompileJob (see dispatch_compile in compile.ts), so this
    // takes that job rather than an HTTP event. Its font/background assets are synced from S3
    // first (see lambda_bootstrap.ts) — lazily here, never at module load, since Lambda's INIT
    // phase has a fixed ~10s budget the sync can exceed
    await run_compile(job, ensure_assets_synced)
}


// The light function wraps the same Hono app dev_server.ts serves locally, for API Gateway's
// Lambda proxy integration
export const handler = config.roles.includes('compile') ? compile_handler : handle(app)
