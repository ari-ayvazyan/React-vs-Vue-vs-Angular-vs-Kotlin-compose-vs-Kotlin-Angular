import { brotliCompressSync, constants, gzipSync } from 'node:zlib';

/** Compress server-rendered HTML (Nitro only pre-compresses static assets). */
export default defineNitroPlugin((nitro) => {
  nitro.hooks.hook('render:response', (response, { event }) => {
    if (typeof response.body !== 'string' || response.body.length < 1024) return;
    const accept = getRequestHeader(event, 'accept-encoding') ?? '';
    const encoding = accept.includes('br') ? 'br' : accept.includes('gzip') ? 'gzip' : null;
    if (!encoding) return;
    const body = Buffer.from(response.body);
    response.body = (encoding === 'br' ? brotliCompressSync(body, { params: { [constants.BROTLI_PARAM_QUALITY]: 4 } }) : gzipSync(body)) as unknown as string;
    response.headers = { ...response.headers, 'content-encoding': encoding, vary: 'Accept-Encoding' };
  });
});
