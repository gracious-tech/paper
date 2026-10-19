---
name: translate
description: Translate paper.bible's UI — add a locale, translate missing/stale strings for one or many locales, or bring translations up to date after English UI text was added or reworded. Use whenever the task touches app/src/locales/, .bin/i18n_*, or asks for the app "in <language>".
---

# Translating the paper.bible UI

Every translation is written by Claude through one loop. Catalogs (`app/src/locales/*.json`) and
their base files (`.state/`) are **never edited by hand** — the tools write them, so staleness
tracking and validation can't be skipped.

## The loop (one or more locales)

```bash
.bin/i18n_status                  # one line per locale: % done, missing, stale
.bin/i18n_job vie fra             # writes app/i18n/jobs/<loc>.json (default ≤250 strings each)
# → read each job, write app/i18n/jobs/<loc>.out.json (see below)
.bin/i18n_apply                   # validates + merges every .out.json, deletes the job files
.bin/i18n_job vie fra             # repeat until it says "nothing to translate"
.bin/i18n_check --allow-missing   # must pass; drop --allow-missing once every locale is complete
```

Run `.bin/i18n_job` with no locale to cover every locale with outstanding work. `--only
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
a decision is made/changed) — `apply` stores them in `app/i18n/style/<loc>.json` and every later
job repeats them, which is what keeps a locale consistent across sessions.

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

1. Find the code detection uses: `bcp47_to_locale()` in `app/src/services/locale.ts` maps the
   browser's tag (`ar`, `pt-BR`, `zh-Hant`) to an ISO 639-3 code (`ara`, `por`, `zho-Hant`).
   Use that code — `i18n_check` fails on a code browsers could never select (e.g. `arb`). If
   the language isn't in the map, add it there.
2. Add it to `app/src/locales.json`: `"<code>": {"name": "<its own name for itself>",
   "english": "<English name>", "dir": "ltr"|"rtl"}`.
3. Run the loop above. The first job has no `style`: decide the conventions and send `_style`
   and `_terms` with the first batch.
4. If the bookcover widget should also be translated, that's its own repo's catalogs; add the
   code to `COVER_LOCALES` in `DialogCoverEditor.vue` once it supports it.

## Many locales at once

Each locale's job is independent, so when the user asks for many locales, translating them in
parallel with subagents is the efficient path — but only when the user has asked for that.
Write all jobs first (`.bin/i18n_job a b c ...`), give each subagent one job file path and tell
it to read this skill and write only that job's `.out.json`. Run `.bin/i18n_apply` once
they've all finished, then loop for the remaining batches. Translation quality drops for
low-resource languages; say so to the user rather than presenting those as reviewed.

## After changing English UI text

Adding or rewording a string in `eng.json` makes it missing/stale in every locale. Finish the
code change, then run the loop for all locales (`.bin/i18n_job` with no arguments). For an English
edit that doesn't change the meaning (typo, punctuation), skip retranslating with
`.bin/i18n_sync --bless <key ...>`.

## Writing UI code that stays translatable

- Every user-visible string goes through `$t('ns.key')` / `t()` / `translate()`, with the English
  added to `app/src/locales/eng.json`. `i18n_check` (run by `audit_unit` and `deploy_app`) fails on
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
