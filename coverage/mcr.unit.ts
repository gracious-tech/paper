
// The MCR config each unit group's vitest run loads (via vitest-monocart-coverage, see
// .bin/audit_unit's COVERAGE switch). It only exports raw V8 data under the group's name —
// coverage/merge.ts turns every run's raw data into the one report

import {REPORTS_DIR, RAW_DIR, shared_options} from './scope.ts'


// Which group this run is, set by audit_unit alongside the coverage flags
const group = process.env['COVERAGE_GROUP'] ?? 'unit'


export default {
    ...shared_options(),
    name: `Unit coverage: ${group}`,
    outputDir: `${REPORTS_DIR}work/${group}`,
    cleanCache: true,
    reports: [['raw', {outputDir: `${RAW_DIR}${group}`}]],
}
