// Modelo e sistema do aparelho, lidos do user agent. Funções puras, testadas em tests/device.test.mjs.

export type Device = { model: string | null; os: string | null };

const dotted = (version: string) => version.replace(/_/g, '.');

/**
 * No app das lojas o Android entrega o modelo (ex.: "SM-A546E") e a versão do sistema. O iPhone só
 * diz que é iPhone, sem o modelo. No navegador o Chrome esconde os dois ("Android 10; K"): aí vem
 * só "Android", e lib/install.ts tenta completar pelas dicas do navegador.
 */
export function deviceFromUserAgent(ua: string): Device {
  const apple = /\((iPhone|iPad|iPod)[^)]*? OS (\d+(?:_\d+)*)/.exec(ua);
  if (apple) return { model: apple[1], os: `iOS ${dotted(apple[2])}` };

  // O modelo vai até " Build/" (pode ter parênteses, como "moto g(30)"); sem isso, até o próximo separador.
  const android = /Android (\d+(?:\.\d+)*)\s*[;)]\s*(?:([^;]+?) Build\/|([^;)]*))/.exec(ua);
  if (android) {
    const model = (android[2] ?? android[3]).trim();
    if (model === 'K') return { model: null, os: 'Android' };
    const known = model !== '' && !/^(Mobile|Tablet|wv|rv:.*)$/.test(model);
    return { model: known ? model : null, os: `Android ${android[1]}` };
  }

  const os = /Windows NT/.test(ua) ? 'Windows' : /Macintosh/.test(ua) ? 'macOS' : /CrOS/.test(ua) ? 'ChromeOS' : /Linux/.test(ua) ? 'Linux' : null;
  return { model: null, os };
}
