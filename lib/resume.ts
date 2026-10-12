// Com o app em segundo plano o tempo real para de entregar, e o que chegou nesse meio-tempo não é reenviado.
const AWAY = 5000;

/**
 * Chama `run` quando a pessoa volta para o app depois de um tempo fora, ou quando a conexão volta:
 * é a hora de buscar de novo o que o tempo real não entregou. Devolve a função que desliga.
 */
export function onResume(run: () => void) {
  let hiddenAt = 0;
  const onVisible = () => {
    if (document.visibilityState !== 'visible') { hiddenAt = Date.now(); return; }
    if (hiddenAt && Date.now() - hiddenAt >= AWAY) run();
    hiddenAt = 0;
  };
  document.addEventListener('visibilitychange', onVisible);
  window.addEventListener('online', run);
  return () => { document.removeEventListener('visibilitychange', onVisible); window.removeEventListener('online', run); };
}
