
<template lang='pug'>

//- One translated sentence with markup inside it: each {placeholder} that has a slot of the
//- same name is replaced by that slot (emphasis, a link), the rest is plain text. This keeps
//- the sentence whole for the translator, who can move the placeholders wherever the grammar of
//- their language needs them — rather than translating fragments glued around each element
template(v-for='(part, i) of parts' :key='i')
    slot(v-if='part.slot' :name='part.slot')
    template(v-else) {{ part.text }}

</template>


<script lang='ts' setup>

import {computed, useSlots} from 'vue'


// `text` is the already-translated sentence (the caller's own $t call), so the key stays
// visible to the i18n tooling like any other
const props = defineProps<{text:string}>()
const slots = useSlots()


// The sentence split into text runs and slot placeholders
const parts = computed(() => {
    const out:{text?:string, slot?:string}[] = []
    let last = 0
    for (const match of props.text.matchAll(/\{(\w+)\}/g)){
        const name = match[1]!
        if (!slots[name]){
            continue
        }
        out.push({text: props.text.slice(last, match.index)}, {slot: name})
        last = match.index + match[0].length
    }
    out.push({text: props.text.slice(last)})
    return out
})

</script>


<style lang='sss' scoped>

</style>
