/**
 * Participación en la actividad del Proyecto CiberFamilias: las reglas del correo y de la universidad.
 * Entidad pura (sin three.js, DOM ni configuración): la usan el simulador y el formulario sencillo.
 * Cada pantalla pone sus propios mensajes de error; la regla vive solo aquí.
 */

// nombre@dominio.ext, sin espacios (la tabla de Supabase valida la misma regla: supabase/respuestas.sql)
export const CORREO_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export const esCorreoValido = (texto) => CORREO_RE.test(String(texto ?? '').trim());

/** Nombre de la universidad sin espacios de sobra: "  Uni   Minuto " → "Uni Minuto". */
export const normalizarUniversidad = (texto) =>
  String(texto ?? '')
    .trim()
    .replace(/\s+/g, ' ');

export const esUniversidadValida = (texto) => normalizarUniversidad(texto).length >= 2;
