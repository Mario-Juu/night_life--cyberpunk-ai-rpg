/**
 * Efeitos sonoros sintetizados (Web Audio) — sem arquivos, carregamento instantâneo.
 *
 * Arquitetura: todos os sons passam por um barramento master
 *   voz → (seco + envio de reverb) → compressor → volume master → saída
 * o que dá coesão, evita estouro quando vários sons tocam juntos e permite volume global.
 */

type Tone = OscillatorType;

const STORAGE_ENABLED = 'nightlife_audio_enabled';
const STORAGE_VOLUME = 'nightlife_audio_volume';

function readStorage(key: string): string | null {
  try {
    return globalThis.localStorage?.getItem(key) ?? null;
  } catch {
    return null;
  }
}

function writeStorage(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    // armazenamento indisponível
  }
}

class SoundEngine {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private reverbSend: GainNode | null = null;
  private noiseBuffer: AudioBuffer | null = null;
  private enabled = true;
  private volume = 0.8;
  private ambienceActive = false;
  private ambientGain: GainNode | null = null;
  private ambientNodes: Array<AudioNode | { stop: () => void; disconnect: () => void }> = [];
  private lastKey = 0;

  constructor() {
    const saved = readStorage(STORAGE_ENABLED);
    if (saved !== null) this.enabled = saved === 'true';
    const vol = Number(readStorage(STORAGE_VOLUME));
    if (Number.isFinite(vol) && vol > 0) this.volume = Math.min(1, vol);
  }

  // ------------------------------------------------------------------ infraestrutura

  private initCtx(): AudioContext | null {
    if (typeof window === 'undefined') return null;
    if (!this.ctx) {
      const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (!Ctx) return null;
      this.ctx = new Ctx();
      this.buildBus(this.ctx);
    }
    if (this.ctx.state === 'suspended') void this.ctx.resume();
    return this.ctx;
  }

