/**
 * Tests del programador por reglas: compilador, maratones, fin de semana sin estrenos,
 * servicio de reglas y migración de la configuración anterior.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const Scheduler = require('../scheduler');
const Database = require('../database');
const { compileRules, cellsToRules, calendarToBroadcast } = require('../programming/rules/RuleCompiler');
const { ScheduleService, ProgrammingManager } = require('../programming');
const { logAiring } = require('../scheduling/DailyEpisodes');

const ep = (showId, n, duration = 1400) => ({ id: `${showId}_e${n}`, name: `${showId} - ${n}`, showTitle: showId, showId, path: `/m/${showId}_${n}.mp4`, duration, type: 'show' });
const prog = (id, title, n, opts = {}) => ({
  id, title, currentEpisodeIndex: opts.ptr || 0, category: 'Anime',
  episodes: Array.from({ length: n }, (_, i) => ep(id, i + 1))
});

/** Base de datos real (respaldo JSON, sin Postgres) con programas de prueba. */
async function makeDb(programs) {
  const db = new Database({ dataDir: fs.mkdtempSync(path.join(os.tmpdir(), 'crhe-prog-')), pgConfig: { host: '127.0.0.1', port: 1, connectionTimeoutMillis: 200 } });
  await db.ready;
  clearTimeout(db.pg.reconnectTimer);
  db.store.data.shows = programs;
  return db;
}

function makeScheduler(db, programs) {
  const s = new Scheduler(db);
  s.dynamicBumperManager = null;
  s.mediaCache = { programs, shows: programs.flatMap(p => p.episodes), bumpers: [], commercials: [] };
  return s;
}

test('compilador: la manual gana a la automática y lo de madrugada va al día de calendario siguiente', () => {
  const { cells, calendarGrid, conflicts } = compileRules([
    { id: 'auto', kind: 'show', target: 'saga:a', days: ['monday'], startTime: '19:00', slots: 1, source: 'auto' },
    { id: 'man', kind: 'show', target: 'saga:b', days: ['monday'], startTime: '19:00', slots: 1, source: 'manual' },
    { id: 'late', kind: 'show', target: 'saga:c', days: ['friday'], startTime: '00:30', slots: 1, source: 'auto' }
  ]);
  assert.strictEqual(cells['monday|19:00'].value, 'saga:b');
  assert.deepStrictEqual(conflicts.map(c => c.losers), [['auto']]);
  assert.strictEqual(calendarGrid.saturday['00:30'], 'saga:c', 'viernes 00:30 de transmisión = sábado 00:30 de calendario');
});

test('compilador: celdas ↔ reglas sin pérdida (maratones y cierres se unen)', () => {
  const grid = { saturday: { '14:00': 'maraton:saga:x@0', '14:30': 'maraton:saga:x@1', '15:00': 'maraton:saga:x@2' }, monday: { '19:00': 'saga:y' }, tuesday: { '19:00': 'saga:y' } };
  const rules = cellsToRules(grid, 'manual');
  assert.deepStrictEqual(rules.map(r => [r.kind, r.target, r.days.join(','), r.startTime, r.slots]).sort(), [
    ['marathon', 'saga:x', 'saturday', '14:00', 3],
    ['show', 'saga:y', 'monday,tuesday', '19:00', 1]
  ].sort());
  const back = compileRules(rules.map((r, i) => ({ ...r, id: `r${i}` }))).cells;
  assert.strictEqual(back['saturday|15:00'].value, 'maraton:saga:x@2');
});

