/**
 * Home Channel HLS - Programación asistida: preferencias por serie, grupos de temporadas,
 * propuestas automáticas y revisión periódica.
 *
 * La propuesta automática es una SUGERENCIA de reglas: al aceptarla reemplaza solo las
 * reglas automáticas; las manuales del administrador nunca se tocan (ver ScheduleService).
 */

const { FRANJAS, MIN_READY_EPISODES, franjaSlots } = require('./constants');
const { detectSagas, slugify } = require('./sagas');
const { buildRuleProposal, applyStats } = require('./proposal');
const { compileRules } = require('./rules/RuleCompiler');
const { loadProfiles, PROFILES_KEY } = require('./profiles');

/**
 * Versión del algoritmo de reparto. Al cambiarla, la revisión automática deja una
 * propuesta nueva aunque las series no hayan cambiado.
 */
const ALGORITHM_VERSION = 'reglas-1';
const SIGNATURE_KEY = 'grid_proposal_signature';

class ProgrammingManager {
  /**
   * @param {Object} deps
   * @param {Object} deps.db
   * @param {import('./ScheduleService')} deps.schedule
   */
  constructor({ db, schedule }) {
    this.db = db;
    this.schedule = schedule;
  }

  getProfiles() {
    return loadProfiles(this.db);
  }

  /** Grupos de temporadas y marcas por serie (siguen en app_settings). */
  legacyProfiles() {
    const p = this.db.getJsonSetting(PROFILES_KEY, {}) || {};
    return { ...p, shows: p.shows || {}, groups: p.groups || {} };
  }

  buildProposal() {
    const rules = this.db.programming.rules.all();
    return buildRuleProposal({
      shows: this.db.getShows() || [],
      profiles: this.getProfiles(),
      queueCounts: this.schedule.queueCounts(),
      manualRules: rules.filter(r => r.source === 'manual'),
      currentRules: rules
    });
  }

  /** Vista del panel: series con su estado, preferencias y emisiones actuales. */
  overview() {
    const preview = this.buildProposal();
    // Emisiones por semana con las reglas vigentes
    const ctx = this.schedule.context();
    applyStats(ctx.summary, this.schedule.compile().cells, ctx.sagaOf);
    const currentByKey = Object.fromEntries(ctx.summary.map(s => [s.key, s]));
    const series = this.db.programming.series.all();
    const pending = this.db.programming.proposals.pending();
    const episodicRecords = (this.db && this.db.getJsonSetting && this.db.getJsonSetting('episodic_cycle_progress', {})) || {};
    return {
      franjas: Object.fromEntries(Object.entries(FRANJAS).map(([k, f]) => [k, { label: f.label, slots: franjaSlots(k).length }])),
      minReady: MIN_READY_EPISODES,
      sagas: preview.sagas.map(s => {
        const cur = currentByKey[s.key] || {};
        const prefs = series[s.key] || {};
        let episodicProgress = null;
        if (s.episodic) {
          const epRec = episodicRecords[`saga:${s.key}`] || episodicRecords[s.key] || {};
          const totalEp = (s.members || []).reduce((acc, m) => acc + ((m.episodes && m.episodes.length) || 0), 0) || s.remaining || 0;
          const seenIds = epRec.seenEpisodeIds || [];
          const seenCount = seenIds.length;
          episodicProgress = {
            cycle: Math.max(1, epRec.cycle || 1),
            totalEpisodes: totalEp,
            seenCount,
            remainingCount: Math.max(0, totalEp - seenCount),
            percent: totalEp > 0 ? Math.round((seenCount / totalEp) * 100) : 0,
            lastAiredAt: epRec.lastAiredAt || null
          };
        }
        return {
          ...s,
          // Lo que hay hoy al aire (la propuesta se ve en su propia vista)
          slotsPerWeek: cur.slotsPerWeek || 0,
          premiereDays: cur.premiereDays || 0,
          marathonSlots: cur.marathonSlots || 0,
          weeksLeft: cur.weeksLeft === undefined ? s.weeksLeft : cur.weeksLeft,
          proposedSlotsPerWeek: s.slotsPerWeek,
          maxDailyChoice: prefs.maxDaily === undefined ? null : prefs.maxDaily,
          marathonChoice: prefs.marathon !== false,
          episodicProgress
        };
      }),
      pending: pending ? { id: pending.id, createdAt: pending.createdAt, reason: pending.reason, changes: (pending.summary || []).length, warnings: pending.warnings } : null
    };
  }

