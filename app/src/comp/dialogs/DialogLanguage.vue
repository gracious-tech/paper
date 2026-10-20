
<template lang='pug'>

v-dialog(v-model='state.language' max-width='360' scrollable)
    v-card
        v-card-title {{ $t("app.language") }}
        //- Only worth a filter once the list is too long to scan by eye
        v-card-text(v-if='options.length > FILTER_MIN' class='flex-0-0 pb-0')
            v-text-field(v-model='filter' :placeholder='$t("common.search")' autofocus clearable)
        v-card-text(class='px-0')
            v-list
                //- Each name is in its own language, so marked up as such for screen readers
                v-list-item(v-for='option of filtered' :key='option.code'
                        :active='option.code === locale' @click='pick(option.code)'
                        :lang='option.code' :dir='option.dir')
                    v-list-item-title {{ option.name }}
        v-card-actions
            v-spacer
            v-btn(@click='state.language = false') {{ $t("common.close") }}

</template>


<script lang='ts' setup>

import {computed, ref} from 'vue'

import {LOCALES, locale, choose_locale, translate} from '@/services/i18n'
import {state, report_failure} from '@/services/state'


// How many locales the list can hold before it gets a filter field
const FILTER_MIN = 12


// The text typed into the filter (null once cleared)
const filter = ref<string|null>('')


// Every locale, by its own name, with what's needed to mark each entry up in its language
const options = computed(() => {
    return Object.entries(LOCALES)
        .map(([code, info]) => ({code, ...info}))
        .sort((a, b) => a.name.localeCompare(b.name))
})


// The locales matching the filter, by either their own or their English name
const filtered = computed(() => {
    const query = (filter.value ?? '').trim().toLowerCase()
    if (!query){
        return options.value
    }
    return options.value.filter(option => option.name.toLowerCase().includes(query)
        || option.english.toLowerCase().includes(query))
})


// Switch to the chosen locale and close
const pick = async (code:string) => {
    state.language = false
    await choose_locale(code).catch((error:unknown) => {
        report_failure(error, translate('common.action_failed'))
    })
}

</script>


<style lang='sss' scoped>

</style>
