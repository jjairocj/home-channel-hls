/**
 * Home Channel HLS - Rotación de comerciales inteligente y prevención de duplicaciones.
 *
 * Características:
 *   1. Separación configurable (Cooldown): evita que el mismo comercial vuelva a salir
 *      antes de N bloques (ej. 6 bloques = 3 horas). Si no se especifica o el catálogo
 *      es pequeño, garantiza separación mínima entre bloques contiguos.
 *   2. Prevención de saturación: límite opcional de comerciales por tanda (maxSpotsPerBreak),
 *      evitando que bloques con episodios cortos quemen 15 comerciales seguidos.
 *   3. Balance equitativo y envejecimiento proporcional:
 *      - 'high': envejece 2x más rápido (sale ~2 veces más frecuente)
 *      - 'normal': frecuencia estándar (1x)
 *      - 'low': envejece a 1/3 (sale ~3 veces menos)
 *      - 'very_low': envejece a 1/6 (sale ~6 veces menos)
 *      - 'paused': no sale nunca (peso 0)
 *   4. Persistencia: almacena contadores de emisión (airCount) y fecha de última emisión
 *      (lastAiredAt) para no perder el estado tras reiniciar el servidor.
 */

const MIN_BUDGET = 15;
const OLDEST_SHARE = 1 / 3;

const ROTATION_WEIGHTS = {
  high: 2,
  normal: 1,
  low: 1 / 3,
  very_low: 1 / 6,
  paused: 0
};

const DEFAULT_CONFIG = {
  minSeparationBlocks: 1, // 1 por defecto (retrocompatible con tests); en producción se configura a 4 o 6
  maxSpotsPerBreak: 0,    // 0 = sin tope artificial
  rotationMode: 'smart_balanced'
};

class CommercialRotation {
  /**
   * @param {Function} getCommercials - lista actual de comerciales
   * @param {Object} [options]
   */
  constructor(getCommercials, options = {}) {
    this.getCommercials = getCommercials;
    this.block = 0;
    this.seq = 0;
    /** id -> { seq, block, after, airedAt } */
    this.history = new Map();
    /** id -> { airCount: number, lastAiredAt: string, lastBlock: number } */
    this.stats = {};
    this.config = { ...DEFAULT_CONFIG, ...(options.config || {}) };
    this.onAired = options.onAired || null;
    if (options.stats) this.loadStats(options.stats);
  }

  loadStats(stats = {}) {
    if (!stats || typeof stats !== 'object') return;
    this.stats = { ...stats };
    for (const [id, s] of Object.entries(this.stats)) {
      if (s && s.lastBlock != null) {
        this.history.set(id, {
          seq: s.airCount || 0,
          block: s.lastBlock,
          after: null,
          airedAt: s.lastAiredAt
        });
      }
    }
  }

