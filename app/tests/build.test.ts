
// Building a design (build.ts): what's frozen (the design as it was at the click), which
// save_token the version takes, when the page count is measured first (a simple design's
// binding), what happens when the user switches design meanwhile or a step before the compile
// fails, and when the print-service warning is shown. The freeze, compile and router are stand-ins

import {describe, it, expect, beforeEach, vi} from 'vitest'

import {blue, set_blue} from './stubs/state'
import {make_blueprint} from './helpers/blueprint'


// The collaborators each test drives
const mocks = vi.hoisted(() => ({
    design_id: {value: 'design_1' as string|null},
    wizard: {simple_mode: false},
    generator: {value: {} as unknown},
    compiles_on_server: vi.fn(() => false),
    flush_changes: vi.fn(async () => undefined),
    create_pending_version: vi.fn(async (..._args:unknown[]) => ({job: true})),
    compile_and_upload: vi.fn(async (..._args:unknown[]) => undefined),
    fresh_estimate: vi.fn(() => null as number|null),
    estimate_pages_for: vi.fn(async () => 120 as number|null),
    claim_compile_turn: vi.fn(),
    release_turn: vi.fn(),
    release_page: vi.fn(),
    auto_binding: vi.fn(() => 'coil'),
    report_failure: vi.fn(),
    report_error: vi.fn(),
    warning_dialog: vi.fn(async () => undefined),
    seen_warning: vi.fn(async () => false),
    record_seen: vi.fn(async () => undefined),
    until_settled: vi.fn(async () => 'available'),
    selected_version_id: {value: null as string|null},
    build_requests: {} as Record<string, unknown>,
    version_progress: {} as Record<string, unknown>,
}))

vi.mock('@/services/state', async importOriginal => ({
    ...await importOriginal<object>(),
    print_service_warning_dialog: mocks.warning_dialog,
    report_failure: mocks.report_failure,
}))
vi.mock('@/services/designs', () => ({
    current_design_id: mocks.design_id,
    flush_changes: mocks.flush_changes,
    design_wizard: mocks.wizard,
}))
vi.mock('@/services/versions', () => ({
    selected_version_id: mocks.selected_version_id,
    until_version_settled: mocks.until_settled,
}))
vi.mock('@/services/errors', () => ({report_error: mocks.report_error}))
vi.mock('@/services/version_compile', () => ({
    create_pending_version: mocks.create_pending_version,
    compile_and_upload: mocks.compile_and_upload,
}))
vi.mock('@/services/compile_progress', () => ({
    hold_page: () => mocks.release_page,
    build_requests: mocks.build_requests,
    version_progress: mocks.version_progress,
    claim_compile_turn: mocks.claim_compile_turn,
    compiling_here: {value: false},
}))
vi.mock('@/services/user_prefs', () => ({
    has_seen_print_service_warning: mocks.seen_warning,
    record_seen_print_service_warning: mocks.record_seen,
}))
vi.mock('@/services/typst', () => ({typst_generator: mocks.generator}))
vi.mock('@/services/content_images', () => ({
    resolve_content_for_style: async (_id:string, content:unknown[]) => content,
}))
vi.mock('@/services/page_estimate', () => ({
    fresh_estimate: mocks.fresh_estimate,
    estimate_pages_for: mocks.estimate_pages_for,
    render_signature: (blueprint:object = blue) => JSON.stringify(blueprint),
}))
vi.mock('@/services/binding_advice', () => ({
    auto_binding: mocks.auto_binding,
    auto_binding_applies: (service_id:string) => service_id === 'home',
}))
vi.mock('@/services/compile_mode', () => ({compiles_on_server: mocks.compiles_on_server}))
vi.mock('@/services/utils', () => ({generate_token: () => `token_${++token_count}`}))


import {build_design, build_starting} from '@/services/build'
import {translate} from '@/services/i18n'

import type {Router} from 'vue-router'


// Tokens handed out so far (the first of each build is its version id)
let token_count = 0


