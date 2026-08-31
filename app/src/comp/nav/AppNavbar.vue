
<template lang='pug'>

nav.navbar
    v-btn(@click='view_all' variant='text' :active='is_viewing_all' icon color='' class='tab_btn'
            density='comfortable')
        app-icon(name='lists')
    v-btn(v-for='design of recent' :key='design.id' @click='open(design.id)' variant='text'
            :active='design.id === active_design_id' color=''
            class='tab_btn design_btn')
        | {{ design.name || $t("common.unnamed_design") }}
    v-spacer
    v-btn(@click='create' variant='flat' size='small' color='secondary' class='create_btn')
        | {{$t("common.new")}}

</template>


<script lang='ts' setup>

import {computed} from 'vue'
import {useRoute, useRouter} from 'vue-router'

import {designs} from '@/services/designs'
import {state} from '@/services/state'


const route = useRoute()
const router = useRouter()


// Last 3 designs by recency (the `designs` list is already ordered modified-desc)
const recent = computed(() => designs.slice(0, 3))

// Whether the "View all" tab represents the currently active route
const is_viewing_all = computed(() => route.name === 'designs')

// The design tab to highlight, per the route (not `current_design_id`, which lingers after
// navigating away to /designs since nothing ever resets it)
const active_design_id = computed(() => {
    return route.name === 'design' ? route.params['id'] as string : null
})


const open = (id:string) => {
    void router.push({name: 'design', params: {id}})
}

const view_all = () => {
    void router.push({name: 'designs'})
}

const create = () => {
    // Open the new-design wizard (it creates the design and routes to it itself on finish)
    state.new_design = true
}

</script>


<style lang='sass' scoped>

.navbar
    display: flex
    align-items: flex-end
    height: 42px
    gap: 6px
    padding: 0 8px

.tab_btn
    border-radius: 8px 8px 0 0 !important
    &.v-btn--active
        background-color: var(--app-bg)
        color: rgb(var(--v-theme-on-surface))

.create_btn
    align-self: center

.design_btn
    max-width: 120px
    background-color: rgba(var(--v-theme-on-primary), 0.12)
    :deep(.v-btn__content)
        overflow: hidden
        text-overflow: ellipsis
        white-space: nowrap
        display: block

</style>
