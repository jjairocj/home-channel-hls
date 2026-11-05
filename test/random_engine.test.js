const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const os = require('os');
const fs = require('fs');
const RandomEngine = require('../random/RandomEngine');

test('RandomEngine: baraja episodios de series autorizadas sin repetir (incluye Simpsons y Futurama)', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'random_test_'));
  const dummyFile = path.join(tmpDir, 'ep1.mp4');
  fs.writeFileSync(dummyFile, 'dummy');

  const mockDb = {
    getShows: () => [
      {
        id: 'fut1',
        title: 'Futurama',
        episodes: [
          { id: 'ep1', title: 'Piloto espacial 3000', path: dummyFile, duration: 1300 },
          { id: 'ep2', title: 'La serie ha aterrizado', path: dummyFile, duration: 1300 }
        ]
      },
      {
        id: 'simp1',
        title: 'Los Simpsons - Temporada 1',
        episodes: [
          { id: 'simp_ep1', title: 'Bart es un genio', path: dummyFile, duration: 1300 }
        ]
      },
      {
        id: 'rick',
        title: 'Rick y Morty',
        episodes: [
          { id: 'rick1', title: 'Piloto', path: dummyFile, duration: 1300 }
        ]
      },
      {
        id: 'coraje',
        title: 'Coraje el Perro Cobarde',
        episodes: [
          { id: 'coraje1', title: 'Una Noche en el Motel Gato Negro', path: dummyFile, duration: 1300 },
          { id: 'coraje2', title: 'El Espeluznante Fred', path: dummyFile, duration: 1300 }
        ]
      },
      {
        id: 'inu',
        title: 'Inuyasha',
        episodes: [
          { id: 'inu1', title: 'Capítulo 1', path: dummyFile, duration: 1400 }
        ]
      }
    ],
    getCommercials: () => [
      { id: 'b_ident', title: 'CrHe Station ID - Shonen', type: 'bumper', status: 'ready', path: dummyFile, duration: 15 }
    ],
    getJsonSetting: () => ({}),
    setJsonSetting: () => {}
  };

  const engine = new RandomEngine(mockDb, {
    streamDir: tmpDir,
    encoder: { name: 'test', args: [] }
  });

  const eps = engine.loadAllEpisodes();
  assert.strictEqual(eps.length, 6, 'Carga episodios de Simpsons, Futurama, Rick y Morty y Coraje (6), excluyendo Inuyasha');

  const queue = engine.buildQueue(1);
  // 6 episodios + 6 bumpers intermedios = 12 items
  assert.strictEqual(queue.length, 12);

  const status = engine.getStatus();
  assert.strictEqual(status.channelNumber, 101);
  assert.strictEqual(status.channelName, 'Random 24/7');

  const xml = engine.getXmltvProgrammes('http://localhost:3000', new Date(), 3);
  assert.ok(xml.includes('channel="random_tv"'));
  assert.ok(xml.includes('Variedades'));

  fs.rmSync(tmpDir, { recursive: true, force: true });
});
