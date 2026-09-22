
<template lang='pug'>

div.cont(class='text-body-medium')

    div(class='ma-6')

        //- Back to home
        v-btn.back(:to='{name: "designs"}' variant='tonal' class='mb-6')
            template(#prepend)
                AppIcon(name='arrow_back')
            | {{$t("common.home")}}

        h1(class='text-headline-small mb-4') {{$t("view.privacy.title")}}

        p(class='text-body-large mb-4' v-html='$t("view.privacy.intro", {org: org_link})')

        h2(class='text-title-large mb-2') {{$t("view.privacy.account_title")}}
        p(class='mb-2') {{$t("view.privacy.account_anonymous")}}
        p(class='mb-4') {{$t("view.privacy.account_signin")}}

        h2(class='text-title-large mb-2') {{$t("view.privacy.content_title")}}
        p(class='mb-2') {{$t("view.privacy.content_designs")}}
        p(class='mb-4') {{$t("view.privacy.content_sharing")}}

        h2(class='text-title-large mb-2') {{$t("view.privacy.usage_title")}}
        p(class='mb-2') {{$t("view.privacy.usage_intro")}}
        ul(class='mb-2')
            li {{$t("view.privacy.usage_ip")}}
            li {{$t("view.privacy.usage_errors")}}
        p(class='mb-4') {{$t("view.privacy.usage_purpose")}}

        h2(class='text-title-large mb-2') {{$t("view.privacy.not_title")}}
        ul(class='mb-4')
            li {{$t("view.privacy.not_sell")}}
            li {{$t("view.privacy.not_track")}}

        p(class='text-body-large') {{$t("view.privacy.contact")}}

        div(class='d-flex flex-wrap ga-3 mt-4')
            v-btn(href='https://gracious.tech/contact' target='_blank' variant='tonal')
                | {{$t("app.contact")}}

</template>


<script lang='ts' setup>

// Inline link substituted into the {org} placeholder of the intro paragraph
const org_link = '<a href="https://gracious.tech" target="_blank" rel="noopener">Gracious Tech</a>'

</script>


<style lang='sss' scoped>

.cont
    flex-grow: 1
    overflow: auto

</style>