test('maratón del sábado: los capítulos estrenados de lunes a viernes, en orden', async () => {
  const b = prog('b', 'Betty', 300);
  const db = await makeDb([b]);
  db.programming.rules.create({ kind: 'show', target: 'saga:betty', days: ['monday', 'tuesday', 'wednesday', 'thursday', 'friday'], startTime: '19:00' });
  db.programming.rules.create({ kind: 'marathon', target: 'saga:betty', days: ['saturday'], startTime: '14:00', slots: 5 });
  const service = new ScheduleService({ db });
  service.apply();
  const s = makeScheduler(db, [b]);

  const blocks = s.planBlocks(new Date('2026-10-19T06:00:00'), 48 * 6, { withItems: false });
  const at = (iso) => blocks.find(x => x.startTime === new Date(iso).toISOString());
  const week = ['19', '20', '21', '22', '23'].map(d => at(`2026-10-${d}T19:00:00`).mainShow.id);
  assert.deepStrictEqual(week, ['b_e1', 'b_e2', 'b_e3', 'b_e4', 'b_e5'], 'un estreno por día L-V');
  const marathon = ['14:00', '14:30', '15:00', '15:30', '16:00'].map(t => at(`2026-10-24T${t}:00`));
  assert.deepStrictEqual(marathon.map(x => x.mainShow.id), week, 'el maratón repasa la semana');
  assert.ok(marathon.every(x => x.mainShow.isRepeat && x.mainShow.noAdvance && x.title.startsWith('Maratón')));
});

