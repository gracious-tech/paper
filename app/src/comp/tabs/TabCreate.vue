
<template lang='pug'>

div.cont(v-if='!trigger_rerender')
    div.generate
        v-btn(@click='generate' :disabled='!blue.content.length' color='secondary' size='large' rounded) Create

    v-text-field.title(v-model='blue.title' label="Document name")
    v-divider(class='my-8')

    h2 Content
    OptionsContent
    v-divider(class='my-8')

    h2 Bible translations
    OptionsBibles
    v-divider(class='my-8')

    h2 Paper size
    OptionsPaper

    v-divider(class='my-8')

    h2 Quick configs
    OptionsPreset
    p(v-if='!state.advanced' class='text-center mt-10')
        v-btn(@click='state.advanced = true' size='small' variant='flat') More Options

    v-divider(class='my-8')

    template(v-if='state.advanced')

        h2 Features
        OptionsFeatures
        v-divider(class='my-8')

        h2 Study
        OptionsStudy
        v-divider(class='my-8')

        h2 Style
        OptionsStyle
        v-divider(class='my-8')

        h2 Layout
        OptionsLayout
        v-divider(class='my-8')

        h2 Print
        OptionsPrint
        v-divider(class='my-8')

        h2 Legal
        OptionsLegal
        v-divider(class='my-8')

        p(class='text-center mt-10')
            v-btn(@click='state.advanced = false' variant='outlined' size='small' class='ma-2')
                | Show less options
            v-btn(@click='revert' variant='outlined' size='small' class='ma-2')
                | Revert to defaults

</template>


<script lang='ts' setup>

import {reactive, ref, nextTick} from 'vue'
import {cloneDeep} from 'lodash-es'

import OptionsContent from '@/comp/options/OptionsContent.vue'
import OptionsPreset from '@/comp/options/OptionsPreset.vue'
import OptionsFeatures from '@/comp/options/OptionsFeatures.vue'
import OptionsStyle from '@/comp/options/OptionsStyle.vue'
import OptionsLegal from '@/comp/options/OptionsLegal.vue'
import OptionsLayout from '@/comp/options/OptionsLayout.vue'
import OptionsPaper from '@/comp/options/OptionsPaper.vue'
import OptionsPrint from '@/comp/options/OptionsPrint.vue'
import OptionsStudy from '@/comp/options/OptionsStudy.vue'
import OptionsBibles from '@/comp/options/OptionsBibles.vue'
import {blue, state, creations, selected_id} from '@/services/state'
import {gen_combined_css, gen_subjobs} from '@/services/render/render'
import {gen_lines_html, gen_lines_css} from '@/services/render/render_lines'
import {gen_base_css, gen_html} from '@/services/render/render_base'
import {gen_content_name, get_default_blueprint} from '@/services/blueprints'
import {put_request} from '@/services/backend'
import {generate_token} from '@/services/utils'
import {monitor_creation} from '@/services/create'
import {database} from '@/services/db'

import type {Creation, PaperRequest} from '@/services/types'


const trigger_rerender = ref(false)


const generate = async () => {

    // Auto-set title if none yet
    if (!blue.title.trim()){
        blue.title = gen_content_name(blue.content[0]!)
    }

    // Save to db
    const creation:Creation = reactive({
        request_id: generate_token(),
        blueprint: cloneDeep(blue),
        created: new Date(),
        creation_id: null,
        status: 'pending',
        pages: null,
    })
    await database.creations_set(creation)
    creations.push(creation)

    // Clear document title
    blue.title = ''

    // Change to history tab
    selected_id.value = creation.request_id
    state.tab = 'history'

    // Form request
    const css = gen_combined_css()
    const subjobs = gen_subjobs()
    for (const subjob of subjobs){
        subjob[0] = gen_html(css, subjob[0])
        if (subjob[1]){
            subjob[1] = gen_html(css, subjob[1])
        }
    }
    const body:PaperRequest = {
        request_id: generate_token(),
        title: blue.title,
        booklet: blue.page_arrangement === 'booklet',
        blank_job: blue.show_lines
            ? gen_html(gen_base_css() + gen_lines_css(), gen_lines_html())
            : gen_html(gen_base_css(), ''),
        subjobs,
        blue: JSON.stringify(blue),
    }

    // Send request
    try {
        creation.creation_id = await put_request(creation.request_id, JSON.stringify(body))
    } catch (error){
        console.error(error)
        creation.status = 'failed'
        return
    } finally {
        // Save changes to creation record to db
        void database.creations_set(creation)
    }

    // Poll PDF creation
    monitor_creation(creation)
}


// Revert all settings to their defaults (except content)
const revert = () => {
    const defaults = get_default_blueprint()
    for (const [key, val] of Object.entries(defaults)){
        if (['content'].includes(key)){
            continue  // Don't wipe content
        }
        // @ts-ignore Can't know type but all will be valid
        blue[key] = val
    }

    // OptionsPaper (and possibly others) have state that won't update properly unless rerendered
    trigger_rerender.value = true
    nextTick(() => {
        trigger_rerender.value = false
    })
}


</script>


<style lang='sass' scoped>

.generate
    text-align: right
    position: sticky
    top: 0  // For sticky to work
    z-index: 1
    height: 0  // So can still select elements to left of button where div would normally be

.cont
    padding: 24px
    overflow: auto
    padding-bottom: 30vh

.title
    max-width: 70%

h2
    font-size: 18px
    margin-bottom: 12px

</style>
