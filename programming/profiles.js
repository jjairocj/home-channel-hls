/**
 * Home Channel HLS - Perfiles de programación.
 *
 * Une las dos fuentes en el formato que usa el resto del motor:
 *   - grupos de temporadas y marcas por serie (terminada / en espera): setting
 *     `programming_profiles` → { groups, shows }
 *   - preferencias por saga (franja, frecuencia, orden, máximo diario, maratón,
 *     exclusión): tabla programming_series → { sagas: { clave: {...} } }
 */

const PROFILES_KEY = 'programming_profiles';

function loadProfiles(db) {
  if (!db || !db.getJsonSetting) return { sagas: {}, shows: {}, groups: {} };
  const legacy = db.getJsonSetting(PROFILES_KEY, {}) || {};
  const sagas = { ...(legacy.sagas || {}) };
  const series = db.programming && db.programming.series ? db.programming.series.all() : {};
  for (const [key, prefs] of Object.entries(series)) {
    sagas[key] = {
      ...(sagas[key] || {}),
      franja: prefs.excluded ? 'excluir' : prefs.franja,
      frequency: prefs.frequency,
      order: prefs.order,
      maxDaily: prefs.maxDaily,
      marathon: prefs.marathon
    };
  }
  return { sagas, shows: legacy.shows || {}, groups: legacy.groups || {} };
}

module.exports = { loadProfiles, PROFILES_KEY };