test('fin de semana: una serie en orden no estrena, repite su último capítulo', async () => {
  const b = prog('b', 'Betty', 300);
  const db = await makeDb([b]);
  db.programming.rules.create({ kind: 'show', target: 'saga:betty', days: ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'], startTime: '19:00' });
  new ScheduleService({ db }).apply();
  const s = makeScheduler(db, [b]);
  const blocks = s.planBlocks(new Date('2026-10-19T06:00:00'), 48 * 8, { withItems: false });
  const at = (iso) => blocks.find(x => x.startTime === new Date(iso).toISOString()).mainShow;
  assert.strictEqual(at('2026-10-23T19:00:00').id, 'b_e5');
  assert.strictEqual(at('2026-10-24T19:00:00').id, 'b_e5');
  assert.strictEqual(at('2026-10-24T19:00:00').isRepeat, true);
  assert.strictEqual(at('2026-10-25T19:00:00').id, 'b_e5');
  assert.strictEqual(at('2026-10-26T19:00:00').id, 'b_e6', 'el lunes vuelve a estrenar');
});

test('el maratón usa los estrenos ya emitidos (historial) tras un reinicio el sábado', async () => {
  const b = prog('b', 'Betty', 300, { ptr: 5 });
  const db = await makeDb([b]);
  // Lunes a viernes ya se emitieron los capítulos 1 a 5 (quedaron en el historial)
  ['19', '20', '21', '22', '23'].forEach((d, i) => logAiring(db, {
    refKey: 'saga:betty', airDay: `2026-10-${d}`, showId: 'b', id: `b_e${i + 1}`
  }));
  db.programming.rules.create({ kind: 'marathon', target: 'saga:betty', days: ['saturday'], startTime: '14:00', slots: 5 });
  new ScheduleService({ db }).apply();
  const s = makeScheduler(db, [b]);
  const blocks = s.planBlocks(new Date('2026-10-24T13:00:00'), 10, { withItems: false });
  const ids = blocks.filter(x => x.title && x.title.startsWith('Maratón')).map(x => x.mainShow.id);
  assert.deepStrictEqual(ids, ['b_e1', 'b_e2', 'b_e3', 'b_e4', 'b_e5']);
});

test('servicio: editar una regla sugerida la vuelve manual y la propuesta no la toca', async () => {
  const shows = Array.from({ length: 6 }, (_, i) => prog(`s${i}`, `Serie ${i}`, 120));
  const db = await makeDb(shows);
  const service = new ScheduleService({ db });
  const manager = new ProgrammingManager({ db, schedule: service });
  const proposal = manager.propose('test');
  assert.ok(proposal.rules.length > 0);
  manager.accept(proposal.id);
  const auto = db.programming.rules.all().find(r => r.source === 'auto' && r.kind === 'show');
  const { rule } = service.update(auto.id, { startTime: '06:00', days: ['monday', 'tuesday', 'wednesday', 'thursday', 'friday'] });
  assert.strictEqual(rule.source, 'manual');

  // Nueva propuesta: la regla ajustada sigue igual
  const again = manager.propose('test 2');
  manager.accept(again.id);
  const kept = db.programming.rules.find(auto.id);
  assert.ok(kept && kept.source === 'manual' && kept.startTime === '06:00');
  assert.ok(!db.programming.rules.all().some(r => r.id !== kept.id && r.days.includes('monday') && r.startTime === '06:00' && compileRules([r]).cells['monday|06:00']),
    'ninguna sugerencia nueva ocupa el mismo horario');
});

test('migración: la grilla anterior pasa a reglas y la emisión queda igual', async () => {
  const db = await makeDb([prog('a', 'Serie A', 60)]);
  const legacy = {
    monday: { '19:00': 'saga:serie-a', '02:00': 'off_air' },
    tuesday: { '19:00': 'saga:serie-a', '00:30': 'saga:serie-a' },
    saturday: { '10:00': 'saga:serie-a' }
  };
  db.updateScheduleConfig({ mode: 'weekly', weeklyGrid: legacy });
  db.store.data.settings.grid_locks = JSON.stringify({ saturday: { '10:00': true } });
  db.store.data.settings.programming_profiles = JSON.stringify({ sagas: { 'serie-a': { franja: 'prime', frequency: 'daily' } } });

  const service = new ScheduleService({ db });
  const report = service.migrateLegacy();
  assert.ok(report.rules >= 3);
  const rules = db.programming.rules.all();
  assert.strictEqual(rules.find(r => r.days.includes('saturday')).source, 'manual', 'el candado pasa a regla manual');
  assert.strictEqual(db.programming.series.get('serie-a').franja, 'prime');

  const { calendarGrid } = service.compile();
  const expected = { ...legacy, monday: { '19:00': 'saga:serie-a' } }; // el cierre 01-05 es implícito
  for (const day of Object.keys(expected)) assert.deepStrictEqual(calendarGrid[day], expected[day], day);
  assert.strictEqual(service.migrateLegacy(), null, 'solo se migra una vez');
});

test('calendario → día de transmisión: el martes 00:30 es la noche del lunes', () => {
  const b = calendarToBroadcast({ tuesday: { '00:30': 'x', '19:00': 'y' } });
  assert.strictEqual(b.monday['00:30'], 'x');
  assert.strictEqual(b.tuesday['19:00'], 'y');
});

/* ---------- La regla que se pone reemplaza lo que había ---------- */

const L_V = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday'];
const describe = (r) => `${r.target}|${r.days.join(',')}|${r.startTime}x${r.slots}|${r.source}`;

test('poner una regla reemplaza la que había debajo (completa, en parte o un solo día)', async () => {
  const db = await makeDb([]);
  const service = new ScheduleService({ db });
  const repo = db.programming.rules;

  // Mismo horario y días: la de debajo se elimina
  const jojo = service.create({ kind: 'show', target: 'saga:jojo', days: L_V, startTime: '08:30', slots: 1 }).rule;
  const res = service.create({ kind: 'show', target: 'saga:dbs', days: L_V, startTime: '08:30', slots: 1 });
  assert.strictEqual(res.replaced, 1);
  assert.strictEqual(repo.find(jojo.id), null);

  // Solo una parte del horario: la sugerida conserva lo que no se pisa
  repo.replaceAuto([{ kind: 'show', target: 'saga:sakura', days: L_V, startTime: '15:30', slots: 2 }]);
  service.create({ kind: 'show', target: 'saga:simpsons', days: L_V, startTime: '15:30', slots: 1 });
  const sakura = repo.all().filter(r => r.target === 'saga:sakura').map(describe);
  assert.deepStrictEqual(sakura, [`saga:sakura|${L_V.join(',')}|16:00x1|auto`]);

  // Un solo día: la de debajo sigue los demás días
  service.create({ kind: 'show', target: 'saga:inuyasha', days: ['friday'], startTime: '08:30', slots: 1 });
  const dbs = repo.all().filter(r => r.target === 'saga:dbs').map(describe);
  assert.deepStrictEqual(dbs, ['saga:dbs|monday,tuesday,wednesday,thursday|08:30x1|manual']);

  assert.deepStrictEqual(service.compile().conflicts, [], 'sin choques');
});

test('arrastrar un bloque: lo movido reemplaza lo que había, sin tocar las reglas del mismo movimiento', async () => {
  const db = await makeDb([]);
  const service = new ScheduleService({ db });
  const repo = db.programming.rules;
  const betty = service.create({ kind: 'show', target: 'saga:betty', days: L_V, startTime: '19:00', slots: 1 }).rule;
  const naruto = service.create({ kind: 'show', target: 'saga:naruto', days: ['friday'], startTime: '20:30', slots: 1 }).rule;

  // Mover Betty del viernes a las 20:30 (solo ese día)
  const out = service.batch([
    { op: 'update', id: betty.id, rule: { days: ['monday', 'tuesday', 'wednesday', 'thursday'] } },
    { op: 'create', rule: { kind: 'show', target: 'saga:betty', days: ['friday'], startTime: '20:30', slots: 1 } }
  ]);
  assert.strictEqual(out.replaced, 1);
  assert.strictEqual(repo.find(naruto.id), null);
  assert.deepStrictEqual(repo.all().map(describe).sort(), [
    'saga:betty|friday|20:30x1|manual',
    'saga:betty|monday,tuesday,wednesday,thursday|19:00x1|manual'
  ]);
});

test('quitar lo tapado: queda lo que sale al aire y desaparecen los choques', async () => {
  const db = await makeDb([]);
  const service = new ScheduleService({ db });
  const repo = db.programming.rules;
  // Los choques del caso real: dos maratones el domingo y Jojo/DBS cruzados a las 08:30 y 09:00
  const add = (r, at) => { const rule = repo.create({ ...r, source: r.source || 'manual' }); rule.updatedAt = at; return rule; };
  add({ kind: 'marathon', target: 'saga:yu-gi-oh', days: ['sunday'], startTime: '06:00', slots: 5 }, '2026-10-20T04:34:00.000Z');
  add({ kind: 'marathon', target: 'saga:dragon-ball', days: ['sunday'], startTime: '06:00', slots: 5 }, '2026-10-20T04:34:30.000Z');
  add({ kind: 'show', target: 'saga:grp-jojo', days: L_V, startTime: '08:30', slots: 1 }, '2026-10-20T04:23:00.000Z');
  add({ kind: 'show', target: 'saga:dragon-ball-super', days: L_V, startTime: '08:30', slots: 1 }, '2026-10-20T04:24:00.000Z');
  add({ kind: 'show', target: 'saga:grp-jojo', days: L_V, startTime: '09:00', slots: 1 }, '2026-10-20T04:24:30.000Z');
  add({ kind: 'show', target: 'saga:dragon-ball-super', days: ['tuesday', 'wednesday', 'thursday', 'friday'], startTime: '09:00', slots: 1 }, '2026-10-20T04:23:30.000Z');
  add({ kind: 'show', target: 'saga:los-simpsons', days: L_V, startTime: '15:30', slots: 1 }, '2026-10-19T15:06:00.000Z');
  add({ kind: 'show', target: 'saga:sakura-card-captor', days: L_V, startTime: '15:30', slots: 1, source: 'auto' }, '2026-10-20T00:29:00.000Z');

  const before = service.compile();
  assert.strictEqual(new Set(before.conflicts.map(c => c.winner)).size, 4);
  const onAir = (c) => Object.fromEntries(Object.entries(c.cells).map(([k, v]) => [k, v.value]));

  const { affected } = service.resolveConflicts();
  assert.strictEqual(affected, 4);
  const after = service.compile();
  assert.deepStrictEqual(after.conflicts, []);
  assert.deepStrictEqual(onAir(after), onAir(before), 'lo que sale al aire no cambia');
  assert.ok(!repo.all().some(r => r.target === 'saga:yu-gi-oh'));
  assert.ok(!repo.all().some(r => r.target === 'saga:sakura-card-captor'));
});
