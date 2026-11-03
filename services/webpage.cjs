const { webUrl } = require('./network.cjs');

function parseWebpage(html, url, contentType = 'text/html') {
  let JSDOM;
  let Readability;
  try {
    ({ JSDOM } = require('jsdom'));
    ({ Readability } = require('@mozilla/readability'));
  } catch (error) {
    throw new Error('网页文字提取依赖不可用，请在 SkillForge 运行 npm install：' + error.message);
  }
  const dom = new JSDOM(html, { url, contentType });
  try {
    const document = dom.window.document;
    const media = new Map();
    const warnings = [];
    let unsupportedMedia = false;
    function addMedia(value) {
      if (typeof value !== 'string' || !value.trim()) return;
      try {
        const address = webUrl(value, document.baseURI).href;
        if (/\.(?:m3u8|mpd)(?:$|\?)/i.test(address)) {
          unsupportedMedia = true;
          return;
        }
        if (media.size < 100) media.set(address, { url: address });
      } catch {
        unsupportedMedia = true;
      }
    }
    for (const element of document.querySelectorAll('video[src], audio[src], video source[src], audio source[src]')) {
      addMedia(element.getAttribute('src'));
    }
    for (const element of document.querySelectorAll('meta[property], meta[name]')) {
      if (/^(?:og:(?:video|audio)(?::(?:url|secure_url))?|twitter:player:stream)$/.test(element.getAttribute('property') || element.getAttribute('name'))) {
        addMedia(element.getAttribute('content'));
      }
    }
    let visited = 0;
    function visit(value, depth = 0) {
      if (!value || typeof value !== 'object' || depth > 30 || ++visited > 10000) return;
      if ([value['@type']].flat().some(type => ['VideoObject', 'AudioObject'].includes(type))) addMedia(value.contentUrl);
      for (const child of Object.values(value)) visit(child, depth + 1);
    }
    for (const element of document.querySelectorAll('script[type="application/ld+json"]')) {
      try { visit(JSON.parse(element.textContent)); } catch {}
    }
    if (unsupportedMedia) warnings.push('发现 Blob、HLS/DASH 或非 HTTP 媒体；请提供可直接播放的媒体文件，再进行边播放边识别');
    if (!media.size && document.querySelector('video, audio, iframe')) {
      warnings.push('页面媒体需要动态解析或嵌入播放器；可传入解析后的 mediaUrls 或完整的 localMediaPaths');
    }
    const parsed = new Readability(document.cloneNode(true), { maxElemsToParse: 100000 }).parse();
    const article = parsed?.textContent?.trim() ? {
      title: parsed.title || document.title,
      byline: parsed.byline || null,
      siteName: parsed.siteName || null,
      excerpt: parsed.excerpt || null,
      lang: parsed.lang || document.documentElement.lang || null,
      publishedTime: parsed.publishedTime || null,
      text: parsed.textContent.trim()
    } : null;
    return { title: article?.title || document.title, article, media: [...media.values()], warnings };
  } finally {
    dom.window.close();
  }
}

module.exports = { parseWebpage };
