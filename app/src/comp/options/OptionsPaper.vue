
<template lang='pug'>

//- Printing service ("Home" + real services + a "Custom…" entry for manual bleed/spine)
v-select(v-model='blue.service_id' :items='service_items' :label='$t("Printing service")'
    variant='underlined' density='compact' style='max-width: 320px')

//- Home mode: a simple A4 / US Letter choice, plus the fold-at-home booklet option
template(v-if='is_home')
    v-radio-group(v-model='blue.size_id' inline class='mt-2')
        v-radio(value='a4' label="A4")
        v-radio(value='us_letter' label="US Letter")

    v-switch(v-model='blue.booklet' :label='$t("Booklet (fold at home)")' color='primary'
        density='compact' hide-details)
    p(v-if='blue.booklet' class='text-body-2 text-secondary') {{ $t("Two pages will appear on each side of paper and will only appear in the correct order once the whole booklet has been folded.") }}

//- Service / custom modes: full trim size + print options
template(v-else)
    //- Trim size header, with a unit toggle shown only in custom-service mode
    div(class='d-flex align-center mt-2')
        span(class='text-medium-emphasis mr-4') {{ $t("Trim size") }}
        v-btn-toggle(v-if='is_custom' :model-value='blue.custom_unit'
            @update:model-value='set_unit' density='compact' variant='outlined' divided mandatory)
            v-btn(v-for='u in unit_items' :key='u' :value='u' size='small') {{ u }}

    //- Named sizes: a button group when few, a dropdown when many; always a "Custom" option
    div(v-if='use_buttons' class='d-flex flex-wrap ga-2 my-2')
        v-btn(v-for='s in size_items' :key='s.id' size='small'
            :variant='blue.size_id === s.id ? "flat" : "outlined"'
            :color='blue.size_id === s.id ? "primary" : undefined'
            @click='select_size(s.id)') {{ s.title }}
        v-btn(size='small'
            :variant='blue.size_id === "" ? "flat" : "outlined"'
            :color='blue.size_id === "" ? "primary" : undefined'
            @click='select_custom') {{ $t("Custom") }}
    v-select(v-else :model-value='blue.size_id || "__custom__"' @update:model-value='on_size_select'
        :items='size_select_items' variant='underlined' density='compact'
        style='max-width: 320px' class='my-2')

    //- Custom dimensions, only shown when no named size is selected
    div(v-if='blue.size_id === ""' class='d-flex align-center ml-2 mb-4')
        v-text-field(v-model.number='blue.custom_trim_width' type='number' variant='underlined'
            density='compact' :label='$t("Width")' class='mr-4')
        v-text-field(v-model.number='blue.custom_trim_height' type='number' variant='underlined'
            density='compact' :label='$t("Height")' class='mr-4')
        //- Unit select only in regular-service mode (custom-service mode uses the toggle above)
        v-radio-group(v-if='!is_custom' v-model='blue.custom_unit' inline)
            v-radio(value='mm' label="mm")
            v-radio(value='inch' label="inches")

    //- Custom-service mode: bleed and spine width (units follow the toggle above)
    div(v-if='is_custom' class='d-flex align-center ml-2 mb-4')
        v-text-field(v-model.number='blue.custom_bleed' type='number' variant='underlined'
            density='compact' :label='$t("Bleed")' class='mr-4' style='max-width: 120px')
        v-text-field(v-model.number='blue.custom_spine' type='number' variant='underlined'
            density='compact' :label='$t("Spine width")' class='mr-4' style='max-width: 120px')

    //- Regular-service mode: binding, ink and paper type (page count isn't asked for — it's
    //- determined by the document itself, estimated from the preview until a version compiles)
    template(v-else)
        div(v-if='binding_items.length > 1' class='ml-2 my-4')
            v-select(v-model='blue.binding_type' :items='binding_items' :label='$t("Binding")'
                variant='underlined' density='compact' style='max-width: 240px')

        //- Warn (never auto-switch) when the chosen binding doesn't suit the estimated length —
        //- the estimate refreshes after every preview compile, and the user keeps their choice
        v-alert(v-if='binding_warning' type='warning' variant='tonal' density='compact'
            class='ml-2 my-4' :text='binding_warning')

        div(v-if='show_ink_type && ink_items.length > 1' class='ml-2 my-4')
            v-select(v-model='blue.ink_type' :items='ink_items' :label='$t("Ink type")'
                variant='underlined' density='compact' style='max-width: 240px')

        div(v-if='show_paper_type && paper_items.length > 1' class='ml-2 my-4')
            v-select(v-model='blue.paper_type' :items='paper_items' :label='$t("Paper type")'
                variant='underlined' density='compact' style='max-width: 240px')

