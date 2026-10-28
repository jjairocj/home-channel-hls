/**
 * Tests de "Próximos capítulos": el bloque al aire sale de la cola real y los
 * siguientes de la proyección; un episodio por fila con su tipo y posición.
 */

const test = require('node:test');
const assert = require('node:assert');
const { upcomingAirings } = require('../programming/UpcomingEpisodes');

const at = (h, m = 0) => new Date(2026, 9, 22, h, m).toISOString();
const show = { id: 's1', title: 'Naruto', currentEpisodeIndex: 4, episodes: [1, 2, 3, 4, 5, 6].map(n => ({ id: `e${n}`, title: `Cap ${n}` })) };
const block = (h, m, ep, extra = {}) => ({ startTime: at(h, m), endTime: at(m === 30 ? h + 1 : h, m === 30 ? 0 : 30), title: 'Naruto', mainShow: ep, ...extra });

test('al aire de la cola real; lo demás de la proyección, con tipo y posición', () => {
  const onAir = [block(10, 0, { id: 'e4', showId: 's1', title: 'Cap 4', isRepeat: true, noAdvance: true })];
  const projected = [
    block(10, 0, { id: 'e5', showId: 's1', title: 'Cap 5' }), // proyección del bloque al aire: se ignora
    block(10, 30, { id: 'e5', showId: 's1', title: 'Cap 5', showTitle: 'Saga Naruto' }),
    block(11, 0, { id: 'e5', showId: 's1', title: 'Cap 5', isRepeat: true, noAdvance: true }),
    block(23, 0, { id: 'e2', showId: 's1', title: 'Cap 2', noAdvance: true }),
    block(23, 30, { id: 'e3', showId: 's1', title: 'Cap 3', marathon: true })
  ];
  const rows = upcomingAirings({ onAir, projected, now: new Date(2026, 9, 22, 10, 10), hours: 13, getShow: () => show });
  assert.deepStrictEqual(rows.map(r => [r.episodeId, r.kind, r.onAir]), [
    ['e4', 'repeat', true],
    ['e5', 'premiere', false],
    ['e5', 'repeat', false],
    ['e2', 'override', false]
  ], 'el maratón de las 23:30 queda fuera del horizonte de 13 h');
  assert.strictEqual(rows[1].series, 'Saga Naruto');
  assert.strictEqual(rows[1].index, 4);
  assert.strictEqual(rows[1].total, 6);
  assert.strictEqual(rows[1].pointer, 4);
});

test('bloque doble: una fila por cada episodio', () => {
  const projected = [block(14, 0, { id: 'e1', showId: 's1', title: 'Cap 1' }, { secondShow: { id: 'e2', showId: 's1', title: 'Cap 2' } })];
  const rows = upcomingAirings({ projected, now: new Date(2026, 9, 22, 13, 50), getShow: () => show });
  assert.deepStrictEqual(rows.map(r => [r.episodeId, r.part]), [['e1', 0], ['e2', 1]]);
});
