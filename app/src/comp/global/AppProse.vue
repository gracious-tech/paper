
<template lang='pug'>

div(class='prose d-flex flex-column')

    //- Formatting toolbar (grouped, with dividers between groups)
    div(class='toolbar d-flex flex-wrap align-center' v-if='editor')
        template(v-for='(group, gi) in groups' :key='gi')
            v-divider(v-if='gi' vertical class='mx-1')
            v-btn(v-for='btn in group' :key='btn.title'
                :title='btn.title'
                size='small' variant='text' density='comfortable'
                :color='btn.active && btn.active() ? "secondary" : undefined'
                @click='btn.run')
                component(:is='btn.icon' class='btn-icon')

    //- The editable content area
    editor-content(:editor='editor' class='content flex-grow-1')

</template>


<script lang='ts' setup>

import {onBeforeUnmount, watch} from 'vue'
import {useEditor, EditorContent} from '@tiptap/vue-3'
import StarterKit from '@tiptap/starter-kit'
import Subscript from '@tiptap/extension-subscript'
import Superscript from '@tiptap/extension-superscript'
import TextAlign from '@tiptap/extension-text-align'

import format_bold from '@material-symbols/svg-400/outlined/format_bold.svg?component'
import format_italic from '@material-symbols/svg-400/outlined/format_italic.svg?component'
import format_underlined from '@material-symbols/svg-400/outlined/format_underlined.svg?component'
import superscript_icon from '@material-symbols/svg-400/outlined/superscript.svg?component'
import subscript_icon from '@material-symbols/svg-400/outlined/subscript.svg?component'
import format_h1 from '@material-symbols/svg-400/outlined/format_h1.svg?component'
import format_h2 from '@material-symbols/svg-400/outlined/format_h2.svg?component'
import format_list_bulleted from '@material-symbols/svg-400/outlined/format_list_bulleted.svg?component'
import format_list_numbered from '@material-symbols/svg-400/outlined/format_list_numbered.svg?component'
import format_align_left from '@material-symbols/svg-400/outlined/format_align_left.svg?component'
import format_align_center from '@material-symbols/svg-400/outlined/format_align_center.svg?component'
import format_align_right from '@material-symbols/svg-400/outlined/format_align_right.svg?component'
import format_align_justify from '@material-symbols/svg-400/outlined/format_align_justify.svg?component'
import horizontal_rule from '@material-symbols/svg-400/outlined/horizontal_rule.svg?component'
import undo_icon from '@material-symbols/svg-400/outlined/undo.svg?component'
import redo_icon from '@material-symbols/svg-400/outlined/redo.svg?component'

import type {PmDoc} from 'paper-bible-typst'


// Doc is typed as PmDoc (pm-to-typst's ProseMirror model) to match ContentCustom.doc; Tiptap's
// getJSON() output is structurally compatible
const props = defineProps<{modelValue:PmDoc}>()
const emit = defineEmits<{(e:'update:modelValue', value:PmDoc):void}>()


// Create the editor, seeded with the current doc and emitting JSON on every change
const editor = useEditor({
    content: props.modelValue,
    extensions: [
        StarterKit,
        Subscript,
        Superscript,
        TextAlign.configure({types: ['heading', 'paragraph']}),
    ],
    onUpdate: () => {
        // getJSON() returns Tiptap's doc type; cast to the structurally-compatible PmDoc
        emit('update:modelValue', editor.value!.getJSON() as PmDoc)
    },
})


// Sync external doc changes back into the editor (e.g. when cancel restores the original)
watch(() => props.modelValue, value => {
    if (editor.value && JSON.stringify(value) !== JSON.stringify(editor.value.getJSON())){
        editor.value.commands.setContent(value, {emitUpdate: false})
    }
})


// Toolbar buttons grouped for divider placement; each maps to a Tiptap command
const groups = [
    [
        {title: "Bold", icon: format_bold,
            active: () => editor.value!.isActive('bold'),
            run: () => editor.value!.chain().focus().toggleBold().run()},
        {title: "Italic", icon: format_italic,
            active: () => editor.value!.isActive('italic'),
            run: () => editor.value!.chain().focus().toggleItalic().run()},
        {title: "Underline", icon: format_underlined,
            active: () => editor.value!.isActive('underline'),
            run: () => editor.value!.chain().focus().toggleUnderline().run()},
        {title: "Superscript", icon: superscript_icon,
            active: () => editor.value!.isActive('superscript'),
            run: () => editor.value!.chain().focus().toggleSuperscript().run()},
        {title: "Subscript", icon: subscript_icon,
            active: () => editor.value!.isActive('subscript'),
            run: () => editor.value!.chain().focus().toggleSubscript().run()},
    ],
    [
        {title: "Heading 1", icon: format_h1,
            active: () => editor.value!.isActive('heading', {level: 1}),
            run: () => editor.value!.chain().focus().toggleHeading({level: 1}).run()},
        {title: "Heading 2", icon: format_h2,
            active: () => editor.value!.isActive('heading', {level: 2}),
            run: () => editor.value!.chain().focus().toggleHeading({level: 2}).run()},
        {title: "Bullet list", icon: format_list_bulleted,
            active: () => editor.value!.isActive('bulletList'),
            run: () => editor.value!.chain().focus().toggleBulletList().run()},
        {title: "Numbered list", icon: format_list_numbered,
            active: () => editor.value!.isActive('orderedList'),
            run: () => editor.value!.chain().focus().toggleOrderedList().run()},
    ],
    [
        {title: "Align left", icon: format_align_left,
            active: () => editor.value!.isActive({textAlign: 'left'}),
            run: () => editor.value!.chain().focus().setTextAlign('left').run()},
        {title: "Align center", icon: format_align_center,
            active: () => editor.value!.isActive({textAlign: 'center'}),
            run: () => editor.value!.chain().focus().setTextAlign('center').run()},
        {title: "Align right", icon: format_align_right,
            active: () => editor.value!.isActive({textAlign: 'right'}),
            run: () => editor.value!.chain().focus().setTextAlign('right').run()},
        {title: "Justify", icon: format_align_justify,
            active: () => editor.value!.isActive({textAlign: 'justify'}),
            run: () => editor.value!.chain().focus().setTextAlign('justify').run()},
    ],
    [
        {title: "Divider", icon: horizontal_rule,
            run: () => editor.value!.chain().focus().setHorizontalRule().run()},
        {title: "Undo", icon: undo_icon,
            run: () => editor.value!.chain().focus().undo().run()},
        {title: "Redo", icon: redo_icon,
            run: () => editor.value!.chain().focus().redo().run()},
    ],
] as {title:string, icon:unknown, active?:() => boolean, run:() => void}[][]


// Destroy the editor to release ProseMirror resources when the component unmounts
onBeforeUnmount(() => {
    editor.value?.destroy()
})


</script>


<style lang='sass' scoped>

.prose
    border: 1px solid rgba(0, 0, 0, 0.2)
    border-radius: 4px
    overflow: hidden

.toolbar
    padding: 4px
    border-bottom: 1px solid rgba(0, 0, 0, 0.12)

.btn-icon
    width: 20px
    height: 20px
    fill: currentColor

.content
    overflow: auto
    padding: 12px

    :deep(.ProseMirror)
        outline: none
        min-height: 100%

        > *:first-child
            margin-top: 0

</style>
