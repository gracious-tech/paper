
<template lang='pug'>

//- Only shown as a fallback when neither the Web Share API nor clipboard access is available
//- (otherwise share_version() handles sharing directly, see services/versions.ts)
v-dialog(:model-value='modelValue' @update:model-value='close' max-width='520')
    v-card
        v-card-title {{$t("dialog.share.title")}}
        v-card-text
            p(class='text-body-small mb-4')
                | {{$t("dialog.share.link_notice")}}
            v-text-field(:model-value='share_url' readonly density='compact' hide-details
                    @focus='select_all')
        v-card-actions
            v-spacer
            v-btn(@click='close') {{$t("common.close")}}

</template>


<script lang='ts' setup>

import {computed} from 'vue'


const props = defineProps<{modelValue:boolean, design_id:string, version_id:string}>()
const emit = defineEmits<{(event:'update:modelValue', value:boolean):void}>()


// Version links are just their canonical viewing URL — publicly readable, no token involved
const share_url = computed(() => `${location.origin}/designs/${props.design_id}/${props.version_id}`)


// Select the whole link when its field is focused (easy manual copy)
const select_all = (event:FocusEvent) => {
    (event.target as HTMLInputElement).select()
}

const close = () => {
    emit('update:modelValue', false)
}

</script>


<style lang='sass' scoped>

</style>
