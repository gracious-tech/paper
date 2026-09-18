
<template lang='pug'>

v-dialog(v-model='open' max-width='520' :fullscreen='is_mobile')
    v-card(v-if='version')
        v-card-title(class='px-6 pt-4') {{ $t("dialog.estimate_cost.title") }}
        v-card-text(class='px-6 pt-2')
            //- What the quote depends on that the design doesn't already decide
            div(class='d-flex flex-wrap ga-4 my-2')
                v-autocomplete(v-model='country' :items='countries'
                    :label='$t("dialog.estimate_cost.country")'
                    density='compact' hide-details auto-select-first style='flex: 2 1 220px')
                v-text-field(v-model.number='quantity' type='number' min='1' :max='MAX_QUANTITY'
                    :label='$t("dialog.estimate_cost.quantity")'
                    density='compact' hide-details style='flex: 1 1 120px')

            //- The quote itself — kept at a steady minimum height so retyping the quantity
            //- doesn't make the dialog jump around between results
            div.result
                div(v-if='pending' class='d-flex justify-center align-center py-8')
                    v-progress-circular(indeterminate color='primary')
                div(v-else-if='error' class='py-4')
                    v-alert(type='warning' variant='tonal' density='compact')
                        | {{ error }}
                template(v-else-if='estimate')
                    p(class='text-body-small text-medium-emphasis mb-1')
                        | {{ $t("dialog.estimate_cost.currency_note", {currency: estimate.currency}) }}
                    dl(class='costs')
                        dt
                            | {{ $t("dialog.estimate_cost.per_book") }}
                            span(v-if='spec' class='detail') {{ $t("dialog.estimate_cost.spec", {binding: spec.binding}) }}
                        dd {{ money(estimate.unit_cost) }}
                        template(v-if='estimate.quantity > 1')
                            dt {{ count_phrase('dialog.estimate_cost.books', estimate.quantity) }}
                            dd {{ money(estimate.books_total) }}
                        dt.delivery
                            | {{ $t("dialog.estimate_cost.delivery") }}
                            span.detail {{ delivery_detail }}
                        dd.delivery {{ money(estimate.shipping.cost) }}
                        dt.total {{ $t("dialog.estimate_cost.total") }}
                        dd.total {{ money(estimate.total) }}

            p(v-if='estimate' class='mt-4 text-body-small text-medium-emphasis')
                | {{ $t("dialog.estimate_cost.disclaimer") }}

            //- A cheaper binding Lulu also offers for this book, if any
            v-alert(v-if='spec?.cheaper_binding' type='info' variant='tonal' density='compact'
                    class='mt-4' :text='$t("dialog.estimate_cost.tip", {binding: spec.cheaper_binding})')

        v-card-actions(class='px-6 pb-4')
            v-btn(:href='lulu_pricing' target='_blank' variant='text' color='secondary')
                | {{ $t("dialog.estimate_cost.lulu_pricing") }}
            v-spacer
            v-btn(@click='open = false' variant='tonal') {{ $t("common.close") }}

</template>


<script lang='ts' setup>

import {computed, nextTick, onUnmounted, ref, watch} from 'vue'
import {get_service} from 'printing-services'

import {count_phrase as count_phrase_base, useI18n} from '@/services/i18n'
import {state} from '@/services/state'
import {use_is_mobile} from '@/services/display'
import {locale_to_bcp47} from '@/services/locale'
import {country_items, estimate_print_cost, guess_country, lulu_pod_package_id, lulu_print_spec,
    NotPrintable, remember_country} from '@/services/print_cost'
import {report_error} from '@/services/errors'

import type {PrintCostEstimate} from '@/services/print_cost'


const {t, locale} = useI18n()

// Bound to the active translator, for the "{n} book(s)" quantity line
const count_phrase = (stem:string, n:number):string => count_phrase_base(t, stem, n)


// Fullscreen on mobile (the cost table plus two fields outgrows a phone modal)
const is_mobile = use_is_mobile()


// Bound to state.estimate_cost — the version being quoted, or null when hidden
const open = computed({
    get: () => state.estimate_cost !== null,
    set: value => {
        if (!value){
            state.estimate_cost = null
        }
    },
})

const version = computed(() => state.estimate_cost)

// The book's binding/ink/paper in plain words, plus any cheaper valid alternative for each
const spec = computed(() =>
    version.value ? lulu_print_spec(version.value.blueprint, version.value.pages) : null)


// Where the books would be delivered, and how many of them
const country = ref(guess_country())
const quantity = ref(1)

// The current quote, and whichever of "still asking" / "couldn't quote" applies instead
const estimate = ref<PrintCostEstimate|null>(null)
const pending = ref(false)
const error = ref<string|null>(null)


