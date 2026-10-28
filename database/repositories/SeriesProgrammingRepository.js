/**
 * Home Channel HLS - Preferencias de programación de cada serie o grupo de temporadas (saga):
 * franja, frecuencia (diaria/semanal), orden (en orden/al azar), máximo de emisiones
 * por día, maratón de fin de semana y exclusión.
 */

const SQL = require('../sql');

const DEFAULTS = { franja: 'auto', frequency: 'auto', order: 'auto', maxDaily: null, marathon: true, excluded: false };
const VALID = {
  franja: ['auto', 'manana', 'tarde', 'prime', 'noche', 'madrugada'],
  frequency: ['auto', 'daily', 'weekly'],
  order: ['auto', 'sequential', 'random']
};

class SeriesProgrammingRepository {
  constructor({ store, pg }) {
    this.store = store;
    this.pg = pg;
  }

  get list() {
    if (!Array.isArray(this.store.data.programmingSeries)) this.store.data.programmingSeries = [];
    return this.store.data.programmingSeries;
  }

  /** Preferencias de todas las sagas configuradas: { sagaKey: {...} }. */
  all() {
    return Object.fromEntries(this.list.map(s => [s.sagaKey, { ...DEFAULTS, ...s }]));
  }

  get(sagaKey) {
    return { ...DEFAULTS, sagaKey, ...(this.list.find(s => s.sagaKey === sagaKey) || {}) };
  }

  /** Actualiza solo los campos recibidos (validados). */
  update(sagaKey, patch = {}) {
    const current = this.get(sagaKey);
    for (const [field, allowed] of Object.entries(VALID)) {
      if (patch[field] !== undefined && !allowed.includes(patch[field])) throw new Error(`Valor inválido para ${field}: ${patch[field]}`);
    }
    const next = { ...current };
    for (const field of ['franja', 'frequency', 'order', 'marathon', 'excluded']) {
      if (patch[field] !== undefined) next[field] = patch[field];
    }
    if (patch.maxDaily !== undefined) {
      const n = patch.maxDaily === null || patch.maxDaily === '' ? null : parseInt(patch.maxDaily, 10);
      if (n !== null && (isNaN(n) || n < 1 || n > 6)) throw new Error('Máximo de emisiones por día inválido (1-6)');
      next.maxDaily = n;
    }
    next.marathon = !!next.marathon;
    next.excluded = !!next.excluded;
    next.updatedAt = new Date().toISOString();

    const idx = this.list.findIndex(s => s.sagaKey === sagaKey);
    if (idx === -1) this.list.push(next);
    else this.list[idx] = next;
    this.store.save();
    this.pg.write('upsertProgrammingSeries', SQL.UPSERT_PROGRAMMING_SERIES,
      [sagaKey, next.franja, next.frequency, next.order, next.maxDaily, next.marathon, next.excluded]);
    return next;
  }
}

module.exports = SeriesProgrammingRepository;
module.exports.DEFAULTS = DEFAULTS;
module.exports.VALID = VALID;
