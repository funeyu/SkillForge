const { createReadStream } = require('node:fs');
const { stat } = require('node:fs/promises');
const { Readable } = require('node:stream');
const path = require('node:path');
const { openUrl } = require('./network.cjs');

async function mediaResponse(source, request) {
  const headers = { 'access-control-allow-origin': '*', 'accept-ranges': 'bytes' };
  if (!['GET', 'HEAD'].includes(request.method)) return new Response(null, { status: 405 });
  const range = request.headers.get('range');
  if (source.url) {
    const { response } = await openUrl(source.url, { signal: request.signal, referer: source.referer, range });
    const mime = response.headers['content-type'] || '';
    if (/mpegurl|dash\+xml/.test(mime) || !/^(?:audio\/|video\/|application\/octet-stream|binary\/octet-stream)/i.test(mime)) {
      response.destroy();
      throw new Error('播放地址不是可直接解码的音视频');
    }
    for (const name of ['content-type', 'content-length', 'content-range', 'accept-ranges']) {
      if (response.headers[name]) headers[name] = response.headers[name];
    }
    if (request.method === 'HEAD') response.destroy();
    return new Response(request.method === 'HEAD' ? null : Readable.toWeb(response), { status: response.statusCode, headers });
  }
  const info = await stat(source.localPath);
  if (!info.isFile() || !info.size) throw new Error('本地媒体文件为空或不可读取');
  let start = 0;
  let end = info.size - 1;
  if (range) {
    const match = range.match(/^bytes=(\d*)-(\d*)$/);
    if (!match || (!match[1] && !match[2])) return new Response(null, { status: 416, headers: { 'content-range': `bytes */${info.size}` } });
    if (!match[1]) start = Math.max(0, info.size - Number(match[2]));
    else {
      start = Number(match[1]);
      if (match[2]) end = Math.min(end, Number(match[2]));
    }
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start > end || start >= info.size) {
      return new Response(null, { status: 416, headers: { 'content-range': `bytes */${info.size}` } });
    }
    headers['content-range'] = `bytes ${start}-${end}/${info.size}`;
  }
  const types = { '.mp4': 'video/mp4', '.webm': 'video/webm', '.mov': 'video/quicktime', '.mp3': 'audio/mpeg', '.m4a': 'audio/mp4', '.wav': 'audio/wav', '.ogg': 'audio/ogg', '.flac': 'audio/flac' };
  headers['content-type'] = types[path.extname(source.localPath).toLowerCase()] || 'application/octet-stream';
  headers['content-length'] = String(end - start + 1);
  const body = request.method === 'HEAD' ? null : Readable.toWeb(createReadStream(source.localPath, { start, end, signal: request.signal }));
  return new Response(body, { status: range ? 206 : 200, headers });
}

module.exports = { mediaResponse };
