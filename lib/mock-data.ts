export const teams = [
  { id: 'ufsc', name: 'Vento Sul', university: 'UFSC · Florianópolis, SC', initials: 'VS', color: 'green', points: 285, speed: '18,4', time: '42:18', change: 1, price: 38 },
  { id: 'ufrj', name: 'Minerva Solar', university: 'UFRJ · Rio de Janeiro, RJ', initials: 'MS', color: 'gold', points: 272, speed: '17,8', time: '43:05', change: 1, price: 34 },
  { id: 'uff', name: 'Arariboia', university: 'UFF · Niterói, RJ', initials: 'AR', color: 'blue', points: 258, speed: '17,2', time: '44:32', change: -2, price: 30 },
  { id: 'ifsc', name: 'Zênite Solar', university: 'IFSC · Joinville, SC', initials: 'ZS', color: 'orange', points: 241, speed: '16,5', time: '45:10', change: 0, price: 27 },
  { id: 'ufes', name: 'Solares', university: 'UFES · Vitória, ES', initials: 'SO', color: 'purple', points: 226, speed: '16,1', time: '46:48', change: 2, price: 25 },
  { id: 'ufpe', name: 'Mangue Solar', university: 'UFPE · Recife, PE', initials: 'MG', color: 'cyan', points: 214, speed: '15,6', time: '47:23', change: -1, price: 22 },
];
export type Team = typeof teams[number];
export const schedule = [
  { time: '08:00', title: 'Abertura da arena', subtitle: 'Marina da Glória', status: 'done' },
  { time: '09:00', title: 'Prova de velocidade', subtitle: 'Etapa 02 · Concluída', status: 'done' },
  { time: '14:00', title: 'Prova de resistência', subtitle: 'Etapa 03 · Próxima prova', status: 'next' },
  { time: '17:00', title: 'Pódio do dia', subtitle: 'Arena principal', status: 'later' },
];
export type Message = { id: string; name: string; initials: string; text: string; time: string; color: string; own?: boolean; team?: string };
export const initialMessages: Message[] = [
  { id: '1', name: 'Marina Costa', initials: 'MC', color: 'green', team: 'Vento Sul', text: 'Bom dia, pessoal! ☀️ Quem já está na Marina da Glória? O dia está perfeito pra navegar!', time: '10:32' },
  { id: '2', name: 'Pedro Almeida', initials: 'PA', color: 'blue', team: 'Arariboia', text: 'Já estamos por aqui! A prova de velocidade foi demais 🚤', time: '10:34' },
  { id: '3', name: 'Ana Souza', initials: 'AS', color: 'orange', text: 'A recuperação da Minerva na última volta foi absurda. Que prova!', time: '10:35' },
  { id: '4', name: 'Lucas Ribeiro', initials: 'LR', color: 'purple', team: 'Minerva Solar', text: 'Valeu pela torcida! Agora é preparar tudo pra resistência. Vai ser uma tarde de muita emoção 💪☀️', time: '10:37' },
  { id: '5', name: 'Marina Costa', initials: 'MC', color: 'green', team: 'Vento Sul', text: 'E aí, já escalaram as equipes no fantasy? Tô montando a minha aqui 👀', time: '10:40' },
];

// Próxima prova demonstrativa. Atualize aqui os dados do card da home.
export const nextRace = {
  name: 'Match race',
  day: 'Sábado',
  date: '2026-09-19',
  time: '09:00',
};
