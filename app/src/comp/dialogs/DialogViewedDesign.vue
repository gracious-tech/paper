
<template lang='pug'>

v-dialog(:model-value='!!state.viewed_version && !state.viewed_confirmed' persistent
        max-width='420')

    //- Loaded — ask whether to view the shared design (ViewDesign.vue shows the regular
    //- read-only version view once confirmed)
    v-card(v-if='version')
        v-card-title {{ version.title }}
        v-card-subtitle {{ version.created.toLocaleDateString() }}
        v-card-text {{$t("Someone shared this document with you.")}}
        v-card-actions
            v-spacer
            v-btn(@click='cancel') {{$t("Cancel")}}
            v-btn(@click='view' color='secondary') {{$t("View")}}

    //- Link didn't resolve (deleted)
    v-card(v-else-if='failed')
        v-card-text {{$t("This share link is invalid or has been disabled.")}}
        v-card-actions
            v-spacer
            v-btn(@click='cancel') {{$t("Close")}}

    //- Still loading
    v-card(v-else)
        v-card-text(class='text-center py-8')
            v-progress-circular(indeterminate color='secondary')

</template>


<script lang='ts' setup>

import {ref, watch} from 'vue'
import {useRouter} from 'vue-router'

import {state} from '@/services/state'
import {fetch_shared_version, record_viewed, has_viewed_design} from '@/services/versions'

import type {Version} from '@/services/types'


const router = useRouter()


const version = ref(null as Version|null)
const failed = ref(false)


// Fetch the viewed version whenever a link arrives (publicly readable by id), then decide
// whether to actually prompt — only the first time a design is viewed. Repeat visits skip the
// prompt (recorded as an updated visit) so it doesn't nag on every reopen. `version` is only
// assigned (revealing the prompt) once that decision is made, so the dialog just shows its
// loading spinner throughout rather than flashing the prompt before immediately skipping it
watch(() => state.viewed_version, async viewed => {
    version.value = null
    failed.value = false
    state.viewed_confirmed = false
    if (!viewed){
        return
    }
    let fetched:Version
    try {
        fetched = await fetch_shared_version(viewed.version_id)
    } catch {
        failed.value = true
        return
    }
    if (state.viewed_version !== viewed){
        return  // Stale — a different link arrived while awaiting
    }
    if (await has_viewed_design(viewed.design_id)){
        await record_viewed(viewed.design_id, viewed.version_id, fetched.title)
        state.viewed_confirmed = true
    } else {
        version.value = fetched
    }
}, {immediate: true})


// Confirm viewing — record it (first-time view) and reveal the regular read-only version view
const view = async () => {
    if (state.viewed_version && version.value){
        await record_viewed(state.viewed_version.design_id, state.viewed_version.version_id,
            version.value.title)
    }
    state.viewed_confirmed = true
}


// Dismiss without recording anything, and return to the user's own designs list
const cancel = async () => {
    state.viewed_version = null
    await router.push({name: 'designs'})
}

</script>


<style lang='sass' scoped>

</style>