  loadConfig(config = {}) {
    if (!config || typeof config !== 'object') return;
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  exportStats() {
    return { ...this.stats };
  }

  exportConfig() {
    return { ...this.config };
  }

  resetStats() {
    this.stats = {};
    this.history.clear();
    this.seq = 0;
  }

  nextBlock() {
    this.block++;
  }

  getMinSeparationBlocks() {
    const configured = parseInt(this.config && this.config.minSeparationBlocks, 10);
    if (!configured || configured <= 1) return 1;
    const list = (this.getCommercials() || []).filter(c => c.duration > 0 && c.rotation !== 'paused');
    if (!list.length) return 1;
    // Si el catálogo es menor que configured * 4, limitar para evitar sequía
    const maxSustain = Math.max(1, Math.floor(list.length / 4));
    return Math.min(configured, maxSustain);
  }

  getMaxSpotsPerBreak() {
    return Math.max(0, parseInt(this.config && this.config.maxSpotsPerBreak, 10) || 0);
  }

  lastSeq(c) {
    const h = this.history.get(c.id);
    return h ? h.seq : -1;
  }

  airCount(c) {
    return (this.stats[c.id] && this.stats[c.id].airCount) || 0;
  }

  /**
   * Orden de prioridad: la última emisión, corregida por la rotación. Un comercial en
   * rotación baja "envejece" a un tercio de velocidad, así sale ~3 veces menos.
   */
  priorityKey(c) {
    const weight = ROTATION_WEIGHTS[c.rotation] != null ? ROTATION_WEIGHTS[c.rotation] : 1;
    if (weight <= 0) return Infinity;
    return this.seq - (this.seq - this.lastSeq(c)) * weight;
  }

  airedInPreviousBlock(c) {
    const h = this.history.get(c.id);
    return !!h && h.block >= this.block - 1;
  }

  isCoolingDown(c) {
    const minBlocks = this.getMinSeparationBlocks();
    if (minBlocks <= 1) return this.airedInPreviousBlock(c);
    const h = this.history.get(c.id);
    if (!h || h.block == null) return false;
    return (this.block - h.block) < minBlocks;
  }

  airedRecently(c) {
    return this.isCoolingDown(c);
  }

  /**
   * Elige entre los candidatos: separación con cooldown, sin repetir pares,
   * el más atrasado si es el primero de la tanda y, si no, al azar entre los menos recientes.
   */
  choose(candidates, previousId, firstOfBreak) {
    const prefer = (list, keep) => {
      const filtered = list.filter(keep);
      return filtered.length ? filtered : list;
    };

    // 1. Preferir primero los que respetan el cooldown configurado
    let pool = prefer(candidates, c => !this.isCoolingDown(c));

    // 2. Si el cooldown completo no es posible, garantizar que no repite del bloque contiguo
    pool = prefer(pool, c => !this.airedInPreviousBlock(c));

    // 3. Evitar repetir el mismo comercial consecutivo en el par
    pool = prefer(pool, c => !previousId || (this.history.get(c.id) || {}).after !== previousId);

    // 4. Ordenar por priorityKey (menos reciente primero según rotación)
    pool.sort((a, b) => this.priorityKey(a) - this.priorityKey(b));

    if (firstOfBreak) return pool[0];

    const size = Math.max(1, Math.ceil(pool.length * OLDEST_SHARE));
    return pool[Math.floor(Math.random() * size)];
  }

  recordLiveAiring(item) {
    if (!item || !item.id) return;
    const nowIso = new Date().toISOString();
    const current = this.stats[item.id] || { airCount: 0, lastAiredAt: null, lastBlock: this.block };
    this.stats[item.id] = {
      airCount: (current.airCount || 0) + 1,
      lastAiredAt: nowIso,
      lastBlock: this.block
    };
    this.history.set(item.id, {
      seq: ++this.seq,
      block: this.block,
      after: null,
      airedAt: nowIso
    });
  }

  recordPlanAiring(item, previousId) {
    const nowIso = new Date().toISOString();
    const current = this.stats[item.id] || { airCount: 0, lastAiredAt: null, lastBlock: this.block };
    this.stats[item.id] = {
      airCount: current.airCount || 0,
      lastAiredAt: current.lastAiredAt,
      lastBlock: this.block
    };
    this.history.set(item.id, {
      seq: ++this.seq,
      block: this.block,
      after: previousId,
      airedAt: nowIso
    });
    if (this.onAired) {
      try { this.onAired(item, this.stats[item.id]); } catch (e) {}
    }
  }

  pick(budgetSeconds, usedInBlock = new Set(), options = {}) {
    const commercials = (this.getCommercials() || []).filter(c => c.duration > 0 && c.rotation !== 'paused');
    if (!commercials.length || budgetSeconds < MIN_BUDGET) return [];

    const maxSpots = options.maxSpots != null ? options.maxSpots : this.getMaxSpotsPerBreak();
    const selected = [];
    let budget = budgetSeconds;
    let lastId = null;

    while (budget >= MIN_BUDGET) {
      if (maxSpots > 0 && selected.length >= maxSpots) break;

      const fits = commercials.filter(c => c.duration <= budget);
      let candidates = fits.filter(c => !usedInBlock.has(c.id));
      if (!candidates.length) candidates = fits.filter(c => c.id !== lastId);
      if (!candidates.length) break;

      const c = this.choose(candidates, lastId, selected.length === 0);
      selected.push(c);
      usedInBlock.add(c.id);
      this.recordPlanAiring(c, lastId);
      budget -= c.duration;
      lastId = c.id;
    }
    return selected;
  }
}

module.exports = CommercialRotation;
module.exports.ROTATION_WEIGHTS = ROTATION_WEIGHTS;
module.exports.DEFAULT_CONFIG = DEFAULT_CONFIG;
