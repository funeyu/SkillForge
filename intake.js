(() => {
  'use strict';
  const input = document.getElementById('source-url');
  const form = document.getElementById('source-form');
  const scene = document.getElementById('scene');
  const status = document.getElementById('intake-status');
  const message = document.getElementById('intake-message');
  const warning = document.getElementById('intake-warning');
  const cancel = document.getElementById('cancel-intake');
  const preview = document.getElementById('source-preview');
  const title = document.getElementById('source-title');
  const excerpt = document.getElementById('source-excerpt');
  const state = { phase: -1, progress: 0, active: false, paused: false, completed: false, characters: 0 };
  let currentJob;
  let starting = false;
  window.getForgeState = () => ({ ...state });

  function unwrap(result) {
    if (!result?.ok) throw new Error(result?.error || '服务暂时不可用');
    return result.value;
  }

  function applyJob(job) {
    if (job.status === 'completed') window.dispatchEvent(new Event('skillforge:skills-changed'));
    if (currentJob && job.id !== currentJob.id && job.createdAt < currentJob.createdAt) return;
    currentJob = job;
    status.hidden = false;
    input.value = job.url;
    const phases = { queued: [0, .03], reading: [0, .15], login_required: [0, .15], awaiting_agent: [2, .65], completed: [3, 1] };
    const [phase, progress] = phases[job.status] || [-1, 0];
    const active = ['queued', 'reading', 'login_required', 'awaiting_agent'].includes(job.status);
    Object.assign(state, { phase, progress, active, paused: job.status === 'login_required', completed: job.status === 'completed', characters: job.characters || 0 });
    input.readOnly = active;
    form.setAttribute('aria-busy', String(active));
    form.dataset.busy = String(active);
    scene.dataset.intake = job.status === 'completed' ? 'complete' : job.status === 'awaiting_agent' ? 'analyzing' : active ? 'reading' : 'idle';
    cancel.hidden = !active;
    cancel.disabled = false;
    message.textContent = job.message;
    if (job.status === 'awaiting_agent') message.textContent += `（任务 ${job.id}）`;
    const pressure = window.skillforgePressure.getPressure(state.characters);
    scene.dataset.pressure = status.dataset.pressure = pressure.level;
    document.getElementById('pressure-count').textContent = `${pressure.characters.toLocaleString('zh-CN')} 字`;
    document.getElementById('pressure-label').textContent = pressure.label;
    const meter = document.getElementById('pressure-meter');
    meter.value = Math.min(1000000, pressure.characters);
    meter.setAttribute('aria-valuetext', `${pressure.characters} 字，${pressure.label}`);
    document.getElementById('pressure-alert').textContent = pressure.label;
    preview.hidden = !job.preview;
    title.textContent = job.title || '查看已读取的资料';
    excerpt.textContent = job.preview || '';
    const warnings = [...(job.warnings || [])];
    if (job.installation?.status === 'blocked') warnings.push(`工具箱已保存，但 Agent 安装失败：${job.installation.error}`);
    warning.textContent = warnings.join('；');
    warning.hidden = !warnings.length;
    document.getElementById('open-toolbox').classList.toggle('skill-added', job.status === 'completed');
  }

  form.addEventListener('submit', async event => {
    event.preventDefault();
    if (starting || state.active) return;
    starting = true;
    status.hidden = false;
    try {
      if (!window.skillforge) throw new Error('请由 Agent 启动 SkillForge Electron 后读取网页');
      const value = input.value.trim();
      if (!value) throw new Error('请先输入网页地址');
      const url = new URL(/^[a-z][a-z\d+.-]*:/i.test(value) ? value : `https://${value}`);
      if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error('请输入不含账号密码的 HTTP(S) 网页地址');
      input.removeAttribute('aria-invalid');
      applyJob(unwrap(await window.skillforge.start({ url: url.href })));
    } catch (error) { message.textContent = error.message; }
    finally { starting = false; }
  });
  input.addEventListener('keydown', event => {
    if (event.key === 'Enter' && !event.isComposing && event.keyCode !== 229) { event.preventDefault(); form.requestSubmit(); }
  });
  cancel.addEventListener('click', async () => {
    if (!currentJob) return;
    cancel.disabled = true;
    try { applyJob(unwrap(await window.skillforge.cancel(currentJob.id))); }
    catch (error) { message.textContent = error.message; cancel.disabled = false; }
  });
  const unsubscribe = window.skillforge?.onProgress(applyJob);
  window.skillforge?.jobs().then(result => {
    const latest = unwrap(result).at(-1);
    if (latest) applyJob(latest);
  }).catch(error => { status.hidden = false; message.textContent = error.message; });
  preview.hidden = true;
  window.addEventListener('beforeunload', () => unsubscribe?.());
})();
