/**
 * Home Channel HLS - Utilidades de rutas seguras
 * Evitan que un nombre de archivo enviado desde el panel (ej. "../../etc/passwd")
 * escape de la carpeta permitida.
 */

const path = require('path');

/**
 * Une baseDir + relPath y devuelve la ruta absoluta SOLO si queda dentro de baseDir.
 * Devuelve null si la ruta es inválida o intenta salir de la carpeta.
 */
function safeJoin(baseDir, relPath) {
  if (typeof relPath !== 'string' || !relPath || relPath.includes('\0')) return null;
  const base = path.resolve(baseDir);
  const full = path.resolve(base, relPath);
  if (full.startsWith(base + path.sep)) return full;
  return null;
}

/** Identificador simple (uploadId, jobId...) sin separadores de ruta. */
function safeId(value, maxLen = 80) {
  if (typeof value !== 'string') return null;
  return new RegExp(`^[A-Za-z0-9_-]{1,${maxLen}}$`).test(value) ? value : null;
}

module.exports = { safeJoin, safeId };
