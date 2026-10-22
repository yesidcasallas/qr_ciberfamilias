/**
 * La ingeniería social del estafador: sus frases, cada una rotulada con la técnica que usa (para aprender a
 * reconocerla), y la regla para elegir la que toca según lo que está haciendo la persona. Entidad pura: el
 * estafador (scammer.js) calcula el contexto desde la escena y aquí se decide qué dice.
 */

// Frases por contexto. text = subtítulo, say = lo que dice en voz alta.
export const FRASES = {
  corridor: [
    { tactic: 'Confianza', text: 'hola… yo también me perdí aquí, te ayudo', say: 'Hola... yo también me perdí aquí. Te ayudo.' },
    { tactic: 'Autoridad', text: 'soy del área de TI de tu universidad', say: 'Soy del área de TI de tu universidad.' },
    { tactic: 'Curiosidad', text: '¿viste ese anuncio? a mí sí me llegó el iPhone', say: '¿Viste ese anuncio? A mí sí me llegó el iPhone.' },
  ],
  windows: [
    { tactic: 'Prueba social', text: 'todos eligieron la de la feria…', say: 'Todos eligieron la de la feria.' },
    { tactic: 'Urgencia', text: 'apúrate, la transmisión se acaba ya', say: 'Apúrate. La transmisión se acaba ya.' },
    { tactic: 'Cebo', text: 'la del premio es la buena, créeme', say: 'La del premio es la buena. Créeme.' },
    { tactic: 'Descrédito', text: 'ese portal oficial es lento y aburrido…', say: 'Ese portal oficial es lento y aburrido.' },
  ],
  typing: [
    { tactic: 'Pretexto', text: 'pon también tu contraseña, es más rápido', say: 'Pon también tu contraseña. Es más rápido.' },
    { tactic: 'Distracción', text: 'no mires la dirección, es la misma página', say: 'No mires la dirección. Es la misma página.' },
  ],
  registered: [
    { tactic: 'Miedo', text: 'ese portal te va a cobrar… yo lo arreglo', say: 'Ese portal te va a cobrar. Yo lo arreglo.' },
    { tactic: 'Confianza', text: 'tranquilo, yo te acompaño hasta la salida', say: 'Tranquilo. Yo te acompaño hasta la salida.' },
  ],
  tv: [
    { tactic: 'Descrédito', text: 'esa TV está rota… sígueme a mí', say: 'Esa TV está rota. Sígueme a mí.' },
    { tactic: 'Psicología inversa', text: 'no escribas ahí, te van a robar…', say: 'No escribas ahí. Te van a robar.' },
    { tactic: 'Autoridad', text: 'yo soy el soporte oficial, déjame ayudarte', say: 'Yo soy el soporte oficial. Déjame ayudarte.' },
  ],
  offer: { tactic: 'Atajo falso', text: 'te saco del teléfono ya… solo acepta', say: 'Te saco del teléfono ya. Solo acepta mi atajo.' },
  pressure: { tactic: 'Urgencia', text: 'rápido, la oferta se acaba…', say: 'Rápido. La oferta se acaba.' },
  declined: { tactic: 'Presión', text: 'tú te lo pierdes…', say: 'Tú te lo pierdes.' },
  gloat: { tactic: 'Robo', text: 'gracias por tus datos…', say: 'Gracias por tus datos.' },
};

// Cebo según el objeto de fraude que la persona tenga cerca (se reconoce por su id).
export const FRASES_OBJETO = [
  { key: 'USB', tactic: 'Cebo', text: 'ese USB tiene fotos tuyas… conéctalo', say: 'Ese USB tiene fotos tuyas. Conéctalo.' },
  { key: 'QR', tactic: 'Cebo', text: 'escanéalo, hay un descuento', say: 'Escanéalo. Hay un descuento.' },
  { key: 'Fi', tactic: 'Cebo', text: 'conéctate, es gratis y rápido', say: 'Conéctate. Es gratis y rápido.' },
  { key: 'Cargador', tactic: 'Miedo', text: 'tu batería está por morir, carga aquí', say: 'Tu batería está por morir. Carga aquí.' },
  { key: 'Grabadora', tactic: 'Pretexto', text: 'te llamo del banco: dime el código que te llegó', say: 'Te llamo del banco. Dime el código que te llegó.' },
];

/**
 * Elige la táctica según lo que la persona está haciendo y dónde está. El contexto lo arma el estafador:
 *   campo            : 'email' | 'university' | null (lo que está escribiendo)
 *   cercaDeTv        : la barrera está abierta y la TV de salida está cerca
 *   objetosCerca     : ids de los objetos de fraude cercanos, en orden
 *   correoRegistrado : ya registró su correo en el portal oficial
 *   frenteAVentanas  : la barrera sigue cerrada y está frente a las ventanas
 * `ultima` evita repetir la frase anterior; `azar` (0..1) se puede fijar en las pruebas.
 */
export function elegirFrase(contexto, ultima = null, azar = Math.random) {
  const elegir = (lista) => {
    const opciones = lista.filter((frase) => frase !== ultima);
    return opciones[Math.floor(azar() * opciones.length)] || lista[0];
  };
  if (contexto.campo === 'email') return elegir(FRASES.typing);
  if (contexto.campo === 'university') return elegir(FRASES.tv);
  if (contexto.cercaDeTv) return elegir(FRASES.tv);
  for (const id of contexto.objetosCerca ?? []) {
    const frase = FRASES_OBJETO.find((o) => id.includes(o.key));
    if (frase && frase !== ultima) return frase;
  }
  if (contexto.correoRegistrado) return elegir(FRASES.registered);
  if (contexto.frenteAVentanas) return elegir(FRASES.windows);
  return elegir(FRASES.corridor);
}
