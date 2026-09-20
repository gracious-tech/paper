
// Types shared by the route handlers.


// What every handle_* function returns: the HTTP status to send and the JSON body to send with
// it. Defined once here rather than restated per module — index.ts's route helper has to name
// the same shape to dispatch to any of them
export interface HandlerResult {
    status:number
    body:Record<string, unknown>
}
