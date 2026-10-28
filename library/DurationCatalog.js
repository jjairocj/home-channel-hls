/**
 * Home Channel HLS - Catálogo de duraciones exactas (ffprobe) con caché en disco.
 *
 * Los bloques de 30 min se cuadran con estas duraciones: si una duración está mal,
 * el "ahora al aire" se adelanta al video y la emisión se desfasa del reloj.
 *
 * - get(): duración conocida (caché) o 0; lo desconocido se mide en segundo plano.
 * - audit(): vuelve a medir las entradas sospechosas (segundos enteros, típicamente
 *   copiadas de la base de datos por versiones anteriores) y corrige las que difieren.
 *
 * Las mediciones en segundo plano van en fila, de a MAX_PROBES a la vez: con la caché
 * vacía hay miles de archivos por medir y lanzarlos juntos tumbó el servidor (memoria
 * agotada). La caché se escribe de forma atómica (archivo temporal + rename) y se
 * guarda una copia: con el disco lleno el archivo quedaba vacío.
 */

const fs = require('fs');
const path = require('path');
const ffmpeg = require('../lib/ffmpeg');

const SAVE_DELAY_MS = 3000;
/** ffprobe simultáneos para las mediciones en segundo plano. */
const MAX_PROBES = 2;
/** Diferencia a partir de la cual una duración se considera mal registrada. */
const MISMATCH_SECONDS = 0.5;

class DurationCatalog {
  /**
   * @param {Object} opts
   * @param {string} opts.cacheFile - ruta del JSON de caché
   * @param {Function} [opts.onMeasured] - se llama tras medir archivos nuevos (para re-escanear)
   */
  constructor({ cacheFile, onMeasured } = {}) {
    this.cacheFile = cacheFile;
    this.onMeasured = onMeasured || (() => {});
    this.cache = null;
    this.probing = new Set();
    this.probeQueue = [];
    this.activeProbes = 0;
    this.measuredInBatch = false;
    this.saveTimer = null;
    this.auditRunning = false;
  }

  load() {
    if (this.cache) return;
    this.cache = new Map();
    if (!this.cacheFile) return;
    // Si la caché está vacía o dañada, se usa la copia anterior
    for (const file of [this.cacheFile, `${this.cacheFile}.bak`]) {
      try {
        const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
        for (const [k, v] of Object.entries(raw)) this.cache.set(k, v);
        if (this.cache.size) return;
      } catch (e) {}
    }
  }

  saveSoon() {
    if (!this.cacheFile || this.saveTimer) return;
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null;
      this.writeCache().catch((e) => console.warn('[Duraciones] No se pudo guardar la caché:', e.message));
    }, SAVE_DELAY_MS);
  }

  /**
   * Escritura atómica: si falla (disco lleno) queda la caché anterior intacta. Antes de
   * reemplazarla se guarda una copia (.bak) de la que estaba bien.
   */
  async writeCache() {
    const json = JSON.stringify(Object.fromEntries(this.cache.entries()));
    const tmp = `${this.cacheFile}.tmp`;
    await fs.promises.mkdir(path.dirname(this.cacheFile), { recursive: true });
    await fs.promises.writeFile(tmp, json, 'utf8');
    try {
      if ((await fs.promises.stat(this.cacheFile)).size > 2) await fs.promises.copyFile(this.cacheFile, `${this.cacheFile}.bak`);
    } catch (e) {}
    await fs.promises.rename(tmp, this.cacheFile);
  }

  /** Duración en caché (0 si no se conoce). */
  cached(filePath) {
    this.load();
    return this.cache.get(filePath) || 0;
  }

  set(filePath, seconds) {
    this.load();
    this.cache.set(filePath, seconds);
    this.saveSoon();
  }

  /** Duración exacta si ya se midió; si no, `fallback`. */
  precise(filePath, fallback) {
    const v = this.cached(filePath);
    return v > 0 ? v : fallback;
  }

  /**
   * Duración para el escaneo: caché, o la de la base mientras se mide en segundo plano.
   * Devuelve 0 si no se conoce (el archivo entra en el siguiente escaneo).
   */
  resolve(filePath, dbDuration = 0) {
    const v = this.cached(filePath);
    if (v > 0) return v;
    this.measureInBackground(filePath);
    return dbDuration > 0 ? dbDuration : 0;
  }

  measureInBackground(filePath) {
    if (this.probing.has(filePath)) return;
    this.probing.add(filePath);
    this.probeQueue.push(filePath);
    this.pumpProbes();
  }

  /** Mide la fila de a MAX_PROBES archivos, con prioridad baja. */
  pumpProbes() {
    while (this.activeProbes < MAX_PROBES && this.probeQueue.length) {
      const filePath = this.probeQueue.shift();
      this.activeProbes++;
      ffmpeg.probeDuration(filePath, 15000, true).then((sec) => {
        if (!(sec > 0)) return;
        this.set(filePath, sec);
        this.measuredInBatch = true;
      }).finally(() => {
        this.activeProbes--;
        this.probing.delete(filePath);
        // Re-escanear solo si se midió algo (un archivo que falla no provoca un bucle)
        if (this.probing.size === 0 && this.measuredInBatch) {
          this.measuredInBatch = false;
          this.onMeasured();
        }
        this.pumpProbes();
      });
    }
  }

  /**
   * Revisa la caché: vuelve a medir con ffprobe (de a uno, en segundo plano) las
   * entradas con segundos enteros y corrige las que no coinciden.
   * @param {string[]} paths - archivos a revisar
   * @returns {Promise<Array<{path, before, after}>>} correcciones aplicadas
   */
  async audit(paths) {
    if (this.auditRunning) return [];
    this.auditRunning = true;
    this.load();
    const fixes = [];
    let touched = false;
    try {
      for (const p of paths) {
        const before = this.cache.get(p);
        if (before > 0 && !Number.isInteger(before)) continue;
        if (!fs.existsSync(p)) continue;
        const real = await ffmpeg.probeDuration(p, 20000, true);
        if (!(real > 0)) continue;
        // Se guarda siempre la medición precisa: así no se vuelve a revisar
        this.cache.set(p, real);
        touched = true;
        if (!before || Math.abs(real - before) > MISMATCH_SECONDS) fixes.push({ path: p, before: before || 0, after: real });
      }
      if (touched) this.saveSoon();
    } finally {
      this.auditRunning = false;
    }
    return fixes;
  }
}

module.exports = DurationCatalog;
module.exports.MAX_PROBES = MAX_PROBES;
