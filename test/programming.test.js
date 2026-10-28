/**
 * Tests de programación automática y del planificador (node --test).
 */

const test = require('node:test');
const assert = require('node:assert');

const Scheduler = require('../scheduler');
const { detectSagas, buildRuleProposal, franjaSlots, isOffAirTime, DAY_KEYS } = require('../programming');

const ep = (showId, n, duration = 1400) => ({
  id: `${showId}_e${n}`, name: `${showId} - ${n}`, showTitle: showId, showId,
  path: `/m/${showId}_${n}.mp4`, duration, type: 'show'
});

function makeEnv({ programs, grid = {}, mode = 'weekly', pending = {}, profiles = {}, commercialCount = 12 }) {
  const settings = { programming_profiles: JSON.stringify(profiles) };
  const db = {
    getScheduleConfig: () => ({ mode, weeklyGrid: grid }),
    getJsonSetting: (k, d) => (settings[k] ? JSON.parse(settings[k]) : d),
    hasPendingJobs: (id) => !!pending[id],
    getShow: (id) => programs.find(p => p.id === id),
    getShows: () => programs,
    getCommercials: () => []
  };
  const s = new Scheduler(db);
  s.dynamicBumperManager = null;
  const bumper = (name, duration) => ({ id: name, name, filename: `${name}.mp4`, path: `/m/${name}.mp4`, duration, type: 'bumper' });
  s.mediaCache = {
    programs,
    shows: programs.flatMap(p => p.episodes),
    bumpers: [bumper('bumper_00_sincronizador_ident', 45.6), bumper('bumper_02_a_continuacion', 13.4), bumper('bumper_03_estas_viendo', 6)],
    commercials: Array.from({ length: commercialCount }, (_, i) => ({ id: `co${i}`, name: `Comercial ${i}`, path: `/m/co${i}.mp4`, duration: 30, type: 'commercial' }))
  };
  return { s, db };
}

const prog = (id, title, n, opts = {}) => ({
  id, title, currentEpisodeIndex: opts.ptr || 0, category: opts.category || 'Anime',
  episodes: Array.from({ length: n }, (_, i) => ep(id, i + 1, opts.duration || 1400))
});

test('sagas: solo se agrupan temporadas; las secuelas con nombre propio van separadas', () => {
  const titles = ['Dragon Ball', 'Dragon Ball Z', 'Naruto', 'Naruto Shippuden', 'Pokémon - Temporada 2: Liga Naranja',
    'Pokémon - Temporada 1: ¡Atrápalos Ya!', 'Los Simpsons - Temporada 9', 'Los Simpsons - Temporada 7',
    'JoJo’s Bizarre Adventure: Golden Wind', 'Digimon Adventure 02', 'Saber Marionette J to X'];
  const sagas = detectSagas(titles.map((t, i) => ({ id: `s${i}`, title: t, episodes: [] })));
  assert.strictEqual(sagas.get('pokemon').members.map(m => m.title)[0], 'Pokémon - Temporada 1: ¡Atrápalos Ya!');
  assert.strictEqual(sagas.get('los-simpsons').members.length, 2);
  assert.ok(sagas.has('dragon-ball') && sagas.has('dragon-ball-z'));
  assert.ok(sagas.has('naruto') && sagas.has('naruto-shippuden'));
  assert.strictEqual(sagas.size, 9);
});

test('sagas: una serie se puede separar a mano', () => {
  const shows = [{ id: 'a', title: 'Pokémon - Temporada 1' }, { id: 'b', title: 'Pokémon - Temporada 2' }];
  const sagas = detectSagas(shows, { shows: { b: { group: 'none' } } });
  assert.strictEqual(sagas.size, 2);
});

test('grupos manuales: unir series y fijar su orden', () => {
  const shows = [
    { id: 'dbz', title: 'Dragon Ball Z' },
    { id: 'db', title: 'Dragon Ball' },
    { id: 'gt', title: 'Dragon Ball GT' },
    { id: 'x', title: 'Otra' }
  ];
  const profiles = {
    groups: { 'grp-db': { label: 'Saga Dragon Ball' } },
    shows: {
      db: { group: 'grp-db', order: 1 },
      dbz: { group: 'grp-db', order: 2 },
      gt: { group: 'grp-db', order: 3 }
    }
  };
  const sagas = detectSagas(shows, profiles);
  assert.deepStrictEqual(sagas.get('grp-db').members.map(m => m.id), ['db', 'dbz', 'gt']);
  assert.strictEqual(sagas.get('grp-db').label, 'Saga Dragon Ball');
  assert.ok(sagas.has('otra'));
});

test('la saga pasa a la siguiente temporada al agotar la actual (un capítulo por día)', () => {
  const t1 = prog('t1', 'Pokémon - Temporada 1', 3, { ptr: 2 });
  const t2 = prog('t2', 'Pokémon - Temporada 2', 5);
  const grid = {};
  for (const d of DAY_KEYS) grid[d] = Object.fromEntries(franjaSlots('manana').map(t => [t, 'saga:pokemon']));
  const { s } = makeEnv({ programs: [t1, t2], grid, profiles: { sagas: { pokemon: { frequency: 'daily' } } } });
  const blocks = s.planBlocks(new Date('2026-10-19T06:00:00'), 48 * 3, { withItems: false }).filter(b => b.mainShow);
  const premieres = blocks.filter(b => !b.isRepeat).map(b => b.mainShow.id);
  assert.deepStrictEqual(premieres, ['t1_e3', 't2_e1', 't2_e2'], 'un estreno por día de transmisión (06:00 → 06:00)');
});

