const { extractWebContent } = require('./index.cjs');

async function main() {
  const args = process.argv.slice(2);
  if (!args.length || args.includes('--help')) {
    console.log('用法：npm run extract -- <网页或媒体 URL> [--text|--media] [--local <音视频文件>]（音视频会打开播放器并实时离线识别）');
    return;
  }
  const url = args.shift();
  const options = { localMediaPaths: [] };
  while (args.length) {
    const flag = args.shift();
    if (flag === '--text' || flag === '--media') options.mode = flag.slice(2);
    else if (flag === '--local' && args.length) options.localMediaPaths.push(args.shift());
    else throw new Error(`未知参数或缺少参数值：${flag}`);
  }
  const controller = new AbortController();
  const cancel = () => controller.abort(new Error('任务已取消'));
  process.once('SIGINT', cancel);
  process.once('SIGTERM', cancel);
  let previous = '';
  try {
    const result = await extractWebContent(url, {
      ...options,
      signal: controller.signal,
      onTranscript: segment => process.stderr.write(`[字幕 ${segment.start.toFixed(1)}s] ${segment.text}\n`),
      onProgress: event => {
        const label = `[${event.stage}] ${event.message}`;
        if (label !== previous) process.stderr.write(label + '\n');
        previous = label;
      }
    });
    process.stdout.write(JSON.stringify(result, null, 2) + '\n');
  } finally {
    process.removeListener('SIGINT', cancel);
    process.removeListener('SIGTERM', cancel);
  }
}

main().catch(error => {
  process.stderr.write(`提取失败：${error.message}\n`);
  process.exitCode = 1;
});
