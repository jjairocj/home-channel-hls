/**
 * Home Channel - Catálogo de cortinillas (bumpers) por función.
 *
 * Cada función de la emisión se resuelve buscando palabras clave en el nombre o el
 * archivo del bumper. Las reglas son datos (tabla ROLE_KEYWORDS), no una cadena de ifs.
 */

/** Palabras clave por función. El primer bumper que coincide se usa. */
const ROLE_KEYWORDS = {
  break_in: ['estas viendo'],              // "Estás viendo // Home Channel" → ir a comerciales
  break_out: ['a continuacion', 'continuacion'], // "A continuación" → volver / siguiente bloque
  outro: ['a continuacion', 'continuacion'],
  intro: ['animestation', 'station id', 'station_id', 'intro'], // apertura de bloque
  sync_pad: ['sincronizador', 'ident'],   // relleno hasta el :00/:30
  signoff: ['cierre', 'nocturno'],         // cierre de emisión nocturno
  cierre_emision: ['cierre', 'nocturno']
};

/** Funciones que, si no encuentran su bumper, usan cualquiera que no sea de cierre. */
const FALLBACK_TO_REGULAR = new Set(['break_in', 'break_out', 'outro']);

const normalize = (str) => String(str || '')
  .normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '');

const textOf = (b) => `${normalize(b.name || b.title)} ${normalize(b.filename)}`;
const isSignoff = (b) => textOf(b).includes('cierre');

class BumperCatalog {
  /** @param {Function} getBumpers - devuelve la lista actual de bumpers de la mediateca */
  constructor(getBumpers) {
    this.getBumpers = getBumpers;
    this.historyByRole = new Map();
  }

  list() {
    return this.getBumpers() || [];
  }

  /** Bumpers comunes (no de cierre, ni Station ID, ni transiciones con locución) entre minDur y maxDur segundos. */
  regular({ minDur = 0, maxDur = Infinity, excludeKeywords = [] } = {}) {
    const defaultExcluded = [
      'cierre', 'nocturno',
      'animestation', 'station id', 'station_id', 'intro',
      'estas viendo',
      'a continuacion', 'continuacion',
      'sincronizador', 'ident'
    ];
    const excluded = [...defaultExcluded, ...excludeKeywords].map(normalize);
    return this.list().filter(b => !isSignoff(b) &&
      b.duration >= minDur && b.duration <= maxDur &&
      !excluded.some(k => textOf(b).includes(k)));
  }

  /**
   * Bumper para una función de la emisión (ver ROLE_KEYWORDS). Sin función conocida,
   * devuelve uno común al azar con rotación y anti-repetición.
   */
  forRole(role, { exclude = [] } = {}) {
    const bumpers = this.list();
    if (!bumpers.length) return null;

    const excludeSet = new Set(exclude instanceof Set ? exclude : (Array.isArray(exclude) ? exclude : []));

    const keys = ROLE_KEYWORDS[role];
    if (!keys) {
      const regular = bumpers.filter(b => !isSignoff(b) && !excludeSet.has(b.id) && !excludeSet.has(b.filename));
      const pool = regular.length ? regular : bumpers.filter(b => !isSignoff(b));
      return pool.length ? pool[Math.floor(Math.random() * pool.length)] : bumpers[0];
    }

    const wanted = keys.map(normalize);
    const matches = bumpers.filter(b => wanted.some(k => textOf(b).includes(k)));
    if (!matches.length) {
      if (FALLBACK_TO_REGULAR.has(role)) {
        const regular = bumpers.filter(b => !isSignoff(b) && !excludeSet.has(b.id) && !excludeSet.has(b.filename));
        const pool = regular.length ? regular : bumpers.filter(b => !isSignoff(b));
        return pool.length ? pool[Math.floor(Math.random() * pool.length)] : bumpers[0];
      }
      return bumpers[0];
    }

    // 1. Filtrar los explícitamente excluidos (ej. usados en el mismo bloque / tanda)
    let candidates = matches.filter(b => !excludeSet.has(b.id) && !excludeSet.has(b.filename));
    if (!candidates.length) candidates = matches;

    // 2. Anti-repetición consecutiva: recordar últimos N emitidos por rol
    if (!this.historyByRole.has(role)) this.historyByRole.set(role, []);
    const history = this.historyByRole.get(role);

    const maxMemory = Math.max(1, candidates.length - 1);
    let fresh = candidates.filter(b => !history.includes(b.id) && !history.includes(b.filename));
    if (!fresh.length) {
      fresh = candidates;
      this.historyByRole.set(role, []);
    }

    const selected = fresh[Math.floor(Math.random() * fresh.length)];
    const histKey = selected.id || selected.filename;
    this.historyByRole.get(role).push(histKey);
    while (this.historyByRole.get(role).length > maxMemory) {
      this.historyByRole.get(role).shift();
    }

    return selected;
  }
}

module.exports = BumperCatalog;
