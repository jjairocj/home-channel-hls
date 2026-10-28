/**
 * Home Channel HLS - Propuesta de programación (pura: sin base de datos ni efectos).
 *
 * Calcula el estado de cada serie y sugiere reglas automáticas que completan lo que
 * no resuelven las reglas manuales del administrador (que siempre se respetan).
 */

const { DAY_KEYS, FRANJAS, MAX_DAILY_AIRINGS, LONG_SERIES_MIN_EPISODES, LONG_SERIES_DAILY_AIRINGS } = require('./constants');
const { detectSagas, suggestFranja, isEpisodic, sagaFrequency, sagaStatus, sagaWeight } = require('./sagas');
const { allocateGrid, MARATHON, BLOCKED } = require('./allocation');
const { compileRules } = require('./rules/RuleCompiler');

/** Estado y preferencias de cada saga, listos para el reparto y el panel. */
function sagaSummary({ shows, profiles = {}, queueCounts = {} }) {
  const sagas = detectSagas(shows, profiles);
  const sagaProfiles = profiles.sagas || {};
  const sagaOf = {};
  const summary = [];
  for (const saga of sagas.values()) {
    for (const m of saga.members) sagaOf[m.id] = saga.key;
    const prefs = sagaProfiles[saga.key] || {};
    const status = sagaStatus(saga, { profiles, queueCounts });
    const chosen = prefs.franja || 'auto';
    const franja = chosen === 'auto' ? suggestFranja(saga) : chosen;
    const episodic = isEpisodic(saga, profiles);
    const frequency = sagaFrequency(saga, { profiles, queueCounts });
    // Serie larga en orden: su capítulo del día se repite más para poder seguirla
    const long = frequency === 'daily' && !episodic && !status.rerun && status.remaining >= LONG_SERIES_MIN_EPISODES;
    summary.push({
      key: saga.key,
      label: saga.label,
      franja,
      franjaChoice: chosen,
      // Franja elegida a mano: estreno y repeticiones se quedan dentro de ella
      franjaLocked: chosen !== 'auto' && chosen !== 'excluir',
      suggested: suggestFranja(saga),
      members: status.members,
      current: status.current ? status.current.title : null,
      remaining: status.remaining,
      remainingBlocks: status.remainingBlocks,
      rerun: status.rerun,
      eligible: status.eligible && franja !== 'excluir',
      reason: franja === 'excluir' ? 'Excluida de la grilla' : (episodic && status.eligible ? 'Episódica: capítulos al azar' : status.reason),
      episodic,
      orderChoice: prefs.order || 'auto',
      frequency,
      frequencyChoice: prefs.frequency || 'auto',
      marathon: prefs.marathon !== false,
      total: status.total,
      long,
      maxDaily: prefs.maxDaily || (long ? LONG_SERIES_DAILY_AIRINGS : MAX_DAILY_AIRINGS),
      weight: sagaWeight(status.remainingBlocks)
    });
  }
  return { summary, sagaOf };
}

/** Clave de saga de un objetivo de regla ('saga:clave' o id de temporada). */
function sagaKeyOf(target, sagaOf) {
  if (!target) return null;
  if (target.startsWith('saga:')) return target.slice(5);
  return sagaOf[target] || null;
}

/** Celdas de las reglas manuales, como horarios ya ocupados para el reparto. */
function reservedCells(manualRules, sagaOf) {
  const { cells } = compileRules(manualRules);
  return Object.values(cells).map(c => {
    const saga = sagaKeyOf(c.target, sagaOf);
    let key = `${BLOCKED}${c.kind}`;
    if (c.kind === 'show' && saga) key = saga;
    if (c.kind === 'marathon' && saga) key = `${MARATHON}${saga}`;
    return { day: DAY_KEYS.indexOf(c.day), time: c.time, key };
  });
}

/** Estadísticas por saga a partir de las celdas compiladas. */
function applyStats(summary, cells, sagaOf) {
  const stats = {};
  const get = (k) => (stats[k] = stats[k] || { slots: 0, days: new Set(), weekdays: new Set(), marathon: 0 });
  for (const c of Object.values(cells)) {
    const saga = sagaKeyOf(c.target, sagaOf);
    if (!saga) continue;
    const s = get(saga);
    if (c.kind === 'marathon') {
      s.marathon++;
      continue;
    }
    s.slots++;
    s.days.add(c.day);
    if (DAY_KEYS.indexOf(c.day) < 5) s.weekdays.add(c.day);
  }
  const warnings = [];
  for (const s of summary) {
    const st = stats[s.key] || get(s.key);
    s.slotsPerWeek = st.slots;
    s.daysPerWeek = st.days.size;
    s.premiereDays = st.weekdays.size;
    s.marathonSlots = st.marathon;
    // Un capítulo nuevo por día de estreno (L-V) en las diarias, uno por semana en las
    // semanales; las repeticiones y los maratones no consumen capítulos
    const premieresPerWeek = s.frequency === 'weekly' ? (st.slots ? 1 : 0) : s.premiereDays;
    s.weeksLeft = premieresPerWeek && !s.episodic ? Math.round(((s.remainingBlocks || s.remaining) / premieresPerWeek) * 10) / 10 : null;
    if (s.eligible && !s.slotsPerWeek) warnings.push(`${s.label} está lista pero no entró en la grilla.`);
  }
  return warnings;
}

const broadcastGrid = (cells) => {
  const grid = Object.fromEntries(DAY_KEYS.map(d => [d, {}]));
  for (const c of Object.values(cells)) grid[c.day][c.time] = c.value;
  return grid;
};

/**
 * Propone reglas automáticas.
 * @param {Object} input
 * @param {Object[]} input.shows
 * @param {Object} [input.profiles] - ver programming/profiles.js
 * @param {Object} [input.queueCounts]
 * @param {Object[]} [input.manualRules] - reglas del administrador (se respetan)
 * @param {Object[]} [input.currentRules] - todas las reglas vigentes (para el resumen de cambios)
 * @returns {{ rules, grid, cells, sagas, warnings, changes }}
 *   grid: por día de transmisión, con manuales + automáticas propuestas
 */
function buildRuleProposal({ shows, profiles = {}, queueCounts = {}, manualRules = [], currentRules = null }) {
  const { summary, sagaOf } = sagaSummary({ shows, profiles, queueCounts });
  const enabledManual = manualRules.filter(r => r.enabled !== false);
  const allocation = allocateGrid(summary.filter(s => s.eligible), { reserved: reservedCells(enabledManual, sagaOf) });
  const rules = allocation.rules;

  const compiled = compileRules([...enabledManual, ...rules.map((r, i) => ({ ...r, id: `new_${i}` }))]);
  const warnings = [...allocation.warnings, ...applyStats(summary, compiled.cells, sagaOf)];

  const grid = broadcastGrid(compiled.cells);
  const before = broadcastGrid(compileRules(currentRules || enabledManual).cells);
  const changes = [];
  for (const day of DAY_KEYS) {
    const times = new Set([...Object.keys(grid[day]), ...Object.keys(before[day])]);
    for (const time of [...times].sort()) {
      const from = before[day][time] || null;
      const to = grid[day][time] || null;
      if (from !== to) changes.push({ day, time, from, to });
    }
  }

  summary.sort((a, b) => Object.keys(FRANJAS).indexOf(a.franja) - Object.keys(FRANJAS).indexOf(b.franja) || a.label.localeCompare(b.label));
  return { rules, grid, cells: compiled.cells, sagas: summary, warnings, changes };
}

module.exports = { buildRuleProposal, sagaSummary, sagaKeyOf, applyStats };
