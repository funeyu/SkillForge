const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { AgentStore, terminal, skillsDirectory, installDirectory } = require('../services/agent-store.cjs');
const { applicationPaths } = require('../services/application-paths.cjs');

function optionsFrom(args) {
  const positional = [];
  const options = {};
  for (let index = 0; index < args.length; index++) {
    const argument = args[index];
    if (['--no-install', '--no-launch'].includes(argument)) options[argument.slice(2)] = true;
    else if (['--file', '--agent', '--skills-dir', '--wait', '--data-dir'].includes(argument)) {
      if (!args[index + 1] || args[index + 1].startsWith('--')) throw new Error(`缺少 ${argument} 参数`);
      options[argument.slice(2)] = args[++index];
    } else if (argument.startsWith('--')) throw new Error(`未知参数：${argument}`);
    else positional.push(argument);
  }
  return { positional, options };
}

function launch(store, id) {
  const application = applicationPaths();
  const executable = application.executable || require('electron');
  if (typeof executable !== 'string' || !fs.existsSync(executable)) throw new Error('Electron 未安装，请先在 SkillForge 运行 npm install');
  const log = fs.openSync(path.join(store.root, 'electron.log'), 'a', 0o600);
  const env = { ...process.env, SKILLFORGE_DATA_DIR: store.root };
  delete env.ELECTRON_RUN_AS_NODE;
  const child = spawn(executable, application.executable ? [] : [application.root], { detached: true, stdio: ['ignore', log, log], env });
  fs.closeSync(log);
  child.once('exit', (code, signal) => {
    if (code === 0 && !signal) return;
    try {
      if (['queued', 'reading', 'login_required'].includes(store.read(id).status)) store.update(id, { status: 'error', message: `Electron 异常退出（${signal || code}），请检查 ${path.join(store.root, 'electron.log')}` });
    } catch (error) { console.error(error.message); }
  });
  return new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('spawn', () => { child.unref(); resolve(); });
  });
}

async function waitForJob(store, id, seconds, { stopOnLogin = true } = {}) {
  if (!Number.isFinite(seconds) || seconds < 0 || seconds > 600) throw new Error('--wait 应为 0–600 秒');
  const deadline = Date.now() + seconds * 1000;
  for (;;) {
    const job = store.read(id);
    if (terminal.has(job.status) || job.status === 'awaiting_agent' || (stopOnLogin && job.status === 'login_required') || Date.now() >= deadline) return job;
    await new Promise(resolve => setTimeout(resolve, 400));
  }
}

async function main(args = process.argv.slice(2), defaults = {}) {
  const { positional: [command, argument], options } = optionsFrom(args);
  if (!command || command === 'help') {
    return { commands: ['read <url> [--wait 120]', 'status <id> [--wait 120]', 'pending', 'publish <id> --file result.json [--agent codex|claude|generic] [--no-install]', 'install <id> [--agent codex|claude|generic]', 'cancel <id>', 'install-skill [--agent codex|claude|generic]'], options: ['--data-dir PATH', '--skills-dir PATH', '--no-launch'] };
  }
  const waitSeconds = Number(options.wait ?? (command === 'read' ? 120 : 0));
  if (!Number.isFinite(waitSeconds) || waitSeconds < 0 || waitSeconds > 600) throw new Error('--wait 应为 0–600 秒');
  const agent = options.agent || defaults.agent || 'codex';
  const inheritedDirectory = !options.agent || options.agent === defaults.agent ? defaults.skillsDir : undefined;
  const skillsDir = options['skills-dir'] || inheritedDirectory;
  const dataDir = options['data-dir'] || defaults.dataDir;
  const installOptions = { agent, skillsDir: skillsDir && path.resolve(skillsDir), install: !options['no-install'] };
  skillsDirectory(installOptions.agent);
  if (command === 'install-skill') {
    const root = path.join(__dirname, '..', 'skills', 'skillforge');
    const directory = installOptions.skillsDir || skillsDirectory(agent);
    const runtime = {
      root: path.resolve(__dirname, '..'),
      defaults: { agent, skillsDir: directory, ...(dataDir ? { dataDir: path.resolve(dataDir) } : {}) }
    };
    const destination = installDirectory('skillforge', {
      'scripts/skillforge.cjs': fs.readFileSync(path.join(root, 'scripts', 'skillforge.cjs'), 'utf8'),
      'scripts/setup.cjs': fs.readFileSync(path.join(root, 'scripts', 'setup.cjs'), 'utf8'),
      'runtime.json': JSON.stringify(runtime, null, 2),
      'SKILL.md': fs.readFileSync(path.join(root, 'SKILL.md'), 'utf8')
    }, directory);
    return { status: 'installed', path: destination, agent: installOptions.agent };
  }
  const store = new AgentStore(dataDir);
  if (command === 'read') {
    const job = store.create(argument);
    if (!options['no-launch']) {
      try { await launch(store, job.id); }
      catch (error) { return store.update(job.id, { status: 'error', message: error.message }); }
    }
    return waitForJob(store, job.id, waitSeconds);
  }
  if (command === 'status') return waitForJob(store, argument, waitSeconds, { stopOnLogin: false });
  if (command === 'pending') return store.jobs().filter(job => !terminal.has(job.status));
  if (command === 'cancel') {
    return store.cancel(argument);
  }
  if (command === 'publish') {
    if (!options.file) throw new Error('需要 --file 指定 Agent 生成的 JSON 文件');
    if (fs.statSync(options.file).size > 1024 * 1024) throw new Error('Skill 结果文件超过 1 MB');
    return store.publish(argument, JSON.parse(fs.readFileSync(options.file, 'utf8')), installOptions);
  }
  if (command === 'install') return store.retryInstall(argument, installOptions);
  throw new Error('未知命令，请运行 node scripts/agent.cjs help');
}

if (require.main === module) main().then(result => {
  console.log(JSON.stringify(result, null, 2));
  if (result?.status === 'error' || result?.installation?.status === 'blocked') process.exitCode = 1;
}).catch(error => { console.error(JSON.stringify({ error: error.message })); process.exitCode = 1; });

module.exports = { main, waitForJob };
