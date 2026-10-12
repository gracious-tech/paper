
import {execFileSync} from 'node:child_process'


// Headless claude calls that must answer in a fixed shape. The prompt goes in on stdin rather
// than argv, which caps a single argument at 128KB on Linux — easily hit by a batch of reports


export function claude_structured<T>(prompt:string, schema:object):T{
    // Run a one-shot claude query whose answer is validated against a JSON schema
    const output = execFileSync('claude',
        ['-p', '--output-format', 'json', '--json-schema', JSON.stringify(schema)],
        {input: prompt, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024, timeout: 15 * 60 * 1000})
    const result = JSON.parse(output) as {structured_output?:T, is_error?:boolean, result?:string}
    if (result.is_error || result.structured_output === undefined){
        throw new Error(`claude gave no structured answer: ${result.result ?? '(no output)'}`)
    }
    return result.structured_output
}

