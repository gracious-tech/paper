
<template lang='pug'>

div
    p(class='mb-5 text-body-medium text-medium-emphasis') {{ $t("wizard.cover.question") }}
    v-alert(type='info' variant='tonal' density='compact' class='mb-5 py-1 px-3 text-body-medium')
        | {{ $t("wizard.cover.more_later") }}
    v-text-field(v-model='draft.title' :label='$t("common.title")' :placeholder='auto_title'
        persistent-placeholder density='compact' variant='outlined' hide-details class='mb-6')
    div.grid
        NewDesignCard(v-for='item of covers' :key='item.id' :image='item.image' :label='item.label'
            :selected='draft.cover === item.id' :ratio='item.ratio' hide_label square
            @select='draft.cover = item.id')
</template>


<script lang='ts' setup>

import {computed, onBeforeUnmount, reactive, watch} from 'vue'
import {useI18n} from '@/services/i18n'
import {debounce} from 'lodash-es'

import NewDesignCard from '@/comp/dialogs/assets/NewDesignCard.vue'
import {wizard_auto_title, wizard_cover_label, wizard_preview_blueprint, render_wizard_preview}
    from '@/services/new_design'
import {typst_generator} from '@/services/typst'

import type {NewDesignDraft, NewDesignCover} from '@/services/new_design'


// Wizard step 5: pick a cover style (seeded as a starting point; refined later in the cover
// editor). Home printing additionally offers "minimal ink" — a plain black-icon cover
const props = defineProps<{draft:NewDesignDraft}>()
const draft = props.draft

const {t} = useI18n()


// Placeholder for the title field: the value the cover auto-generates when the title is blank
// (the first included passage's reference), reflecting the draft's current content/translation
const auto_title = computed(() => wizard_auto_title(draft))


// Live-rendered front-panel SVGs (as blob URLs) for each preset, filled in as they resolve —
// reactive so `covers` picks up each one as soon as it's ready. Kept outside the `covers`
// computed so a debounced re-render doesn't have to fight a computed's own caching
const preview_images = reactive<Partial<Record<NewDesignCover, string>>>({})

// Each card's real width/height ratio, read straight off its rendered SVG (the front panel's
// own <svg width/height> — see split_svg in bookcover-core) so the card matches the actual
// proportions of the chosen book size/service rather than a generic placeholder box
const preview_ratios = reactive<Partial<Record<NewDesignCover, number>>>({})

// Pull the front panel's own width/height (in pt) off its root <svg> tag
function svg_ratio(svg:string):number|null {
    const width = /<svg[^>]*\swidth="([\d.]+)pt"/.exec(svg)?.[1]
    const height = /<svg[^>]*\sheight="([\d.]+)pt"/.exec(svg)?.[1]
    return width && height ? Number(width) / Number(height) : null
}

// Render live SVG previews for every style, reflecting the draft's current book/translation/
// print selections — each goes through the same builders real design creation uses (a cover
// render for photo/pattern/icon, the opening title page for minimal ink — see
// render_wizard_preview). Each card's previous blob URL is revoked once its replacement is
// ready, so re-renders don't leak
async function render_previews(){
    const blueprint = wizard_preview_blueprint(draft)
    // Only the styles currently on offer — minimal ink costs a Typst compile of its own, so
    // don't render it for a draft that isn't printing at home
    const kinds:NewDesignCover[] = ['photo', 'pattern', 'icon']
    // Minimal ink is only offered for home printing, and needs the book's own Typst compiler
    // (still initialising on a fresh page load — the watcher below re-renders once it's ready)
    if (draft.service_id === 'home' && typst_generator.value){
        kinds.push('minimal')
    }
    await Promise.all(kinds.map(async kind => {
        try {
            const svg = await render_wizard_preview(kind, blueprint)
            const url = URL.createObjectURL(new Blob([svg], {type: 'image/svg+xml'}))
            const previous = preview_images[kind]
            preview_images[kind] = url
            const ratio = svg_ratio(svg)
            if (ratio){
                preview_ratios[kind] = ratio
            }
            if (previous){
                URL.revokeObjectURL(previous)
            }
        } catch (error){
            // Leave this card without a preview — it falls back to showing its label, and the
            // other cards (and picking a style at all) shouldn't be blocked by one bad render
            console.error(error)
        }
    }))
}

// Re-render on every relevant draft change, debounced so a burst of edits (e.g. toggling many
// books) only triggers one render pass
const debounced_render = debounce(() => {void render_previews()}, 400)
watch(() => [draft.type, draft.title, draft.book_mode, draft.books, draft.passages,
    draft.bibles, draft.service_id, draft.size_id, typst_generator.value],
    debounced_render, {deep: true, immediate: true})

onBeforeUnmount(() => {
    debounced_render.cancel()
    for (const url of Object.values(preview_images)){
        URL.revokeObjectURL(url)
    }
})


// The offered cover styles (minimal ink only when printing at home) — labels shared with the
// simple-mode summary row via wizard_cover_label()
const covers = computed(() => {
    const items:{id:NewDesignCover, image?:string|undefined, label:string,
        ratio?:number|undefined}[] = [
        {id: 'photo', image: preview_images.photo,
            label: wizard_cover_label('photo', t), ratio: preview_ratios.photo},
        {id: 'pattern', image: preview_images.pattern,
            label: wizard_cover_label('pattern', t), ratio: preview_ratios.pattern},
        {id: 'icon', image: preview_images.icon,
            label: wizard_cover_label('icon', t), ratio: preview_ratios.icon},
    ]
    if (draft.service_id === 'home'){
        items.push({id: 'minimal', image: preview_images.minimal,
            label: wizard_cover_label('minimal', t), ratio: preview_ratios.minimal})
    }
    return items
})


// If the user went back and switched away from home printing, a minimal-ink choice is no
// longer valid — clear it so they must choose again
watch(() => draft.service_id, () => {
    if (draft.cover === 'minimal' && draft.service_id !== 'home'){
        draft.cover = null
    }
})


</script>


<style lang='sss' scoped>

.grid
    display: grid
    grid-template-columns: 1fr 1fr
    gap: 12px
    // Cap the cards' size in the wide dialog so a pair of covers fits without much scrolling
    max-width: 640px
    margin: 0 auto

    // Reserve the border width for both states so selecting a card doesn't shift layout
    :deep(.v-card)
        border-width: 3px
        border-color: transparent

    :deep(.v-card.selected)
        border-color: rgb(var(--v-theme-secondary))

</style>
