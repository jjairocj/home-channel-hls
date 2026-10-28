/**
 * Home Channel HLS - Servicio de la parrilla por reglas (Fachada).
 *
 * - Altas, cambios y bajas de reglas. Editar una regla automática la vuelve manual:
 *   la propuesta automática es una sugerencia y lo que el administrador ajusta se respeta.
 * - La regla que se guarda reemplaza lo que había en esos horarios: las reglas que
 *   quedan debajo se recortan (o se borran si quedan cubiertas del todo), así no hay
 *   programas "escondidos" bajo otro.
 * - Compila las reglas en la grilla que usa la emisión y programa el recálculo en el
 *   próximo :00/:30 (sin cortar el programa en curso).
 * - Vista semanal para el panel: celdas con su serie, regla, tipo (estreno, repetición,
 *   maratón, al azar, cierre) y conflictos.
 * - Migra una sola vez la configuración anterior (grilla en JSON, candados, perfiles e
 *   historial de estrenos) a las tablas del programador.
 */

const { DAY_KEYS } = require('../core/time');
const { compileRules, cellsToRules, calendarToBroadcast, ruleCellKeys, subtractCells, precedence, BROADCAST_TIMES } = require('./rules/RuleCompiler');
const { sagaSummary, sagaKeyOf } = require('./proposal');
const { loadProfiles, PROFILES_KEY } = require('./profiles');
const { isOffAirTime } = require('./constants');

const MIGRATED_KEY = 'programmer_migrated';
const WEEKEND = ['saturday', 'sunday'];

class ScheduleService {
  /**
   * @param {Object} deps
   * @param {Object} deps.db
   * @param {Object} [deps.scheduler] - para invalidar la guía
   * @param {Object} [deps.playout] - para recalcular la emisión
   */
  constructor({ db, scheduler = null, playout = null }) {
    this.db = db;
    this.scheduler = scheduler;
    this.playout = playout;
  }

  get repo() {
    return this.db.programming.rules;
  }

  queueCounts() {
    const counts = {};
    for (const j of this.db.getTranscodeJobs() || []) {
      if ((j.status === 'pending' || j.status === 'processing') && j.showId) counts[j.showId] = (counts[j.showId] || 0) + 1;
    }
    return counts;
  }

  /** Series (sagas) con su estado y preferencias. */
  context() {
    const profiles = loadProfiles(this.db);
    return { profiles, ...sagaSummary({ shows: this.db.getShows() || [], profiles, queueCounts: this.queueCounts() }) };
  }

  compile() {
    return compileRules(this.repo.all());
  }

  /**
   * Aplica las reglas a la emisión: grilla compilada + recálculo en el próximo bloque.
   * @returns {string|null} hora en que entra el cambio
   */
  apply(reason = 'Parrilla actualizada') {
    const { calendarGrid } = this.compile();
    this.db.updateScheduleConfig({ mode: 'weekly', weeklyGrid: calendarGrid });
    if (this.scheduler) this.scheduler.invalidateGuide();
    return this.playout ? this.playout.requestResync(reason) : null;
  }

  /* ---------- Reglas ---------- */

  /**
   * Recorta las demás reglas que pisan los horarios de `rule` (la recién guardada
   * gana). Las que quedan cubiertas del todo se borran; las demás conservan lo que no
   * se pisa, partidas en tramos si hace falta.
   * @param {Set<string>} [protect] - ids que no se tocan (p. ej. del mismo lote)
   * @returns {number} reglas afectadas
   */
  replaceUnder(rule, protect = new Set()) {
    if (!rule || rule.enabled === false) return 0;
    const covered = ruleCellKeys(rule);
    let affected = 0;
    for (const other of [...this.repo.all()]) {
      if (other.id === rule.id || protect.has(other.id) || other.enabled === false) continue;
      const rest = subtractCells(other, covered);
      if (!rest) continue;
      this.repo.delete(other.id);
      rest.forEach(part => this.repo.create(part));
      affected++;
    }
    return affected;
  }

