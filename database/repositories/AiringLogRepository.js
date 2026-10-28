/**
 * Home Channel HLS - Historial de lo que salió al aire (series): estreno, repetición, maratón
 * o capítulo al azar. En memoria se guardan los últimos ~15 días (para maratones y la
 * vista de lo emitido); en Postgres, todo.
 */

const SQL = require('../sql');

const MEMORY_DAYS = 15;
const KINDS = ['premiere', 'repeat', 'marathon', 'random'];

class AiringLogRepository {
  constructor({ store, pg }) {
    this.store = store;
    this.pg = pg;
  }

  get entries() {
    if (!Array.isArray(this.store.data.airingLog)) this.store.data.airingLog = [];
    return this.store.data.airingLog;
  }

  recent() {
    return this.entries;
  }

  /** Registra una emisión. */
  log({ refKey, showId, episodeId, period, kind, airedAt = new Date().toISOString() }) {
    if (!refKey || !showId || !episodeId || !period) return null;
    const entry = { refKey, showId, episodeId, period, kind: KINDS.includes(kind) ? kind : 'repeat', airedAt };
    this.entries.push(entry);
    const cutoff = Date.now() - MEMORY_DAYS * 24 * 3600 * 1000;
    this.store.data.airingLog = this.entries.filter(e => new Date(e.airedAt).getTime() > cutoff);
    this.store.save();
    this.pg.write('insertAiring', SQL.INSERT_AIRING, [refKey, showId, episodeId, period, entry.kind, airedAt]);
    return entry;
  }

  /** Emisiones entre dos fechas (Postgres si está disponible; si no, la memoria). */
  async range(from, to) {
    if (this.pg.available) {
      try {
        return (await this.pg.query(SQL.SELECT_AIRINGS_RANGE, [from, to])).rows;
      } catch (e) {}
    }
    const a = new Date(from).getTime();
    const b = new Date(to).getTime();
    return this.entries.filter(e => { const t = new Date(e.airedAt).getTime(); return t >= a && t < b; });
  }
}

module.exports = AiringLogRepository;
