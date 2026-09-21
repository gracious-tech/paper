
// Test double for the app's UI/open-design state (see vitest.config.ts for why it's aliased).
//
// The real module reaches into the error reporter, the API client and the Bible content service
// at import time, and its `blue` singleton is only meaningful once a design is open. Services
// under test read `blue` as a default argument ("summarise the design currently being edited"),
// so all a suite needs is a settable stand-in.

import {reactive, ref} from 'vue'

import type {Blueprint} from '@/services/types'


// The open design. Replaced wholesale in the real app when switching designs, so tests assign
// into it rather than reassigning the binding (same constraint the real code has)
export const blue = reactive({} as unknown as Blueprint)


export function set_blue(blueprint:Partial<Blueprint>):void{
    // Make `blue` describe the given design, clearing whatever a previous test left
    for (const key of Object.keys(blue)){
        delete (blue as unknown as Record<string, unknown>)[key]
    }
    Object.assign(blue, blueprint)
}


export const estimated_pages = ref<number|null>(null)


export const state = reactive({
    toasts: [] as string[],
    splash: false,
})


export function show_toast(message:string):void{
    state.toasts.push(message)
}


export function page_count_guess():number{
    return estimated_pages.value ?? 0
}
