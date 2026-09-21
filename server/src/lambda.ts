
import {handle} from 'hono/aws-lambda'

import {app} from './index.ts'
import {config} from './config.ts'
import {ensure_assets_synced} from './lambda_bootstrap.ts'

import type {LambdaEvent, LambdaContext} from 'hono/aws-lambda'


// Production entry point (see infra/cloudformation.yml) — wraps the same Hono app dev_server.ts
// serves locally, for API Gateway's Lambda proxy integration
const hono_handler = handle(app)


// The compile function needs its font/background assets synced from S3 into /tmp before its
// first real compile in a given execution environment (see lambda_bootstrap.ts). This has to
// wrap the whole handler rather than register as Hono middleware: Hono composes matched
// handlers in registration order, and index.ts's `POST /api/compile` route (registered when
// this module's `import {app} from './index.ts'` above runs, before anything below it) never
// calls next() — it always returns a response directly (see authed_post()) — so any middleware
// registered afterwards, from here, would never be reached
export const handler = async (event:LambdaEvent, context?:LambdaContext) => {
    if (config.roles.includes('compile')){
        await ensure_assets_synced()
    }
    return hono_handler(event, context)
}
