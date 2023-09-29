
import {PutObjectCommand, S3Client} from '@aws-sdk/client-s3'

import {hex_to_buffer, buffer_to_url64} from './utils'


const S3 = new S3Client({
    region: import.meta.env['VITE_REGION'],
    signer: {
        // Don't require authentication https://github.com/aws/aws-sdk-js-v3/issues/2321
        sign: async (request) => request,
    },
})


export async function put_request(id:string, data:string):Promise<string>{
    // Put new request and return creation id
    const resp = await S3.send(new PutObjectCommand({
        Bucket: import.meta.env['VITE_BUCKET'],
        Key: `requests/${id}`,
        Body: data,
    }))

    // AWS very annoyingly wraps etag in quotes :/
    const etag = resp.ETag!.replace(/\"/g, '')

    // Return creation id
    const url64_etag = buffer_to_url64(hex_to_buffer(etag))
    return id.slice(0, 2) + url64_etag
}


// Generate url for creation with given id and file type
export function gen_creation_url(id:string, type:'blue'|'result'|'pdf'):string{
    const bucket = import.meta.env['VITE_BUCKET']
    const region = import.meta.env['VITE_REGION']
    const ext = type === 'pdf' ? type : `${type}.json`
    return `https://${bucket}.s3.${region}.amazonaws.com/creations/${id}.${ext}`
}
