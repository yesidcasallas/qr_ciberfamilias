/**
 * Guarda respuestas en Google Sheets a través de la aplicación web de Apps Script
 * (google-apps-script/Codigo.gs). Sin PUBLIC_SHEETS_URL no se envía nada.
 *
 *   saveResponse({ origen: 'formulario', correo, universidad });
 *   saveResponse({ origen: 'simulador', correo, universidad, senuelos, resistio });
 */
const SHEETS_URL = import.meta.env.PUBLIC_SHEETS_URL || '';

export function saveResponse(data) {
  if (!SHEETS_URL) return;
  fetch(SHEETS_URL, {
    method: 'POST',
    mode: 'no-cors', // Apps Script redirige sin cabeceras CORS: se envía sin leer la respuesta
    keepalive: true, // termina de enviarse aunque la página se recargue
    headers: { 'Content-Type': 'text/plain;charset=utf-8' }, // petición simple, sin preflight
    body: JSON.stringify(data),
  }).catch(() => {});
}
