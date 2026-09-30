/**
 * Night City Radio Engine
 * Streams Icecast/MP3 abertos. Cada estação lista mirrors DO MESMO canal.
 *
 * Máquina de estados: stopped → loading → playing | offline.
 * Cada tentativa de tocar recebe um token; eventos de tentativas antigas
 * (inclusive o `error` disparado ao limpar o src no stop) são ignorados.
 */

export interface RadioStation {
  id: string;
  frequency: string;
  name: string;
  genre: string;
  description: string;
  streams: string[];
  accentColor: string;
}

export type RadioStatus = 'stopped' | 'loading' | 'playing' | 'offline';

const soma = (channel: string) => ['ice1', 'ice2', 'ice4', 'ice6'].map(h => `https://${h}.somafm.com/${channel}-128-mp3`);

export const STATIONS: RadioStation[] = [
  {
    id: 'nightride',
    frequency: '98.7 MHz',
    name: 'NIGHTRIDE SYNTHWAVE',
    genre: 'Outrun / Synthwave',
    description: 'Synthwave oitentista direto das autoestradas de Night City.',
    streams: ['https://stream.nightride.fm/nightride.mp3'],
    accentColor: '#ef4444',
  },
  {
    id: 'darksynth',
    frequency: '88.3 MHz',
    name: 'NETWATCH DARKSYNTH',
    genre: 'Darksynth / Industrial',
    description: 'Sintetizadores distorcidos para operações na Rede profunda.',
    streams: ['https://stream.nightride.fm/darksynth.mp3'],
    accentColor: '#06b6d4',
  },
  {
    id: 'chillsynth',
    frequency: '107.3 MHz',
    name: 'PACIFIC CHILLSYNTH',
    genre: 'Chillsynth',
    description: 'Melodias nostálgicas para ver a chuva ácida sobre os telhados.',
    streams: ['https://stream.nightride.fm/chillsynth.mp3'],
    accentColor: '#f59e0b',
  },
  {
    id: 'datawave',
    frequency: '101.1 MHz',
    name: 'DATAWAVE TRILHA',
    genre: 'Datawave / Chiptune',
    description: 'Pulsos digitais para quem vive plugado no ciberdeck.',
    streams: ['https://stream.nightride.fm/datawave.mp3'],
    accentColor: '#a855f7',
  },
  {
    id: 'secretagent',
    frequency: '91.9 MHz',
    name: 'ROYAL BLUE NOIR',
    genre: 'Dark Jazz / Espionagem',
    description: 'Jazz sombrio para negociar segredos corporativos no escuro.',
    streams: soma('secretagent'),
    accentColor: '#3b82f6',
  },
  {
    id: 'groovesalad',
    frequency: '95.5 MHz',
    name: 'AFTERLIFE LOUNGE',
    genre: 'Downtempo',
    description: 'Eletrônica serena entre um contrato e outro no Afterlife.',
    streams: soma('groovesalad'),
    accentColor: '#10b981',
  },
  {
    id: 'darkzone',
    frequency: '89.7 MHz',
    name: 'DOGTOWN DARKZONE',
    genre: 'Dark Ambient',
    description: 'Ruído e sombras vindos das ruínas de Pacifica.',
    streams: soma('darkzone'),
    accentColor: '#64748b',
  },
  {
    id: 'defcon',
    frequency: '103.3 MHz',
    name: 'RÁDIO DEF CON',
    genre: 'Hacker / Eletrônica',
    description: 'A trilha oficial dos Trilheiros que invadem sistemas às 3 da manhã.',
    streams: soma('defcon'),
    accentColor: '#22c55e',
  },
];

const NIGHT_CITY_NEWS = [
  'NCPD: Alerta de tiroteio com a Maelstrom no Distrito Norte.',
  'EQUIPE DE TRAUMA: Cobertura Platina prioritária ativa no setor corporativo.',
  'ARASAKA: Comunicado oficial nega vazamento de dados em Heywood.',
  'MILITECH: Comboios pesados patrulham a Zona de Combate nesta madrugada.',
  'KIROSHI: Novo firmware óptico corrige falha de rastreio.',
  'CANAIS UNIDOS: Recompensa aberta para recuperar carga extraviada.',
  'AFTERLIFE: Lendas locais celebram contrato corporativo bem-sucedido.',
  'CLIMA: Chuva ácida persistente com índice corrosivo moderado.',
  'NCART: Linha A interditada temporariamente por motivos de segurança.',
];

const LOAD_TIMEOUT_MS = 12_000;

type RadioListener = () => void;

class RadioEngine {
  private audio: HTMLAudioElement | null = null;
  private stationIndex = 0;
  private mirrorIndex = 0;
  private status: RadioStatus = 'stopped';
  private token = 0;
  private loadTimer: ReturnType<typeof setTimeout> | null = null;
  private volume = 0.5;
  private muted = false;
  private headline = 0;
  private listeners = new Set<RadioListener>();
  private ticker: ReturnType<typeof setInterval> | null = null;

