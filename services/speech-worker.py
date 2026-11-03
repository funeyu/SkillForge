import argparse
import base64
import json
import math
import os
from pathlib import Path
import sys

os.environ['HF_HUB_OFFLINE'] = '1'
os.environ['HF_HUB_DISABLE_TELEMETRY'] = '1'
sys.stdout.reconfigure(encoding='utf-8')
sys.stderr.reconfigure(encoding='utf-8')


def emit(event, **values):
    print(json.dumps({'event': event, **values}, ensure_ascii=False), flush=True)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--model', required=True)
    parser.add_argument('--language', choices=['auto', 'zh', 'en'], default='auto')
    args = parser.parse_args()
    model_path = Path(args.model).resolve()
    for name in ['model.bin', 'config.json', 'tokenizer.json', 'vocabulary.txt']:
        if not (model_path / name).is_file() or not (model_path / name).stat().st_size:
            raise RuntimeError('SkillForge 内置语音模型缺少文件：' + name)

    import numpy as np
    import onnxruntime
    from faster_whisper import WhisperModel

    onnxruntime.disable_telemetry_events()
    model = WhisperModel(str(model_path), device='cpu', compute_type='int8', cpu_threads=min(8, os.cpu_count() or 4), local_files_only=True)
    emit('ready')
    tail = np.empty(0, dtype=np.float32)
    previous_end = 0.0
    emitted_end = 0.0
    previous_text = ''
    expected_id = 0
    while True:
        line = sys.stdin.buffer.readline(400000)
        if not line:
            raise RuntimeError('播放音频流意外关闭')
        if len(line) >= 400000:
            raise RuntimeError('音频分块超过大小限制')
        request = json.loads(line)
        if request.get('event') == 'finish':
            emit('done')
            return
        if request.get('event') != 'audio' or request.get('id') != expected_id:
            raise RuntimeError('音频分块顺序无效')
        expected_id += 1
        start = float(request['start'])
        raw = base64.b64decode(request['pcm'], validate=True)
        if not math.isfinite(start) or start < 0 or not raw or len(raw) % 4 or len(raw) > 16000 * 4 * 4:
            raise RuntimeError('音频分块格式无效')
        audio = np.frombuffer(raw, dtype='<f4')
        if not np.all(np.isfinite(audio)):
            raise RuntimeError('音频包含无效采样')
        if abs(start - previous_end) > 0.15:
            tail = np.empty(0, dtype=np.float32)
        window_start = max(0, start - len(tail) / 16000)
        window = np.concatenate((tail, audio))
        end = start + len(audio) / 16000
        segments, _info = model.transcribe(window, language=None if args.language == 'auto' else args.language, vad_filter=True, beam_size=1, condition_on_previous_text=False)
        for segment in segments:
            segment_start = max(0, window_start + float(segment.start))
            segment_end = min(end, window_start + float(segment.end))
            text = segment.text.strip()
            if not text or not math.isfinite(segment_end) or segment_end <= emitted_end + 0.05:
                continue
            if segment_start < emitted_end:
                for length in range(min(len(previous_text), len(text)), 1, -1):
                    if previous_text[-length:] == text[:length]:
                        text = text[length:].lstrip()
                        break
            segment_start = max(segment_start, emitted_end)
            if text and segment_end > segment_start:
                emit('transcript-segment', segment={'start': segment_start, 'end': segment_end, 'text': text})
                emitted_end = segment_end
                previous_text = text
        tail = window[-16000:].copy()
        previous_end = end
        emit('chunk-complete', id=request['id'])


if __name__ == '__main__':
    try:
        main()
    except Exception as error:
        emit('error', message=str(error))
        sys.exit(1)
