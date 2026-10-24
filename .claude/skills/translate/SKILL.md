---
name: translate
description: Translate paper.bible's UI and the text it prints into books — add a locale, translate missing/stale strings for one or many locales, or bring translations up to date after English text was added or reworded. Use whenever the task touches app/src/locales/, typst/locales/, .bin/i18n_*, or asks for the app or its printed books "in <language>".
---

# Translating the paper.bible UI

Every translation is written by Claude through one loop. Catalogs and their base files
(`.state/`) are **never edited by hand** — the tools write them, so staleness tracking and
validation can't be skipped.

There are two catalog **domains**, handled identically by every command:

| Domain | What | Catalogs | Locale list | Keyed by |
|---|---|---|---|---|
| `ui` | the app's interface | `app/src/locales/` | `app/src/locales.json` | a browser language tag (`en`, `pt-BR`, `zh-Hans`) |
| `doc` | the few strings printed *into* a book: copyright page, "Chapter N" | `typst/locales/` | `typst/locales.json` | the fetch.bible language of the book's primary translation (`eng`, `pes`, `cmn-Hant`) |

A book prints in its Bible's language whatever language its creator's UI is in, so `doc` has
its own language list — usually broader than `ui`'s, since it's 8 strings rather than 660. Its
catalogs are compiled into `typst/src/generated/doc_strings.ts` (the tools do this; `i18n_check`
fails if it's stale). A language missing from `doc` simply prints in English.

So one language has two codes, one per domain (Vietnamese is `vi` and `vie`); name both when you
run a job for it. They share one style file, keyed by the written language (`style/vi.json`).

## The loop (one or more locales)

```bash
.bin/i18n_status                  # per domain, one line per locale: % done, missing, stale
.bin/i18n_job vi vie fr fra       # writes app/i18n/jobs/<domain>.<loc>.json (≤250 strings each)
# → read each job, write the .out.json it names (see below)
.bin/i18n_apply                   # validates + merges every .out.json, deletes the job files
.bin/i18n_job vi vie fr fra       # repeat until it says "nothing to translate"
.bin/i18n_check --allow-missing   # must pass; drop --allow-missing once every locale is complete
.bin/gen_example_images           # if i18n_check warned that example pictures are out of date
.bin/gen_type_images              # if it warned that a locale has no wizard type pictures
```

The example designs' titles (`svc.examples.*_title`/`_subtitle`) are printed on cover pictures,
so `i18n_check` warns when one changed since its picture was rendered. That's only a warning
(CI can't render them), but re-render before committing so the pictures match. It needs no dev
servers, takes about a second per changed picture, and its output is committed with the
catalogs.

Run `.bin/i18n_job` with no locale to cover every locale with outstanding work, in both
domains; `--domain ui|doc` restricts it to one. `--only
common.,dialog.account.` narrows a job to key prefixes. `--review` adds the strings already
translated, to re-check them (e.g. after improving context notes or the glossary); it's a single
unbatched pass, so narrow it with `--only` rather than looping on it.

### Translating a job

Read the job file. It is self-contained: `rules`, `glossary` (with this locale's chosen
renderings in `use`), `style` (this locale's conventions so far), and `strings`, where each entry
has the English (`en`), where it appears (`where`: component:line plus the source line), and
sometimes a `note`. Stale entries also carry `was` (old English) and `current` (old translation).

Write **only** the output file named in the job's `output` — a flat object, every key from
`strings`, nothing else:

```json
{
  "app.about": "Giới thiệu",
  "common.cancel": "Hủy",
  "_terms": {"design": "thiết kế"},
  "_style": "Address the user as \"bạn\"; sentence case for labels; “curly” quotes."
}
```

`_terms` and `_style` are optional: include them the first time a locale is translated (or when
a decision is made/changed) — `apply` stores them in `app/i18n/style/<language>.json` (shared by
the language's UI and document codes) and every later job repeats them, which is what keeps a
locale consistent across sessions.

Read `where` before translating short strings. "Home", "Copy", "Print", "Left" etc. mean
different things in different places; the source line shows whether it's a button, a menu item,
a tooltip or a value in a dropdown. If a string is ambiguous even with its call site, add a note
for it to `app/i18n/context.json` (`{"<key>": "<what it means>"}`) — every future locale benefits.

### What `apply` refuses (and what to do)

Refused entries print with `✗` and stay untranslated; re-run `i18n_job` and redo them:
- a `{placeholder}` dropped, renamed or translated (names inside braces are never translated)
- HTML tags or line breaks that differ from the English
- a glossary `keep` term (product/company names) not kept verbatim
- an empty value, a key not in the job, or English that changed since the job was written

Warnings (`?`) are applied but worth a look: identical to the English, unusual length, or a
glossary term not rendered the way `_terms` says.

## Adding a locale

**For printed books (`doc`):** add the language to `typst/locales.json` under its fetch.bible
code (the `language` of its translations, ISO 639-3, e.g. `arb`, `pes`, `swh` — not the UI's
tags), plus its script where fetch.bible declares one for that language's Bibles (`cmn-Hans`,
`cmn-Hant`), with `name`/`english`/`dir`, then run the loop. Use the chapter word published Bibles in
that language print; the job's notes say so. Prefer languages you translate reliably — a wrong
copyright statement printed in someone's Bible is worse than an English one.

**For the UI (`ui`):**

1. Pick its browser language tag, in the canonical form browsers report (`ar`, `pt-BR`,
   `zh-Hant`; `i18n_check` fails on e.g. `arb` or `zh-hant`). Add a region only when the
   catalog is genuinely regional (`pt-BR`). Detection (`best_locale()` in
   `app/src/services/locale.ts`) matches the browser's tags by language and script, so a
   `pt-BR` catalog serves `pt-PT` too, and `zh-TW` reaches `zh-Hant` but never `zh-Hans`.
2. Add it to `app/src/locales.json`: `"<tag>": {"name": "<its own name for itself>",
   "english": "<English name>", "dir": "ltr"|"rtl"}`.
3. Run the loop above. The first job has no `style`: decide the conventions and send `_style`
   and `_terms` with the first batch. If the language is also a Bible language (most are),
   add it to `typst/locales.json` too, so books in it print in it.
4. The bookcover widget is sent the same tag and matches it against its own catalogs (its own
   repo), falling back to English — nothing to add here when it gains a language.
5. Render the new-design wizard's type pictures in it: `.bin/gen_type_images <tag>` (a few
   seconds; `i18n_check` warns until it's done). They show Genesis 1 in fetch.bible's preferred
   translation for the language, so they're rendered, not translated. Look at the review sheet
   it prints the path of: each English screenshot beside the new picture. If one is wrong (a
   word overflowing a column, text cut badly), add a `LANGUAGE_OVERRIDES` entry for that
   language and type in `app/tools/gen_type_images.ts` and rerun with `--force --types=<type>`.
   Commit the new `app/src/assets/images/design_types/<tag>/` and `manifest.json`. A language
   with no Bible containing Genesis is recorded with `bible: null` and keeps the English
   pictures. Also run `.bin/gen_example_images` for the example covers.

## Many locales at once

Each locale's job is independent, so when the user asks for many locales, translating them in
parallel with subagents is the efficient path — but only when the user has asked for that.
Write all jobs first (`.bin/i18n_job a b c ...`), give each subagent one job file path and tell
it to read this skill and write only that job's `.out.json`. Run `.bin/i18n_apply` once
they've all finished, then loop for the remaining batches. Translation quality drops for
low-resource languages; say so to the user rather than presenting those as reviewed.

## After changing English text

Adding or rewording a string in either source catalog (`app/src/locales/en.json`,
`typst/locales/eng.json`) makes it missing/stale in every locale. Finish the
code change, then run the loop for all locales (`.bin/i18n_job` with no arguments). For an English
edit that doesn't change the meaning (typo, punctuation), skip retranslating with
`.bin/i18n_sync --bless <key ...>`.

## Writing UI code that stays translatable

- Every user-visible string goes through `$t('ns.key')` / `t()` / `translate()`, with the English
  added to `app/src/locales/en.json`. `i18n_check` (run by `audit_unit` and `deploy_app`) fails on
  text that doesn't: in TypeScript a double-quoted literal *is* UI text by the project's quoting
  convention, so non-UI strings must be single-quoted.
- Deliberately untranslated text (product names, URLs, file extensions) gets `i18n-ignore` on
  its line or the line above (`//- ... (i18n-ignore)` in Pug), with the reason; a whole file
  can opt out with `i18n-ignore-file`.
- Whole sentences only — never concatenate translated fragments or glue a number onto a word.
  Emphasis or links inside a sentence become `{placeholders}` filled by slots:
  `AppSentence(:text='$t("ns.key")')` with `template(#name)` children. Plurals:
  `count_phrase(t, 'stem', n)` with `stem.one`/`stem.other` keys. Keys passed around by name, or
  built from a stem/prefix, are found by the scanner as long as the literal appears in code.
- Don't call `t()` once at setup/module scope to build a constant — wrap it in `computed()` so
  it follows a language change.
- `vuetify.*` keys are Vuetify's own strings, re-nested for it by `vuetify_messages()`; add one
  there only if the app starts using a Vuetify feature that shows another.

## Writing text the typst package prints into a book

- Add the key (prefixed `doc.`) with its English to `typst/locales/eng.json`, a note to
  `app/i18n/context.json`, run `.bin/i18n_sync` to recompile, then look it up with
  `doc_translator(doc_language(blue, resources))` from `typst/src/doc_strings.ts`.
- Text generated in the worker (from a `TypstRequest`, which has no catalogs) must be resolved by
  `BibleContent.resolve()` and carried in the request — see `FeatureConfig.chapter_label`.
- Escape for Typst first, then swap a placeholder for markup (see "Created with {link}" in
  `copyright.ts`).
- Never draw text with pdf-lib's built-in fonts: they only encode WinAnsi, so most languages
  throw. Typeset it, or (for UI-language notices around a preview) show it as HTML — see
  `DisplayPreviewPages.vue`.
