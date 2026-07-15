
<template lang='pug'>

div.cont

    div.header
        h2 {{$t("My designs")}}
        v-btn-toggle(v-model='sort_by' density='compact' mandatory)
            v-btn(value='modified' size='small') {{$t("Recent")}}
            v-btn(value='name' size='small') {{$t("Name")}}

    div(v-if='!own.length' class='pa-4 text-center text-medium-emphasis')
        | {{$t("No designs yet")}}
    v-list(v-else bg-color='transparent')
        DesignListItem(v-for='design of own_sorted' :key='design.id' :design='design')

    template(v-if='edit_access.length')
        h2(class='mt-8') {{$t("Edit access")}}
        v-list(bg-color='transparent')
            DesignListItem(v-for='design of edit_access_sorted' :key='design.id' :design='design')

    template(v-if='viewed_designs.length')
        h2(class='mt-8') {{$t("Read access")}}
        v-list(bg-color='transparent')
            v-list-item(v-for='viewed of viewed_designs' :key='viewed.design_id'
                    @click='open_viewed(viewed)' color='primary')
                v-list-item-title {{ viewed.title || $t("Unnamed design") }}
                v-list-item-subtitle {{ viewed.last_viewed.toLocaleString() }}

</template>


<script lang='ts' setup>

import {computed, ref} from 'vue'
import {useRouter} from 'vue-router'

import DesignListItem from './assets/DesignListItem.vue'
import {user} from '@/services/auth'
import {designs, viewed_designs} from '@/services/designs'

import type {ViewedDesign} from '@/services/types'


const router = useRouter()


// Sort criterion for both "My designs" and "Edit access" (shared toggle)
const sort_by = ref<'modified'|'name'>('modified')

const sort = <T extends {name:string, modified:Date}>(list:T[]):T[] => {
    return [...list].sort((a, b) => {
        return sort_by.value === 'name'
            ? a.name.localeCompare(b.name)
            : b.modified.getTime() - a.modified.getTime()
    })
}


const own = computed(() => designs.filter(item => item.owner === user.value?.uid))
const edit_access = computed(() => designs.filter(item => item.owner !== user.value?.uid))

const own_sorted = computed(() => sort(own.value))
const edit_access_sorted = computed(() => sort(edit_access.value))


const open_viewed = (viewed:ViewedDesign) => {
    void router.push({name: 'design', params: {id: viewed.design_id, version: viewed.last_version_id}})
}

</script>


<style lang='sass' scoped>

.cont
    padding: 24px
    overflow: auto
    flex-grow: 1

.header
    display: flex
    align-items: center
    justify-content: space-between

h2
    font-size: 18px
    margin-bottom: 12px

</style>
