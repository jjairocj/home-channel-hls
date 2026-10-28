const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const PlayoutQueue = require('../playout/PlayoutQueue');
const StatusPresenter = require('../playout/StatusPresenter');
const { selectAudioTrack } = require('../transcoding/AudioTrackSelector');
const { slotsNeededFor, MIN_BREAK_SECONDS } = require('../scheduling/SchedulePlanner');
const BlockComposer = require('../scheduling/BlockComposer');
const CommercialRotation = require('../scheduling/CommercialRotation');
const DurationCatalog = require('../library/DurationCatalog');
const Database = require('../database');

const tmpDir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'crhe-test-'));

test('PlayoutQueue: offsets e indexAt según duración real (targetDuration manda)', () => {
  const q = new PlayoutQueue([
    { id: 'a', duration: 100 },
    { id: 'b', duration: 30, targetDuration: 12.5 },
    { id: 'c', duration: 50 }
  ]);
  assert.deepStrictEqual(q.offsets, [0, 100, 112.5]);
  assert.strictEqual(q.indexAt(0), 0);
  assert.strictEqual(q.indexAt(99.9), 0);
  assert.strictEqual(q.indexAt(100), 1);
  assert.strictEqual(q.indexAt(112.4), 1);
  assert.strictEqual(q.indexAt(500), 2);
});

test('StatusPresenter: en la pausa comercial muestra el programa del BLOQUE en curso', () => {
  const blocks = [
    { title: 'Dragon Ball', startTime: '10:30', endTime: '11:00', items: [
      { id: 'db1', name: 'dragon_ball_e1.mp4', showTitle: 'Dragon Ball', role: 'main_show', duration: 1400 },
      { id: 'c1', name: 'spot.mp4', role: 'commercial', duration: 400 }
    ] },
    { title: 'Los Simpsons', startTime: '11:00', endTime: '11:30', items: [
      { id: 's1', name: 'simpsons.mp4', showTitle: 'Los Simpsons', role: 'main_show', duration: 1320 }
    ] }
  ];
  const queue = PlayoutQueue.fromBlocks(blocks);
  const presenter = new StatusPresenter({ cleanTitle: (n) => n, blockFor: () => null });
  const status = presenter.present({ queue, index: 1, position: 1500, running: true, startedAt: Date.now(), clock: null });

  assert.strictEqual(status.currentProgram.isCommercialBreak, true);
  assert.strictEqual(status.currentProgram.showTitle, 'Dragon Ball');
  assert.strictEqual(status.currentTrack.elapsed, 100);
  assert.strictEqual(status.nextProgram.showTitle, 'Los Simpsons');
});

test('AudioTrackSelector: prefiere latino y evita castellano', () => {
  const streams = [
    { index: 1, tags: { language: 'jpn' } },
    { index: 2, tags: { language: 'spa', title: 'Castellano' } },
    { index: 3, tags: { language: 'spa', title: 'Español Latino' } }
  ];
  assert.strictEqual(selectAudioTrack([
    { index: 1, tags: { language: 'eng', title: 'Inglés WWW.GDRIVELatinoHD.NET' } },
    { index: 2, tags: { language: 'spa', title: 'Latino WWW.GDRIVELatinoHD.NET' } }
  ]).map, '0:2');
  assert.strictEqual(selectAudioTrack(streams).map, '0:3');
  assert.strictEqual(selectAudioTrack([{ index: 1, tags: { language: 'eng' } }]).map, '0:a:0');
  assert.strictEqual(selectAudioTrack([{ index: 1, tags: { language: 'jpn' } }, { index: 4, tags: { language: 'spa' } }]).map, '0:4');
});

test('slotsNeededFor: un episodio pasa a 1 hora solo si no cabe con una pausa mínima', () => {
  assert.strictEqual(MIN_BREAK_SECONDS, 45);
  assert.strictEqual(slotsNeededFor(1380), 1);          // 23:00
  assert.strictEqual(slotsNeededFor(1745), 1);          // 29:05 → aún cabe en 30 min
  assert.strictEqual(slotsNeededFor(1800 - 44), 2);     // no deja ni 45 s de pausa
  assert.strictEqual(slotsNeededFor(2700), 2);          // 45 min
  assert.strictEqual(slotsNeededFor(3600), 3);
});

test('BlockComposer: el bloque suma exactamente 30 / 60 minutos', () => {
  const commercials = Array.from({ length: 8 }, (_, i) => ({ id: `c${i}`, name: `spot${i}.mp4`, duration: 30 + i * 7 }));
  const bumpers = { forRole: () => null, regular: () => [{ id: 'b1', name: 'b1.mp4', duration: 9.4 }] };
  const composer = new BlockComposer({
    bumpers,
    rotation: new CommercialRotation(() => commercials),
    getCommercials: () => commercials,
    bumpersDir: '/tmp'
  });
  const sum = (block) => block.items.reduce((s, it) => s + PlayoutQueue.durationOf(it), 0);

  for (const dur of [1300.4, 1380, 1460.7]) {
    const block = composer.compose({ id: 'ep', name: 'ep.mp4', duration: dur }, 1800);
    assert.ok(Math.abs(sum(block) - 1800) < 0.01, `30 min con episodio de ${dur}s → ${sum(block)}`);
  }
  const hour = composer.compose({ id: 'e1', name: 'e1.mp4', duration: 1400 }, 3600, { id: 'e2', name: 'e2.mp4', duration: 1410.3 });
  assert.ok(Math.abs(sum(hour) - 3600) < 0.01);
  assert.strictEqual(hour.items.filter(i => i.role === 'main_show').length, 2);
});

