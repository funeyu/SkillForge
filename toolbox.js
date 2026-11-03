(() => {
  'use strict';

  const storageKey = 'skillforge.skills.v1';
  const toolbox = document.getElementById('skill-toolbox');
  const list = document.getElementById('skill-list');
  const empty = document.getElementById('toolbox-empty');
  const summary = document.getElementById('toolbox-summary');
  let renderVersion = 0;

  function isSkill(skill) {
    return skill && typeof skill.id === 'string' && skill.id.trim()
      && typeof skill.name === 'string' && skill.name.trim()
      && typeof skill.content === 'string' && skill.content.trim()
      && (skill.description === undefined || typeof skill.description === 'string');
  }

  function readSkills() {
    const skills = JSON.parse(localStorage.getItem(storageKey) || '[]');
    if (!Array.isArray(skills) || !skills.every(isSkill)) {
      throw new Error('Skill 数据格式不正确');
    }
    return skills;
  }

  async function renderSkills() {
    const version = ++renderVersion;
    list.replaceChildren();
    list.hidden = true;
    empty.hidden = true;
    try {
      let skills = readSkills();
      if (window.skillforge?.listSkills) {
        const result = await window.skillforge.listSkills();
        if (!result.ok) throw new Error(result.error);
        skills = [...new Map([...skills, ...result.value].map(skill => [skill.id, skill])).values()];
      }
      if (version !== renderVersion) return;
      summary.textContent = `共 ${skills.length} 个 Skill`;
      empty.hidden = skills.length !== 0;
      list.hidden = skills.length === 0;
      for (const skill of skills) {
        const item = document.createElement('li');
        const card = document.createElement('details');
        card.className = 'skill-card';
        const title = document.createElement('summary');
        title.textContent = skill.name;
        card.append(title);
        if (skill.description) {
          const description = document.createElement('p');
          description.className = 'skill-description';
          description.textContent = skill.description;
          card.append(description);
        }
        if (skill.source) {
          const provenance = document.createElement('p');
          provenance.className = 'skill-provenance';
          provenance.textContent = `来源：${skill.source.title || ''}\n${skill.source.url}\n读取时间：${skill.source.retrievedAt}`;
          card.append(provenance);
        }
        if (skill.installation) {
          const installation = document.createElement('p');
          installation.className = 'skill-provenance';
          installation.textContent = skill.installation.status === 'installed'
            ? `已安装到 ${skill.installation.agent}：${skill.installation.path}`
            : `尚未安装到 Agent${skill.installation.error ? `：${skill.installation.error}` : ''}`;
          card.append(installation);
        }
        const content = document.createElement('pre');
        content.className = 'skill-content';
        content.textContent = skill.content;
        card.append(content);
        item.append(card);
        list.append(item);
      }
    } catch (error) {
      if (version !== renderVersion) return;
      summary.textContent = '暂时无法读取 Skill，请关闭工具箱后重试。本地数据未被修改。';
      console.warn('[SkillForge toolbox]', error);
    }
  }

  function saveSkill(skill) {
    if (!isSkill(skill)) throw new TypeError('Skill 需要 id、name 和 content');
    const skills = readSkills();
    const record = { id: skill.id, name: skill.name, description: skill.description || '', content: skill.content };
    const index = skills.findIndex(item => item.id === record.id);
    if (index === -1) skills.unshift(record);
    else skills[index] = record;
    localStorage.setItem(storageKey, JSON.stringify(skills));
    if (toolbox.open) renderSkills();
  }

  window.skillforgeSkills = Object.freeze({ list: readSkills, save: saveSkill });
  document.getElementById('open-toolbox').addEventListener('click', () => {
    renderSkills();
    if (!toolbox.open) toolbox.showModal();
  });
  document.getElementById('close-toolbox').addEventListener('click', () => toolbox.close());
  toolbox.addEventListener('click', event => {
    if (event.target !== toolbox) return;
    const bounds = toolbox.getBoundingClientRect();
    if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) toolbox.close();
  });
  window.addEventListener('storage', event => {
    if ((event.key === storageKey || event.key === null) && toolbox.open) renderSkills();
  });
  window.addEventListener('skillforge:skills-changed', () => { if (toolbox.open) void renderSkills(); });
})();
