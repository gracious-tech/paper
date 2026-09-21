
import {defineConfig} from 'vitest/config'


// The emulator-backed suites. Each file brings up its own RulesTestEnvironment and clears
// Firestore between cases, so files must not run against the same emulator concurrently
export default defineConfig({
    test: {
        // Redirects the Admin SDK to the test emulators before any suite imports it
        setupFiles: ['./setup_env.ts'],
        // Rule evaluation and Storage uploads are round trips to a local emulator, not pure
        // function calls — the default 5s is tight for the larger upload cases
        testTimeout: 30_000,
        hookTimeout: 30_000,
        // clearFirestore() and clearStorage() are global to the emulator, so two files running at
        // once would wipe each other's fixtures mid-test
        fileParallelism: false,
    },
})
