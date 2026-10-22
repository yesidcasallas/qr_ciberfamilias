import { test } from 'node:test';
import assert from 'node:assert/strict';
import { esCorreoValido, esUniversidadValida, normalizarUniversidad } from '../../src/entities/participacion.js';

test('acepta correos con usuario, dominio y extensión', () => {
  for (const correo of ['estudiante@uniminuto.edu.co', 'a@b.co', '  nombre@correo.com  ']) {
    assert.equal(esCorreoValido(correo), true, correo);
  }
});

test('rechaza correos incompletos, con espacios o vacíos', () => {
  for (const correo of ['', 'sin-arroba.com', 'a@b', 'a@b.c', 'a b@c.com', '@correo.com', 'a@@b.com', null, undefined]) {
    assert.equal(esCorreoValido(correo), false, String(correo));
  }
});

test('la universidad necesita al menos 2 caracteres, sin contar espacios de sobra', () => {
  assert.equal(esUniversidadValida('UNIMINUTO'), true);
  assert.equal(esUniversidadValida('U2'), true);
  assert.equal(esUniversidadValida('  U  '), false);
  assert.equal(esUniversidadValida(''), false);
  assert.equal(esUniversidadValida(undefined), false);
});

test('normaliza los espacios del nombre de la universidad', () => {
  assert.equal(normalizarUniversidad('  Corporación   Universitaria  Minuto de Dios '), 'Corporación Universitaria Minuto de Dios');
});
