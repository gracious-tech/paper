
import {handle} from 'hono/aws-lambda'

import {app} from './index.ts'
import {config} from './config.ts'
import {ensure_assets_synced} from './lambda_bootstrap.ts'


// Production entry point (see infra/cloudformation.yml) — wraps the same Hono app dev_server.ts
// serves locally, for API Gateway's Lambda proxy integration
//
// The compile function needs its font/background assets synced from S3 into /tmp before the
// first real compile (see lambda_bootstrap.ts) — registered here, not in index.ts, so
// dev_server.ts and the test suite (which run against a real local ASSETS_DIR already) never
// trigger it
if (config.roles.includes('compile')){
    app.use('/api/compile', async (context, next) => {
        await ensure_assets_synced()
        await next()
    })
}

export const handler = handle(app)
