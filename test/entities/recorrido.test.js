import { test } from 'node:test';
import assert from 'node:assert/strict';
import { crearRecorrido } from '../../src/entities/recorrido.js';

test('un recorrido nuevo empieza sin caídas ni registro', () => {
  const recorrido = crearRecorrido();
  assert.equal(recorrido.correoRegistrado, false);
  assert.deepEqual(recorrido.resumen(), { email: '', university: '', fell: 0, resisted: false });
});

test('cada caída en una trampa cuenta, aunque se repita', () => {
  const recorrido = crearRecorrido();
  recorrido.caerEnTrampa(); // ventana falsa
  recorrido.caerEnTrampa(); // la misma u otra, o el atajo del estafador
  assert.equal(recorrido.resumen().fell, 2);
});

test('cada cebo cuenta una sola vez y se suma a las trampas', () => {
  const recorrido = crearRecorrido();
  recorrido.tocarCebo('ad--3');
  recorrido.tocarCebo('ad--3');
  recorrido.tocarCebo('fraud-USB');
  recorrido.caerEnTrampa();
  assert.equal(recorrido.resumen().fell, 3);
});

test('resistir al estafador queda en el resumen', () => {
  const recorrido = crearRecorrido();
  recorrido.resistirEstafador();
  assert.equal(recorrido.resumen().resisted, true);
});

test('solo registra un correo válido', () => {
  const recorrido = crearRecorrido();
  assert.equal(recorrido.registrarCorreo('no-es-correo'), false);
  assert.equal(recorrido.correoRegistrado, false);
  assert.equal(recorrido.registrarCorreo(' estudiante@uniminuto.edu.co '), true);
  assert.equal(recorrido.correoRegistrado, true);
  assert.equal(recorrido.resumen().email, 'estudiante@uniminuto.edu.co');
});

test('registra la universidad para la salida', () => {
  const recorrido = crearRecorrido();
  assert.equal(recorrido.registrarUniversidad(' '), false);
  assert.equal(recorrido.registrarUniversidad('UNIMINUTO'), true);
  assert.equal(recorrido.resumen().university, 'UNIMINUTO');
});
