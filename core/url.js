/**
 * CrHe X-99 - Utilidades de red y resolución de URLs para streaming y listas M3U/EPG.
 */

const VALID_HOST_RE = /^[a-zA-Z0-9.-]+(:\d{1,5})?$/;

/**
 * Determina si un host/IP corresponde a la red privada o local (LAN, RFC 1918, loopback).
 * Permite que los Smart TVs en casa se conecten directamente a la IP del servidor sin salir a Internet.
 */
function isPrivateHost(host) {
  if (!host) return false;
  const h = host.split(':')[0].toLowerCase();
  if (h === 'localhost' || h === '127.0.0.1' || h.endsWith('.local')) return true;
  if (/^192\.168\.\d{1,3}\.\d{1,3}$/.test(h)) return true;
  if (/^10\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(h)) return true;
  if (/^172\.(1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3}$/.test(h)) return true;
  return false;
}

/**
 * Resuelve la URL base adecuada según el origen de la petición:
 * - Si la petición proviene de la red local (ej: http://192.168.68.201:3600), usa la IP local y puerto
 *   para que el streaming HLS viaje 100% por LAN sin depender de la conexión a Internet.
 * - Si proviene de fuera o se solicita por el dominio público (ej: https://crhe.jairocruz.dev),
 *   usa la URL pública para que funcione en cualquier parte del mundo a través de Cloudflare.
 */
function getBaseUrl(req) {
  const forwardedHost = String((req && req.headers && req.headers['x-forwarded-host']) || '').trim().split(',')[0].trim();
  const rawHost = forwardedHost || String((req && req.headers && req.headers.host) || '').trim();
  const host = VALID_HOST_RE.test(rawHost) ? rawHost : '';

  // 1. Si la petición viene explícitamente a la IP/host local de la LAN
  if (host && isPrivateHost(host)) {
    const rawProto = String((req && req.headers && req.headers['x-forwarded-proto']) || (req && req.secure ? 'https' : (req && req.protocol)) || 'http').split(',')[0].trim().toLowerCase();
    const proto = rawProto === 'https' ? 'https' : 'http';
    return `${proto}://${host}`;
  }

  // 2. Si hay PUBLIC_BASE_URL configurada (ej: https://crhe.jairocruz.dev)
  if (process.env.PUBLIC_BASE_URL) return process.env.PUBLIC_BASE_URL.replace(/\/$/, '');

  // 3. Fallback en caso de no haber variable configurada
  const fallbackHost = host || 'crhe.jairocruz.dev';
  const rawProto = String((req && req.headers && req.headers['x-forwarded-proto']) || (req && req.secure ? 'https' : (req && req.protocol)) || 'http').split(',')[0].trim().toLowerCase();
  const proto = rawProto === 'https' ? 'https' : 'http';
  return `${proto}://${fallbackHost}`;
}

module.exports = {
  isPrivateHost,
  getBaseUrl
};
