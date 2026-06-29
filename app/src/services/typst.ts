
import {shallowRef} from 'vue'

import type {TypstWeb} from 'paper-bible-typst-web'


// In-browser Typst PDF generator — set once the WASM compiler has initialised.
// shallowRef so Vue tracks assignment without deeply proxying the WASM compiler instance.
export const typst_generator = shallowRef<TypstWeb|null>(null)
