/**
 * Guarda las respuestas autorizadas en Supabase: tabla `respuestas` (ver supabase/respuestas.sql).
 * Usa la clave publicable, hecha para ir en el sitio: las políticas de la tabla solo le permiten
 * agregar filas, no leerlas, cambiarlas ni borrarlas. Sin las dos variables no se envía nada.
 *
 *   saveResponse({ origen: 'formulario', correo, universidad });
 *   saveResponse({ origen: 'simulador', correo, universidad, senuelos, resistio });
 */
const SUPABASE_URL = (import.meta.env.PUBLIC_SUPABASE_URL || '').replace(/\/+$/, '');
const SUPABASE_KEY = import.meta.env.PUBLIC_SUPABASE_PUBLISHABLE_KEY || '';

/** Si el sitio guarda respuestas: las páginas muestran la casilla de autorización. */
export const guardaRespuestas = Boolean(SUPABASE_URL && SUPABASE_KEY);

export function saveResponse(data) {
  if (!guardaRespuestas) return;
  const fila = {
    origen: data.origen,
    correo: String(data.correo ?? '').trim(),
    universidad: String(data.universidad ?? '').trim().slice(0, 120),
  };
  if (data.origen === 'simulador') {
    fila.senuelos = Number(data.senuelos) || 0;
    fila.resistio = Boolean(data.resistio);
  }
  fetch(`${SUPABASE_URL}/rest/v1/respuestas`, {
    method: 'POST',
    headers: { apikey: SUPABASE_KEY, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
    body: JSON.stringify(fila),
  })
    .then((r) => r.ok || console.warn(`No se guardó la respuesta (${r.status})`))
    .catch(() => {}); // sin conexión, la actividad sigue igual
}