// A router that records where it was sent, its current route following push/replace
function make_router(){
    const current = {value: {params: {} as Record<string, string>}}
    const go = async (to:{params:Record<string, string>}) => {
        current.value = {params: to.params}
    }
    return {push: vi.fn(go), replace: vi.fn(go), currentRoute: current} as unknown as Router
        & {push:ReturnType<typeof vi.fn<typeof go>>, replace:ReturnType<typeof vi.fn<typeof go>>}
}


// Let the fire-and-forget print warning run its course
async function settle():Promise<void>{
    for (let i = 0; i < 10; i++){
        await Promise.resolve()
    }
}


beforeEach(() => {
    vi.clearAllMocks()
    token_count = 0
    mocks.design_id.value = 'design_1'
    mocks.wizard.simple_mode = false
    mocks.generator.value = {}
    mocks.compiles_on_server.mockReturnValue(false)
    mocks.fresh_estimate.mockReturnValue(null)
    mocks.estimate_pages_for.mockResolvedValue(120)
    mocks.claim_compile_turn.mockResolvedValue(mocks.release_turn)
    mocks.seen_warning.mockResolvedValue(false)
    mocks.until_settled.mockResolvedValue('available')
    for (const key of Object.keys(mocks.build_requests)){
        delete mocks.build_requests[key]
        delete mocks.version_progress[key]
    }
    set_blue(make_blueprint({service_id: 'home'}))
})


describe('build_design', () => {

    it('does nothing without a compiler (unless the server compiles) or an open design', async () => {
        const router = make_router()
        mocks.generator.value = null
        await build_design(router)
        mocks.generator.value = {}
        mocks.design_id.value = null
        await build_design(router)
        expect(router.push).not.toHaveBeenCalled()

        // A device the server compiles for needs no compiler of its own
        mocks.generator.value = null
        mocks.design_id.value = 'design_1'
        mocks.compiles_on_server.mockReturnValue(true)
        await build_design(router)
        expect(mocks.create_pending_version).toHaveBeenCalled()
    })

    it('goes straight to the new version\'s page, then freezes and compiles it', async () => {
        const router = make_router()
        await build_design(router)
        expect(router.push).toHaveBeenCalledWith(
            {name: 'design', params: {id: 'design_1', version: 'token_1'}})
        expect(mocks.selected_version_id.value).toBe('token_1')
        expect(mocks.flush_changes).toHaveBeenCalled()
        const [design_id, , version_id] = mocks.create_pending_version.mock.calls[0]!
        expect([design_id, version_id]).toEqual(['design_1', 'token_1'])
        expect(mocks.compile_and_upload).toHaveBeenCalledWith({job: true}, null)
        expect(build_starting.value).toBe(false)
        // Kept once the version exists, so it's timed from the click through any fallback
        expect(mocks.build_requests['token_1']).toBeDefined()
    })

    it('takes the design\'s own save_token when nothing was edited since the click', async () => {
        await build_design(make_router())
        expect(mocks.create_pending_version.mock.calls[0]![4]).toBe(null)
    })

    it('freezes the click-time design, with a token of its own if edited meanwhile', async () => {
        const router = make_router()
        router.push.mockImplementationOnce(async () => {
            blue.bibles = ['eng_edited']
        })
        await build_design(router)
        const [, blueprint, , , save_token] = mocks.create_pending_version.mock.calls[0]!
        expect((blueprint as {bibles:string[]}).bibles).not.toEqual(['eng_edited'])
        expect(save_token).toBe('token_2')
    })

    it('measures a simple design first, on its turn, when its binding depends on it', async () => {
        mocks.wizard.simple_mode = true
        await build_design(make_router())
        expect(mocks.claim_compile_turn).toHaveBeenCalled()
        expect(mocks.auto_binding).toHaveBeenCalledWith(expect.anything(), 120)
        const [, blueprint, , page_estimate] = mocks.create_pending_version.mock.calls[0]!
        expect((blueprint as {binding_type:string}).binding_type).toBe('coil')
        expect(page_estimate).toBe(120)
        // The turn is handed on to the compile, which releases it
        expect(mocks.compile_and_upload).toHaveBeenCalledWith({job: true}, mocks.release_turn)
    })

    it('uses a fresh estimate as is, measuring nothing', async () => {
        mocks.wizard.simple_mode = true
        mocks.fresh_estimate.mockReturnValue(64)
        await build_design(make_router())
        expect(mocks.claim_compile_turn).not.toHaveBeenCalled()
        expect(mocks.auto_binding).toHaveBeenCalledWith(expect.anything(), 64)
    })

    it('defers the estimate of any other design to the compile, falling back to a guess', async () => {
        await build_design(make_router())
        expect(mocks.claim_compile_turn).not.toHaveBeenCalled()
        const page_estimate = mocks.create_pending_version.mock.calls[0]![3] as () =>
            Promise<number>
        expect(await page_estimate()).toBe(120)
        mocks.estimate_pages_for.mockResolvedValueOnce(null)
        expect(await page_estimate()).toBe(0)
    })

    it('abandons the build when the user switched to another design meanwhile', async () => {
        mocks.flush_changes.mockImplementationOnce(async () => {
            mocks.design_id.value = 'design_2'
        })
        await build_design(make_router())
        expect(mocks.create_pending_version).not.toHaveBeenCalled()
        expect(mocks.build_requests['token_1']).toBeUndefined()
    })

    it('tells the user when a step before the compile fails, leaving the dead version page',
            async () => {
        const router = make_router()
        mocks.create_pending_version.mockRejectedValueOnce(new Error('rules refused'))
        await build_design(router)
        expect(mocks.report_failure).toHaveBeenCalledWith(expect.any(Error),
            translate('view.design.build_failed'))
        expect(router.replace).toHaveBeenCalledWith({name: 'design', params: {id: 'design_1'}})
        expect(mocks.release_page).toHaveBeenCalled()
        expect(mocks.build_requests['token_1']).toBeUndefined()
        expect(mocks.version_progress['token_1']).toBeUndefined()
    })

    it('stays put after a failure once the user has already left the version page', async () => {
        const router = make_router()
        mocks.flush_changes.mockImplementationOnce(async () => {
            router.currentRoute.value = {params: {}} as never
            throw new Error('offline')
        })
        await build_design(router)
        expect(router.replace).not.toHaveBeenCalled()
    })

})


