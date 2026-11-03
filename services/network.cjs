const http = require('node:http');
const https = require('node:https');
const { lookup } = require('node:dns/promises');
const { BlockList, isIP } = require('node:net');

const blocked = new BlockList();
for (const [address, prefix] of [
  ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8],
  ['169.254.0.0', 16], ['172.16.0.0', 12], ['192.0.0.0', 24], ['192.0.2.0', 24],
  ['192.168.0.0', 16], ['198.18.0.0', 15], ['198.51.100.0', 24], ['203.0.113.0', 24],
  ['224.0.0.0', 4], ['240.0.0.0', 4]
]) blocked.addSubnet(address, prefix, 'ipv4');
blocked.addSubnet('2001::', 32, 'ipv6');
blocked.addSubnet('2001:db8::', 32, 'ipv6');
blocked.addSubnet('2002::', 16, 'ipv6');

function webUrl(value, base) {
  const url = new URL(value, base);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) {
    throw new Error('仅支持不含用户名和密码的 HTTP(S) 地址');
  }
  url.hash = '';
  return url;
}

function isPublicAddress(address) {
  const family = isIP(address);
  if (family === 4) return !blocked.check(address, 'ipv4');
  return family === 6 && /^[23]/.test(address) && !blocked.check(address, 'ipv6');
}

async function openUrl(value, { signal, referer, range, timeoutMs = 120000 } = {}) {
  let url = webUrl(value);
  for (let redirects = 0; redirects <= 5; redirects++) {
    signal?.throwIfAborted();
    const hostname = url.hostname.replace(/^\[|\]$/g, '');
    const addresses = isIP(hostname)
      ? [{ address: hostname, family: isIP(hostname) }]
      : await lookup(hostname, { all: true });
    signal?.throwIfAborted();
    if (!addresses.length || addresses.some(entry => !isPublicAddress(entry.address))) {
      throw new Error('网页提取不允许访问本机、内网或保留地址');
    }
    const headers = { 'user-agent': 'SkillForge/0.1', 'accept-encoding': 'identity' };
    if (range) {
      if (!/^bytes=\d*-\d*$/.test(range)) throw new Error('媒体 Range 请求格式无效');
      headers.range = range;
    }
    if (referer) {
      const source = webUrl(referer);
      if (!(source.protocol === 'https:' && url.protocol === 'http:')) {
        headers.referer = source.origin === url.origin ? source.href : source.origin + '/';
      }
    }
    const response = await new Promise((resolve, reject) => {
      const request = (url.protocol === 'https:' ? https : http).get(url, {
        agent: false,
        signal,
        headers,
        lookup: (_hostname, options, callback) => {
          const selected = addresses.find(entry => !options.family || entry.family === options.family) || addresses[0];
          if (options.all) callback(null, [selected]);
          else callback(null, selected.address, selected.family);
        }
      }, resolve);
      request.on('error', reject);
      request.setTimeout(timeoutMs, () => request.destroy(new Error('下载超时，长时间未收到数据')));
    });
    response.on('error', () => {});
    if ([301, 302, 303, 307, 308].includes(response.statusCode)) {
      const location = response.headers.location;
      response.destroy();
      if (!location || redirects === 5) throw new Error('重定向地址无效或次数过多');
      url = webUrl(location, url);
      continue;
    }
    if (response.statusCode < 200 || response.statusCode >= 300) {
      response.destroy();
      throw new Error(`下载失败（HTTP ${response.statusCode}），可能需要登录或访问授权`);
    }
    return { response, url: url.href };
  }
}

async function consume(response, maxBytes, write, signal) {
  let bytes = 0;
  try {
    const encoding = response.headers['content-encoding'];
    if (encoding && encoding !== 'identity') throw new Error('服务器未返回未压缩内容，请更换下载地址');
    const length = response.headers['content-length'];
    let total = length === undefined ? undefined : Number(length);
    if (length !== undefined && (!/^\d+$/.test(length) || !Number.isSafeInteger(total) || total > maxBytes)) {
      throw new Error('响应大小无效或超过限制');
    }
    if (response.statusCode === 206) {
      const range = response.headers['content-range']?.match(/^bytes 0-(\d+)\/(\d+)$/);
      if (!range || Number(range[1]) + 1 !== Number(range[2]) || (total !== undefined && total !== Number(range[2]))) {
        throw new Error('服务器仅返回部分媒体，不能开始转写');
      }
      total = Number(range[2]);
      if (!Number.isSafeInteger(total) || total > maxBytes) throw new Error('媒体大小超过限制');
    }
    for await (const chunk of response) {
      signal?.throwIfAborted();
      bytes += chunk.length;
      if (bytes > maxBytes || (total !== undefined && bytes > total)) throw new Error('下载内容超过大小限制');
      await write(chunk, bytes, total);
    }
    signal?.throwIfAborted();
    if (!bytes || (total !== undefined && bytes !== total)) throw new Error('下载不完整，不能开始提取');
    return bytes;
  } finally {
    response.destroy();
  }
}

module.exports = { webUrl, isPublicAddress, openUrl, consume };
