export type Tier = 'A' | 'B' | 'C';
export type Team = { id: string; name: string; university: string; initials: string; color: string; tier: Tier; points: number };

// Barcos demonstrativos, separados por tier para o fantasy.
export const teams: Team[] = [
  { id: 'ufsc', name: 'Vento Sul', university: 'UFSC · Florianópolis, SC', initials: 'VS', color: 'green', tier: 'A', points: 285 },
  { id: 'ufrj', name: 'Minerva Solar', university: 'UFRJ · Rio de Janeiro, RJ', initials: 'MS', color: 'gold', tier: 'A', points: 272 },
  { id: 'uff', name: 'Arariboia', university: 'UFF · Niterói, RJ', initials: 'AR', color: 'blue', tier: 'A', points: 258 },
  { id: 'ifsc', name: 'Zênite Solar', university: 'IFSC · Joinville, SC', initials: 'ZS', color: 'orange', tier: 'B', points: 241 },
  { id: 'ufes', name: 'Solares', university: 'UFES · Vitória, ES', initials: 'SO', color: 'purple', tier: 'B', points: 226 },
  { id: 'ufpe', name: 'Mangue Solar', university: 'UFPE · Recife, PE', initials: 'MG', color: 'cyan', tier: 'B', points: 214 },
  { id: 'usp', name: 'Raia Paulista', university: 'USP · São Carlos, SP', initials: 'RP', color: 'blue', tier: 'B', points: 203 },
  { id: 'ufmg', name: 'Sol de Minas', university: 'UFMG · Belo Horizonte, MG', initials: 'SM', color: 'gold', tier: 'B', points: 188 },
  { id: 'ufba', name: 'Maré Alta', university: 'UFBA · Salvador, BA', initials: 'MA', color: 'green', tier: 'C', points: 171 },
  { id: 'ufrn', name: 'Potiguar Solar', university: 'UFRN · Natal, RN', initials: 'PS', color: 'orange', tier: 'C', points: 158 },
  { id: 'ufpa', name: 'Iara', university: 'UFPA · Belém, PA', initials: 'IA', color: 'cyan', tier: 'C', points: 142 },
  { id: 'ufsm', name: 'Pampa Solar', university: 'UFSM · Santa Maria, RS', initials: 'PA', color: 'purple', tier: 'C', points: 129 },
];

// Provas da programação oficial (horário de Brasília).
export const races = [
  { id: 'raia-rapida', number: 1, name: 'Raia Rápida', start: '2026-10-13T15:00:00-03:00' },
  { id: 'match-race', number: 2, name: 'Match Race', start: '2026-10-14T10:00:00-03:00' },
  { id: 'raia-manobra', number: 3, name: 'Raia de Manobra', start: '2026-10-14T14:00:00-03:00' },
  { id: 'raia-longa', number: 4, name: 'Raia Longa', start: '2026-10-15T08:00:00-03:00' },
  { id: 'revezamento', number: 5, name: 'Revezamento de Pilotos', start: '2026-10-16T09:00:00-03:00' },
  { id: 'sprint', number: 6, name: 'Sprint', start: '2026-10-17T09:00:00-03:00' },
  { id: 'slalom', number: 7, name: 'Slalom', start: '2026-10-17T09:30:00-03:00' },
];
export type Race = typeof races[number];

// Vagas da escalação de cada prova: 1 tier A, 2 tier B e 1 tier C.
export const lineupSlots: Tier[] = ['A', 'B', 'B', 'C'];

export const fantasyPlayers = [
  { name: 'Marina Costa', points: 1140 },
  { name: 'Pedro Almeida', points: 1086 },
  { name: 'Ana Souza', points: 1012 },
  { name: 'Lucas Ribeiro', points: 968 },
  { name: 'Julia Martins', points: 921 },
  { name: 'Rafael Lima', points: 874 },
  { name: 'Beatriz Rocha', points: 810 },
  { name: 'Thiago Nunes', points: 755 },
];

export type Message = { id: string; name: string; initials: string; text: string; time: string; color: string; own?: boolean; team?: string };
export const initialMessages: Message[] = [
  { id: '1', name: 'Marina Costa', initials: 'MC', color: 'green', team: 'Vento Sul', text: 'Bom dia, pessoal! ☀️ Quem já está na Marina da Glória? O dia está perfeito pra navegar!', time: '10:32' },
  { id: '2', name: 'Pedro Almeida', initials: 'PA', color: 'blue', team: 'Arariboia', text: 'Já estamos por aqui! A prova de velocidade foi demais 🚤', time: '10:34' },
  { id: '3', name: 'Ana Souza', initials: 'AS', color: 'orange', text: 'A recuperação da Minerva na última volta foi absurda. Que prova!', time: '10:35' },
  { id: '4', name: 'Lucas Ribeiro', initials: 'LR', color: 'purple', team: 'Minerva Solar', text: 'Valeu pela torcida! Agora é preparar tudo pra resistência. Vai ser uma tarde de muita emoção 💪☀️', time: '10:37' },
  { id: '5', name: 'Marina Costa', initials: 'MC', color: 'green', team: 'Vento Sul', text: 'E aí, já escalaram as equipes no fantasy? Tô montando a minha aqui 👀', time: '10:40' },
];
