/**
 * Tests de la rotación de comerciales (separación + al azar entre los menos recientes).
 */

const test = require('node:test');
const assert = require('node:assert');
const CommercialRotation = require('../scheduling/CommercialRotation');

const spots = (n, duration = () => 30) => Array.from({ length: n }, (_, i) => ({ id: `c${i}`, name: `C${i}`, duration: duration(i) }));

/** Simula tandas de un bloque: dos cortes por bloque, como el BlockComposer. */
function simulate(rotation, blocks, budgets = [120, 150]) {
  const out = [];
  for (let b = 0; b < blocks; b++) {
    rotation.nextBlock();
    const used = new Set();
    const block = [];
    for (const budget of budgets) block.push(...rotation.pick(budget, used).map(c => c.id));
    out.push(block);
  }
  return out;
}

test('todos salen parejo: en cualquier momento, como mucho 4 emisiones de diferencia', () => {
  const list = spots(25);
  const aired = simulate(new CommercialRotation(() => list), 60).flat();
  for (let end = 50; end <= aired.length; end += 25) {
    const counts = Object.fromEntries(list.map(c => [c.id, 0]));
    for (const id of aired.slice(0, end)) counts[id]++;
    const values = Object.values(counts);
    assert.ok(Math.max(...values) - Math.min(...values) <= 4, `hasta ${end}: ${values}`);
  }
});

test('las tandas cambian de composición (no salen siempre los mismos juntos)', () => {
  const list = spots(25);
  const blocks = simulate(new CommercialRotation(() => list), 30).map(b => [...b].sort().join(','));
  assert.strictEqual(new Set(blocks).size, blocks.length, 'ninguna tanda se repite igual');
  const pairs = new Map();
  for (const b of simulate(new CommercialRotation(() => list), 60)) {
    for (let i = 1; i < b.length; i++) {
      const key = `${b[i - 1]}>${b[i]}`;
      pairs.set(key, (pairs.get(key) || 0) + 1);
    }
  }
  // Al azar puro el par más repetido sale ~7 veces en 60 bloques: no debe ser peor
  assert.ok(Math.max(...pairs.values()) <= 9, `par repetido ${Math.max(...pairs.values())} veces`);
});

test('sin repetidos en un bloque ni entre bloques seguidos (si alcanzan)', () => {
  const list = spots(25);
  const blocks = simulate(new CommercialRotation(() => list), 50);
  blocks.forEach((b, i) => {
    assert.strictEqual(new Set(b).size, b.length, `bloque ${i} repite un comercial`);
    if (i) assert.ok(b.every(id => !blocks[i - 1].includes(id)), `bloque ${i} repite del anterior`);
  });
});

test('los comerciales largos no quedan relegados', () => {
  const list = spots(20, i => (i < 4 ? 90 : 20));
  const aired = simulate(new CommercialRotation(() => list), 60).flat();
  const counts = {};
  for (const id of aired) counts[id] = (counts[id] || 0) + 1;
  const long = [0, 1, 2, 3].map(i => counts[`c${i}`] || 0);
  const short = Object.entries(counts).filter(([id]) => !['c0', 'c1', 'c2', 'c3'].includes(id)).map(([, n]) => n);
  assert.ok(Math.min(...long) >= Math.min(...short) - 7, `largos ${long} vs cortos ${Math.min(...short)}-${Math.max(...short)}`);
});

test('bloques muy largos: si no alcanzan, se repiten pero nunca dos seguidos', () => {
  const list = spots(5);
  const [block] = simulate(new CommercialRotation(() => list), 1, [600]);
  assert.ok(block.length > 5);
  for (let i = 1; i < block.length; i++) assert.notStrictEqual(block[i], block[i - 1]);
});

test('los comerciales nuevos entran a la rotación y los borrados salen', () => {
  let list = spots(10);
  const rotation = new CommercialRotation(() => list);
  simulate(rotation, 2);
  list = [...list.slice(2), { id: 'nuevo', name: 'Nuevo', duration: 30 }];
  const aired = simulate(rotation, 6).flat();
  assert.ok(aired.includes('nuevo'));
  assert.ok(!aired.includes('c0') && !aired.includes('c1'));
});

test('rotación baja: sale cerca de un tercio de lo normal; pausado: nunca sale', () => {
  const list = spots(25).map((c, i) => ({ ...c, rotation: i === 0 ? 'low' : (i === 1 ? 'paused' : 'normal') }));
  const aired = simulate(new CommercialRotation(() => list), 120).flat();
  const counts = {};
  for (const id of aired) counts[id] = (counts[id] || 0) + 1;
  const normal = Object.entries(counts).filter(([id]) => !['c0', 'c1'].includes(id)).map(([, n]) => n);
  const avg = normal.reduce((a, b) => a + b, 0) / normal.length;
  assert.strictEqual(counts.c1 || 0, 0, 'el pausado no sale');
  assert.ok(counts.c0 >= avg * 0.2 && counts.c0 <= avg * 0.5, `baja: ${counts.c0} vs normal ~${avg.toFixed(1)}`);
});
