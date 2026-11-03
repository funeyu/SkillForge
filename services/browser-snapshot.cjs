async function browserSnapshot() {
  await new Promise(resolve => {
    let quiet;
    let deadline;
    const finish = () => { observer.disconnect(); clearTimeout(quiet); clearTimeout(deadline); resolve(); };
    const changed = () => {
      clearTimeout(quiet);
      if ((document.body?.innerText || '').trim().length >= 80) quiet = setTimeout(finish, 500);
    };
    const observer = new MutationObserver(changed);
    observer.observe(document.documentElement, { subtree: true, childList: true, characterData: true });
    deadline = setTimeout(finish, 6000);
    changed();
  });
  const visible = element => element.getClientRects().length > 0 && getComputedStyle(element).visibility !== 'hidden';
  const bodyText = document.body?.innerText || '';
  const hasPassword = [...document.querySelectorAll('input[type="password"]')].some(visible);
  const gate = /登录后(?:继续|查看|阅读)|请先登录|扫码登录|登录即可(?:查看|阅读)|sign in to (?:continue|read|view)|log in to (?:continue|read|view)|verify you are human|checking your browser|access denied|验证码验证/i;
  const candidates = [...document.querySelectorAll('article, main, [role="main"]')]
    .filter(visible).map(element => element.innerText || '').sort((first, second) => second.length - first.length);
  const text = candidates[0]?.trim().length >= 200 ? candidates[0].trim() : bodyText.trim();
  const gatedDialog = [...document.querySelectorAll('[role="dialog"], dialog')].some(element => visible(element) && gate.test(element.innerText || ''));
  const authRequired = hasPassword || gatedDialog || gate.test(bodyText.slice(0, 10000)) && text.length < 800
    || /(?:sign in|log in|登录|安全验证)/i.test(document.title) && text.length < 800;
  return {
    url: location.href, title: document.title.slice(0, 500), text: text.slice(0, 1000000),
    authRequired, truncated: text.length > 1000000, extraction: 'visible-text',
    warnings: text.length > 1000000 ? ['网页超过 1,000,000 字符，快照已截断；分析前请确认资料范围'] : []
  };
}

module.exports = { browserSnapshot };
