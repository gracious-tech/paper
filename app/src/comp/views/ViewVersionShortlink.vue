
<template lang='pug'>

div.cont
    v-progress-circular(indeterminate color='secondary')

</template>


<script lang='ts' setup>

import {onMounted} from 'vue'
import {useRoute, useRouter} from 'vue-router'

import {useI18n} from '@/services/i18n'
import {show_toast} from '@/services/state'
import {fetch_shared_version} from '@/services/versions'


const route = useRoute()
const router = useRouter()
const {t} = useI18n()


onMounted(async () => {
    // Short /v/:id links only carry a version id (kept off the printed page/QR code so it stays
    // short) — look the version up to learn its parent design_id, then hand off to the regular
    // design route, which does the rest (read-only landing prompt etc)
    const id = route.params['id'] as string
    try {
        const version = await fetch_shared_version(id)
        await router.replace({name: 'design', params: {id: version.design_id, version: id}})
    } catch {
        show_toast(t("dialog.viewed.invalid_link"))
        await router.replace({name: 'designs'})
    }
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