  /**
   * Limpia los choques que ya existen: deja lo que hoy sale al aire (la regla que
   * gana en cada horario) y quita lo que está debajo.
   * @returns {{ affected: number, resyncAt: string|null }}
   */
  resolveConflicts() {
    const taken = new Set();
    let affected = 0;
    const ordered = this.repo.all().filter(r => r.enabled !== false).sort(precedence);
    for (const rule of ordered) {
      const rest = subtractCells(rule, taken);
      if (rest) {
        this.repo.delete(rule.id);
        rest.map(part => this.repo.create(part)).forEach(part => ruleCellKeys(part).forEach(k => taken.add(k)));
        affected++;
      } else {
        ruleCellKeys(rule).forEach(k => taken.add(k));
      }
    }
    return { affected, resyncAt: affected ? this.apply('Choques de la parrilla resueltos') : null };
  }

  create(input) {
    const rule = this.repo.create({ ...input, source: 'manual' });
    const replaced = this.replaceUnder(rule);
    return { rule, replaced, resyncAt: this.apply('Regla nueva en la parrilla') };
  }

  update(id, patch) {
    // Ajustar una sugerencia automática la adopta como manual
    const rule = this.repo.update(id, { ...patch, source: 'manual' });
    if (!rule) throw new Error('Regla no encontrada');
    const replaced = this.replaceUnder(rule);
    return { rule, replaced, resyncAt: this.apply('Regla de la parrilla modificada') };
  }

  remove(id) {
    const rule = this.repo.delete(id);
    if (!rule) throw new Error('Regla no encontrada');
    return { rule, resyncAt: this.apply('Regla de la parrilla eliminada') };
  }

  /**
   * Varios cambios a la vez (p. ej. arrastrar un bloque), con un solo recálculo.
   * @param {Array<{op: 'create'|'update'|'delete', id?, rule?}>} ops
   */
  batch(ops) {
    const results = [];
    const saved = [];
    for (const op of ops || []) {
      if (op.op === 'create') results.push(this.repo.create({ ...op.rule, source: 'manual' }));
      else if (op.op === 'update') results.push(this.repo.update(op.id, { ...op.rule, source: 'manual' }));
      else if (op.op === 'delete') results.push(this.repo.delete(op.id));
      else throw new Error(`Operación desconocida: ${op.op}`);
      if (op.op !== 'delete' && results[results.length - 1]) saved.push(results[results.length - 1]);
    }
    // Lo movido o creado reemplaza lo que había; las reglas del mismo lote no se pisan entre sí
    const batchIds = new Set(saved.map(r => r.id));
    const replaced = saved.reduce((n, rule) => n + this.replaceUnder(this.repo.find(rule.id), batchIds), 0);
    return { results, replaced, resyncAt: this.apply('Parrilla editada') };
  }

  /* ---------- Vista semanal ---------- */

  /**
   * Tipo de cada celda de serie, como se verá al aire: estreno, repetición, maratón,
   * capítulo al azar o cierre. Diarias: el primer horario del día L-V estrena;
   * semanales: el primero de la semana (L-V); fin de semana: sin estrenos.
   */
  labelCells(cells, sagas, sagaOf) {
    const bySaga = Object.fromEntries(sagas.map(s => [s.key, s]));
    const seenDay = new Set();
    const seenWeek = new Set();
    for (const day of DAY_KEYS) {
      for (const time of BROADCAST_TIMES) {
        const c = cells[`${day}|${time}`];
        if (!c) continue;
        const saga = bySaga[sagaKeyOf(c.target, sagaOf)];
        c.sagaKey = saga ? saga.key : null;
        c.label = c.kind === 'off_air' ? 'Cierre de emisión' : (saga ? saga.label : c.target);
        if (c.kind === 'off_air') c.badge = 'off';
        else if (c.kind === 'marathon') c.badge = 'marathon';
        else if (saga && saga.episodic) c.badge = 'random';
        else if (WEEKEND.includes(day)) c.badge = 'repeat';
        else if (saga && saga.frequency === 'weekly') {
          c.badge = seenWeek.has(saga.key) ? 'repeat' : 'premiere';
          seenWeek.add(saga.key);
        } else {
          const k = `${day}|${c.sagaKey || c.target}`;
          c.badge = seenDay.has(k) ? 'repeat' : 'premiere';
          seenDay.add(k);
        }
      }
    }
    return cells;
  }