  private buildBus(ctx: AudioContext) {
    const compressor = ctx.createDynamicsCompressor();
    compressor.threshold.value = -18;
    compressor.knee.value = 12;
    compressor.ratio.value = 4;
    compressor.attack.value = 0.003;
    compressor.release.value = 0.2;

    this.master = ctx.createGain();
    this.master.gain.value = this.volume;
    compressor.connect(this.master);
    this.master.connect(ctx.destination);

    // Reverb curto gerado (ruído com decaimento exponencial): "sala" de concreto.
    const convolver = ctx.createConvolver();
    const len = Math.floor(ctx.sampleRate * 1.1);
    const impulse = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const data = impulse.getChannelData(ch);
      for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3.2);
    }
    convolver.buffer = impulse;
    this.reverbSend = ctx.createGain();
    this.reverbSend.gain.value = 0.22;
    this.reverbSend.connect(convolver);
    convolver.connect(compressor);

    // Entrada seca do barramento
    this.bus = compressor;
  }

  private bus: AudioNode | null = null;

  /** Ponto de entrada de uma voz no barramento (com envio de reverb opcional). */
  private out(ctx: AudioContext, reverb = 0.25): AudioNode {
    const input = ctx.createGain();
    input.connect(this.bus ?? ctx.destination);
    if (reverb > 0 && this.reverbSend) {
      const send = ctx.createGain();
      send.gain.value = reverb;
      input.connect(send);
      send.connect(this.reverbSend);
    }
    return input;
  }

  private noise(ctx: AudioContext): AudioBuffer {
    if (!this.noiseBuffer) {
      const len = ctx.sampleRate * 2;
      this.noiseBuffer = ctx.createBuffer(1, len, ctx.sampleRate);
      const data = this.noiseBuffer.getChannelData(0);
      for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    }
    return this.noiseBuffer;
  }

  /** Oscilador com envelope de ataque/decaimento. */
  private tone(opts: { type?: Tone; freq: number; to?: number; start?: number; dur: number; gain: number; attack?: number; reverb?: number; detune?: number }) {
    const ctx = this.ready();
    if (!ctx) return;
    const t = ctx.currentTime + (opts.start ?? 0);
    const osc = ctx.createOscillator();
    const env = ctx.createGain();
    osc.type = opts.type ?? 'sine';
    osc.frequency.setValueAtTime(opts.freq, t);
    if (opts.detune) osc.detune.setValueAtTime(opts.detune, t);
    if (opts.to) osc.frequency.exponentialRampToValueAtTime(Math.max(1, opts.to), t + opts.dur);
    env.gain.setValueAtTime(0.0001, t);
    env.gain.exponentialRampToValueAtTime(opts.gain, t + (opts.attack ?? 0.005));
    env.gain.exponentialRampToValueAtTime(0.0001, t + opts.dur);
    osc.connect(env);
    env.connect(this.out(ctx, opts.reverb ?? 0.2));
    osc.start(t);
    osc.stop(t + opts.dur + 0.05);
  }

  /** Rajada de ruído filtrado (cliques, impactos, chuva, estática). */
  private burst(opts: { start?: number; dur: number; gain: number; filter?: BiquadFilterType; freq: number; q?: number; to?: number; reverb?: number; attack?: number }) {
    const ctx = this.ready();
    if (!ctx) return;
    const t = ctx.currentTime + (opts.start ?? 0);
    const src = ctx.createBufferSource();
    src.buffer = this.noise(ctx);
    const filter = ctx.createBiquadFilter();
    filter.type = opts.filter ?? 'bandpass';
    filter.frequency.setValueAtTime(opts.freq, t);
    if (opts.to) filter.frequency.exponentialRampToValueAtTime(opts.to, t + opts.dur);
    filter.Q.value = opts.q ?? 1;
    const env = ctx.createGain();
    env.gain.setValueAtTime(0.0001, t);
    env.gain.exponentialRampToValueAtTime(opts.gain, t + (opts.attack ?? 0.002));
    env.gain.exponentialRampToValueAtTime(0.0001, t + opts.dur);
    src.connect(filter);
    filter.connect(env);
    env.connect(this.out(ctx, opts.reverb ?? 0.15));
    src.start(t, Math.random() * 1.5);
    src.stop(t + opts.dur + 0.05);
  }

  private ready(): AudioContext | null {
    if (!this.enabled) return null;
    return this.initCtx();
  }

  // ------------------------------------------------------------------ configuração

  public isEnabled(): boolean {
    return this.enabled;
  }

  public isAmbienceActive(): boolean {
    return this.ambienceActive;
  }

  public getVolume(): number {
    return this.volume;
  }

  public setVolume(v: number) {
    this.volume = Math.max(0, Math.min(1, v));
    writeStorage(STORAGE_VOLUME, String(this.volume));
    if (this.master && this.ctx) this.master.gain.setTargetAtTime(this.volume, this.ctx.currentTime, 0.05);
  }

  public toggle(): boolean {
    this.enabled = !this.enabled;
    writeStorage(STORAGE_ENABLED, String(this.enabled));
    if (this.enabled) this.playClick();
    else this.stopAmbience();
    return this.enabled;
  }

  public toggleAmbience(): boolean {
    if (this.ambienceActive) {
      this.stopAmbience();
      return false;
    }
    this.startAmbience();
    return this.ambienceActive;
  }

  // ------------------------------------------------------------------ ambiente

  /** Drone analógico escuro + chuva ácida (ruído rosa filtrado). */
  public startAmbience() {
    const ctx = this.ready();
    if (!ctx || this.ambienceActive) return;
    try {
      this.ambienceActive = true;
      const now = ctx.currentTime;
      const master = ctx.createGain();
      master.gain.setValueAtTime(0.0001, now);
      master.gain.exponentialRampToValueAtTime(0.16, now + 2.5);
      master.connect(this.out(ctx, 0.4));
      this.ambientGain = master;

      const sub = ctx.createOscillator();
      sub.type = 'sawtooth';
      sub.frequency.value = 55;
      const subFilter = ctx.createBiquadFilter();
      subFilter.type = 'lowpass';
      subFilter.frequency.value = 120;
      subFilter.Q.value = 3;
      const subGain = ctx.createGain();
      subGain.gain.value = 0.35;
      sub.connect(subFilter);
      subFilter.connect(subGain);
      subGain.connect(master);
      sub.start();

      // LFO lento no filtro: o drone "respira".
      const lfo = ctx.createOscillator();
      lfo.frequency.value = 0.07;
      const lfoGain = ctx.createGain();
      lfoGain.gain.value = 45;
      lfo.connect(lfoGain);
      lfoGain.connect(subFilter.frequency);
      lfo.start();

      const fifth = ctx.createOscillator();
      fifth.type = 'sine';
      fifth.frequency.value = 82.4;
      const fifthGain = ctx.createGain();
      fifthGain.gain.value = 0.22;
      fifth.connect(fifthGain);
      fifthGain.connect(master);
      fifth.start();

      const len = ctx.sampleRate * 2;
      const buf = ctx.createBuffer(1, len, ctx.sampleRate);
      const out = buf.getChannelData(0);
      let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
      for (let i = 0; i < len; i++) {
        const w = Math.random() * 2 - 1;
        b0 = 0.99886 * b0 + w * 0.0555179;
        b1 = 0.99332 * b1 + w * 0.0750759;
        b2 = 0.969 * b2 + w * 0.153852;
        b3 = 0.8665 * b3 + w * 0.3104856;
        b4 = 0.55 * b4 + w * 0.5329522;
        b5 = -0.7616 * b5 - w * 0.016898;
        out[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362) * 0.11;
        b6 = w * 0.115926;
      }
      const rain = ctx.createBufferSource();
      rain.buffer = buf;
      rain.loop = true;
      const rainFilter = ctx.createBiquadFilter();
      rainFilter.type = 'bandpass';
      rainFilter.frequency.value = 800;
      rainFilter.Q.value = 0.8;
      const rainGain = ctx.createGain();
      rainGain.gain.value = 0.12;
      rain.connect(rainFilter);
      rainFilter.connect(rainGain);
      rainGain.connect(master);
      rain.start();

      this.ambientNodes = [sub, lfo, fifth, rain, subFilter, rainFilter, subGain, lfoGain, fifthGain, rainGain, master];
    } catch (e) {
      console.warn('Falha ao iniciar ambiente sonoro:', e);
      this.ambienceActive = false;
    }
  }

  public stopAmbience() {
    if (!this.ambienceActive || !this.ctx || !this.ambientGain) {
      this.ambienceActive = false;
      return;
    }
    const now = this.ctx.currentTime;
    this.ambientGain.gain.setValueAtTime(Math.max(0.0001, this.ambientGain.gain.value), now);
    this.ambientGain.gain.exponentialRampToValueAtTime(0.0001, now + 1.2);
    const nodes = [...this.ambientNodes];
    setTimeout(() => {
      for (const node of nodes) {
        try {
          if ('stop' in node && typeof node.stop === 'function') node.stop();
          node.disconnect();
        } catch {
          // nó já encerrado
        }
      }
    }, 1300);
    this.ambientGain = null;
    this.ambientNodes = [];
    this.ambienceActive = false;
  }

  // ------------------------------------------------------------------ interface

  /** Clique de interface (tecla de cyberdeck). */
  public playClick() {
    this.tone({ type: 'triangle', freq: 1400, to: 380, dur: 0.035, gain: 0.05, reverb: 0.05 });
  }

  /** Blip curto de hover/foco. */
  public playHover() {
    this.tone({ type: 'sine', freq: 2200, dur: 0.025, gain: 0.015, reverb: 0 });
  }

  /** Tecla de terminal (limitada para não saturar quando o texto corre rápido). */
  public playKey() {
    const ctx = this.ready();
    if (!ctx) return;
    const now = performance.now();
    if (now - this.lastKey < 28) return;
    this.lastKey = now;
    this.burst({ dur: 0.018, gain: 0.05, freq: 3200 + Math.random() * 1800, q: 6, reverb: 0.03 });
    this.tone({ type: 'square', freq: 90 + Math.random() * 30, dur: 0.012, gain: 0.012, reverb: 0 });
  }

  /** Boot do sistema: varredura ascendente + acorde. */
  public playBoot() {
    this.burst({ dur: 0.5, gain: 0.05, filter: 'bandpass', freq: 300, to: 4000, q: 2, reverb: 0.3 });
    this.tone({ type: 'sawtooth', freq: 55, to: 110, dur: 0.6, gain: 0.05, attack: 0.05, reverb: 0.4 });
    [220, 277.2, 329.6, 440].forEach((f, i) => this.tone({ type: 'triangle', freq: f, start: 0.35 + i * 0.07, dur: 0.9, gain: 0.03, reverb: 0.5 }));
  }

  /** Estática digital com cortes (transições, falhas). */
  public playGlitch() {
    for (let i = 0; i < 6; i++) this.burst({ start: i * 0.035 + Math.random() * 0.02, dur: 0.03, gain: 0.07, filter: 'highpass', freq: 1500 + Math.random() * 3000, q: 0.7, reverb: 0.05 });
    this.tone({ type: 'square', freq: 900, to: 120, dur: 0.18, gain: 0.025, reverb: 0.05 });
  }

  /** Nova narração chegando: varredura suave de ar. */
  public playReveal() {
    this.burst({ dur: 0.7, gain: 0.03, filter: 'bandpass', freq: 400, to: 2400, q: 0.8, attack: 0.25, reverb: 0.6 });
    this.tone({ type: 'sine', freq: 330, dur: 0.9, gain: 0.018, attack: 0.3, reverb: 0.6 });
  }

  // ------------------------------------------------------------------ dados

  /** Dados chacoalhando: cliques plásticos aleatórios decaindo. */
  public playDiceRattle(durationMs = 900) {
    const ctx = this.ready();
    if (!ctx) return;
    let t = 0;
    const end = durationMs / 1000;
    while (t < end) {
      const decay = 1 - (t / end) * 0.6;
      this.burst({ start: t, dur: 0.02 + Math.random() * 0.02, gain: 0.09 * decay, freq: 2200 + Math.random() * 2800, q: 5 + Math.random() * 5, reverb: 0.12 });
      t += 0.03 + Math.random() * 0.06;
    }
  }

  /** Compatibilidade: rolagem curta. */
  public playDiceRoll() {
    this.playDiceRattle(600);
  }

  /** Dado pousando na mesa: batida grave + clique. */
  public playDiceLand() {
    this.tone({ type: 'sine', freq: 150, to: 55, dur: 0.14, gain: 0.18, reverb: 0.2 });
    this.burst({ dur: 0.05, gain: 0.12, freq: 1800, q: 3, reverb: 0.15 });
  }

  /** 10 natural: arpejo brilhante subindo. */
  public playCrit() {
    [523.3, 659.3, 784, 1046.5].forEach((f, i) => {
      this.tone({ type: 'triangle', freq: f, start: i * 0.06, dur: 0.5, gain: 0.07, reverb: 0.6 });
      this.tone({ type: 'sine', freq: f * 2, start: i * 0.06, dur: 0.4, gain: 0.02, reverb: 0.6 });
    });
    this.burst({ start: 0.24, dur: 0.6, gain: 0.03, filter: 'highpass', freq: 6000, q: 0.5, reverb: 0.7 });
  }

  /** 1 natural: queda desafinada + glitch. */
  public playFumble() {
    this.tone({ type: 'sawtooth', freq: 320, to: 60, dur: 0.55, gain: 0.08, reverb: 0.3 });
    this.tone({ type: 'sawtooth', freq: 331, to: 58, dur: 0.55, gain: 0.05, reverb: 0.3 });
    this.playGlitch();
  }

  /** Confirmação positiva discreta. */
  public playSuccess() {
    this.tone({ type: 'triangle', freq: 660, dur: 0.12, gain: 0.05, reverb: 0.3 });
    this.tone({ type: 'triangle', freq: 990, start: 0.08, dur: 0.2, gain: 0.05, reverb: 0.4 });
  }

  public playHeal() {
    [392, 523.3, 659.3].forEach((f, i) => this.tone({ type: 'sine', freq: f, start: i * 0.09, dur: 0.6, gain: 0.04, attack: 0.05, reverb: 0.7 }));
  }

  // ------------------------------------------------------------------ mundo

  /** SMS no Agent: duplo "pling" de holo-phone. */
  public playNotification() {
    this.tone({ type: 'sine', freq: 1318.5, dur: 0.12, gain: 0.06, reverb: 0.3 });
    this.tone({ type: 'sine', freq: 1760, start: 0.1, dur: 0.22, gain: 0.05, reverb: 0.4 });
  }

  /** Início de combate: sirene + impacto grave. */
  public playCombatStart() {
    this.tone({ type: 'sine', freq: 50, to: 38, dur: 0.8, gain: 0.25, reverb: 0.3 });
    this.burst({ dur: 0.25, gain: 0.12, filter: 'lowpass', freq: 400, reverb: 0.3 });
    for (let i = 0; i < 2; i++) this.tone({ type: 'sawtooth', freq: 440, to: 880, start: 0.15 + i * 0.35, dur: 0.3, gain: 0.03, reverb: 0.4 });
  }

  /** Tomar dano: impacto grave + estalo. */
  public playDamageTaken() {
    this.tone({ type: 'sine', freq: 110, to: 35, dur: 0.35, gain: 0.3, reverb: 0.2 });
    this.burst({ dur: 0.12, gain: 0.18, filter: 'lowpass', freq: 900, reverb: 0.2 });
    this.burst({ start: 0.02, dur: 0.05, gain: 0.08, filter: 'highpass', freq: 3000, reverb: 0.1 });
  }

  public playDiscovery() {
    [880, 1174.7].forEach((f, i) => this.tone({ type: 'triangle', freq: f, start: i * 0.1, dur: 0.35, gain: 0.04, reverb: 0.5 }));
  }

  public playAlert() {
    this.tone({ type: 'square', freq: 220, dur: 0.08, gain: 0.04, reverb: 0.1 });
    this.tone({ type: 'square', freq: 180, start: 0.1, dur: 0.12, gain: 0.04, reverb: 0.1 });
  }

  /** Armadura perdendo SP: rangido metálico. */
  public playArmorAblation() {
    this.burst({ dur: 0.25, gain: 0.06, filter: 'bandpass', freq: 2500, to: 900, q: 12, reverb: 0.3 });
    this.tone({ type: 'sawtooth', freq: 180, to: 140, dur: 0.2, gain: 0.03, reverb: 0.2 });
  }

  /** Coração acelerado (PV em zero). */
  public playHeartbeatDanger() {
    for (let i = 0; i < 3; i++) {
      this.tone({ type: 'sine', freq: 60, to: 40, start: i * 0.55, dur: 0.14, gain: 0.3, reverb: 0.1 });
      this.tone({ type: 'sine', freq: 55, to: 38, start: i * 0.55 + 0.18, dur: 0.12, gain: 0.22, reverb: 0.1 });
    }
  }

  /** Sua vez / teste pendente. */
  public playTurnAlert() {
    this.tone({ type: 'triangle', freq: 880, dur: 0.08, gain: 0.04, reverb: 0.2 });
    this.tone({ type: 'triangle', freq: 1320, start: 0.09, dur: 0.12, gain: 0.04, reverb: 0.3 });
  }
}

export const sound = new SoundEngine();
