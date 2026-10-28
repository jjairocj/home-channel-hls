/**
 * Tests del "capítulo del día": un capítulo nuevo por día y repeticiones del mismo.
 */

const test = require('node:test');
const assert = require('node:assert');

const Scheduler = require('../scheduler');
const { recordPremiere } = require('../scheduling/DailyEpisodes');
const { buildRuleProposal, DAY_KEYS } = require('../programming');
const { LONG_SERIES_DAILY_AIRINGS, WEEKLY_AIRINGS } = require('../programming/constants');
const { broadcastMinutes } = require('../core/time');

const ep = (showId, n, duration = 1400) => ({
  id: `${showId}_e${n}`, name: `${showId} - ${n}`, showTitle: showId, showId, path: `/m/${showId}_${n}.mp4`, duration, type: 'show'
});
const prog = (id, title, n, opts = {}) => ({
  id, title, currentEpisodeIndex: opts.ptr || 0, category: opts.category || 'Anime',
  episodes: Array.from({ length: n }, (_, i) => ep(id, i + 1, opts.duration || 1400))
});

function makeEnv(programs, grid, profiles = {}) {
  const settings = { programming_profiles: JSON.stringify(profiles) };
  const db = {
    getScheduleConfig: () => ({ mode: 'weekly', weeklyGrid: grid }),
    getJsonSetting: (k, d) => (settings[k] !== undefined ? JSON.parse(settings[k]) : d),
    setJsonSetting: (k, v) => { settings[k] = JSON.stringify(v); },
    hasPendingJobs: () => false,
    getShow: (id) => programs.find(p => p.id === id),
    getShows: () => programs,
    getCommercials: () => []
  };
  const s = new Scheduler(db);
  s.dynamicBumperManager = null;
  s.mediaCache = { programs, shows: programs.flatMap(p => p.episodes), bumpers: [], commercials: [] };
  return { s, db };
}

/** Grilla con la serie a las 07:00, 13:00 y 20:00 todos los días. */
function threeTimesADay(value) {
  const grid = {};
  for (const d of DAY_KEYS) grid[d] = { '07:00': value, '13:00': value, '20:00': value };
  return grid;
}

test('el mismo capítulo se repite durante el día y avanza al día siguiente', () => {
  const a = prog('a', 'Serie A', 60, { ptr: 4 });
  const { s } = makeEnv([a], threeTimesADay('saga:serie-a'));
  // Desde las 07:00: las franjas vacías se rellenan por rotación con la misma serie
  const blocks = s.planBlocks(new Date('2026-10-19T07:00:00'), 48 * 2, { withItems: false });
  const at = (iso) => blocks.find(b => b.startTime === new Date(iso).toISOString()).mainShow;

  const day1 = ['2026-10-19T07:00:00', '2026-10-19T13:00:00', '2026-10-19T20:00:00'].map(at);
  assert.deepStrictEqual(day1.map(e => e.id), ['a_e5', 'a_e5', 'a_e5']);
  assert.deepStrictEqual(day1.map(e => !!e.isRepeat), [false, true, true]);
  assert.deepStrictEqual(day1.map(e => !!e.noAdvance), [false, true, true], 'las repeticiones no mueven el puntero');
  assert.strictEqual(at('2026-10-20T07:00:00').id, 'a_e6', 'al día siguiente, capítulo nuevo');
});

test('tras emitirse el estreno, una re-planificación sigue repitiendo ese capítulo', () => {
  const a = prog('a', 'Serie A', 60, { ptr: 4 });
  const { s, db } = makeEnv([a], threeTimesADay('saga:serie-a'));
  const premiere = s.planBlocks(new Date('2026-10-19T07:00:00'), 1, { withItems: true })[0].mainShow;
  assert.strictEqual(premiere.id, 'a_e5');

  // Terminó el estreno: el puntero avanza y queda registrado
  a.currentEpisodeIndex = 5;
  recordPremiere(db, premiere);

  const later = s.planBlocks(new Date('2026-10-19T12:10:00'), 2, { withItems: false });
  const repeat = later.find(b => b.mainShow).mainShow;
  assert.strictEqual(repeat.id, 'a_e5');
  assert.strictEqual(repeat.isRepeat, true);
  const tomorrow = s.planBlocks(new Date('2026-10-20T06:30:00'), 2, { withItems: false }).find(b => b.mainShow).mainShow;
  assert.strictEqual(tomorrow.id, 'a_e6');
});

