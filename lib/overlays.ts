/**
 * Pilha das camadas abertas (bottom sheets e visualizador de mídia).
 * O botão físico de voltar do Android fecha a de cima em vez de sair da tela.
 */
const abertas: (() => void)[] = [];

export function registerOverlay(fechar: () => void) {
  abertas.push(fechar);
  return () => {
    const i = abertas.indexOf(fechar);
    if (i >= 0) abertas.splice(i, 1);
  };
}

/** Fecha a camada mais recente. Devolve false quando não havia nenhuma. */
export function closeTopOverlay() {
  const fechar = abertas.pop();
  if (!fechar) return false;
  fechar();
  return true;
}