test('BlockComposer: la tanda final cierra con "A continuación" sin duplicar al abrir', () => {
  const commercials = Array.from({ length: 8 }, (_, i) => ({ id: `c${i}`, name: `spot${i}.mp4`, duration: 30 + i * 7 }));
  const named = { break_in: { id: 'in', name: 'estas viendo.mp4', duration: 6 }, break_out: { id: 'out', name: 'a continuacion.mp4', duration: 10 } };
  const bumpers = { forRole: (r) => named[r] || null, regular: () => [{ id: 'b1', name: 'b1.mp4', duration: 9.4 }] };
  const composer = new BlockComposer({ bumpers, rotation: new CommercialRotation(() => commercials), getCommercials: () => commercials, bumpersDir: '/tmp' });
  const sum = (block) => block.items.reduce((s, it) => s + PlayoutQueue.durationOf(it), 0);

  const single = composer.compose({ id: 'ep', name: 'ep.mp4', duration: 1380 }, 1800);
  const roles = single.items.map(i => i.role);
  assert.deepStrictEqual(roles.slice(0, 2), ['main_show', 'mid_bumper_in']);
  assert.strictEqual(roles[2], 'commercial');
  assert.ok(roles.indexOf('outro_bumper') > roles.lastIndexOf('commercial'), 'cierra con A continuación');
  assert.strictEqual(roles.filter(r => r === 'next_up_bumper' || r === 'outro_bumper').length, 1, 'un solo A continuación por tanda');
  assert.ok(Math.abs(sum(single) - 1800) < 0.01);

  const hour = composer.compose({ id: 'e1', name: 'e1.mp4', duration: 1400 }, 3600, { id: 'e2', name: 'e2.mp4', duration: 1410.3 });
  const hourRoles = hour.items.map(i => i.role);
  const second = hourRoles.lastIndexOf('main_show');
  assert.deepStrictEqual(hourRoles.slice(second, second + 2), ['main_show', 'outro_bumper_in']);
  assert.strictEqual(hourRoles.filter(r => r === 'outro_bumper').length, 1, 'solo un A continuación al cierre');
  assert.ok(Math.abs(sum(hour) - 3600) < 0.01);

  // Sin tiempo para la tanda: no se fuerza
  const tight = composer.compose({ id: 'ep', name: 'ep.mp4', duration: 1760 }, 1800);
  assert.ok(!tight.items.some(i => i.role === 'next_up_bumper'));
  assert.ok(Math.abs(sum(tight) - 1800) < 0.01);
});

let hasFfmpeg = true;
try { execFileSync('ffmpeg', ['-version'], { stdio: 'ignore' }); } catch (e) { hasFfmpeg = false; }

test('DurationCatalog.audit: corrige duraciones enteras heredadas', { skip: !hasFfmpeg && 'ffmpeg no disponible' }, async () => {
  const dir = tmpDir();
  const clip = path.join(dir, 'clip.mp4');
  execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'testsrc=size=64x64:rate=10', '-t', '3.5', '-pix_fmt', 'yuv420p', clip]);
  const cacheFile = path.join(dir, 'cache.json');
  fs.writeFileSync(cacheFile, JSON.stringify({ [clip]: 1380 }));

  const catalog = new DurationCatalog({ cacheFile });
  const fixes = await catalog.audit([clip]);
  assert.strictEqual(fixes.length, 1);
  assert.strictEqual(fixes[0].before, 1380);
  assert.ok(Math.abs(fixes[0].after - 3.5) < 0.2);
  assert.deepStrictEqual(await catalog.audit([clip]), [], 'una medición precisa no se vuelve a revisar');
});

test('Database (sin Postgres): repositorios, fin de serie y corrección de duración', async () => {
  const db = new Database({ dataDir: tmpDir(), pgConfig: { host: '127.0.0.1', port: 1, connectionTimeoutMillis: 200 } });
  await db.ready;
  clearTimeout(db.pg.reconnectTimer);

  const show = db.createShow({ title: 'Prueba' });
  db.addEpisodeToShow(show.id, { path: '/a.mp4', duration: 1380, season: 1, episode: 2 });
  db.addEpisodeToShow(show.id, { path: '/b.mp4', duration: 1300, season: 1, episode: 1 });
  assert.deepStrictEqual(db.getShow(show.id).episodes.map(e => e.path), ['/b.mp4', '/a.mp4']);

  assert.strictEqual(db.updateMediaDuration('/a.mp4', 1461.4), true);
  assert.strictEqual(db.getShow(show.id).episodes[1].durationFormatted, '24:21');
  assert.strictEqual(db.updateMediaDuration('/no-existe.mp4', 10), false);

  // Con capítulos aún en cola, la serie queda "en espera" en vez de volver al 1
  db.addTranscodeJob({ id: 'job1', showId: show.id, status: 'pending' });
  db.updateShowProgress(show.id, 1);
  assert.strictEqual(db.advanceShowProgress(show.id), 2);
  assert.strictEqual(db.getJsonSetting('programming_profiles').shows[show.id].waiting, true);

  // Sin pendientes: terminada y vuelve al inicio
  db.updateTranscodeJob('job1', { status: 'completed' });
  db.updateShowProgress(show.id, 1);
  assert.strictEqual(db.advanceShowProgress(show.id), 0);
  assert.strictEqual(db.pg.dirtyWhileOffline, true, 'los cambios sin conexión quedan para subirse');
  db.flushLocalJsonSync();
});
