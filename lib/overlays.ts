/**
 * Pilha das camadas abertas (bottom sheets e visualizador de mídia).
 * O botão físico de voltar do Android fecha a de cima em vez de sair da tela.
 */
const abertas: (() => void)[] = [];
const ouvintes = new Set<(abertas: number) => void>();
const avisar = () => ouvintes.forEach(ouvinte => ouvinte(abertas.length));

export function registerOverlay(fechar: () => void) {
  abertas.push(fechar);
  avisar();
  return () => {
    const i = abertas.indexOf(fechar);
    if (i >= 0) { abertas.splice(i, 1); avisar(); }
  };
}

/** Quantas camadas estão abertas, a cada mudança (o mapa da home desenha devagar enquanto há alguma). */
export function onOverlaysChange(ouvinte: (abertas: number) => void) {
  ouvintes.add(ouvinte);
  return () => { ouvintes.delete(ouvinte); };
}

/** Fecha a camada mais recente. Devolve false quando não havia nenhuma. */
export function closeTopOverlay() {
  const fechar = abertas.pop();
  if (!fechar) return false;
  avisar();
  fechar();
  return true;
}
