
<template lang='pug'>

iframe(v-if='iframe_src' :src='iframe_src')
div.explain(v-else)
    template(v-if='status === undefined')
    template(v-else-if='status === "pending"')
        h3(class='mb-6') Generating your creation...
        div(class='mb-10') Short documents take seconds, where as large ones may be a few minutes.
        v-progress-circular(indeterminate color='secondary' size='60' width='6')
    template(v-else-if='status === "failed"')
        div An error occured
    template(v-else-if='status === "expired"')
        div Creation has expired

</template>


<script lang='ts' setup>

import {computed} from 'vue'

import {selected_creation} from '@/services/state'
import {gen_creation_url} from '@/services/backend'


const status = computed(() => {
    return selected_creation.value?.status
})


const iframe_src = computed(() => {
    if (selected_creation.value?.status === 'available'){
        return gen_creation_url(selected_creation.value.creation_id!, 'pdf')
    }
    return null
})



</script>


<style lang='sass' scoped>

.explain
    display: flex
    flex-direction: column
    justify-content: center
    align-items: center
    flex-grow: 1
    color: white
    text-align: center
    padding: 24px

</style>
