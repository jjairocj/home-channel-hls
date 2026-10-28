/**
 * Tests de la caché de duraciones: con la caché vacía no se lanzan miles de ffprobe a
 * la vez, y una caché dañada (disco lleno) se recupera de la copia.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ffmpeg = require('../lib/ffmpeg');

test('con miles de archivos por medir, nunca hay más de MAX_PROBES ffprobe a la vez', async () => {
  let active = 0;
  let peak = 0;
  let calls = 0;
  const original = ffmpeg.probeDuration;
  ffmpeg.probeDuration = async () => {
    calls++;
    active++;
    peak = Math.max(peak, active);
    await new Promise(r => setImmediate(r));
    active--;
    return 1400.5;
  };
  delete require.cache[require.resolve('../library/DurationCatalog')];
  const DurationCatalog = require('../library/DurationCatalog');
  try {
    let measured = 0;
    const done = new Promise(resolve => {
      const cat = new DurationCatalog({ onMeasured: () => { measured++; resolve(cat); } });
      cat.load();
      for (let i = 0; i < 3000; i++) cat.resolve(`/media/ep_${i}.mp4`, 1400);
    });
    const cat = await done;
    assert.strictEqual(calls, 3000);
    assert.ok(peak <= DurationCatalog.MAX_PROBES, `pico de ${peak} ffprobe simultáneos`);
    assert.strictEqual(measured, 1, 'un solo re-escaneo al terminar la fila');
    assert.strictEqual(cat.cached('/media/ep_10.mp4'), 1400.5);
  } finally {
    ffmpeg.probeDuration = original;
    delete require.cache[require.resolve('../library/DurationCatalog')];
  }
});

test('caché vacía (escrita con el disco lleno): se usa la copia y la escritura es atómica', async () => {
  const DurationCatalog = require('../library/DurationCatalog');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'x99-dur-'));
  const file = path.join(dir, 'duration_cache.json');
  fs.writeFileSync(file, '');
  fs.writeFileSync(`${file}.bak`, JSON.stringify({ '/media/a.mp4': 1461.6 }));
  const cat = new DurationCatalog({ cacheFile: file });
  assert.strictEqual(cat.cached('/media/a.mp4'), 1461.6);

  cat.cache.set('/media/b.mp4', 1409.8);
  await cat.writeCache();
  assert.deepStrictEqual(JSON.parse(fs.readFileSync(file, 'utf8')), { '/media/a.mp4': 1461.6, '/media/b.mp4': 1409.8 });
  assert.ok(!fs.existsSync(`${file}.tmp`));
  fs.rmSync(dir, { recursive: true, force: true });
});