test('lo emitido después de medianoche pertenece al día de transmisión anterior', () => {
  const a = prog('a', 'Serie A', 60);
  const grid = {};
  for (const d of DAY_KEYS) grid[d] = { '23:00': 'saga:serie-a', '00:30': 'saga:serie-a' };
  const { s } = makeEnv([a], grid);
  const blocks = s.planBlocks(new Date('2026-10-19T23:00:00'), 4, { withItems: false });
  const at = (iso) => blocks.find(b => b.startTime === new Date(iso).toISOString()).mainShow;
  assert.strictEqual(at('2026-10-19T23:00:00').id, 'a_e1');
  assert.strictEqual(at('2026-10-20T00:30:00').id, 'a_e1');
  assert.strictEqual(at('2026-10-20T00:30:00').isRepeat, true);
});

test('propuesta: las series largas van en tira de lunes a viernes (2-3 emisiones) a la misma hora', () => {
  const shows = Array.from({ length: 22 }, (_, i) => prog(`s${i}`, `Serie ${i}`, i < 5 ? 300 : 60));
  const p = buildRuleProposal({ shows });
  const WEEKDAY_KEYS = DAY_KEYS.slice(0, 5);
  for (const s of p.sagas.filter(x => x.eligible)) {
    assert.strictEqual(s.frequency, 'daily');
    assert.strictEqual(s.premiereDays, 5, `${s.label} estrena de lunes a viernes`);
    const times = (day) => Object.entries(p.grid[day]).filter(([, v]) => v === `saga:${s.key}`).map(([t]) => t).sort();
    if (s.long) {
      assert.ok(times('monday').length >= 2 && times('monday').length <= LONG_SERIES_DAILY_AIRINGS, `${s.label}: ${times('monday')}`);
      for (const day of WEEKDAY_KEYS) assert.deepStrictEqual(times(day), times('monday'), `${s.label}: mismo horario cada día`);
    }
    assert.strictEqual(s.weeksLeft, Math.round((s.remaining / 5) * 10) / 10, 'un capítulo por día de lunes a viernes');
  }
  // Las reglas sugeridas son automáticas
  assert.ok(p.rules.length && p.rules.every(r => r.source === 'auto'));
});

test('propuesta: el fin de semana no hay estrenos; las series en orden tienen maratón', () => {
  const shows = Array.from({ length: 10 }, (_, i) => prog(`s${i}`, `Serie ${i}`, 120));
  const p = buildRuleProposal({ shows });
  const marathons = p.rules.filter(r => r.kind === 'marathon');
  assert.ok(marathons.length > 0, 'hay maratones');
  for (const m of marathons) {
    assert.ok(m.days.every(d => d === 'saturday' || d === 'sunday'), 'los maratones son en fin de semana');
    assert.ok(m.slots >= 3 && m.slots <= 5, `maratón de ${m.slots} capítulos`);
  }
  // Ninguna regla de serie estrena el fin de semana con un capítulo nuevo: las reglas de
  // serie del fin de semana son repeticiones (lo decide el planificador), no estrenos L-V
  for (const r of p.rules.filter(x => x.kind === 'show')) {
    if (r.days.every(d => d === 'saturday' || d === 'sunday')) continue;
    assert.ok(r.days.every(d => !['saturday', 'sunday'].includes(d)) || r.days.length > 2);
  }
});

test('propuesta: las series cortas son semanales y se agrupan en bloques la misma noche', () => {
  const cult = ['Evangelion', 'Cowboy Bebop', 'Lain', 'Ergo Proxy'].map((t, i) => prog(`c${i}`, t, 26, { category: 'Anime de culto' }));
  const daily = Array.from({ length: 6 }, (_, i) => prog(`d${i}`, `Diaria ${i}`, 200));
  const p = buildRuleProposal({ shows: [...cult, ...daily], profiles: { sagas: Object.fromEntries(cult.map(c => [c.title.toLowerCase().replace(/ /g, '-'), { franja: 'prime' }])) } });
  const weekly = p.sagas.filter(s => s.frequency === 'weekly');
  assert.strictEqual(weekly.length, 4);
  for (const s of weekly) {
    assert.ok(s.slotsPerWeek >= 1 && s.slotsPerWeek <= WEEKLY_AIRINGS + 2, `${s.label}: ${s.slotsPerWeek}/semana`);
    assert.strictEqual(s.weeksLeft, s.remaining, 'un capítulo nuevo por semana');
  }
  // Estreno en prime time: las tres primeras forman un bloque seguido la misma noche
  const premieres = weekly.map(s => {
    for (const day of DAY_KEYS.slice(0, 5)) {
      const t = Object.keys(p.grid[day]).sort().find(time => p.grid[day][time] === `saga:${s.key}` && time >= '18:00' && time < '23:00');
      if (t) return { day, t };
    }
    return null;
  });
  assert.ok(premieres.every(Boolean), 'todas estrenan en prime time');
  const byDay = {};
  for (const { day, t } of premieres) (byDay[day] = byDay[day] || []).push(t);
  const block = Object.values(byDay).find(list => list.length === 3);
  assert.ok(block, `hay un bloque de 3: ${JSON.stringify(byDay)}`);
  const mins = block.map(t => broadcastMinutes(t)).sort((a, b) => a - b);
  assert.deepStrictEqual(mins.map(m => m - mins[0]), [0, 30, 60], 'seguidas');
});

