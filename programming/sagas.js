/**
 * Home Channel HLS - Sagas (grupos de temporadas que comparten horario) y su estado.
 */

const { MIN_READY_EPISODES, FRANJA_KEYWORDS, EPISODIC_KEYWORDS, WEEKLY_MAX_EPISODES } = require('./constants');

function normalize(str) {
  return String(str || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

function slugify(str) {
  return normalize(str).replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'serie';
}

/** "HH:MM" de cada bloque de 30 min de una franja. */
/**
 * Agrupa series en sagas (grupos que comparten horario y se emiten en orden).
 * Devuelve Map key -> { key, label, members: [show...] } con los miembros en orden.
 *
 * Configuración por serie en profiles.shows[id]:
 *   group: undefined | 'auto'  -> automático: solo se agrupan títulos "Serie - Temporada N"
 *          'none'              -> independiente (horario propio)
 *          '<clave>'           -> grupo manual (profiles.groups[clave].label)
 *   order: número de orden dentro del grupo (opcional)
 */
function detectSagas(shows, profiles = {}) {
  const sagas = new Map();
  const flags = profiles.shows || {};
  const groups = profiles.groups || {};

  for (const show of shows || []) {
    const title = String(show.title || '');
    const f = flags[show.id] || {};
    const season = title.match(/temporada\s*(\d+)/i);
    let key;
    let label;
    let rank = season ? parseInt(season[1], 10) : 0;

    if (f.group && f.group !== 'auto' && f.group !== 'none') {
      key = f.group;
      label = (groups[key] && groups[key].label) || key;
    } else if (season && f.group !== 'none') {
      // "Pokémon - Temporada 1: …" / "Los Simpsons - Temporada 8"
      const base = title.replace(/\s*[-–:]?\s*temporada\s*\d+.*$/i, '').trim() || title;
      key = slugify(base);
      label = base;
    } else {
      key = slugify(title);
      label = title;
      rank = 0;
    }
    if (typeof f.order === 'number') rank = f.order;

    // Una serie independiente no debe caer en un grupo que tenga la misma clave
    if (sagas.has(key) && (f.group === 'none' || !season) && !(f.group && f.group !== 'auto' && f.group !== 'none')) {
      key = `${key}-${String(show.id).slice(-5)}`;
    }

    if (!sagas.has(key)) sagas.set(key, { key, label, members: [] });
    sagas.get(key).members.push({ show, rank });
  }

  for (const saga of sagas.values()) {
    saga.members.sort((a, b) => a.rank - b.rank || String(a.show.title).localeCompare(String(b.show.title)));
    saga.members = saga.members.map(m => m.show);
  }
  return sagas;
}

/** Franja sugerida para una saga según palabras clave y categoría. */
function suggestFranja(saga) {
  const text = normalize(`${saga.label} ${saga.members.map(m => `${m.title} ${m.category || ''}`).join(' ')}`);
  for (const [franja, words] of Object.entries(FRANJA_KEYWORDS)) {
    if (words.some(w => text.includes(normalize(w)))) return franja;
  }
  if (/culto/.test(text)) return 'prime';
  if (/shonen|infantil|kids/.test(text)) return 'manana';
  if (/adult/.test(text)) return 'noche';
  return 'tarde';
}

/**
 * ¿Serie episódica (capítulos al azar)? Primero la elección del panel
 * (profiles.sagas[clave].order = 'random' | 'sequential'), luego el nombre.
 */
function isEpisodic(saga, profiles = {}) {
  const choice = ((profiles.sagas || {})[saga.key] || {}).order;
  if (choice === 'random') return true;
  if (choice === 'sequential') return false;
  const text = normalize(`${saga.label} ${saga.members.map(m => m.title).join(' ')}`);
  return EPISODIC_KEYWORDS.some(w => text.includes(normalize(w)));
}

/** Bloques de 30 min que consume cada episodio (formato corto: 2 episodios por bloque). */
function episodesPerBlock(show) {
  const durs = (show.episodes || []).map(e => e.duration).filter(d => d > 0).sort((x, y) => x - y);
  if (!durs.length) return 1;
  return durs[Math.floor(durs.length / 2)] < 850 ? 2 : 1;
}

/**
 * Pone primero la temporada que está en curso: si una temporada posterior ya empezó
 * (p. ej. la T8 mientras la T7 se sigue codificando), se continúa con ella y las
 * anteriores entran después, sin saltos hacia atrás a mitad de temporada.
 */
function rotateToInProgress(list, ptrOf) {
  const idx = list.findIndex(m => ptrOf(m) > 0);
  return idx > 0 ? [...list.slice(idx), ...list.slice(0, idx)] : list;
}

/**
 * Estado de una saga: temporada actual, episodios y bloques restantes (listos y en
 * cola) y si cumple el mínimo para entrar a la grilla.
 */
function sagaStatus(saga, { profiles = {}, queueCounts = {} } = {}) {
  const showFlags = profiles.shows || {};
  const members = saga.members.map(show => {
    const ready = (show.episodes || []).length;
    const queued = queueCounts[show.id] || 0;
    const ptr = Math.min(show.currentEpisodeIndex || 0, ready);
    const flags = showFlags[show.id] || {};
    return { id: show.id, title: show.title, ready, queued, ptr, completed: !!flags.completed, perBlock: episodesPerBlock(show) };
  });

  let active = members.filter(m => !m.completed && (m.ready + m.queued) > 0);
  const rerun = active.length === 0;
  if (rerun) active = members.filter(m => m.ready > 0);
  active = rotateToInProgress(active, m => m.ptr);

  // Temporada actual: la que está en curso, o la primera con episodios listos
  const current = active.find(m => m.ptr > 0) || active.find(m => m.ready > 0) || active[0] || null;
  const remaining = active.reduce((acc, m) => acc + (m === current ? m.ready - m.ptr : m.ready) + m.queued, 0);
  const remainingBlocks = active.reduce((acc, m) => acc + Math.ceil(((m === current ? m.ready - m.ptr : m.ready) + m.queued) / m.perBlock), 0);
  const readyAhead = current ? current.ready - current.ptr : 0;
  const expectedLeft = current ? current.ready + current.queued - current.ptr : 0;
  const eligible = !!current && current.ready > 0 &&
    (readyAhead >= Math.min(MIN_READY_EPISODES, expectedLeft) || rerun);

  let reason = 'Lista para emitirse';
  if (!current) reason = 'Sin episodios';
  else if (!eligible) reason = `Esperando episodios (${readyAhead} listos de ${MIN_READY_EPISODES} mínimos)`;
  else if (rerun) reason = 'Repetición (todas sus temporadas ya se emitieron)';

  const total = members.reduce((acc, m) => acc + m.ready + m.queued, 0);
  return { members, current, remaining, remainingBlocks, total, eligible, rerun, reason };
}

/**
 * Frecuencia de una saga: 'daily' (tira diaria) o 'weekly' (un capítulo por semana).
 * Primero la elección del panel (profiles.sagas[clave].frequency), luego el largo:
 * hasta WEEKLY_MAX_EPISODES capítulos en total es semanal.
 */
function sagaFrequency(saga, { profiles = {}, queueCounts = {} } = {}) {
  const choice = ((profiles.sagas || {})[saga.key] || {}).frequency;
  if (choice === 'daily' || choice === 'weekly') return choice;
  const total = saga.members.reduce((acc, m) => acc + (m.episodes || []).length + (queueCounts[m.id] || 0), 0);
  return total <= WEEKLY_MAX_EPISODES ? 'weekly' : 'daily';
}

/** Peso de una saga en la rotación según los episodios que le quedan. */
function sagaWeight(remaining) {
  if (remaining >= 150) return 3;
  if (remaining >= 60) return 2;
  return 1;
}

module.exports = { normalize, slugify, detectSagas, suggestFranja, isEpisodic, sagaFrequency, episodesPerBlock, sagaStatus, sagaWeight };