</template>


<script lang='ts' setup>

import {computed, watch} from 'vue'
import {useI18n} from 'vue-i18n'
import {list_services, get_service, get_common_sizes} from 'printing-services'
import type {ServicePublic, SizeId, BindingTypeId, InkTypeId} from 'printing-services'

import {blue, estimated_pages} from '@/services/state'
import {format_dims, binding_page_issue} from '@/services/blueprints'


const {t} = useI18n()


// Unit options for custom sizes (printing-services uses 'inch', not 'in')
const unit_items = ['mm', 'inch']


// Service dropdown items: "Home" + real services + a "Custom…" entry
const service_items = computed(() => [
    {title: t("Home"), value: 'home'},
    ...list_services().map(s => ({title: s.name, value: s.id})),
    {title: t("Custom…"), value: 'custom'},
])


// Whether we're in home mode (simple A4 / US Letter choice for home printing)
const is_home = computed(() => blue.service_id === 'home')


// Whether we're in custom-service mode (no print service; manual bleed/spine)
const is_custom = computed(() => blue.service_id === 'custom')


// The currently selected service (null in the service-less home/custom modes)
const service = computed<ServicePublic|null>(() =>
    (is_home.value || is_custom.value)
        ? null
        : get_service(blue.service_id as Parameters<typeof get_service>[0]))


// Available named sizes: the service's sizes, or the common list in the service-less modes
const size_items = computed(() => {
    const sizes = service.value
        ? service.value.get_sizes({numbers: 'number', all: true})
        : get_common_sizes({numbers: 'number'})
    return sizes.map(s => ({
        id: s.id,
        title: `${s.name} (${format_dims(s.width, s.height, s.unit)})`,
    }))
})


// Show sizes as a button group when few, otherwise a dropdown (matches bookcover's >5 rule)
const use_buttons = computed(() => size_items.value.length <= 5)


// Dropdown items reuse the named sizes plus a trailing "Custom" entry
const size_select_items = computed(() => [
    ...size_items.value.map(s => ({title: s.title, value: s.id})),
    {title: t("Custom"), value: '__custom__'},
])


// Binding/ink/paper option lists, with invalid options disabled (regular service only).
// Page count is deliberately not part of the binding validity here — it's only an estimate
// that shifts with every edit, so it warns (binding_warning below) rather than disabling
const binding_items = computed(() =>
    service.value?.get_binding_types({
        all: true,
        ...blue.size_id && {size: blue.size_id as SizeId},
    }).map(b => ({title: b.name, value: b.id, props: {disabled: !b.valid}})) ?? [])

const ink_items = computed(() =>
    service.value?.get_ink_types({
        all: true,
        ...blue.binding_type && {binding_type: blue.binding_type as BindingTypeId},
    }).map(i => ({title: i.name, value: i.id, props: {disabled: !i.valid}})) ?? [])

const paper_items = computed(() =>
    service.value?.get_paper_types({
        all: true,
        ...blue.binding_type && {binding_type: blue.binding_type as BindingTypeId},
        ...blue.ink_type && {ink_type: blue.ink_type as InkTypeId},
    }).map(p => ({title: p.name, value: p.id, props: {disabled: !p.valid}})) ?? [])


// Whether the service needs ink/paper type to compute cover dimensions
const show_ink_type = computed(() => service.value?.cover_calc_requires_ink ?? false)
const show_paper_type = computed(() => service.value?.cover_calc_requires_paper ?? false)


