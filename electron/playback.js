const media = document.getElementById('media');
const toggle = document.getElementById('toggle');
const status = document.getElementById('status');
const transcript = document.getElementById('transcript');
const queue = [];
const flushes = new Map();
let processor;
let context;
let sending = false;
let backpressure = false;
let userPaused = false;
let ending = false;
let failed = false;
let flushId = 0;

function fail(error) {
  if (failed) return;
  failed = true;
  media.pause();
  status.textContent = error.message || String(error);
  toggle.disabled = true;
  window.speechPlayback.error(status.textContent).catch(() => {});
}

function flush() {
  const id = ++flushId;
  return new Promise(resolve => {
    flushes.set(id, resolve);
    processor.port.postMessage({ type: 'flush', id });
  });
}

async function drain() {
  if (sending || failed) return;
  sending = true;
  try {
    while (queue.length) {
      const chunk = queue.shift();
      await window.speechPlayback.audio(chunk.start, chunk.samples);
      if (backpressure && queue.length <= 1 && !ending) {
        backpressure = false;
        if (!userPaused) await media.play();
      }
    }
  } catch (error) { fail(error); }
  finally { sending = false; }
}

async function main() {
  window.speechPlayback.onSegment(segment => {
    const item = document.createElement('li');
    const time = document.createElement('time');
    time.textContent = `${Math.floor(segment.start / 60)}:${String(Math.floor(segment.start % 60)).padStart(2, '0')}`;
    item.append(time, document.createTextNode(segment.text));
    transcript.append(item);
    item.scrollIntoView({ block: 'nearest' });
  });
  const config = await window.speechPlayback.start();
  context = new AudioContext({ sampleRate: 16000 });
  if (context.sampleRate !== 16000) throw new Error('音频设备不支持 16 kHz 识别采样');
  await context.audioWorklet.addModule('./playback-worklet.js');
  processor = new AudioWorkletNode(context, 'playback-pcm', { outputChannelCount: [1] });
  context.createMediaElementSource(media).connect(processor).connect(context.destination);
  processor.port.onmessage = ({ data }) => {
    if (data.type === 'flushed') {
      flushes.get(data.id)?.();
      flushes.delete(data.id);
      return;
    }
    if (data.type !== 'audio' || failed) return;
    queue.push(data);
    if (queue.length >= 3 && !media.paused) {
      backpressure = true;
      media.pause();
      status.textContent = '本地识别正在追赶进度，暂缓播放，不丢弃音频…';
    }
    drain();
  };
  media.addEventListener('playing', () => {
    processor.port.postMessage({ type: 'start', start: media.currentTime });
    status.textContent = '正在边播放边识别，约每 4 秒更新一次文字';
  });
  media.addEventListener('pause', () => { if (!ending) flush(); });
  media.addEventListener('waiting', () => { flush(); status.textContent = '正在缓冲媒体…'; });
  media.addEventListener('error', () => fail(new Error('媒体无法播放：可能格式不受支持、需要登录或网络中断')));
  media.addEventListener('ended', async () => {
    ending = true;
    toggle.disabled = true;
    status.textContent = '播放结束，正在处理剩余语音…';
    await flush();
    while ((sending || queue.length) && !failed) await new Promise(resolve => setTimeout(resolve, 50));
    await context.close();
    if (!failed) await window.speechPlayback.finish();
  });
  toggle.addEventListener('click', async () => {
    userPaused = !userPaused;
    toggle.textContent = userPaused ? '继续' : '暂停';
    if (userPaused) { media.pause(); status.textContent = '已暂停，已播放部分继续识别'; }
    else if (!backpressure) { try { await media.play(); } catch (error) { fail(error); } }
  });
  media.src = config.url;
  await context.resume();
  await media.play();
  toggle.disabled = false;
}

window.addEventListener('unhandledrejection', event => { event.preventDefault(); fail(event.reason); });
main().catch(fail);
