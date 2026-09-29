// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';

/** Elemento de áudio falso que reproduz os eventos problemáticos do navegador. */
class FakeAudio extends EventTarget {
  static instances: FakeAudio[] = [];
  static defaultMode: 'ok' | 'fail' = 'ok';
  src = '';
  volume = 1;
  preload = '';
  currentSrc = '';
  playCalls = 0;
  mode: 'ok' | 'fail' = FakeAudio.defaultMode;
  constructor() {
    super();
    FakeAudio.instances.push(this);
  }
  play() {
    this.playCalls++;
    this.currentSrc = this.src;
    if (this.mode === 'fail') {
      queueMicrotask(() => this.dispatchEvent(new Event('error')));
      return Promise.resolve();
    }
    queueMicrotask(() => this.dispatchEvent(new Event('playing')));
    return Promise.resolve();
  }
  pause() {}
  removeAttribute() {
    this.src = '';
  }
  load() {
    // Navegadores disparam 'error' ao carregar src vazio: garante que é ignorado.
    this.currentSrc = this.src;
    queueMicrotask(() => this.dispatchEvent(new Event('error')));
  }
}

const totalPlays = () => FakeAudio.instances.reduce((n, a) => n + a.playCalls, 0);
const flush = async () => {
  for (let i = 0; i < 5; i++) await Promise.resolve();
};

beforeEach(() => {
  vi.resetModules();
  FakeAudio.instances = [];
  FakeAudio.defaultMode = 'ok';
  vi.stubGlobal('Audio', FakeAudio);
});

describe('radioEngine', () => {
  it('parar realmente para, sem religar sozinho', async () => {
    const { radio } = await import('./radioEngine');
    radio.play();
    await flush();
    expect(radio.getStatus()).toBe('playing');
    radio.togglePlay();
    await flush();
    expect(radio.getStatus()).toBe('stopped');
    expect(totalPlays()).toBe(1);
  });

  it('trocar de estação não pula para outro canal', async () => {
    const { radio, STATIONS } = await import('./radioEngine');
    radio.play();
    await flush();
    radio.setStation(1);
    await flush();
    expect(radio.getStatus()).toBe('playing');
    expect(FakeAudio.instances.at(-1)!.src).toBe(STATIONS[1].streams[0]);
    expect(totalPlays()).toBe(2);
  });

  it('falha em todos os mirrors fica "sem sinal" em vez de tocar outra coisa', async () => {
    const { radio, STATIONS } = await import('./radioEngine');
    const somaIndex = STATIONS.findIndex(s => s.streams.length > 1);
    radio.setStation(somaIndex);
    FakeAudio.defaultMode = 'fail';
    radio.play();
    for (let i = 0; i < 10; i++) await flush();
    expect(radio.getStatus()).toBe('offline');
    expect(FakeAudio.instances.map(a => a.src.includes('somafm') || a.src === '')).not.toContain(false);
    expect(totalPlays()).toBe(STATIONS[somaIndex].streams.length);
    radio.togglePlay(); // offline → tenta de novo
    expect(radio.getStatus()).toBe('loading');
  });
});
