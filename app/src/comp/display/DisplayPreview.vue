
<template lang='pug'>

iframe(ref='iframe' :srcdoc='preview')

</template>


<script lang='ts' setup>

import {ref, computed} from 'vue'

import {gen_subjobs, gen_combined_css} from '@/services/render/render'
import {blue, page_height, page_width} from '@/services/state'
import {gen_html} from '@/services/render/render_base'


function generate_preview_css(){

    const margin_offset = `${blue.margin_bottom + blue.margin_top}${blue.margin_unit}`

    return `
        @import url('https://fonts.googleapis.com/css2?family=Libre+Baskerville:ital,wght@0,400;0,700;1,400&display=swap');
        @import url('https://fonts.googleapis.com/css2?family=Libre+Caslon+Text:ital,wght@0,400;0,700;1,400&display=swap');
        @import url('https://fonts.googleapis.com/css2?family=EB+Garamond:ital,wght@0,400;0,700;1,400;1,700&display=swap');
        @import url('https://fonts.googleapis.com/css2?family=Crimson+Pro:ital,wght@0,400;0,700;1,400;1,700&display=swap');
        @import url('https://fonts.googleapis.com/css2?family=Dancing+Script:wght@700&display=swap');
        @import url('https://fonts.googleapis.com/css2?family=Noto+Emoji:wght@300&display=swap');

        html {
            background-color: #333;
            height: 100%;
        }

        body {
            display: flex;
            align-items: center;
            justify-content: center;
            height: 100%;
            margin: 12px;
            overflow: hidden;
        }

        .wrapper {
            display: flex;
            flex-direction: column;
            width: 100%;
            height: 100%;
            max-width: ${page_width.value}${blue.paper_unit};
            max-height: ${page_height.value}${blue.paper_unit};
            overflow: hidden;
            background-color: white;
            counter-reset: footnote;
        }

        .warning {
            min-height: ${blue.margin_top}${blue.margin_unit};
            max-height: ${blue.margin_top}${blue.margin_unit};
            display: flex;
            align-items: center;
            justify-content: center;
            text-align: center;
            font-size: 12px;
            color: #f60;
            font-family: "Arial", sans-serif;
            line-height: 1.2;
        }
        .wrapper:not(:hover) .warning {
            visibility: hidden;
        }

        .content {
            position: relative;  /* For corner patterns, but would mess up print position */
            overflow: hidden scroll;
            margin: 0 ${blue.margin_right}${blue.margin_unit}
            ${blue.margin_bottom}${blue.margin_unit} ${blue.margin_left}${blue.margin_unit};
        }
        .wrapper:hover .content {
            max-width: calc(${page_width.value}${blue.paper_unit} + 15px);
            margin-right: calc(${blue.margin_right}${blue.margin_unit} - 15px);
        }
        .wrapper:not(:hover) .content::-webkit-scrollbar {
            display: none;
        }

        .title {
            height: calc(${page_height.value}${blue.paper_unit} - ${margin_offset});
            position: relative;
        }

        .fb-note {
            counter-increment: footnote;
        }
        .fb-note::before {
            content: counter(footnote, lower-alpha);
            vertical-align: super;
            opacity: 0.5;
            font-size: 0.8em;
        }

        .study, .fb-note {
            display: none;
        }

        .subjob-break, .page-break {
            margin-top: ${blue.margin_bottom}${blue.margin_unit};
            margin-bottom: ${blue.margin_top}${blue.margin_unit};
            border: 1px dashed #0002;
            border-bottom-width: 0;
        }
    `
}

const iframe = ref<HTMLIFrameElement>()


const preview = computed(() => {
    // Preview approximation in browser
    const content = gen_subjobs().flat().filter(i => typeof i === 'string')
        .join('<hr class="subjob-break">')
    const css = generate_preview_css() + gen_combined_css()
    return gen_html(css, `
        <div class='wrapper'>
            <div class='warning'>
                This preview cannot display some features and sizes may differ when printed.<br>
                Always print a test page before finalising your design.
            </div>
            <div class='content'>${content}</div>
        </div>
    `)
})


</script>


<style lang='sass' scoped>


</style>
