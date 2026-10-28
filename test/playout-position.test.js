/**
 * Tests de la posición de la emisión: un reporte viejo de FFmpeg (del proceso que se
 * acaba de reemplazar) no puede adelantar lo que el sistema cree que está al aire.
 */

const test = require('node:test');
const assert = require('node:assert');

const PlayoutEngine = require('../playout/PlayoutEngine');
const PlayoutQueue = require('../playout/PlayoutQueue');

function fakeEngine(startedSecondsAgo) {
  const queue = new PlayoutQueue([
    { name: 'Intro', role: 'intro_bumper', duration: 20 },
    { name: 'InuYasha 02', role: 'main_show', duration: 1462 },
    { name: 'Comercial', role: 'commercial', duration: 312 },
    { name: 'Sincronizador', role: 'filler_pad', duration: 6 }
  ]);
  return {
    queue,
    index: 0,
    seekOffset: 0,
    outTimeSec: null,
    processStartedAt: Date.now() - startedSecondsAgo * 1000,
    isRunning: true,
    get currentTrack() { return this.queue.at(this.index); },
    finishItem() {},
    currentPosition: PlayoutEngine.prototype.currentPosition,
    track: PlayoutEngine.prototype.track
  };
}

test('un reporte por delante del reloj (el último del proceso anterior) se recorta', () => {
  const e = fakeEngine(600);
  e.outTimeSec = 1800; // lo que alcanzó a reportar el FFmpeg del bloque anterior
  assert.ok(e.currentPosition() <= 603, 'nunca más de 3 s por delante del reloj');
  e.track();
  assert.strictEqual(e.currentTrack.name, 'InuYasha 02', 'sigue en el capítulo, no en el relleno');
});

test('si el índice quedó adelantado, se recoloca en lo que de verdad está al aire', () => {
  const e = fakeEngine(600);
  e.index = 3; // quedó en el sincronizador por un reporte erróneo
  e.outTimeSec = 598;
  e.track();
  assert.strictEqual(e.currentTrack.name, 'InuYasha 02');

  // Avance normal: al terminar el capítulo pasa a la tanda
  e.processStartedAt = Date.now() - 1490 * 1000;
  e.outTimeSec = 1489;
  e.track();
  assert.strictEqual(e.currentTrack.name, 'Comercial');
});
