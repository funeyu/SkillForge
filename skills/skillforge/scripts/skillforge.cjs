const fs = require('node:fs');
const path = require('node:path');
Promise.resolve().then(() => {
  const config = path.join(__dirname, '..', 'runtime.json');
  const runtime = fs.existsSync(config) ? JSON.parse(fs.readFileSync(config, 'utf8')) : { root: path.resolve(__dirname, '../../..') };
  const entry = path.join(runtime.root, 'scripts', 'agent.cjs');
  if (!fs.existsSync(entry)) throw new Error(`找不到 SkillForge 项目：${runtime.root}。项目移动后请更新 ${config} 中的 root 路径。`);
  return require(entry).main(process.argv.slice(2), runtime.defaults);
}).then(result => {
  console.log(JSON.stringify(result, null, 2));
  if (result?.status === 'error' || result?.installation?.status === 'blocked') process.exitCode = 1;
}).catch(error => { console.error(JSON.stringify({ error: error.message })); process.exitCode = 1; });
