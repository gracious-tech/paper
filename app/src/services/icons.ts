
// Bible-themed icon suggestions, as Iconify IDs ("collection:name").
// Icons are resolved + recolored to SVG server-side (see paper-bible-typst's icon_cache). The
// title-page editor previews them by fetching the same SVG from the Iconify API. Users may also
// paste any other "collection:name" ID, so these are only the curated suggestions.
// We default to the game-icons set (bold, thematic silhouettes that suit a decorative title).

import {suggested_icons} from 'bookcover-core'


// Curated suggestions, sourced from the bookcover widget's own curated set (both apps offer the
// same icons) so there's a single list to keep thematic and Bible-appropriate. Excludes
// "builtin:" ids — those resolve from bookcover's own bundled icon set (builtin_icons.ts),
// which this app's typst/icon_cache.ts doesn't fetch from; every "builtin:" icon bookcover
// offers also has an Iconify-sourced preset covering the same idea (e.g. "builtin:cross" next to
// "mdi:cross"), so nothing is lost by dropping them.
export const biblical_icons:string[] = suggested_icons.filter(id => !id.startsWith('builtin:'))


// Suggested icon for each book of the Bible
export const book_icon:Record<string, string> = {
    'gen': `game-icons:world`,            // Earth
    'exo': `game-icons:mountaintop`,      // Mountain (Sinai)
    'lev': `game-icons:temple-door`,      // Temple curtain
    'num': `game-icons:path-distance`,    // Wandering
    'deu': `game-icons:direction-signs`,  // Choose blessing or curse
    'jos': `game-icons:crossed-swords`,   // Conquest
    'jdg': `material-symbols:cycle`,      // Cycle
    'rut': `game-icons:wheat`,            // Harvest fields
    '1sa': `game-icons:crown`,            // Kingship
    '2sa': `game-icons:crown`,            // Same as 1 Samuel
    '1ki': `game-icons:shattered-sword`,  // Shattered sword
    '2ki': `game-icons:shattered-sword`,  // Same as 1 Kings
    '1ch': `game-icons:family-tree`,      // Chronicles/history
    '2ch': `game-icons:family-tree`,      // Same as 1 Chronicles
    'ezr': `game-icons:broken-wall`,      // Rebuilding
    'neh': `game-icons:broken-wall`,      // Rebuilding the wall
    'est': `game-icons:card-queen-hearts`,// Queen/love
    'job': `game-icons:tornado`,          // Whirlwind
    'psa': `game-icons:musical-score`,    // Songs
    'pro': `game-icons:choice`,           // Choose good not bad
    'ecc': `game-icons:magnifying-glass`, // Searching for meaning
    'sng': `game-icons:rose`,             // Love song
    'isa': `game-icons:throne-king`,      // Vision of God on throne
    'jer': `game-icons:broken-pottery`,   // Broken jar
    'lam': `game-icons:heavy-rain`,       // Weeping
    'ezk': `game-icons:feathered-wing`,   // Cherubim
    'dan': `game-icons:fire-silhouette`,  // Furnace
    'hos': `game-icons:shattered-heart`,  // Unfaithful wife
    'jol': `game-icons:cricket`,          // Locusts
    'amo': `game-icons:lightning-storm`,  // Judgement
    'oba': `game-icons:falling-rocks`,    // Destruction of Edom
    'jon': `game-icons:whale-tail`,       // The great fish
    'mic': `game-icons:injustice`,        // Injustice
    'nam': `game-icons:tower-fall`,       // Nineveh's fall
    'hab': `game-icons:watchtower`,       // Watchtower
    'zep': `game-icons:stump-regrowth`,   // Faithful remnant
    'hag': `game-icons:ancient-ruins`,    // Rebuild the temple
    'zec': `game-icons:cloaked-figure-on-horseback`, // Visions of horses
    'mal': `game-icons:face-to-face`,     // Argument back and forth / stubborn

    'mat': `game-icons:king`,             // Fulfilment / king
    'mrk': `game-icons:crown-of-thorns`,  // Suffering servant
    'luk': `mdi:cross`,                   // Cross
    'jhn': `game-icons:beams-aura`,       // Son of God

    'act': `mdi:broadcast`,               // Spread of gospel
    'rom': `game-icons:scales`,           // Righteousness
    '1co': `icon-park-outline:doc-fail`,  // Problems in church
    '2co': `game-icons:scroll-quill`,     // Letter (many themes)
    'gal': `game-icons:fruit-tree`,       // Fruit of the Spirit
    'eph': `game-icons:battle-gear`,      // Armour of God
    'php': `game-icons:dungeon-light`,    // Hope in prison
    'col': `game-icons:aura`,             // Prayer
    '1th': `game-icons:hasty-grave`,      // The dead in Christ
    '2th': `game-icons:deadly-strike`,    // Jesus' return / man of lawlessness
    '1ti': `boxicons:church-filled`,      // The church
    '2ti': `game-icons:compass`,          // Keep the course
    'tit': `game-icons:tied-scroll`,      // Letter
    'phm': `game-icons:breaking-chain`,   // Freedom
    'heb': `game-icons:open-gate`,        // Access to God
    'jas': `game-icons:mirror-mirror`,    // Mirror of the word
    '1pe': `game-icons:stone-block`,      // Living stones
    '2pe': `game-icons:small-fire`,       // The day of the Lord
    '1jn': `game-icons:crowned-heart`,    // Love
    '2jn': `game-icons:love-letter`,      // Letter
    '3jn': `streamline-freehand:business-management-teamwork-clap`, // Teamwork
    'jud': `game-icons:dead-wood`,        // Fruitless trees
    'rev': `game-icons:pouring-chalice`,  // God's wrath poured out
}
