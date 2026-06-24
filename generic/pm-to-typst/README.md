
# pm-to-typst

Convert a [ProseMirror](https://prosemirror.net/) / [Tiptap](https://tiptap.dev/) document
(the JSON from `editor.getJSON()`) into [Typst](https://typst.app/) markup.

A complete renderer for the Tiptap StarterKit vocabulary ships built in, and you can override or
add handlers for any node/mark without forking the package.


## Install

```bash
npm install pm-to-typst
```


## Usage

```ts
import {pm_to_typst} from 'pm-to-typst'

const doc = {
    type: 'doc',
    content: [
        {type: 'heading', attrs: {level: 2}, content: [{type: 'text', text: 'Hello'}]},
        {type: 'paragraph', content: [
            {type: 'text', text: 'some '},
            {type: 'text', marks: [{type: 'bold'}], text: 'bold'},
            {type: 'text', text: ' text'},
        ]},
    ],
}

pm_to_typst(doc)
// == Hello
//
// some *bold* text
```


## With Tiptap

Pass whatever `editor.getJSON()` returns straight in:

```ts
import {Editor} from '@tiptap/core'
import StarterKit from '@tiptap/starter-kit'
import {pm_to_typst} from 'pm-to-typst'

const editor = new Editor({extensions: [StarterKit]})

// ...user edits the document...

const typst = pm_to_typst(editor.getJSON())
```


## Supported nodes and marks

| ProseMirror node | Typst output |
|---|---|
| `doc` | block children joined by a blank line |
| `paragraph` | inline content |
| `heading` (level N) | `=` repeated N times, then the content |
| `bulletList` / `listItem` | `- ` markers (wrapped/nested lines indented) |
| `orderedList` / `listItem` | `+ ` markers |
| `blockquote` | `#quote[...]` |
| `horizontalRule` | `#line(length: 100%)` |
| `hardBreak` | `\` line break |
| `codeBlock` | `#raw(block: true, "...")` |

| ProseMirror mark | Typst output |
|---|---|
| `bold` | `*...*` |
| `italic` | `_..._` |
| `strike` | `#strike[...]` |
| `underline` | `#underline[...]` |
| `code` | `#raw("...")` |
| `link` | collapsed to plain text |

All literal text is escaped for Typst. Unknown nodes render their children; marks with no handler
render as plain inner text.


## Extending

Pass a partial renderer as the second argument. Your handlers are merged over the defaults
(per-key for `nodes` and `marks`), so you only specify what changes:

```ts
pm_to_typst(doc, {
    nodes: {
        // override a built-in node
        paragraph: (node, ctx) => ctx.children() + '\n',
        // add a custom node type
        callout: (node, ctx) => `#callout[${ctx.children('\n\n')}]`,
    },
    marks: {
        // add a custom mark
        highlight: (mark, inner) => `#highlight[${inner}]`,
    },
    // catch-all for unhandled node types
    fallback: (node, ctx) => ctx.children(),
})
```

A node handler receives the node and a context:

- `ctx.children(separator?)` — render the node's children, joined by `separator` (default `''`).
- `ctx.node(node)` — render an arbitrary node manually.

A mark handler receives the mark and the already-rendered inner string, and returns it wrapped.


## API

- `pm_to_typst(doc, custom?)` — render a document with the built-in renderer, optionally extended.
- `typst_renderer` — the default ProseMirror → Typst renderer.
- `render(doc, renderer)` — the low-level walker; render with any renderer.
- `extend_renderer(base, custom?)` — merge custom handlers over a base renderer.

Types: `PmDoc`, `PmNode`, `PmMark`, `Renderer`, `NodeHandler`, `MarkHandler`, `RenderContext`.


## License

MIT-0.
