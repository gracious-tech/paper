
<template lang='pug'>

div.cont(v-if='!trigger_rerender')
    div.generate
        v-btn(@click='generate' :disabled='!blue.content.length || !typst_generator'
            :loading='generating' color='secondary' size='large' rounded) {{$t("Create")}}

    v-text-field.title(v-model='blue.title' :label='$t("Document name")')
    v-divider(class='my-8')

    h2 {{$t("Content")}}
    OptionsContent
    v-divider(class='my-8')

    h2 {{$t("Bible translations")}}
    OptionsBibles
    v-divider(class='my-8')

    h2 {{$t("Book size")}}
    OptionsPaper

    v-divider(class='my-8')

    h2 {{$t("Features")}}
    OptionsFeatures
    v-divider(class='my-8')

    h2 {{$t("Study")}}
    OptionsStudy
    v-divider(class='my-8')

    h2 {{$t("Style")}}
    OptionsStyle
    v-divider(class='my-8')

    h2 {{$t("Layout")}}
    OptionsLayout
    v-divider(class='my-8')

    h2 {{$t("Print")}}
    OptionsPrint
    v-divider(class='my-8')

    h2 {{$t("Other stuff...")}}
    OptionsIgnore

</template>


<script lang='ts' setup>

import {reactive, ref, nextTick} from 'vue'
import {cloneDeep} from 'lodash-es'

import OptionsContent from '@/comp/options/OptionsContent.vue'
import OptionsPreset from '@/comp/options/OptionsPreset.vue'
import OptionsFeatures from '@/comp/options/OptionsFeatures.vue'
import OptionsStyle from '@/comp/options/OptionsStyle.vue'
import OptionsIgnore from '@/comp/options/OptionsIgnore.vue'
import OptionsLayout from '@/comp/options/OptionsLayout.vue'
import OptionsPaper from '@/comp/options/OptionsPaper.vue'
import OptionsPrint from '@/comp/options/OptionsPrint.vue'
import OptionsStudy from '@/comp/options/OptionsStudy.vue'
import OptionsBibles from '@/comp/options/OptionsBibles.vue'
import {PDFDocument} from 'pdf-lib'

import {blue, state, creations, selected_id} from '@/services/state'
import {bible_content} from '@/services/content'
import {typst_generator} from '@/services/typst'
import {gen_content_name, get_default_blueprint} from '@/services/blueprints'
import {generate_token} from '@/services/utils'

import type {Creation} from '@/services/types'


const trigger_rerender = ref(false)


// Whether a PDF is currently being compiled (disables the Create button)
const generating = ref(false)


const generate = async () => {

    // Compiler must be ready (the button is disabled until it is, but guard anyway)
    const generator = typst_generator.value
    if (!generator){
        return
    }

    // Auto-set title if none yet
    if (!blue.title.trim()){
        blue.title = gen_content_name(blue.content[0]!)
    }

    // Snapshot the request from the current draft before any further mutation (it's a plain
    // object, so later edits to `blue` won't affect this in-flight creation)
    const request = await bible_content.resolve(blue)

    // Record the new creation in state
    const creation:Creation = reactive({
        request_id: generate_token(),
        blueprint: cloneDeep(blue),
        created: new Date(),
        status: 'pending',
        pages: null,
        pdf_url: null,
    })
    creations.push(creation)

    // Clear document title
    blue.title = ''

    // Change to history tab
    selected_id.value = creation.request_id
    state.tab = 'history'

    // Compile the final PDF in-browser via Typst
    generating.value = true
    try {
        const bytes = await generator.compile_pdf(request)
        creation.pages = (await PDFDocument.load(bytes)).getPageCount()
        creation.pdf_url = URL.createObjectURL(
            new Blob([bytes as BlobPart], {type: 'application/pdf'}))
        creation.status = 'available'
    } catch (error){
        console.error(error)
        creation.status = 'failed'
    } finally {
        generating.value = false
    }
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