  /* ---------- Propuestas ---------- */

  /** Genera y guarda una propuesta pendiente (reglas automáticas sugeridas). */
  propose(reason = 'Generada manualmente') {
    const proposal = this.buildProposal();
    const record = this.db.programming.proposals.save({
      id: `prop_${Date.now()}`,
      createdAt: new Date().toISOString(),
      reason,
      rules: proposal.rules,
      warnings: proposal.warnings,
      summary: proposal.changes
    });
    this.db.setJsonSetting(SIGNATURE_KEY, this.signature());
    return {
      ...record,
      changes: proposal.changes,
      grid: proposal.grid,
      cells: proposal.cells,
      sagas: proposal.sagas.map(s => ({ key: s.key, label: s.label, slotsPerWeek: s.slotsPerWeek, premiereDays: s.premiereDays, marathonSlots: s.marathonSlots, episodic: s.episodic, frequency: s.frequency, weeksLeft: s.weeksLeft, current: s.current }))
    };
  }

  /** La propuesta pendiente con su vista previa (reglas manuales + sugeridas). */
  getProposal() {
    const p = this.db.programming.proposals.pending();
    if (!p) return null;
    const manual = this.db.programming.rules.all().filter(r => r.source === 'manual');
    const { cells } = compileRules([...manual, ...p.rules.map((r, i) => ({ ...r, id: `prop_${i}`, source: 'auto' }))]);
    const ctx = this.schedule.context();
    this.schedule.labelCells(cells, ctx.summary, ctx.sagaOf);
    applyStats(ctx.summary, cells, ctx.sagaOf);
    const sagas = ctx.summary
      .filter(s => s.slotsPerWeek || s.marathonSlots)
      .map(s => ({ key: s.key, label: s.label, current: s.current, slotsPerWeek: s.slotsPerWeek, daysPerWeek: s.daysPerWeek, premiereDays: s.premiereDays, marathonSlots: s.marathonSlots, episodic: s.episodic, frequency: s.frequency, weeksLeft: s.weeksLeft }));
    return { ...p, changes: p.summary || [], cells, sagas };
  }

  accept(proposalId) {
    const p = this.db.programming.proposals.pending();
    if (!p || (proposalId && p.id !== proposalId)) throw new Error('No hay una propuesta pendiente con ese id.');
    this.db.programming.rules.replaceAuto(p.rules);
    this.db.programming.proposals.decide(p.id, 'accepted');
    return this.schedule.apply('Propuesta de parrilla aceptada');
  }

  discard() {
    const p = this.db.programming.proposals.pending();
    if (p) this.db.programming.proposals.decide(p.id, 'discarded');
  }

  /* ---------- Preferencias por serie ---------- */

  /**
   * @param {string} sagaKey
   * @param {{ franja?, order?, frequency?, maxDaily?, marathon?, excluded? }} opts
   *   franja 'excluir' equivale a excluded: true
   */
  setSagaOptions(sagaKey, opts = {}) {
    const patch = { ...opts };
    if (patch.franja === 'excluir') {
      patch.excluded = true;
      delete patch.franja;
    } else if (patch.franja !== undefined) {
      patch.excluded = false;
    }
    return this.db.programming.series.update(sagaKey, patch);
  }

  /* ---------- Grupos de temporadas ---------- */

  /**
   * Agrupación manual de una serie.
   * @param {string} showId
   * @param {{ group?: string, newGroupLabel?: string, order?: number|null }} opts
   *   group: 'auto' | 'none' | clave de grupo existente; newGroupLabel crea un grupo nuevo.
   */
  async setShowGroup(showId, { group, newGroupLabel, order } = {}) {
    const profiles = this.legacyProfiles();
    const current = { ...(profiles.shows[showId] || {}) };

    if (newGroupLabel && String(newGroupLabel).trim()) {
      const label = String(newGroupLabel).trim().slice(0, 60);
      const key = `grp-${slugify(label)}`;
      profiles.groups[key] = { label };
      current.group = key;
    } else if (group === 'auto' || group === 'none') {
      current.group = group;
    } else if (group) {
      // Unirse a un grupo existente (manual o automático): se fija como grupo manual
      if (!profiles.groups[group]) {
        const saga = detectSagas(this.db.getShows() || [], this.getProfiles()).get(group);
        profiles.groups[group] = { label: saga ? saga.label : group };
      }
      current.group = group;
    }

    if (order === null || order === '') delete current.order;
    else if (order !== undefined && !isNaN(parseInt(order, 10))) current.order = parseInt(order, 10);

    profiles.shows[showId] = current;

    // Limpiar grupos manuales que quedaron vacíos
    const used = new Set(Object.values(profiles.shows).map(f => f.group));
    for (const key of Object.keys(profiles.groups)) if (!used.has(key)) delete profiles.groups[key];

    await this.db.setJsonSetting(PROFILES_KEY, profiles);
    return this.groupsOverview();
  }

