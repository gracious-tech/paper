
<template lang='pug'>

HtmlEditor(:value='html' :init='config' @input='$emit("input", $event)')

</template>


<script lang='ts' setup>

// All required by tinymce for basic function
import 'tinymce/tinymce'
import 'tinymce/models/dom'
import 'tinymce/icons/default'
import 'tinymce/themes/silver/theme'
import 'tinymce/skins/ui/oxide/skin.min.css'

// Optional plugins
import 'tinymce/plugins/lists'
import 'tinymce/plugins/advlist'
import 'tinymce/plugins/table'
import 'tinymce/plugins/pagebreak'

// These styles need to be inserted within the sandboxed iframe
import content_css from 'tinymce/skins/content/default/content.css?raw'
import content_skin_css from 'tinymce/skins/ui/oxide/content.css?raw'

import HtmlEditor from '@tinymce/tinymce-vue'


const config = {
    promotion: false,
    menubar: false,
    statusbar: false,
    plugins: 'lists advlist table pagebreak',
    toolbar1: 'bold italic underline superscript subscript | blocks bullist numlist table | alignleft aligncenter alignright alignjustify | hr pagebreak | undo redo',
    pagebreak_separator: '<hr class="page-break">',
    content_style: content_css + content_skin_css,
}


defineProps<{html:string}>()


</script>


<style lang='sass' scoped>

</style>
