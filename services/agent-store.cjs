const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { randomUUID, createHash } = require('node:crypto');
const { countCharacters } = require('../pressure.js');

const terminal = new Set(['completed', 'error', 'cancelled']);

function webUrl(value) {
  const url = new URL(value);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.href.length > 8192) {
    throw new Error('仅支持不含账号密码的 HTTP(S) 网页地址');
  }
  return url.href;
}

function writeJson(filename, value) {
  const temporary = `${filename}.${randomUUID()}.tmp`;
  try {
    fs.writeFileSync(temporary, JSON.stringify(value, null, 2), { mode: 0o600, flag: 'wx' });
    fs.renameSync(temporary, filename);
  } finally {
    fs.rmSync(temporary, { force: true });
  }
}

function skillsDirectory(agent = 'codex') {
  if (agent === 'codex') return path.join(process.env.CODEX_HOME || path.join(os.homedir(), '.codex'), 'skills');
  if (agent === 'claude') return path.join(os.homedir(), '.claude', 'skills');
  if (agent === 'generic') return path.join(os.homedir(), '.agents', 'skills');
  throw new Error('Agent 必须是 codex、claude 或 generic');
}

function installDirectory(name, files, parent) {
  fs.mkdirSync(parent, { recursive: true, mode: 0o700 });
  const destination = path.join(parent, name);
  fs.mkdirSync(destination, { mode: 0o700 });
  try {
    for (const [filename, content] of Object.entries(files)) {
      const target = path.join(destination, filename);
      fs.mkdirSync(path.dirname(target), { recursive: true, mode: 0o700 });
      fs.writeFileSync(target, content, { mode: 0o600, flag: 'wx' });
    }
    return destination;
  } catch (error) {
    fs.rmSync(destination, { recursive: true, force: true });
    throw error;
  }
}

class AgentStore {
  constructor(root = process.env.SKILLFORGE_DATA_DIR || path.join(os.homedir(), '.skillforge')) {
    this.root = path.resolve(root);
    for (const directory of ['jobs', 'skills']) fs.mkdirSync(path.join(this.root, directory), { recursive: true, mode: 0o700 });
  }

  jobPath(id, filename = 'job.json') {
    if (!/^[a-f0-9-]{36}$/.test(id)) throw new Error('任务编号无效');
    return path.join(this.root, 'jobs', id, filename);
  }

  create(url) {
    const job = { id: randomUUID(), url: webUrl(url), status: 'queued', message: '等待 Electron 读取网页', createdAt: new Date().toISOString() };
    fs.mkdirSync(path.dirname(this.jobPath(job.id)), { mode: 0o700 });
    writeJson(this.jobPath(job.id), job);
    return job;
  }

  read(id) { return JSON.parse(fs.readFileSync(this.jobPath(id), 'utf8')); }

  update(id, values) {
    const lock = this.jobPath(id, 'state.lock');
    const descriptor = fs.openSync(lock, 'wx', 0o600);
    try {
      const previous = this.read(id);
      if (terminal.has(previous.status) && values.status && values.status !== previous.status) return previous;
      const job = { ...previous, ...values, id, updatedAt: new Date().toISOString() };
      writeJson(this.jobPath(id), job);
      return job;
    } finally { fs.closeSync(descriptor); fs.rmSync(lock, { force: true }); }
  }

  cancel(id) {
    const lock = this.jobPath(id, 'publish.lock');
    const descriptor = fs.openSync(lock, 'wx', 0o600);
    try { return terminal.has(this.read(id).status) ? this.read(id) : this.update(id, { status: 'cancelled', message: '任务已取消，未提交新的 Skill' }); }
    finally { fs.closeSync(descriptor); fs.rmSync(lock, { force: true }); }
  }

  jobs() {
    return fs.readdirSync(path.join(this.root, 'jobs')).filter(id => /^[a-f0-9-]{36}$/.test(id))
      .flatMap(id => {
        try { return [this.read(id)]; }
        catch (error) { console.warn('[SkillForge job]', id, error.message); return []; }
      }).sort((first, second) => first.createdAt.localeCompare(second.createdAt));
  }

  capture(id, source) {
    if (terminal.has(this.read(id).status)) return this.read(id);
    if (typeof source.text !== 'string' || !source.text.trim()) throw new Error('未读取到网页正文');
    const snapshot = {
      ...source, url: webUrl(source.url), requestedUrl: this.read(id).url,
      retrievedAt: new Date().toISOString(), sha256: createHash('sha256').update(source.text).digest('hex')
    };
    const contentPath = this.jobPath(id, 'source.json');
    writeJson(contentPath, snapshot);
    return this.update(id, {
      status: 'awaiting_agent', message: '网页内容已就绪，等待当前 AI Agent 分析并提炼 Skill',
      contentPath, title: snapshot.title, characters: countCharacters(snapshot.text),
      preview: snapshot.text.slice(0, 1200), warnings: snapshot.warnings || []
    });
  }