  /** Cria um elemento novo por tentativa: eventos de tentativas antigas nunca alcançam a atual. */
  private createAudio(token: number): HTMLAudioElement | null {
    if (typeof Audio === 'undefined') return null;
    const audio = new Audio();
    audio.preload = 'none';
    audio.volume = this.muted ? 0 : this.volume;
    const current = () => token === this.token && this.audio === audio && this.status !== 'stopped';
    audio.addEventListener('playing', () => current() && this.onPlaying());
    audio.addEventListener('error', () => current() && this.onFailure(token));
    audio.addEventListener('stalled', () => current() && this.armTimeout(token));
    return audio;
  }

  private notify() {
    this.listeners.forEach(l => l());
  }

  private setStatus(status: RadioStatus) {
    this.status = status;
    this.notify();
  }

  private clearTimer() {
    if (this.loadTimer) clearTimeout(this.loadTimer);
    this.loadTimer = null;
  }

  private armTimeout(token: number) {
    this.clearTimer();
    this.loadTimer = setTimeout(() => {
      if (token === this.token && this.status === 'loading') this.onFailure(token);
    }, LOAD_TIMEOUT_MS);
  }

  private onPlaying() {
    if (this.status === 'stopped') return;
    this.clearTimer();
    this.setStatus('playing');
  }

  /** Falha da tentativa atual: tenta o próximo mirror da MESMA estação, senão fica offline. */
  private onFailure(token: number) {
    if (token !== this.token || this.status === 'stopped') return;
    const station = STATIONS[this.stationIndex];
    if (this.mirrorIndex < station.streams.length - 1) {
      this.mirrorIndex++;
      this.attempt();
    } else {
      this.clearTimer();
      this.release();
      this.setStatus('offline');
    }
  }

  private attempt() {
    this.release();
    const token = ++this.token;
    const audio = this.createAudio(token);
    if (!audio) return;
    this.audio = audio;
    this.setStatus('loading');
    audio.src = STATIONS[this.stationIndex].streams[this.mirrorIndex];
    this.armTimeout(token);
    audio.play().catch(err => {
      if (token !== this.token) return; // tentativa substituída ou parada
      const name = (err as DOMException)?.name;
      if (name === 'AbortError') return;
      if (name === 'NotAllowedError') {
        this.clearTimer();
        this.release();
        this.setStatus('stopped');
        return;
      }
      this.onFailure(token);
    });
  }

  /** Solta o stream atual e descarta o elemento (sem disparar novas tentativas). */
  private release() {
    const audio = this.audio;
    this.audio = null;
    if (!audio) return;
    audio.pause();
    audio.removeAttribute('src');
    audio.load();
  }

  subscribe(listener: RadioListener): () => void {
    this.listeners.add(listener);
    if (!this.ticker && typeof window !== 'undefined') {
      this.ticker = setInterval(() => {
        this.headline = (this.headline + 1) % NIGHT_CITY_NEWS.length;
        this.notify();
      }, 18_000);
    }
    return () => {
      this.listeners.delete(listener);
    };
  }

  getStatus(): RadioStatus {
    return this.status;
  }
  getCurrentStation(): RadioStation {
    return STATIONS[this.stationIndex];
  }
  getStationIndex(): number {
    return this.stationIndex;
  }
  getIsPlaying(): boolean {
    return this.status === 'playing';
  }
  getIsLoading(): boolean {
    return this.status === 'loading';
  }
  getVolume(): number {
    return this.volume;
  }
  getIsMuted(): boolean {
    return this.muted;
  }
  getCurrentNews(): string {
    return NIGHT_CITY_NEWS[this.headline];
  }

  /** Tocando ou carregando → para. Parado ou offline → toca. */
  togglePlay(): void {
    if (this.status === 'playing' || this.status === 'loading') this.stop();
    else this.play();
  }

  play(): void {
    this.mirrorIndex = 0;
    this.attempt();
  }

  stop(): void {
    this.token++; // invalida qualquer evento/promise pendente
    this.clearTimer();
    this.status = 'stopped';
    this.release();
    this.notify();
  }

  setStation(index: number): void {
    if (index < 0 || index >= STATIONS.length || index === this.stationIndex) return;
    const wasActive = this.status === 'playing' || this.status === 'loading';
    this.stop();
    this.stationIndex = index;
    if (wasActive) this.play();
    else this.notify();
  }

  nextStation(): void {
    this.setStation((this.stationIndex + 1) % STATIONS.length);
  }

  prevStation(): void {
    this.setStation((this.stationIndex - 1 + STATIONS.length) % STATIONS.length);
  }

  setVolume(vol: number): void {
    this.volume = Math.max(0, Math.min(1, vol));
    if (this.audio) this.audio.volume = this.muted ? 0 : this.volume;
    this.notify();
  }

  toggleMute(): void {
    this.muted = !this.muted;
    if (this.audio) this.audio.volume = this.muted ? 0 : this.volume;
    this.notify();
  }
}

export const radioEngine = new RadioEngine();
export const radio = radioEngine;