// Warning text when the chosen binding doesn't suit the document's estimated length — shown
// instead of ever auto-switching the binding, since the estimate can shift with every edit.
// Silent until the first preview compile has produced an estimate (no point warning off the
// generic fallback guess). States whether it's too short or too long and the limit, since a
// bare "may not support this length" leaves the user guessing which direction to fix
const binding_warning = computed(() => {
    if (estimated_pages.value === null){
        return null
    }
    const issue = binding_page_issue(blue, estimated_pages.value)
    if (!issue){
        return null
    }
    const requirement = issue.fewer
        ? t("requires at least")
        : t("allows at most")
    return `${issue.name} ${t("binding")} ${requirement} ${issue.limit}`
        + ` ${t("pages, but this document is estimated at")} ~${estimated_pages.value} ${t("pages")}.`
})


// Select a named size preset
function select_size(id:string):void{
    blue.size_id = id
}


// Switch to custom dimensions
function select_custom():void{
    blue.size_id = ''
}


// Dropdown handler: route the trailing "Custom" option to custom mode
function on_size_select(value:string):void{
    if (value === '__custom__'){
        select_custom()
    } else {
        select_size(value)
    }
}


// Convert a measurement between mm and inch, rounded to 3 decimals
function convert_unit(value:number, from:string, to:string):number{
    if (from === to){
        return value
    }
    const converted = from === 'mm' ? value / 25.4 : value * 25.4
    return Math.round(converted * 1000) / 1000
}


// Toggle the unit (custom-service mode), converting all custom measurements to match
function set_unit(unit:string):void{
    const from = blue.custom_unit
    if (from === unit){
        return
    }
    blue.custom_trim_width = convert_unit(blue.custom_trim_width, from, unit)
    blue.custom_trim_height = convert_unit(blue.custom_trim_height, from, unit)
    blue.custom_bleed = convert_unit(blue.custom_bleed, from, unit)
    blue.custom_spine = convert_unit(blue.custom_spine, from, unit)
    blue.custom_unit = unit as 'mm'|'inch'
}


// Reset ink to the first valid option when the current one is no longer valid
function reset_ink_if_invalid():void{
    if (!service.value){
        return
    }
    const valid = service.value.get_ink_types({binding_type: blue.binding_type as BindingTypeId})
    if (valid.length && !valid.some(i => i.id === blue.ink_type)){
        blue.ink_type = valid[0]!.id
    }
}


// Reset paper to the first valid option when the current one is no longer valid
function reset_paper_if_invalid():void{
    if (!service.value){
        return
    }
    const valid = service.value.get_paper_types({
        binding_type: blue.binding_type as BindingTypeId,
        ink_type: blue.ink_type as InkTypeId,
    })
    if (valid.length && !valid.some(p => p.id === blue.paper_type)){
        blue.paper_type = valid[0]!.id
    }
}


// When the service changes, reset all dependent selections to their first available option
watch(() => blue.service_id, () => {
    if (is_home.value){
        // Home printing: keep it to A4 / US Letter
        if (blue.size_id !== 'a4' && blue.size_id !== 'us_letter'){
            blue.size_id = 'a4'
        }
        return
    }
    // Booklet (fold-at-home) only applies to home printing
    blue.booklet = false
    if (is_custom.value){
        // Custom service: default to the first common size and a plain paperback binding
        const sizes = get_common_sizes({numbers: 'number'})
        blue.size_id = sizes.length ? sizes[0]!.id : ''
        blue.binding_type = 'paperback'
        return
    }
    const sizes = service.value!.get_sizes()
    blue.size_id = sizes.length ? sizes[0]!.id : ''
    const bindings = service.value!.get_binding_types()
    blue.binding_type = bindings.length ? bindings[0]!.id : ''
    const inks = service.value!.get_ink_types()
    blue.ink_type = inks.length ? inks[0]!.id : ''
    const papers = service.value!.get_paper_types()
    blue.paper_type = papers.length ? papers[0]!.id : ''
})


// When the binding changes, ink and paper may become invalid
watch(() => blue.binding_type, () => {
    reset_ink_if_invalid()
    reset_paper_if_invalid()
})


// When the ink changes, paper may become invalid
watch(() => blue.ink_type, () => {
    reset_paper_if_invalid()
})


</script>


<style lang='sass' scoped>



</style>