describe('the print-service warning', () => {

    it('is never shown for printing at home', async () => {
        await build_design(make_router())
        await settle()
        expect(mocks.warning_dialog).not.toHaveBeenCalled()
    })

    it('is shown once a printing service\'s first version has a PDF, and recorded', async () => {
        set_blue(make_blueprint({service_id: 'lulu'}))
        await build_design(make_router())
        await settle()
        expect(mocks.until_settled).toHaveBeenCalledWith('token_1')
        expect(mocks.warning_dialog).toHaveBeenCalled()
        expect(mocks.record_seen).toHaveBeenCalled()
    })

    it('stays quiet once seen, or when the build failed', async () => {
        set_blue(make_blueprint({service_id: 'lulu'}))
        mocks.seen_warning.mockResolvedValueOnce(true)
        await build_design(make_router())
        await settle()
        mocks.until_settled.mockResolvedValueOnce('failed')
        await build_design(make_router())
        await settle()
        expect(mocks.warning_dialog).not.toHaveBeenCalled()
    })

    it('only reports its own failure, since the build itself worked', async () => {
        set_blue(make_blueprint({service_id: 'lulu'}))
        mocks.seen_warning.mockRejectedValueOnce(new Error('prefs unreadable'))
        await build_design(make_router())
        await settle()
        expect(mocks.report_error).toHaveBeenCalledWith('silent', expect.any(Error))
        expect(mocks.report_failure).not.toHaveBeenCalled()
    })

})