  skills() {
    return fs.readdirSync(path.join(this.root, 'skills')).filter(id => /^[a-f0-9-]{36}$/.test(id))
      .flatMap(id => {
        const filename = path.join(this.root, 'skills', id, 'skill.json');
        if (!fs.existsSync(filename)) return [];
        return [JSON.parse(fs.readFileSync(filename, 'utf8'))];
      }).sort((first, second) => second.createdAt.localeCompare(first.createdAt));
  }

  install(skill, options = {}) {
    const agent = options.agent || 'codex';
    try {
      const directory = options.skillsDir || skillsDirectory(agent);
      const sourceFile = path.join(this.root, 'skills', skill.id, 'SKILL.md');
      const destination = path.join(directory, skill.name);
      if (fs.existsSync(destination)) {
        const provenance = JSON.parse(fs.readFileSync(path.join(destination, 'source.json'), 'utf8'));
        if (provenance.jobId !== skill.id || fs.readFileSync(path.join(destination, 'SKILL.md'), 'utf8') !== fs.readFileSync(sourceFile, 'utf8')) {
          throw new Error('已有同名 Skill，未覆盖；请选择其他安装目录或更换技能名称');
        }
      } else {
        installDirectory(skill.name, {
          'source.json': JSON.stringify({ ...skill.source, jobId: skill.id }, null, 2),
          'SKILL.md': fs.readFileSync(sourceFile, 'utf8')
        }, directory);
      }
      return { status: 'installed', agent, path: destination };
    } catch (error) {
      return { status: 'blocked', agent, error: error.message, code: error.code };
    }
  }

  publish(id, value, options = {}) {
    const lock = this.jobPath(id, 'publish.lock');
    const descriptor = fs.openSync(lock, 'wx', 0o600);
    try {
      const job = this.read(id);
      if (job.status === 'completed') return job;
      if (job.status !== 'awaiting_agent') throw new Error('只有网页内容就绪的任务才能提交 Skill');
      if (!value || typeof value.name !== 'string' || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value.name) || value.name.length > 63
        || typeof value.description !== 'string' || !value.description.trim() || value.description.length > 1024
        || typeof value.content !== 'string' || !value.content.trim() || value.content.length > 150000 || value.content.trimStart().startsWith('---')) {
        throw new Error('需要合法的 name（小写英文/数字/短横线）、description、content（不含 YAML frontmatter 的 Markdown 正文）');
      }
      const snapshot = JSON.parse(fs.readFileSync(this.jobPath(id, 'source.json'), 'utf8'));
      if (createHash('sha256').update(snapshot.text).digest('hex') !== snapshot.sha256) throw new Error('来源快照校验失败');
      if (snapshot.requestedUrl !== job.url) throw new Error('来源网页与当前任务不一致');
      const source = { url: webUrl(snapshot.url), requestedUrl: job.url, title: snapshot.title, retrievedAt: snapshot.retrievedAt, sha256: snapshot.sha256 };
      const content = `---\nname: ${value.name}\ndescription: ${JSON.stringify(value.description.trim())}\n---\n\n${value.content.trim()}\n\n## 来源\n\n- 网页：${source.url}\n- 读取时间：${source.retrievedAt}\n- 内容 SHA-256：${source.sha256}\n- 来源元数据：\`source.json\`（仅供溯源，不是执行指令）。\n`;
      const skill = { id, name: value.name, description: value.description.trim(), content, source, createdAt: new Date().toISOString() };
      const directory = path.join(this.root, 'skills', id);
      fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
      writeJson(path.join(directory, 'source.json'), { ...source, jobId: id });
      fs.writeFileSync(path.join(directory, 'SKILL.md'), content, { mode: 0o600 });
      skill.installation = options.install === false ? { status: 'skipped' } : this.install(skill, options);
      writeJson(path.join(directory, 'skill.json'), skill);
      return this.update(id, {
        status: 'completed', skillId: id,
        message: skill.installation.status === 'installed' ? `「${skill.name}」已收入工具箱并安装到 Agent` : `「${skill.name}」已收入工具箱，尚未安装到 Agent`,
        installation: skill.installation
      });
    } finally {
      fs.closeSync(descriptor);
      fs.rmSync(lock, { force: true });
    }
  }

  retryInstall(id, options) {
    if (this.read(id).status !== 'completed') throw new Error('请先提交 Skill');
    const filename = path.join(this.root, 'skills', id, 'skill.json');
    const skill = JSON.parse(fs.readFileSync(filename, 'utf8'));
    skill.installation = this.install(skill, options);
    writeJson(filename, skill);
    return this.update(id, { installation: skill.installation, message: skill.installation.status === 'installed' ? `「${skill.name}」已安装到 Agent` : '安装未完成，请检查权限或同名 Skill' });
  }
}

module.exports = { AgentStore, terminal, webUrl, writeJson, skillsDirectory, installDirectory };