  weekView() {
    const { summary, sagaOf } = this.context();
    const { cells, conflicts } = this.compile();
    this.labelCells(cells, summary, sagaOf);
    const shows = this.db.getShows() || [];
    return {
      days: DAY_KEYS,
      times: BROADCAST_TIMES,
      rules: this.repo.all(),
      cells,
      conflicts,
      series: summary.map(s => ({
        key: s.key,
        value: `saga:${s.key}`,
        label: s.label,
        eligible: s.eligible,
        frequency: s.frequency,
        episodic: s.episodic,
        franja: s.franja,
        seasons: s.members.length > 1
          ? s.members.map(m => ({ id: m.id, title: (shows.find(x => x.id === m.id) || {}).title || m.id }))
          : []
      })),
      pendingProposal: this.db.programming.proposals.pending()
    };
  }

  /* ---------- Migración desde la configuración anterior ---------- */

  /**
   * Convierte una sola vez la grilla anterior (JSON por día de calendario), los
   * candados, las preferencias por saga y el historial de estrenos a las tablas
   * nuevas. Las celdas con candado pasan a reglas manuales; el resto, automáticas.
   * La grilla compilada queda igual que la anterior (no cambia la emisión).
   */
  migrateLegacy() {
    if (this.db.getJsonSetting(MIGRATED_KEY, null)) return null;
    const report = { rules: 0, series: 0, airings: 0 };

    if (!this.repo.all().length) {
      const legacy = calendarToBroadcast((this.db.getScheduleConfig() || {}).weeklyGrid || {});
      const locks = calendarToBroadcast(Object.fromEntries(Object.entries(this.db.getJsonSetting('grid_locks', {}) || {})
        .map(([day, times]) => [day, Object.fromEntries(Object.keys(times || {}).filter(t => times[t]).map(t => [t, true]))])));
      const manual = Object.fromEntries(DAY_KEYS.map(d => [d, {}]));
      const auto = Object.fromEntries(DAY_KEYS.map(d => [d, {}]));
      for (const day of DAY_KEYS) {
        for (const [time, value] of Object.entries(legacy[day])) {
          // El cierre nocturno de 01:00 a 05:00 es implícito: no necesita regla
          if (!value || (value === 'off_air' && isOffAirTime(time))) continue;
          (locks[day][time] ? manual : auto)[day][time] = value;
        }
      }
      const manualRules = cellsToRules(manual, 'manual');
      const autoRules = cellsToRules(auto, 'auto');
      manualRules.forEach(r => this.repo.create(r));
      this.repo.replaceAuto(autoRules);
      report.rules = manualRules.length + autoRules.length;
    }

    const profiles = this.db.getJsonSetting(PROFILES_KEY, {}) || {};
    for (const [key, p] of Object.entries(profiles.sagas || {})) {
      try {
        this.db.programming.series.update(key, {
          franja: p.franja && p.franja !== 'excluir' ? p.franja : undefined,
          excluded: p.franja === 'excluir' ? true : undefined,
          order: p.order,
          frequency: p.frequency
        });
        report.series++;
      } catch (e) {
        console.warn(`[Programador] Preferencias de ${key} no migradas:`, e.message);
      }
    }

    const records = this.db.getJsonSetting('daily_airings', {}) || {};
    for (const [refKey, record] of Object.entries(records)) {
      const history = Array.isArray(record.history) ? record.history : (record.day ? [{ day: record.day, episodes: record.episodes || [] }] : []);
      for (const h of history) {
        for (const e of h.episodes || []) {
          const date = /^\d{4}-\d{2}-\d{2}$/.test(h.day) ? `${h.day}T12:00:00` : new Date().toISOString();
          this.db.programming.airings.log({ refKey, showId: e.showId, episodeId: e.episodeId, period: h.day, kind: 'premiere', airedAt: new Date(date).toISOString() });
          report.airings++;
        }
      }
    }

    this.db.setJsonSetting(MIGRATED_KEY, { at: new Date().toISOString(), ...report });
    console.log(`[Programador] 🔄 Configuración anterior migrada: ${report.rules} reglas, ${report.series} series, ${report.airings} estrenos.`);
    return report;
  }
}

module.exports = ScheduleService;
