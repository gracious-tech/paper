
// Handing an accepted job from the light function to the compile function: a version compile
// (compile.ts) or a preview (preview.ts). Each job's outcome is recorded on a doc the client
// syncs, so nothing here waits for one to finish.

import {LambdaClient, InvokeCommand} from '@aws-sdk/client-lambda'

import {config} from './config.ts'


// Invokes the compile function from the light one (created on first dispatch)
let lambda_client:LambdaClient|null = null


export async function dispatch_job(job:object, run_here:() => Promise<void>):Promise<void>{
    // Start an accepted job without waiting for it. In production that's an async ('Event')
    // invocation of the compile function, which Lambda queues and runs to the function's own
    // timeout with no HTTP request attached (lambda.ts tells the jobs apart by their `kind`).
    // Running from source there's no function to invoke, so `run_here` runs it in this process
    // instead — only where this process serves the compile role too (dev's default): a
    // light-only Lambda is frozen the moment its response goes out
    if (config.compile_function !== null){
        lambda_client ??= new LambdaClient({})
        await lambda_client.send(new InvokeCommand({
            FunctionName: config.compile_function,
            InvocationType: 'Event',
            Payload: new TextEncoder().encode(JSON.stringify(job)),
        }))
        return
    }
    if (!config.roles.includes('compile')){
        throw new Error('No compile function to dispatch to (COMPILE_FUNCTION is unset)')
    }
    // The job records its own outcome on its doc; this only keeps anything it couldn't record
    // from going unhandled and taking the dev server down with it
    void run_here().catch(error => console.error(error))
}
