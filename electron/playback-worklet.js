class PlaybackPCM extends AudioWorkletProcessor {
  constructor() {
    super();
    this.samples = new Float32Array(64000);
    this.length = 0;
    this.start = 0;
    this.recording = false;
    this.port.onmessage = ({ data }) => {
      if (data.type === 'start') {
        this.flush();
        this.start = data.start;
        this.recording = true;
      } else if (data.type === 'flush') {
        this.recording = false;
        this.flush();
        this.port.postMessage({ type: 'flushed', id: data.id });
      }
    };
  }

  flush() {
    if (!this.length) return;
    const samples = this.samples.slice(0, this.length);
    this.port.postMessage({ type: 'audio', start: this.start, samples }, [samples.buffer]);
    this.start += this.length / sampleRate;
    this.length = 0;
  }

  process(inputs, outputs) {
    const channels = inputs[0];
    const output = outputs[0][0];
    for (let frame = 0; frame < output.length; frame++) {
      let sample = 0;
      for (const channel of channels) sample += channel[frame] || 0;
      sample /= Math.max(1, channels.length);
      output[frame] = sample;
      if (!this.recording || !channels.length) continue;
      this.samples[this.length++] = sample;
      if (this.length === this.samples.length) this.flush();
    }
    return true;
  }
}

registerProcessor('playback-pcm', PlaybackPCM);
