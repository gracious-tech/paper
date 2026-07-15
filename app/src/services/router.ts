
// The app's routes. A single `design` route serves both /designs/:id (editor or latest
// version) and /designs/:id/:version (a specific version selected) via an optional param —
// ViewDesign.vue tells the two cases apart by checking whether route.params.version is set

import {createRouter, createWebHistory} from 'vue-router'

import ViewDesigns from '@/comp/views/ViewDesigns.vue'
import ViewDesign from '@/comp/views/ViewDesign.vue'
import ViewDesignInvite from '@/comp/views/ViewDesignInvite.vue'
import ViewHelp from '@/comp/views/ViewHelp.vue'


export const router = createRouter({
    history: createWebHistory(),
    routes: [
        {path: '/', redirect: {name: 'designs'}},
        {path: '/designs', name: 'designs', component: ViewDesigns},
        {path: '/designs/:id/invite/:token', name: 'design-invite', component: ViewDesignInvite},
        {path: '/designs/:id/:version?', name: 'design', component: ViewDesign},
        {path: '/help', name: 'help', component: ViewHelp},
        {path: '/:pathMatch(.*)*', redirect: {name: 'designs'}},
    ],
})
