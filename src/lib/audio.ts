// Lightweight Web Audio API horn & tactile feedback (gracefully degrades if blocked)

let audioCtx: AudioContext | null = null;
let hornOsc1: OscillatorNode | null = null;
let hornOsc2: OscillatorNode | null = null;
let hornGain: GainNode | null = null;

function ensureContext(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctx) return null;
  if (!audioCtx) {
    try {
      audioCtx = new Ctx();
    } catch {
      return null;
    }
  }
  if (audioCtx.state === 'suspended') {
    audioCtx.resume().catch(() => {});
  }
  return audioCtx;
}

export function startHornAudio(muted = false): void {
  if (muted) return;
  const ctx = ensureContext();
  if (!ctx || hornOsc1) return;

  try {
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.001, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.08, ctx.currentTime + 0.03);

    const osc1 = ctx.createOscillator();
    osc1.type = 'sawtooth';
    osc1.frequency.setValueAtTime(340, ctx.currentTime);

    const osc2 = ctx.createOscillator();
    osc2.type = 'sawtooth';
    osc2.frequency.setValueAtTime(425, ctx.currentTime);

    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(1100, ctx.currentTime);

    osc1.connect(filter);
    osc2.connect(filter);
    filter.connect(gain);
    gain.connect(ctx.destination);

    osc1.start();
    osc2.start();

    hornOsc1 = osc1;
    hornOsc2 = osc2;
    hornGain = gain;
  } catch {
    stopHornAudio();
  }
}

export function stopHornAudio(): void {
  if (!audioCtx || !hornGain) {
    hornOsc1 = null;
    hornOsc2 = null;
    hornGain = null;
    return;
  }
  try {
    const now = audioCtx.currentTime;
    hornGain.gain.cancelScheduledValues(now);
    hornGain.gain.setTargetAtTime(0.0001, now, 0.02);
    const o1 = hornOsc1;
    const o2 = hornOsc2;
    setTimeout(() => {
      try {
        o1?.stop();
        o2?.stop();
        o1?.disconnect();
        o2?.disconnect();
      } catch {
        // ignore cleanup errors
      }
    }, 60);
  } catch {
    // ignore
  } finally {
    hornOsc1 = null;
    hornOsc2 = null;
    hornGain = null;
  }
}
