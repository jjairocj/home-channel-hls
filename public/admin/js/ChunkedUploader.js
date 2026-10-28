/**
 * Home Channel Master Control - Subida de archivos grandes por partes.
 *
 * Partes de 20 MB (el proxy gratuito de Cloudflare limita cada petición a 100 MB),
 * cada una con hasta 3 reintentos.
 */

const CHUNK_SIZE = 20 * 1024 * 1024;
const MAX_ATTEMPTS = 3;
const RETRY_DELAY_MS = 1000;
const ENDPOINT = '/api/admin/upload-chunk';

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

export class ChunkedUploader {
  /**
   * @param {File} file
   * @param {Object} fields - metadatos que acompañan cada parte (type, showId, title…)
   * @param {Function} onProgress - ({ index, total, percent }) => void
   */
  constructor(file, fields, onProgress = () => {}) {
    this.file = file;
    this.fields = fields;
    this.onProgress = onProgress;
    this.total = Math.ceil(file.size / CHUNK_SIZE);
    this.uploadId = `up_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
  }

  /** Sube todas las partes. Devuelve la respuesta de la última (completed: true). */
  async upload() {
    let last = null;
    for (let index = 0; index < this.total; index++) {
      this.onProgress({ index, total: this.total, percent: Math.round((index / this.total) * 100) });
      last = await this.sendWithRetry(index);
    }
    return last;
  }

  async sendWithRetry(index) {
    let lastError = null;
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      try {
        return await this.send(index);
      } catch (err) {
        lastError = err;
        console.warn(`[Upload] Reintentando parte ${index + 1} (intento ${attempt}/${MAX_ATTEMPTS})...`, err);
        await sleep(RETRY_DELAY_MS);
      }
    }
    throw new Error(`Fallo al subir la parte ${index + 1}: ${lastError ? lastError.message : 'Error de red'}`);
  }

  async send(index) {
    const start = index * CHUNK_SIZE;
    const form = new FormData();
    form.append('chunk', this.file.slice(start, Math.min(this.file.size, start + CHUNK_SIZE)), this.file.name);
    form.append('uploadId', this.uploadId);
    form.append('chunkIndex', index);
    form.append('totalChunks', this.total);
    form.append('originalFilename', this.file.name);
    for (const [key, value] of Object.entries(this.fields)) form.append(key, value);

    const res = await fetch(ENDPOINT, { method: 'POST', body: form });
    if (!res.ok) throw new Error(`Servidor respondió con código ${res.status}`);
    return res.json();
  }
}
