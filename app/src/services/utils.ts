
import {debounce as lodash_debounce} from 'lodash-es'


export function buffer_to_url64(buffer:ArrayBuffer):string{
    // Encode binary data as a url-safe base64 string
    // NOTE btoa only works with strings so convert each byte to a char
    const base64 = btoa(String.fromCharCode(...new Uint8Array(buffer)))
    // Convert to urlsafe base64
    return base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/\=/g, '~')
}


export function url64_to_buffer(encoded:string):ArrayBuffer{
    // Convert a url64 encoded string to an ArrayBuffer
    /* Explanation of decoding
        atob() is weird in that its "binary" output is still a string
        While JS uses UTF-16, atob() will only ever generate chars that take up 1 of the 2 bytes
        Which means that charCodeAt() will return integers up to 1 byte only (even if supports 2)
        Which can then be fed into a Uint8Array!
    */
    encoded = encoded.replace(/\-/g, '+').replace(/\_/g, '/').replace(/\~/g, '=')
    const binary_string = atob(encoded)
    return Uint8Array.from(binary_string, c => c.charCodeAt(0)).buffer
}


export function generate_token(bytes=15):string{
    // Return a random string that is url safe (can be used for authentication or uuid etc)
    // NOTE Standard UUIDs are 15.25 bytes random + 0.75 version info (16 in total)
    // NOTE Returned string will be bytes/3*4 in length (multiples of 3 best for base64)
    const random_buffer = crypto.getRandomValues(new Uint8Array(bytes)).buffer
    return buffer_to_url64(random_buffer)
}


export async function compress(buffer:ArrayBuffer):Promise<ArrayBuffer>{
    // Compress binary data using gzip
    let stream = new Blob([buffer]).stream().pipeThrough(new CompressionStream('gzip'))
    return await new Response(stream).arrayBuffer()
}


export function string_to_utf8(text:string):ArrayBuffer{
    // Convert a string to a UTF8 ArrayBuffer
    return new TextEncoder().encode(text).buffer
}


export function debounce<T>(fn:T, ms=500){
    // Version of lodash debounce that has own defaults
    // @ts-ignore -- Lodash uses 'any' types and can't work out how to declare unknown args fn
    return lodash_debounce(fn, ms) as unknown as T
}


export function format_datetime(date:Date):string{
    // The app's canonical exact date + time rendering (locale-aware, e.g. "2 Sep 2026, 14:30")
    return date.toLocaleString(undefined, {dateStyle: 'medium', timeStyle: 'short'})
}


export function format_relative_time(date:Date):string{
    // Human-friendly "time ago" (e.g. "3 hours ago", "2 weeks ago") for recent dates, falling
    // back to a plain date once a relative count stops being useful
    const seconds = (Date.now() - date.getTime()) / 1000
    const rtf = new Intl.RelativeTimeFormat(undefined, {numeric: 'auto'})
    const minutes = seconds / 60
    const hours = minutes / 60
    const days = hours / 24
    const weeks = days / 7
    const months = days / 30
    if (seconds < 60){
        return rtf.format(0, 'second')
    } else if (minutes < 60){
        return rtf.format(-Math.round(minutes), 'minute')
    } else if (hours < 24){
        return rtf.format(-Math.round(hours), 'hour')
    } else if (days < 7){
        return rtf.format(-Math.round(days), 'day')
    } else if (weeks < 8){
        return rtf.format(-Math.round(weeks), 'week')
    } else if (months < 12){
        return date.toLocaleDateString(undefined, {month: 'short', day: 'numeric'})
    }
    return date.toLocaleDateString()
}
