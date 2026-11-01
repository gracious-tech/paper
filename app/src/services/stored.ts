// This browser's localStorage, read and written without ever throwing. Storage can be missing
// altogether (an Android WebView with DOM storage off has `localStorage` null), blocked (private
// modes, site data refused) or full, and nothing kept there is worth failing over: every key
// holds a preference or a hint that the app works without


export function read_stored(key:string):string|null{
    // A key's value, or null wherever it can't be read
    try {
        return localStorage.getItem(key)
    } catch {
        return null
    }
}


export function write_stored(key:string, value:string|null):void{
    // Set a key, or (null) remove it, best-effort
    try {
        if (value === null){
            localStorage.removeItem(key)
        } else {
            localStorage.setItem(key, value)
        }
    } catch {
        // Without storage the preference only lasts until the page reloads
    }
}
