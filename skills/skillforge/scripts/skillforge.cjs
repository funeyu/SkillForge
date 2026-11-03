const path = require('node:path');
Promise.resolve().then(async () => {
  const args = process.argv.slice(2);
  if (!args.length || args[0] === 'help') return { commands: ['setup', 'read <url>', 'status <id> [--wait 120]', 'pending', 'publish <id> --file result.json', 'install <id>', 'cancel <id>', 'install-skill'], options: ['--agent codex|claude|generic', '--skills-dir PATH', '--data-dir PATH', '--no-install', '--no-launch'], setup: '首次使用自动安装桌面应用、依赖及语音运行时；也可运行 setup 提前安装。进度输出到 stderr，结果 JSON 输出到 stdout。' };
  if (args[0] === 'setup' && args.length !== 1) throw new Error('setup 不接受参数；可用 SKILLFORGE_APP_DIR 指定应用安装目录');
  const runtime = await require('./setup.cjs').ensureRuntime(path.resolve(__dirname, '..'), { full: args[0] === 'setup' });
  if (args[0] === 'setup') return { status: 'ready', root: runtime.root, speech: 'ready' };
  const entry = path.join(runtime.root, 'scripts', 'agent.cjs');
  return require(entry).main(args, runtime.defaults);
}).then(result => {
  console.log(JSON.stringify(result, null, 2));
  if (result?.status === 'error' || result?.installation?.status === 'blocked') process.exitCode = 1;
}).catch(error => { console.error(JSON.stringify({ error: error.message })); process.exitCode = 1; });
