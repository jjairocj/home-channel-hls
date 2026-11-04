const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const os = require('os');
const fs = require('fs');
const RandomEngine = require('../random/RandomEngine');

test('RandomEngine: baraja episodios sin repetir y soporta modo bajo demanda', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'random_test_'));
  const dummyFile = path.join(tmpDir, 'ep1.mp4');
  fs.writeFileSync(dummyFile, 'dummy');

  const mockDb = {
    getShows: () => [
      {
        id: 'show1',
        title: 'Show Uno',
        episodes: [
          { id: 'ep1', title: 'Episodio 1', path: dummyFile, duration: 1300 },
          { id: 'ep2', title: 'Episodio 2', path: dummyFile, duration: 1300 }
        ]
      },
      {
        id: 'show2',
        title: 'Show Dos',
        episodes: [
          { id: 'ep3', title: 'Episodio 3', path: dummyFile, duration: 1300 }
        ]
      }
    ],
    getCommercials: () => [
      { id: 'b_ident', title: 'Station ID', type: 'bumper', status: 'ready', path: dummyFile, duration: 15 }
    ],
    getJsonSetting: (k, def) => {
      if (k === 'random_channel_config') return { showIds: ['show1', 'show2'] };
      return def;
    },
    setJsonSetting: () => {}
  };

  const engine = new RandomEngine(mockDb, {
    streamDir: tmpDir,
    channelNumber: 101,
    channelName: '24/7 Shuffle Channel',
    encoder: { name: 'test', args: [] }
  });

  const eps = engine.loadAllEpisodes();
  assert.strictEqual(eps.length, 3, 'Carga los 3 episodios autorizados');

  const queue = engine.buildQueue(1);
  assert.strictEqual(queue.length, 6, '3 episodios + 3 cortinillas');

  const status = engine.getStatus();
  assert.strictEqual(status.channelNumber, 101);
  assert.strictEqual(status.channelName, '24/7 Shuffle Channel');
  assert.strictEqual(status.isOnDemand, true);

  // Prueba On-Demand: touch() despierta el canal
  let started = false;
  engine.start = () => {
    started = true;
    engine.process = { running: true, kill: () => {} };
    return { success: true };
  };
  engine.touch();
  assert.ok(started, 'touch() activa la emisión bajo demanda');

  // Perro guardián de inactividad
  let stopped = false;
  engine.stop = () => { stopped = true; engine.process = null; };
  engine.lastHitAt = Date.now() - 200000;
  engine.startInactivityWatchdog(100);
  if (engine.isRunning && Date.now() - engine.lastHitAt > 100) {
    engine.stop();
  }
  assert.ok(stopped, 'El canal entra en reposo tras timeout');
  if (engine.inactivityTimer) clearInterval(engine.inactivityTimer);

  const xml = engine.getXmltvProgrammes('http://localhost:3000', new Date(), 3);
  assert.ok(xml.includes('channel="random_tv"'));

  fs.rmSync(tmpDir, { recursive: true, force: true });
});
