
<template lang='pug'>

component.icon(:is='icons[name]')

</template>


<script lang='ts' setup>


import drag_indicator from '@material-symbols/svg-400/outlined/drag_indicator.svg?component'
import close from '@material-symbols/svg-400/outlined/close.svg?component'
import arrow_back from '@material-symbols/svg-400/outlined/arrow_back.svg?component'
import expand_more from '@material-symbols/svg-400/outlined/expand_more.svg?component'
import copyright from '@material-symbols/svg-400/outlined/copyright.svg?component'
import auto_stories from '@material-symbols/svg-400/outlined/auto_stories.svg?component'
import subject from '@material-symbols/svg-400/outlined/subject.svg?component'
import download from '@material-symbols/svg-400/outlined/download.svg?component'
import upload from '@material-symbols/svg-400/outlined/upload.svg?component'
import error from '@material-symbols/svg-400/outlined/error.svg?component'
import more_vert from '@material-symbols/svg-400/outlined/more_vert.svg?component'
import more_horiz from '@material-symbols/svg-400/outlined/more_horiz.svg?component'
import lists from '@material-symbols/svg-400/outlined/lists.svg?component'
import history_toggle_off from '@material-symbols/svg-400/outlined/history_toggle_off.svg?component'
import add from '@material-symbols/svg-400/outlined/add.svg?component'
import content_copy from '@material-symbols/svg-400/outlined/content_copy.svg?component'
import delete_icon from '@material-symbols/svg-400/outlined/delete.svg?component'
import group from '@material-symbols/svg-400/outlined/group.svg?component'
import share from '@material-symbols/svg-400/outlined/share.svg?component'
import account_circle from '@material-symbols/svg-400/outlined/account_circle.svg?component'
import straighten from '@material-symbols/svg-400/outlined/straighten.svg?component'
import menu_book from '@material-symbols/svg-400/outlined/menu_book.svg?component'
import description from '@material-symbols/svg-400/outlined/description.svg?component'
import print from '@material-symbols/svg-400/outlined/print.svg?component'
import warning from '@material-symbols/svg-400/outlined/warning.svg?component'
import check from '@material-symbols/svg-400/outlined/check.svg?component'

import planner_banner from '@/assets/planner_banner.svg?component'
import donate from '@/assets/icons/donate.svg?component'


import type {FunctionalComponent} from 'vue'


defineProps({
    name: {required: true, type: String},
})


const icons = {
    drag_indicator, close, arrow_back, expand_more, planner_banner, copyright, auto_stories,
    subject, download, upload, error, more_vert, more_horiz, lists, history_toggle_off, donate,
    add, content_copy, 'delete': delete_icon, group, share, account_circle, straighten,
    menu_book, description, print, warning, check,
} as Record<string, FunctionalComponent>


</script>


<style lang='sass' scoped>

.icon
    height: 24px
    width: 24px
    fill: currentColor

</style>
