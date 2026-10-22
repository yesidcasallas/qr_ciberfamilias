import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';

// Regla de dependencias (Clean Architecture): las entidades son el centro y no dependen de nada de afuera.
// Pueden importarse entre ellas, pero no three.js, ni el DOM, ni Astro, ni la configuración del sitio.
const CARPETA = new URL('../src/entities/', import.meta.url);
const IMPORTS = /\bimport\s*(?:[^'"]*?from\s*)?['"]([^'"]+)['"]|\bimport\(\s*['"]([^'"]+)['"]\s*\)/g;

for (const archivo of readdirSync(CARPETA).filter((nombre) => nombre.endsWith('.js'))) {
  const codigo = readFileSync(new URL(archivo, CARPETA), 'utf8');

  test(`entities/${archivo} solo importa otras entidades`, () => {
    for (const [, estatico, dinamico] of codigo.matchAll(IMPORTS)) {
      const destino = estatico ?? dinamico;
      assert.match(destino, /^\.\/[^/]+\.js$/, `importa «${destino}»`);
    }
  });

  test(`entities/${archivo} no usa el navegador ni la configuración`, () => {
    assert.doesNotMatch(codigo, /import\.meta\.env|\bdocument\.|\bwindow\.|\blocalStorage\b|\bfetch\(/);
  });
}
