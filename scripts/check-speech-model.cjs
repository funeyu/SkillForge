const { createHash } = require('node:crypto');
const { createReadStream } = require('node:fs');
const { readFile, stat } = require('node:fs/promises');
const path = require('node:path');

async function check() {
  const directory = path.join(__dirname, '../models/speech');
  const manifest = JSON.parse(await readFile(path.join(directory, 'manifest.json'), 'utf8'));
  for (const file of manifest.models.base.files) {
    const filename = path.join(directory, 'base', file.name);
    if ((await stat(filename)).size !== file.size) throw new Error('内置模型文件大小不匹配：' + file.name);
    const hash = createHash(file.algorithm);
    if (file.algorithm === 'sha1') hash.update(`blob ${file.size}\0`);
    for await (const chunk of createReadStream(filename)) hash.update(chunk);
    if (hash.digest('hex') !== file.hash) throw new Error('内置模型文件校验失败：' + file.name);
  }
  console.log('SkillForge 内置 Base 模型完整，所有文件大小和哈希校验通过');
}

check().catch(error => { console.error(error.message); process.exitCode = 1; });