test('no salta de temporada mientras la actual sigue codificándose', () => {
  const t1 = prog('t1', 'Pokémon - Temporada 1', 3, { ptr: 2 });
  const t2 = prog('t2', 'Pokémon - Temporada 2', 5);
  const other = prog('x', 'Otra Serie', 10);
  const grid = {};
  for (const d of DAY_KEYS) grid[d] = Object.fromEntries(franjaSlots('manana').map(t => [t, 'saga:pokemon']));
  const { s } = makeEnv({ programs: [t1, t2, other], grid, pending: { t1: true } });
  const blocks = s.planBlocks(new Date('2026-10-19T06:00:00'), 3, { withItems: false });
  assert.strictEqual(blocks[0].mainShow.id, 't1_e3');
  assert.ok(blocks.slice(1).every(b => !b.mainShow.id.startsWith('t2')), 'no debe adelantarse la temporada 2');
});

test('guía (solo títulos) coincide con la emisión', () => {
  const a = prog('a', 'Serie A', 30);
  const b = prog('b', 'Serie B', 30);
  const grid = {};
  for (const d of DAY_KEYS) {
    grid[d] = {};
    franjaSlots('manana').forEach((t, i) => { grid[d][t] = i % 2 ? 'saga:serie-a' : 'saga:serie-b'; });
  }
  const { s } = makeEnv({ programs: [a, b], grid });
  const start = new Date('2026-10-19T05:30:00');
  const emission = s.planBlocks(start, 20, { withItems: true }).map(x => x.mainShow && x.mainShow.id);
  const guide = s.planBlocks(start, 20, { withItems: false }).map(x => x.mainShow && x.mainShow.id);
  assert.deepStrictEqual(guide, emission);
});

test('"al aire en el próximo bloque" con capítulo fuera de orden no mueve el puntero', () => {
  const a = prog('a', 'Serie A', 10, { ptr: 3 });
  const { s } = makeEnv({ programs: [a], mode: 'random' });
  const blocks = s.planBlocks(new Date('2026-10-19T18:10:00'), 3, {
    withItems: true,
    override: { showId: 'a', episodeId: 'a_e8', applyAt: '2026-10-19T18:30:00' }
  });
  assert.strictEqual(blocks[0].mainShow.id, 'a_e4');
  assert.strictEqual(blocks[1].mainShow.id, 'a_e8');
  assert.strictEqual(blocks[1].mainShow.noAdvance, true);
  assert.strictEqual(blocks[2].mainShow.id, 'a_e4', 'el resto del día repite el capítulo del día');
  assert.strictEqual(blocks[2].mainShow.isRepeat, true);
  assert.ok(blocks[1].items.some(it => it.noAdvance));
});

test('rotación: un comercial no se repite en bloques seguidos si hay alternativas', () => {
  const a = prog('a', 'Serie A', 30, { duration: 1500 });
  // ~9 spots por bloque: con 24 distintos siempre hay alternativas
  const { s } = makeEnv({ programs: [a], mode: 'random', commercialCount: 24 });
  const blocks = s.planBlocks(new Date('2026-10-19T18:00:00'), 6, { withItems: true });
  for (let i = 1; i < blocks.length; i++) {
    const prev = new Set(blocks[i - 1].items.filter(x => x.role === 'commercial').map(x => x.id));
    const cur = blocks[i].items.filter(x => x.role === 'commercial').map(x => x.id);
    assert.ok(cur.every(id => !prev.has(id)), `bloque ${i} repite comerciales del anterior`);
  }
});

test('propuesta: respeta las reglas manuales, el cierre nocturno y el mínimo de episodios', () => {
  const big = prog('big', 'Dragon Ball Z', 200, { category: 'Anime Shonen' });
  const small = prog('small', 'Serie Nueva', 3);
  const manualRules = [{ id: 'm1', kind: 'show', target: 'show_fijo', days: ['monday'], startTime: '18:00', slots: 1, source: 'manual' }];
  const p = buildRuleProposal({ shows: [big, small], queueCounts: { small: 20 }, manualRules });
  assert.strictEqual(p.grid.monday['18:00'], 'show_fijo', 'la regla manual se respeta');
  assert.ok(p.rules.every(r => !(r.days.includes('monday') && r.startTime === '18:00')), 'ninguna sugerencia pisa la regla manual');
  for (const r of p.rules) assert.ok(!isOffAirTime(r.startTime), `nada en el cierre nocturno: ${r.startTime}`);
  const smallEntry = p.sagas.find(x => x.key === 'serie-nueva');
  assert.strictEqual(smallEntry.eligible, false, '3 listos de 23 esperados: aún no entra');
  assert.ok(p.sagas.find(x => x.key === 'dragon-ball-z').slotsPerWeek > 0);
  assert.ok(Object.values(p.grid.monday).every(v => v !== 'saga:serie-nueva'));
});