  /** Series con su grupo actual y la lista de grupos disponibles (para la interfaz). */
  groupsOverview() {
    const profiles = this.getProfiles();
    const shows = this.db.getShows() || [];
    const sagas = detectSagas(shows, profiles);
    const autoSagas = detectSagas(shows, { shows: {} });

    const keyOf = {};
    for (const saga of sagas.values()) for (const m of saga.members) keyOf[m.id] = saga;
    const autoKeyOf = {};
    for (const saga of autoSagas.values()) for (const m of saga.members) autoKeyOf[m.id] = saga;

    const groups = [...sagas.values()]
      .filter(s => s.members.length > 1 || (profiles.groups || {})[s.key])
      .map(s => ({ key: s.key, label: s.label, members: s.members.map(m => m.title) }));

    return {
      groups,
      shows: shows
        .map(show => {
          const f = profiles.shows[show.id] || {};
          const saga = keyOf[show.id];
          const auto = autoKeyOf[show.id];
          return {
            id: show.id,
            title: show.title,
            episodes: (show.episodes || []).length,
            mode: f.group === 'none' ? 'none' : (f.group && f.group !== 'auto' ? 'manual' : 'auto'),
            groupKey: saga ? saga.key : null,
            groupLabel: saga && saga.members.length > 1 ? saga.label : null,
            autoGroupLabel: auto && auto.members.length > 1 ? auto.label : null,
            order: typeof f.order === 'number' ? f.order : null,
            position: saga ? saga.members.findIndex(m => m.id === show.id) + 1 : 1
          };
        })
        .sort((a, b) => String(a.groupLabel || a.title).localeCompare(String(b.groupLabel || b.title)) || a.position - b.position)
    };
  }

  /* ---------- Revisión automática ---------- */

  /** Huella del algoritmo, las reglas manuales y qué sagas están listas. */
  signature() {
    const p = this.buildProposal();
    const sagas = p.sagas.filter(s => s.eligible).map(s => `${s.key}:${s.current}:${s.franja}:${s.frequency}`).sort().join('|');
    const manual = this.db.programming.rules.all().filter(r => r.source === 'manual').map(r => r.id).sort().join(',');
    return `${ALGORITHM_VERSION}#${sagas}#${manual}`;
  }

  /**
   * Si entró una serie nueva, terminó una temporada, cambió una preferencia o una
   * regla manual, deja una propuesta pendiente. Además, una propuesta fresca cada
   * domingo. Nunca aplica nada sin aprobación.
   */
  autoCheck() {
    try {
      const sig = this.signature();
      const lastSig = this.db.getJsonSetting(SIGNATURE_KEY, null);
      const now = new Date();
      const latest = this.db.programming.proposals.latest();
      const isSundayEvening = now.getDay() === 0 && now.getHours() === 20;
      const staleWeekly = isSundayEvening && (!latest || Date.now() - new Date(latest.createdAt).getTime() > 6 * 24 * 3600 * 1000);
      if (sig === lastSig && !staleWeekly) return;

      const proposal = this.buildProposal();
      const newAlgorithm = !String(lastSig || '').startsWith(`${ALGORITHM_VERSION}#`);
      let reason = 'Cambio en las series o en las reglas';
      if (staleWeekly) reason = 'Revisión semanal automática';
      else if (newAlgorithm) reason = 'Nuevo programador: estrenos L-V y maratones de fin de semana';
      if (proposal.changes.length > 0) {
        this.propose(reason);
        console.log(`[Programación] 📋 Nueva propuesta de parrilla pendiente (${proposal.changes.length} cambios).`);
      } else {
        this.db.setJsonSetting(SIGNATURE_KEY, sig);
      }
    } catch (e) {
      console.warn('[Programación] Error en revisión automática:', e.message);
    }
  }

  start() {
    setTimeout(() => this.autoCheck(), 60000).unref();
    setInterval(() => this.autoCheck(), 60 * 60 * 1000).unref();
  }
}

module.exports = ProgrammingManager;
