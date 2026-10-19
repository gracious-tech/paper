
// Find user-visible text that never goes through t()/$t()/translate(), so new UI copy can't
// quietly ship English-only. Relies on the project's quoting convention: in TypeScript, text
// shown to the user is double-quoted and everything else single-quoted, so any double-quoted
// literal that isn't a translation call's argument is either untranslated UI text or should be
// single-quoted. Pug templates are lexed for plain text and static UI attributes (label=, title=
// ...); expressions inside templates can't follow the quoting convention (the attribute's own
// quotes force the inner ones), so there only phrase-like literals are flagged.
// Exemptions are explicit and local: `i18n-ignore` on the line or the line above, or
// `i18n-ignore-file` anywhere in the file, each with a reason beside it.

import {readFileSync} from 'node:fs'
import {createRequire} from 'node:module'

import {source_files, rel, APP_DIR} from './lib.ts'

import type * as TS from 'typescript'

// Resolve the app's own copies of the parsers (no extra dependencies for the tooling)
const require = createRequire(`${APP_DIR}/package.json`)
const ts = require('typescript') as typeof TS
const pug_lex = require('pug-lexer') as (src:string) => PugToken[]
const {parse: parse_sfc} = require('@vue/compiler-sfc') as
    {parse:(src:string) => {descriptor:Sfc}}

// The slice of pug-lexer's token shape used here
interface PugToken {
    type:string
    val?:unknown
    name?:string
    loc:{start:{line:number}}
}

// The slice of @vue/compiler-sfc's descriptor used here
interface SfcBlock {
    content:string
    lang?:string
    loc:{start:{line:number}}
}
interface Sfc {
    template:SfcBlock|null
    script:SfcBlock|null
    scriptSetup:SfcBlock|null
}

// One piece of untranslated text
export interface Finding {
    file:string
    line:number
    text:string
}

// Static template attributes whose value is shown to the user
const UI_ATTRS = new Set(['label', 'title', 'placeholder', 'hint', 'text', 'subtitle', 'alt',
    'aria-label', 'prefix', 'suffix', 'messages', 'error-messages', 'no-data-text',
    'loading-text', 'prepend-text', 'append-text', 'tooltip'])

// The functions whose string argument is a key, not text
const TRANSLATORS = new Set(['t', '$t', 'translate'])

// Text with at least two letters in a row (rules out numbers, symbols and single initials)
const WORDY = /\p{L}{2}/u

// Looks like words for a person rather than an identifier/class/route name: two words, or a
// capitalised word
const PHRASE = /\p{L}{2,}\s+\p{L}{2,}|^\p{Lu}\p{Ll}+/u

// Find double-quoted (or, with `phrases_only`, phrase-like) literals in a TypeScript snippet
function scan_ts(code:string, file:string, first_line:number, phrases_only:boolean,
        out:Finding[]):void {
    const source = ts.createSourceFile(file, code, ts.ScriptTarget.Latest, true)
    const visit = (node:TS.Node):void => {
        if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)){
            const parent = node.parent
            const is_key = ts.isCallExpression(parent) && parent.arguments[0] === node
                && TRANSLATORS.has(parent.expression.getText(source))
            const is_code = ts.isImportDeclaration(parent) || ts.isExportDeclaration(parent)
                || ts.isLiteralTypeNode(parent) || ts.isExternalModuleReference(parent)
            const quoted = node.getText(source).startsWith('"')
            const flagged = phrases_only ? PHRASE.test(node.text) : quoted
            if (!is_key && !is_code && flagged && WORDY.test(node.text)){
                const {line} = source.getLineAndCharacterOfPosition(node.getStart(source))
                out.push({file, line: first_line + line, text: node.text})
            }
        }
        ts.forEachChild(node, visit)
    }
    visit(source)
}

// Find untranslated text in a Pug template
function scan_pug(template:string, file:string, first_line:number, out:Finding[]):void {
    let tokens:PugToken[]
    try {
        tokens = pug_lex(template)
    } catch (error){
        out.push({file, line: first_line, text: `(template failed to lex: ${String(error)})`})
        return
    }
    for (const token of tokens){
        const line = first_line + token.loc.start.line - 1
        if (token.type === 'text' && typeof token.val === 'string'){
            // Interpolations are code (scanned below), entities and punctuation aren't words
            for (const match of token.val.matchAll(/\{\{([\s\S]*?)\}\}/g)){
                scan_ts(match[1]!, file, line, true, out)
            }
            const plain = token.val.replace(/\{\{[\s\S]*?\}\}/g, '').replace(/&\w+;/g, '')
            if (WORDY.test(plain)){
                out.push({file, line, text: plain.trim()})
            }
        } else if (token.type === 'attribute' && typeof token.val === 'string'){
            const name = token.name ?? ''
            const value = token.val
            if (/^[:@#]|^v-/.test(name)){
                // A bound expression — only phrase-like literals inside it count
                scan_ts(value.slice(1, -1), file, line, true, out)
            } else if (UI_ATTRS.has(name) && WORDY.test(value)){
                out.push({file, line, text: value.slice(1, -1)})
            }
        }
    }
}

// Whether a finding's line (or the line above it) carries an i18n-ignore marker
function ignored(lines:string[], line:number):boolean {
    return [lines[line - 1], lines[line - 2]].some(text => text?.includes('i18n-ignore'))
}

// The untranslated text in one source file (`file` decides how it's parsed: .ts or .vue)
export function lint_source(file:string, source:string):Finding[] {
    if (source.includes('i18n-ignore-file')){
        return []
    }
    const found:Finding[] = []
    if (file.endsWith('.ts')){
        scan_ts(source, file, 1, false, found)
    } else {
        const {descriptor} = parse_sfc(source)
        for (const block of [descriptor.script, descriptor.scriptSetup]){
            if (block){
                scan_ts(block.content, file, block.loc.start.line, false, found)
            }
        }
        if (descriptor.template?.lang === 'pug'){
            scan_pug(descriptor.template.content, file, descriptor.template.loc.start.line, found)
        }
    }
    const lines = source.split('\n')
    return found.filter(finding => !ignored(lines, finding.line))
}


// Every untranslated piece of text in app/src
export function find_untranslated():Finding[] {
    return source_files().flatMap(path => lint_source(rel(path), readFileSync(path, 'utf8')))
}
