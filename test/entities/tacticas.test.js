import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FRASES, FRASES_OBJETO, elegirFrase } from '../../src/entities/tacticas.js';

const pasillo = { campo: null, cercaDeTv: false, objetosCerca: [], correoRegistrado: false, frenteAVentanas: false };
const primera = () => 0; // azar fijo: siempre la primera opción disponible

test('mientras escribe el correo, el estafador usa tácticas sobre la escritura', () => {
  assert.ok(FRASES.typing.includes(elegirFrase({ ...pasillo, campo: 'email' })));
});

test('escribiendo la universidad o cerca de la TV, desacredita la salida', () => {
  assert.ok(FRASES.tv.includes(elegirFrase({ ...pasillo, campo: 'university' })));
  assert.ok(FRASES.tv.includes(elegirFrase({ ...pasillo, cercaDeTv: true })));
});

test('escribir pesa más que estar cerca de un objeto', () => {
  assert.ok(FRASES.typing.includes(elegirFrase({ ...pasillo, campo: 'email', objetosCerca: ['fraud-USB'] })));
});

test('cerca de un objeto de fraude usa el cebo de ese objeto', () => {
  const usb = FRASES_OBJETO.find((f) => f.key === 'USB');
  assert.equal(elegirFrase({ ...pasillo, objetosCerca: ['fraud-USB'] }), usb);
  const wifi = FRASES_OBJETO.find((f) => f.key === 'Fi');
  assert.equal(elegirFrase({ ...pasillo, objetosCerca: ['fraud-Wi‑Fi gratis'] }), wifi);
});

test('no repite el cebo del objeto: pasa al siguiente objeto cercano o al contexto', () => {
  const usb = FRASES_OBJETO.find((f) => f.key === 'USB');
  const qr = FRASES_OBJETO.find((f) => f.key === 'QR');
  assert.equal(elegirFrase({ ...pasillo, objetosCerca: ['fraud-USB', 'fraud-Código QR'] }, usb), qr);
  assert.ok(FRASES.corridor.includes(elegirFrase({ ...pasillo, objetosCerca: ['fraud-USB'] }, usb)));
});

test('con el correo registrado cambia el discurso', () => {
  assert.ok(FRASES.registered.includes(elegirFrase({ ...pasillo, correoRegistrado: true })));
});

test('frente a las ventanas empuja hacia las falsas', () => {
  assert.ok(FRASES.windows.includes(elegirFrase({ ...pasillo, frenteAVentanas: true })));
});

test('en el pasillo intenta ganarse tu confianza', () => {
  assert.ok(FRASES.corridor.includes(elegirFrase(pasillo)));
});

test('no repite la frase anterior cuando hay otras', () => {
  const anterior = FRASES.corridor[0];
  for (let i = 0; i < 20; i++) assert.notEqual(elegirFrase(pasillo, anterior), anterior);
  assert.equal(elegirFrase(pasillo, anterior, primera), FRASES.corridor[1]);
});

test('cada frase está rotulada con su técnica, tiene subtítulo y voz', () => {
  const todas = [...Object.values(FRASES).flat(), ...FRASES_OBJETO];
  for (const frase of todas) {
    for (const campo of ['tactic', 'text', 'say']) {
      assert.equal(typeof frase[campo], 'string', `${campo} en ${JSON.stringify(frase)}`);
      assert.ok(frase[campo].length > 0);
    }
  }
});
