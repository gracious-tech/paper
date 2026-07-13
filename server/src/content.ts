
import {BibleContent} from 'paper-bible-typst-node'

import {config} from './config.ts'


// One BibleContent for the whole instance, so the collection manifest and fetched books stay
// warm across compiles (Bible content is static, and usage is heavily skewed to a few popular
// translations — an LRU keeps those hot). Per-instance only: a fresh Cloud Run instance starts
// cold and relies on fetch.bible's CDN for its first fills
export const shared_content = new BibleContent({
    endpoint: config.endpoint,
    // The manifest (list of available translations) can gain new entries at any time, so
    // refresh it hourly
    manifest_ttl_ms: 60 * 60 * 1000,
    // Individual books/notes are effectively static once published — cache for a full day rather
    // than only bounding by LRU size, in case a book is ever corrected/removed upstream
    cache_ttl_ms: 24 * 60 * 60 * 1000,
    // Roughly a tenth of the compile service's 2GiB — plenty for the popular translations
    cache_max_bytes: Number(process.env['CONTENT_CACHE_MB'] ?? 256) * 1024 * 1024,
})
