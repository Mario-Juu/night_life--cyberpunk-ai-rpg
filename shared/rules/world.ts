export interface DistrictInfo {
  id: string;
  name: string;
  sub: string;
  vibe: string;
  localGang: string;
}

export const DISTRICTS: readonly DistrictInfo[] = [
  { id: 'WATSON', name: 'Watson', sub: 'Little China, Kabuki, Northside', vibe: 'Densidade asfixiante, mercados pretos, Maelstrom e Tyger Claws.', localGang: 'Tyger Claws' },
  { id: 'WESTBROOK', name: 'Westbrook', sub: 'Japantown, Charter Hill, North Oak', vibe: 'Luxo corporativo, casas de bonecas, cassinos clandestinos.', localGang: 'Tyger Claws' },
  { id: 'CITY CENTER', name: 'City Center', sub: 'Corpo Plaza, Downtown', vibe: 'Arranha-céus corporativos e segurança pesada.', localGang: 'Segurança Arasaka' },
  { id: 'HEYWOOD', name: 'Heywood', sub: 'The Glen, Wellsprings, Vista Del Rey', vibe: 'Coração urbano, orgulho latino, território dos Valentinos.', localGang: 'Valentinos' },
  { id: 'SANTO DOMINGO', name: 'Santo Domingo', sub: 'Arroyo, Rancho Coronado', vibe: 'Fábricas fumegantes e subúrbio industrial esquecido.', localGang: '6th Street' },
  { id: 'PACIFICA', name: 'Pacifica', sub: 'Coastview, West Wind Estate', vibe: 'Paraíso abandonado, terra sem lei, Voodoo Boys.', localGang: 'Voodoo Boys' },
];

export function getDistrict(id: string): DistrictInfo {
  return DISTRICTS.find(d => d.id === id.toUpperCase()) ?? DISTRICTS[0];
}

/** Data inicial padrão da campanha. */
export const CAMPAIGN_START_TIME = '2077-09-29T23:41:00.000Z';

const WEEKDAYS = ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado'];
const MONTHS = ['JAN', 'FEV', 'MAR', 'ABR', 'MAI', 'JUN', 'JUL', 'AGO', 'SET', 'OUT', 'NOV', 'DEZ'];

export function formatGameTime(iso: string): { date: string; time: string; weekday: string } {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return { date: '--', time: '--:--', weekday: '' };
  const pad = (n: number) => String(n).padStart(2, '0');
  return {
    date: `${pad(d.getUTCDate())} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`,
    time: `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`,
    weekday: WEEKDAYS[d.getUTCDay()],
  };
}

export function advanceGameTime(iso: string, minutes: number): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return new Date(d.getTime() + minutes * 60_000).toISOString();
}

export function gameDay(iso: string): string {
  return iso.slice(0, 10);
}
