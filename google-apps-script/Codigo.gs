/**
 * Proyecto CiberFamilias: recibe las respuestas del sitio (formulario y simulador) y las
 * agrega como filas a la hoja "Respuestas" de esta hoja de cálculo.
 *
 * Instalación (una sola vez):
 *  1. Crea una hoja de cálculo en Google Sheets.
 *  2. Extensiones → Apps Script. Borra lo que haya, pega este archivo y guarda.
 *  3. Implementar → Nueva implementación → tipo "Aplicación web".
 *     Ejecutar como: "Yo". Quién tiene acceso: "Cualquier persona". Implementar y autorizar.
 *  4. Copia la URL que termina en /exec y ponla en el sitio como PUBLIC_SHEETS_URL.
 */
const HOJA = 'Respuestas';
const COLUMNAS = ['Fecha', 'Origen', 'Correo', 'Universidad', 'Señuelos en los que cayó', 'Resistió al estafador'];
const ORIGENES = ['formulario', 'simulador'];
const CORREO = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

function doPost(e) {
  let datos;
  try {
    datos = JSON.parse(e.postData.contents);
  } catch (err) {
    return respuesta('json inválido');
  }
  const correo = String(datos.correo || '').trim();
  if (ORIGENES.indexOf(datos.origen) < 0 || !CORREO.test(correo) || correo.length > 120) {
    return respuesta('datos inválidos');
  }

  const lock = LockService.getScriptLock();
  lock.waitLock(10000); // varias respuestas al mismo tiempo no se pisan
  try {
    const libro = SpreadsheetApp.getActiveSpreadsheet();
    const hoja = libro.getSheetByName(HOJA) || libro.insertSheet(HOJA);
    if (hoja.getLastRow() === 0) hoja.appendRow(COLUMNAS);
    const simulador = datos.origen === 'simulador';
    hoja.appendRow([
      new Date(),
      datos.origen,
      texto(correo),
      texto(datos.universidad),
      simulador ? Number(datos.senuelos) || 0 : '',
      simulador ? (datos.resistio ? 'Sí' : 'No') : '',
    ]);
  } finally {
    lock.releaseLock();
  }
  return respuesta('ok');
}

// Texto seguro para la hoja: corto y sin fórmulas (un =, +, - o @ al inicio se escapa).
function texto(valor) {
  const t = String(valor || '').trim().slice(0, 120);
  return /^[=+\-@]/.test(t) ? "'" + t : t;
}

function respuesta(mensaje) {
  return ContentService.createTextOutput(mensaje);
}
