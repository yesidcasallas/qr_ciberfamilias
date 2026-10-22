import { esCorreoValido, esUniversidadValida } from './participacion.js';

/**
 * El recorrido de una persona por el simulador: en cuántas trampas cayó, qué cebos tocó, si resistió al
 * estafador y qué registró. Entidad pura: el juego (game.js) le avisa lo que pasa y le pide el resumen.
 *
 *   const recorrido = crearRecorrido();
 *   recorrido.caerEnTrampa();          // ventana falsa o atajo del estafador: cada caída cuenta
 *   recorrido.tocarCebo('fraud-USB');  // anuncio u objeto de fraude: cada uno cuenta una vez
 *   recorrido.resumen();               // { email, university, fell, resisted }
 */
export function crearRecorrido() {
  let trampas = 0;
  const cebos = new Set();
  let resistio = false;
  let correo = '';
  let universidad = '';

  return {
    caerEnTrampa() {
      trampas++;
    },
    tocarCebo(id) {
      cebos.add(id);
    },
    resistirEstafador() {
      resistio = true;
    },
    /** Solo el correo del portal oficial; uno inválido no se registra (devuelve false). */
    registrarCorreo(valor) {
      if (!esCorreoValido(valor)) return false;
      correo = valor.trim();
      return true;
    },
    registrarUniversidad(valor) {
      if (!esUniversidadValida(valor)) return false;
      universidad = valor.trim();
      return true;
    },
    get correoRegistrado() {
      return correo !== '';
    },
    /** Lo que muestran los créditos (y lo que se guarda, si la persona lo autorizó). */
    resumen() {
      return { email: correo, university: universidad, fell: trampas + cebos.size, resisted: resistio };
    },
  };
}
