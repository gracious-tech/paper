
import {serve} from '@hono/node-server'

import {app} from './index.ts'
import {config} from './config.ts'


// Local/test entry point — a real listening HTTP server, used by .bin/serve_server and
// tests/server/routes.test.ts. Not used in production (see server/src/lambda.ts)
serve({fetch: app.fetch, port: config.port}, info => {
    console.log(`paper-bible-server (${config.roles.join('+')}) listening on :${info.port}`)
})
