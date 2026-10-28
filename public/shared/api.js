/**
 * Home Channel HLS - Cliente HTTP mínimo para la API JSON del canal.
 *
 * Nunca lanza por códigos HTTP de error: devuelve el cuerpo JSON y, si la respuesta
 * no fue 2xx, asegura `success: false` y un `error`. Solo lanza si no hay red.
 */

async function request(method, url, body) {
  const options = { method };
  if (body !== undefined) {
    options.headers = { 'Content-Type': 'application/json' };
    options.body = JSON.stringify(body);
  }
  const res = await fetch(url, options);
  const data = await res.json().catch(() => ({}));
  if (!res.ok && data && !Array.isArray(data)) {
    data.success = false;
    data.error = data.error || `El servidor respondió ${res.status}`;
  }
  return data;
}

export const api = {
  get: (url) => request('GET', url),
  post: (url, body) => request('POST', url, body),
  put: (url, body) => request('PUT', url, body),
  del: (url) => request('DELETE', url)
};
