
<template lang='pug'>

//- English only, like the commercial translations it explains, so not run through i18n
//- (i18n-ignore-file)
div
    p(class='text-body-large').
        In 2023 we asked the owners of popular English translations for permission to include them
        in Paper Bible, with a message along these lines:
    //- The gist of the request each owner was sent
    blockquote(class='request mt-3')
        p(class='text-body-large') {{ request.text }}
        footer(class='text-body-small text-medium-emphasis mt-1')
            | {{ request.org }} · {{ format_month(request.sent) }}
    p(class='text-body-large mt-6') These are the reasons they gave for denying permission:
    v-divider(class='mt-6')
    section(v-for='item of requests' :key='item.name' class='mt-6')
        h3(class='text-title-medium') {{ item.name }}
        p(v-if='item.unanswered' class='text-body-large text-medium-emphasis mt-2')
            | {{ item.unanswered }} didn't respond.
        template(v-for='reply of item.replies' :key='reply.text')
            p(v-if='reply.lead' class='text-body-medium text-medium-emphasis mt-3')
                | {{ reply.lead }}
            blockquote(class='mt-2')
                p(class='text-body-large') {{ reply.text }}
                footer(class='text-body-small text-medium-emphasis mt-1')
                    | {{ reply.org }} · {{ format_month(reply.sent) }}
        p(v-if='item.note' class='text-body-medium text-medium-emphasis mt-3') {{ item.note }}
    //- Where to read more about why so many translations are restricted
    v-divider(class='mt-6')
    div(class='more d-flex flex-wrap justify-center ga-2 mt-6')
        v-btn(href='https://sellingjesus.org/articles/bible-publishers' target='_blank'
                rel='noopener' variant='tonal' color='secondary')
            | Read an article on this issue
        v-btn(href='https://copy.church/watch' target='_blank' rel='noopener'
                variant='tonal' color='secondary')
            | See how this affects other languages

</template>


<script lang='ts' setup>

// A quoted message, attributed to the organisation that sent it
interface Reply {
    org:string
    sent:string  // YYYY-MM
    text:string
    lead?:string  // What we had asked, for a reply that doesn't make sense without it
}

// The replies to one request for permission (one translation, or one owner's translations)
interface Request {
    name:string
    replies:Reply[]
    unanswered?:string  // The organisation that never replied, when there are no replies
    note?:string  // Our own comment on the replies, shown after them
}


// The owners' replies to our requests to include their translations, in their own words —
// shown both in DialogPublisherReplies and as the shareable /publishers page

// The most common wording of the request each owner was sent
const request:Reply = {
    org: "Gracious Tech",
    sent: '2023-09',
    text: "We are a missional app development non-profit that creates free apps for sharing "
        + "Scripture and assisting in cross-cultural mission. We recently released a new app for "
        + "printing and sharing Scripture in hundreds of languages, called Paper Bible. The app is "
        + "completely free with no cost or ads. We'd be keen to include your translation in this "
        + "new app and look forward to hearing if you'd be interested in doing so.",
}

// Every request, with the main parts of each reply
const requests:Request[] = [
    {
        name: "ESV — English Standard Version",
        replies: [
            {
                org: "Crossway",
                sent: '2023-10',
                text: "We reviewed your request and how your platform functions, and unfortunately "
                    + "it is not something we can grant a license for. We have a formal licensing "
                    + "process for allowing trusted bible publishers to print the ESV text. We do "
                    + "not however grant licenses for end-users to print their own editions, "
                    + "regardless of the amount of text they're printing.",
            },
        ],
    },
    {
        name: "NIV — New International Version",
        replies: [
            {
                org: "Biblica",
                sent: '2023-10',
                text: "We have had an opportunity to consider this matter and unfortunately, we "
                    + "have decided to deny your request. Biblica does not allow our licensees "
                    + "and/or their end users to create additional adaptations of any of its "
                    + "texts, especially for uncontrolled onward distribution.",
            },
            {
                org: "Biblica",
                sent: '2023-10',
                lead: "We then offered to allow only printing the pure NIV text, with no "
                    + "custom content.",
                text: "We look at a number of things when granting requests for use of our texts. "
                    + "One being novelty and/or innovation – does the website or app differ "
                    + "significantly from what is already available online? Is the website/app in "
                    + "question truly unique and innovative, offering functionalities outside of "
                    + "what is currently offered by YouVersion and BibleGateway? In this case, to "
                    + "simply offer the user the option to print out a portion of the text "
                    + "(currently available on YV, BG, and Biblica.com) would not be unique nor "
                    + "innovative, and unfortunately, we would have to deny that as well.",
            },
        ],
        note: "(YouVersion shows only one chapter, BibleGateway doesn't allow "
            + "printing more than 250 verses, and neither is designed for printing books or "
            + "booklets.)",
    },
    {
        name: "NLT — New Living Translation",
        replies: [],
        unanswered: "Tyndale House Publishers",
    },
    {
        name: "CSB — Christian Standard Bible",
        replies: [
            {
                org: "Holman Bible Publishers",
                sent: '2023-10',
                text: "Unfortunately, we cannot grant this kind of request that allows any user to "
                    + "print from the CSB text themselves or with a print-on-demand printer. While "
                    + "we cannot approve this request, we do acknowledge that this is a great "
                    + "service for alternate language texts that are hard to acquire in certain "
                    + "parts of the world.",
            },
        ],
    },
    {
        name: "LSB — Legacy Standard Bible",
        replies: [
            {
                org: "316 Publishing",
                sent: '2024-05',
                text: "We apologize but, due to restrictions in our agreement with the Lockman "
                    + "Foundation, we are unable to grant permission to use the LSB as part of "
                    + "paper.bible at this time.",
            },
        ],
    },
    {
        name: "NRSVue — New Revised Standard Version, Updated Edition",
        replies: [
            {
                org: "National Council of Churches",
                sent: '2023-10',
                text: "The NCC does license the NRSVue for use in gratis applications. The general "
                    + "terms are an annual licensing fee: $1,000.",
            },
        ],
        note: "While the NCC did offer access to their translation, this was in exchange for "
            + "money despite our app being completely free for users. We declined for financial "
            + "and theological reasons (2 Cor 2:17).",
    },
]


// Month and year a message was sent, in English to match the rest of the text
function format_month(sent:string):string {
    const [year, month] = sent.split('-').map(Number) as [number, number]
    return new Date(year, month - 1).toLocaleDateString('en', {year: 'numeric', month: 'long'})
}

</script>


<style lang='sss' scoped>

// Let the long link labels wrap on narrow screens rather than overflow
.more .v-btn
    height: auto
    min-height: 36px
    padding-block: 8px

    :deep(.v-btn__content)
        white-space: normal

// Every message as a tinted panel, the owners' replies in primary
blockquote
    border-inline-start: 3px solid rgb(var(--v-theme-primary))
    background-color: rgba(var(--v-theme-primary), 0.08)
    border-radius: 4px
    padding: 12px 16px

    // Drop the browser's default indent on mobile, where the width is better spent on text
    @media (max-width: 900px)
        margin-inline: 0

    // Our own request in secondary (blue), so it can't be mistaken for a reply
    &.request
        border-inline-start-color: rgb(var(--v-theme-secondary))
        background-color: rgba(var(--v-theme-secondary), 0.12)

</style>