// Every destination Lulu delivers to, named in the user's language
const countries = computed(() => country_items(locale.value))


// Lulu's own pricing page, for anyone who wants to price a variation we don't offer
const lulu_pricing = get_service('lulu').url_pricing


// Lulu quotes in one of five currencies, picked from the destination — never assume the
// browser's own, and always name the one the quote actually came back in
function money(amount:number):string{
    return new Intl.NumberFormat(locale_to_bcp47(locale.value),
        {style: 'currency', currency: estimate.value?.currency ?? 'USD'}).format(amount)
}


// Who carries it and how long Lulu expects it to take, shown under the delivery label
const delivery_detail = computed(() => {
    const shipping = estimate.value?.shipping
    if (!shipping){
        return ''
    }
    const {days_min: min, days_max: max} = shipping
    return min && max
        ? t('dialog.estimate_cost.delivery_detail', {carrier: shipping.carrier, min, max})
        : shipping.carrier
})


// Re-quote on every change, after a pause — the quantity field is typed into digit by digit
// and each intermediate value would otherwise cost a request
const DEBOUNCE_MS = 600
let debounce_timer:ReturnType<typeof setTimeout>|null = null
let request_count = 0

// More copies than anyone orders at once; Lulu's own limits apply well before this
const MAX_QUANTITY = 10000

// Set while the dialog seeds its fields as it opens, so the change watcher below doesn't queue
// a second quote on top of the one opening already asks for
let seeding = false


// Work out a fresh quote, ignoring the answer if the fields have moved on since
async function refresh():Promise<void>{
    const blueprint = version.value?.blueprint
    const pages = version.value?.pages
    const sku = blueprint ? lulu_pod_package_id(blueprint) : null
    // The buttons that open this only appear for a quotable version, so a missing SKU/page
    // count can only mean the dialog was left open while the selection changed. A half-typed
    // quantity (blank, 0, absurdly large) simply leaves the last quote up
    if (!sku || !pages || !Number.isInteger(quantity.value) || quantity.value < 1
            || quantity.value > MAX_QUANTITY){
        return
    }
    const this_request = ++request_count
    pending.value = true
    error.value = null
    try {
        const result = await estimate_print_cost(sku, pages, quantity.value, country.value)
        if (this_request === request_count){
            estimate.value = result
        }
    } catch (exception){
        if (this_request !== request_count){
            return
        }
        estimate.value = null
        // Lulu having no such product is an answer, not a fault — anything else is worth
        // reporting (a network failure, or a change in their API)
        if (exception instanceof NotPrintable){
            error.value = t('dialog.estimate_cost.unavailable')
        } else {
            error.value = t('dialog.estimate_cost.failed')
            // The dialog shows the failure itself, so no banner on top of it
            report_error('silent', exception)
        }
    } finally {
        if (this_request === request_count){
            pending.value = false
        }
    }
}


// Queue a quote, replacing any already waiting
function schedule():void{
    if (debounce_timer){
        clearTimeout(debounce_timer)
    }
    debounce_timer = setTimeout(() => {
        void refresh()
    }, DEBOUNCE_MS)
}


// Quote as soon as the dialog opens (with the remembered country and a single copy), then
// again whenever either field changes
watch(open, async is_open => {
    if (!is_open){
        return
    }
    seeding = true
    country.value = guess_country()
    quantity.value = 1
    estimate.value = null
    error.value = null
    await nextTick()
    seeding = false
    void refresh()
})

watch([country, quantity], () => {
    if (!open.value || seeding){
        return
    }
    // The country is a deliberate choice, so it's the one worth carrying to the next design
    remember_country(country.value)
    schedule()
})


onUnmounted(() => {
    if (debounce_timer){
        clearTimeout(debounce_timer)
    }
})

</script>


<style lang='sss' scoped>

// Hold a stable height across loading/error/result so the dialog doesn't jump while typing
.result
    min-height: 150px

// Label/amount rows, amounts right-aligned in their own column, ruled like a table so the
// rows don't run together
.costs
    display: grid
    grid-template-columns: 1fr auto
    column-gap: 16px
    align-items: baseline

    dt, dd
        padding: 16px 0 8px 0

    dd
        text-align: right
        font-variant-numeric: tabular-nums

    // The total is separated from the parts that make it up, not just another ruled row
    .total
        font-weight: 600
        padding-top: 14px
        border-top: 1px solid rgba(0, 0, 0, 0.3)
        border-bottom: none

    .delivery
        align-self: center

    // Carrier and delivery time, subordinate to the label they follow
    .detail
        display: block
        font-size: 0.8rem
        opacity: 0.7
        padding-top: 4px

</style>
