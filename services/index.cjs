const path = require('node:path');
const { webUrl, openUrl, consume } = require('./network.cjs');
const { parseWebpage } = require('./webpage.cjs');
const { transcribePlayback } = require('./speech.cjs');
const { countCharacters } = require('../pressure.js');

const htmlLimit = 8 * 1024 * 1024;

function contentKind(response) {
  const mime = String(response.headers['content-type'] || '').split(';')[0].trim().toLowerCase();
  if (/mpegurl|dash\+xml/.test(mime)) return 'playlist';
  if (/^(?:audio|video)\//.test(mime) || ['application/octet-stream', 'binary/octet-stream'].includes(mime)) return 'media';
  if (['text/html', 'application/xhtml+xml'].includes(mime)) return 'html';
  return 'unknown';
}

async function extractWebContent(value, options = {}) {
  const sourceUrl = webUrl(value).href;
  const mode = options.mode || 'auto';
  const maxMedia = options.maxMedia ?? 1;
  const timeoutMs = options.timeoutMs ?? 30 * 60 * 1000;
  if (!['auto', 'text', 'media'].includes(mode)) throw new Error('mode 仅支持 auto、text 或 media');
  if (!Number.isInteger(maxMedia) || maxMedia < 1 || maxMedia > 8) throw new Error('maxMedia 必须为 1 到 8');
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 24 * 60 * 60 * 1000) throw new Error('timeoutMs 必须在 1 毫秒到 24 小时之间');
  if (options.language !== undefined && !['auto', 'zh', 'en'].includes(options.language)) throw new Error('language 仅支持 auto、zh 或 en');
  if (options.html !== undefined && (typeof options.html !== 'string' || Buffer.byteLength(options.html) > htmlLimit)) throw new Error('html 必须为不超过 8 MB 的字符串');
  for (const key of ['mediaUrls', 'localMediaPaths']) {
    if (options[key] !== undefined && (!Array.isArray(options[key]) || options[key].length > 100 || options[key].some(item => typeof item !== 'string' || !item.trim()))) {
      throw new Error(`${key} 必须为不超过 100 项的非空字符串数组`);
    }
  }
  const candidates = [
    ...(options.localMediaPaths || []).map(localPath => ({ localPath: path.resolve(localPath) })),
    ...(options.mediaUrls || []).map(url => ({ url: webUrl(url, sourceUrl).href }))
  ];
  const signal = AbortSignal.any([AbortSignal.timeout(timeoutMs), ...(options.signal ? [options.signal] : [])]);
  const onProgress = event => {
    try { options.onProgress?.(event); } catch {}
  };
  const warnings = [];
  const media = [];
  let url = sourceUrl;
  let article = null;
  let title = '';
  let pendingResponse;
  try {
    signal.throwIfAborted();
    let html = options.html;
    let contentType;
    if (html === undefined && !(mode === 'media' && candidates.length)) {
      onProgress({ stage: 'fetching', message: '正在获取网页内容' });
      const fetched = await openUrl(url, { signal, timeoutMs: 30000 });
      url = fetched.url;
      pendingResponse = fetched.response;
      const kind = contentKind(pendingResponse);
      if (kind === 'media') {
        if (mode === 'text') throw new Error('该地址是音视频文件，不是文字网页');
        candidates.push({ url });
        pendingResponse.destroy();
        pendingResponse = undefined;
      } else if (kind === 'html') {
        contentType = pendingResponse.headers['content-type'];
        const chunks = [];
        await consume(pendingResponse, htmlLimit, chunk => { chunks.push(chunk); }, signal);
        pendingResponse = undefined;
        html = Buffer.concat(chunks);
      } else {
        throw new Error(kind === 'playlist' ? '暂不支持 HLS/DASH 播放列表，请先下载完整媒体文件' : '响应不是 HTML 网页或音视频文件');
      }
    }
    if (html !== undefined) {
      onProgress({ stage: 'reading', message: '正在使用 Readability 提取正文' });
      const page = parseWebpage(html, url, contentType);
      article = page.article;
      title = page.title;
      warnings.push(...page.warnings);
      candidates.push(...page.media);
      onProgress({ stage: 'extracted', message: '网页正文已提取', characters: mode !== 'media' && article ? countCharacters(article.text) : 0, title, preview: article?.text.slice(0, 1200) || '' });
    }
    if (mode !== 'text') {
      const unique = [...new Map(candidates.map(candidate => [candidate.localPath || candidate.url, candidate])).values()];
      if (unique.length > maxMedia) warnings.push(`发现 ${unique.length} 个媒体，仅处理前 ${maxMedia} 个；可调整 maxMedia（上限 8）`);
      if (!unique.length && (mode === 'media' || !article)) warnings.push('未发现可直接播放的音视频；动态、登录或 DRM 页面需要提供 mediaUrls 或 localMediaPaths');
      for (const [index, candidate] of unique.slice(0, maxMedia).entries()) {
        signal.throwIfAborted();
        try {
          if (candidate.url && /\.(?:m3u8|mpd)(?:$|\?)/i.test(candidate.url)) throw new Error('暂不支持 HLS/DASH 播放列表，请提供可播放的媒体文件');
          signal.throwIfAborted();
          onProgress({ stage: 'loading', index, message: '正在打开播放器并加载 SkillForge 内置语音模型' });
          const transcript = await transcribePlayback({ ...candidate, referer: url }, {
            ...options, signal, onProgress: event => onProgress({ ...event, index }),
            onTranscript: segment => options.onTranscript?.({ ...segment, index })
          });
          media.push({ source: candidate.url || candidate.localPath, ...transcript });
          warnings.push(...transcript.warnings);
        } catch (error) {
          signal.throwIfAborted();
          warnings.push(`媒体 ${index + 1} 提取失败：${error.message}`);
        }
      }
    }
    signal.throwIfAborted();
    const text = [...(mode !== 'media' && article ? [article.text] : []), ...media.map(item => item.text)].join('\n\n');
    if (!text) throw new Error(warnings.join('；') || 'Readability 未找到可用正文；页面可能需要登录或 JavaScript 渲染');
    onProgress({ stage: 'complete', message: '网页内容提取完成' });
    return { sourceUrl, url, title: title || url, article: mode === 'media' ? null : article, media, text, warnings };
  } finally {
    pendingResponse?.destroy();
  }
}

module.exports = { extractWebContent };
