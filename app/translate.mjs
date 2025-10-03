
import fs from 'node:fs'
import path from 'node:path'
import {Agent} from 'undici'


// Config
const api_key = process.env.OPENAI_KEY


async function translate(content, language){
    const sys_prompt = `This is a JSON i18n UI strings file with empty values for an app that produces Christian Scripture into PDFs that can be printed at home. The object keys are the strings that need translating. Map all the strings to a translation of them in ${language}. The resulting JSON should have exactly the same keys as the original file, with the values filled with translated strings.`

    const response = await fetch('https://api.openai.com/v1/responses', {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${api_key}`,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            model: 'gpt-5',  // GPT5 has issues but has a massively larger context window / limit
            instructions: sys_prompt,
            input: content,
        }),
        dispatcher: new Agent({
            headersTimeout: 60 * 1000 * 10,  // Wait 10 minutes
        })
    })

    const data = await response.json()
    try {
        return data.output.find(i => i.type === 'message').content[0].text
    } catch {
        throw new Error(JSON.stringify(data))
    }
}


// Get languages that need to be supported
const languages = JSON.parse(fs.readFileSync('src/locales.json', 'utf8')).supported

// Get strings that need translating
const original = fs.readFileSync('src/locales/en.json', 'utf8')


for (const language of languages){

    const out_file = `src/locales/${language}.json`
    if (fs.existsSync(out_file)){
        console.log(`Already exists: ${out_file}`)
        continue
    }
    console.log(`Translating to ${out_file}`)
    const translated = await translate(original, language)
    fs.writeFileSync(out_file, translated, 'utf8')
}