test('serie semanal: un capítulo nuevo por semana; sus otras emisiones de la semana lo repiten', () => {
  const e = prog('e', 'Evangelion', 26);
  const grid = {};
  for (const d of DAY_KEYS) grid[d] = {};
  grid.wednesday['20:00'] = 'saga:evangelion';
  grid.saturday['15:00'] = 'saga:evangelion';
  const { s } = makeEnv([e], grid);
  const blocks = s.planBlocks(new Date('2026-10-19T06:00:00'), 48 * 14, { withItems: false });
  const at = (iso) => blocks.find(b => b.startTime === new Date(iso).toISOString()).mainShow;
  assert.strictEqual(at('2026-10-21T20:00:00').id, 'e_e1');
  assert.strictEqual(at('2026-10-24T15:00:00').id, 'e_e1');
  assert.strictEqual(at('2026-10-24T15:00:00').isRepeat, true);
  assert.strictEqual(at('2026-10-28T20:00:00').id, 'e_e2', 'la semana siguiente, capítulo nuevo');
});

test('la madrugada (05:00-06:00) repite el capítulo del día anterior', () => {
  const a = prog('a', 'Serie A', 200);
  const grid = {};
  for (const d of DAY_KEYS) grid[d] = { '20:00': 'saga:serie-a', '05:30': 'saga:serie-a' };
  const { s } = makeEnv([a], grid);
  const blocks = s.planBlocks(new Date('2026-10-19T20:00:00'), 50, { withItems: false });
  const at = (iso) => blocks.find(b => b.startTime === new Date(iso).toISOString()).mainShow;
  assert.strictEqual(at('2026-10-19T20:00:00').id, 'a_e1');
  assert.strictEqual(at('2026-10-20T05:30:00').id, 'a_e1');
  assert.strictEqual(at('2026-10-20T05:30:00').isRepeat, true);
  assert.strictEqual(at('2026-10-20T20:00:00').id, 'a_e2');
});

test('propuesta: la repetición queda lejos del estreno', () => {
  const shows = Array.from({ length: 12 }, (_, i) => prog(`s${i}`, `Serie ${i}`, 120));
  const p = buildRuleProposal({ shows });
  for (const s of p.sagas) {
    const times = Object.entries(p.grid.monday).filter(([, v]) => v === `saga:${s.key}`).map(([t]) => broadcastMinutes(t)).sort((x, y) => x - y);
    if (times.length > 1) assert.ok(times[1] - times[0] >= 180, `${s.label}: ${times}`);
  }
});

test('Los Simpsons es episódica: capítulos al azar, sin repetir en el día ni mover el puntero', () => {
  const t7 = prog('t7', 'Los Simpsons - Temporada 7', 25);
  const t8 = prog('t8', 'Los Simpsons - Temporada 8', 25);
  const { s } = makeEnv([t7, t8], threeTimesADay('saga:los-simpsons'));
  const plan = (from) => s.planBlocks(new Date(from), 48 * 2, { withItems: false });
  const blocks = plan('2026-10-19T07:00:00');
  const at = (list, iso) => list.find(b => b.startTime === new Date(iso).toISOString()).mainShow;

  const day = ['2026-10-19T07:00:00', '2026-10-19T13:00:00', '2026-10-19T20:00:00'].map(iso => at(blocks, iso));
  assert.strictEqual(new Set(day.map(e => e.id)).size, 3, 'tres capítulos distintos en el día');
  assert.ok(day.every(e => e.noAdvance && !e.isRepeat), 'no avanza ni se marca como repetición');
  assert.notDeepStrictEqual(day.map(e => e.id), ['t7_e1', 't7_e2', 't7_e3'], 'no va en orden');

  const simpsonBlock = blocks.find(b => b.startTime === new Date('2026-10-19T07:00:00').toISOString());
  assert.strictEqual(simpsonBlock.title, 'Los Simpsons', 'el título del bloque agrupado debe ser el de la saga, sin temporada');
  assert.strictEqual(day[0].showTitle, 'Los Simpsons', 'el showTitle debe ser el de la saga agrupada');

  // Estable: re-planificar a media tarde da el mismo capítulo a las 20:00, y la guía coincide
  assert.strictEqual(at(plan('2026-10-19T15:10:00'), '2026-10-19T20:00:00').id, day[2].id);
  const emission = s.planBlocks(new Date('2026-10-19T07:00:00'), 30, { withItems: true }).map(b => b.mainShow && b.mainShow.id);
  assert.deepStrictEqual(s.planBlocks(new Date('2026-10-19T07:00:00'), 30, { withItems: false }).map(b => b.mainShow && b.mainShow.id), emission);
  assert.strictEqual(t7.currentEpisodeIndex, 0);
});

