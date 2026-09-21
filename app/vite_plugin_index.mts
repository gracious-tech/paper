// A vite plugin that supports writing index in Pug and embedding SugarSS

import {readFileSync} from 'node:fs'

import pug from 'pug'
import postcss from 'postcss'
import postcss_nested from 'postcss-nested'
import sugarss from 'sugarss'
import {Plugin, ResolvedConfig} from 'vite'


export default function(template_path:string):Plugin{
    // Return config for plugin

    let config:ResolvedConfig
    const define_env:Record<string, string> = {}

    return {
        name: 'pug-index',

        configResolved(resolved_config){
            // Provide access to config when it's available
            config = resolved_config
            // Expose all the same env that vite does normally
            // WARN Defined values are inserted as code, not strings, hence `stringify()`
            for (const [key, val] of Object.entries(config.env)){
                define_env[`import.meta.env.${key}`] = JSON.stringify(val)
            }
        },

        transformIndexHtml: {
            // Replace default index contents with rendered pug template instead

            // Run before all core Vite plugins
            order: 'pre',

            async handler(html, context){
                // NOTE index.html is ignored as replacing entirely by index.pug
                // NOTE context.bundle will never be available because plugin runs 'pre' others
                const template = readFileSync(template_path, {encoding: 'utf-8'})
                return pug.compile(template, {
                    // NOTE pretty is deprecated and can cause bugs with dev vs prod
                    // WARN Filters cannot be async
                    filters: {

                        sss: (text:string) => {
                            // Render SugarSS blocks (only nesting needs expanding, and both
                            // plugins are sync, so the result resolves without awaiting).
                            // The block is inlined in index.html, so drop authoring comments
                            // from it when building for production
                            const result = postcss([postcss_nested])
                                .process(text, {from: undefined, parser: sugarss})
                            if (config.isProduction){
                                result.root.walkComments(comment => {
                                    comment.remove()
                                })
                            }
                            return result.css
                        },

                    },
                })(config.env)  // Expose same env vars Vue does in templates
            },
        },

        handleHotUpdate(context){
            // Index changed whenever pug template does, so reload page
            // NOTE filename is absolute, so first make relative
            const filename = context.file.slice(context.server.config.root.length)
            if (filename === '/index.pug'){
                context.server.ws.send({type: 'full-reload'})
            }
        },

    }
}
