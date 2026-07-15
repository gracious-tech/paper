
<template lang='pug'>

div.cont
    v-progress-circular(indeterminate color='secondary')

</template>


<script lang='ts' setup>

import {onMounted} from 'vue'
import {useRoute, useRouter} from 'vue-router'

import {state} from '@/services/state'


const route = useRoute()
const router = useRouter()


onMounted(async () => {
    const id = route.params['id'] as string
    const token = route.params['token'] as string
    // Hand off to DialogAcceptInvite (mounted globally in AppRoot) rather than redeeming
    // immediately — the user must explicitly accept before becoming an editor
    state.design_invite = {design_id: id, token}
    // Strip the token from the URL regardless of what the user decides
    await router.replace({name: 'design', params: {id}})
})

</script>


<style lang='sass' scoped>

.cont
    display: flex
    align-items: center
    justify-content: center
    flex-grow: 1
    height: 100%

</style>