test('series episódicas: no se repite un capítulo hasta recorrerlos todos', () => {
  const simpsons = prog('sim', 'Los Simpsons', 10);
  const { s } = makeEnv([simpsons], threeTimesADay('saga:los-simpsons'));
  const ids = s.planBlocks(new Date('2026-10-19T07:00:00'), 48 * 4, { withItems: false })
    .filter(b => b.mainShow && ['07:00', '13:00', '20:00'].includes(new Date(b.startTime).toTimeString().slice(0, 5)))
    .map(b => b.mainShow.id);
  assert.strictEqual(new Set(ids.slice(0, 10)).size, 10, `los primeros 10 son distintos: ${ids.slice(0, 10)}`);
});

test('propuesta: una serie se puede marcar en orden o al azar desde el panel', () => {
  const shows = [prog('sim', 'Los Simpsons', 30), prog('b', 'Betty', 30)];
  const auto = buildRuleProposal({ shows });
  assert.strictEqual(auto.sagas.find(x => x.label === 'Los Simpsons').episodic, true);
  assert.strictEqual(auto.sagas.find(x => x.label === 'Betty').episodic, false);
  const manual = buildRuleProposal({ shows, profiles: { sagas: { 'los-simpsons': { order: 'sequential' }, betty: { order: 'random' } } } });
  assert.strictEqual(manual.sagas.find(x => x.label === 'Los Simpsons').episodic, false);
  assert.strictEqual(manual.sagas.find(x => x.label === 'Betty').episodic, true);
});

test('series episódicas: avanza de ciclo al emitir todos los capítulos y cambia la permutación', () => {
  const simpsons = prog('sim', 'Los Simpsons', 5);
  const { s, db } = makeEnv([simpsons], threeTimesADay('saga:los-simpsons'));
  const { recordEpisodicAiring, resetEpisodicCycle, getEpisodicOverview } = require('../scheduling/DailyEpisodes');

  // Registrar emisión de los primeros 4 capítulos
  for (let i = 1; i <= 4; i++) {
    recordEpisodicAiring(db, { id: `sim_e${i}`, refKey: 'saga:los-simpsons' }, { programs: [simpsons] });
  }

  let ov = getEpisodicOverview(db, { sagas: [{ key: 'los-simpsons', label: 'Los Simpsons', members: [simpsons] }] });
  assert.strictEqual(ov[0].seenCount, 4);
  assert.strictEqual(ov[0].cycle, 1);
  assert.strictEqual(ov[0].remainingCount, 1);

  // Emitir el último capítulo (completa el ciclo 1)
  recordEpisodicAiring(db, { id: 'sim_e5', refKey: 'saga:los-simpsons' }, { programs: [simpsons] });

  ov = getEpisodicOverview(db, { sagas: [{ key: 'los-simpsons', label: 'Los Simpsons', members: [simpsons] }] });
  assert.strictEqual(ov[0].cycle, 2, 'el ciclo debe avanzar automáticamente a 2');
  assert.strictEqual(ov[0].seenCount, 0, 'la lista de vistos debe reiniciarse en 0');
  assert.strictEqual(ov[0].remainingCount, 5);

  // Reiniciar ciclo manualmente
  resetEpisodicCycle(db, 'saga:los-simpsons');
  ov = getEpisodicOverview(db, { sagas: [{ key: 'los-simpsons', label: 'Los Simpsons', members: [simpsons] }] });
  assert.strictEqual(ov[0].cycle, 3, 'reinicio manual avanza al siguiente ciclo');
  assert.strictEqual(ov[0].seenCount, 0);
});
