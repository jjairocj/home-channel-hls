/**
 * Tests de la "Cartelera de hoy" quemada en la señal: ubicación en el relleno, suma
 * exacta del bloque y contenido (lo que sigue y los próximos programas).
 */

const test = require('node:test');
const assert = require('node:assert');

const { decorateWithBillboard } = require('../scheduling/NextUpDecorator');
const { renderBillboardSvg } = require('../library/billboardTemplate');

const SLOT = 1800;
const lengthOf = (it) => it.targetDuration || it.duration;

/** Bloque de 30 min: episodio + tanda + "A continuación" + relleno de `pad` segundos en dos bumpers. */
function block(start, title, pad, { offAir = false } = {}) {
  const startTime = new Date(start).toISOString();
  const endTime = new Date(new Date(start).getTime() + SLOT * 1000).toISOString();
  if (offAir) return { startTime, endTime, title: 'Home Channel HLS // Cierre de Emisión', isOffAir: true, items: [] };
  const show = SLOT - 300 - 12 - pad;
  const first = Math.min(pad, 15);
  const items = [
    { id: 'ep', role: 'main_show', duration: show, slotOffset: 0 },
    { id: 'ads', role: 'commercial', duration: 300, slotOffset: show },
    { id: 'next', role: 'outro_bumper', duration: 12, slotOffset: show + 300 },
    { id: 'pad1', role: 'filler_pad', duration: Math.round(first), targetDuration: first, slotOffset: show + 312, path: '/b/1.mp4' }
  ];
  if (pad > first) items.push({ id: 'pad2', role: 'filler_pad', duration: Math.round(pad - first), targetDuration: pad - first, slotOffset: show + 312 + first, path: '/b/2.mp4' });
  return { startTime, endTime, title, mainShow: { name: title }, items };
}

function fakeRenderer() {
  const calls = [];
  return {
    calls,
    getOrCreateBillboard(entries, opts) {
      calls.push({ entries, opts });
      return { id: 'dyn_board_x', name: 'Home Channel HLS // Cartelera de hoy', path: '/dyn/board.mp4', duration: 20, type: 'bumper' };
    }
  };
}

const sum = (items) => items.reduce((s, it) => s + lengthOf(it), 0);
const contiguous = (items) => items.every((it, i) => i === 0 || Math.abs(it.slotOffset - (items[i - 1].slotOffset + lengthOf(items[i - 1]))) < 1e-6);

test('la cartelera abre el relleno y el bloque sigue sumando exactamente 30 min', () => {
  const blocks = [
    block('2026-10-20T18:30:00', 'Yo soy Betty, la fea', 31.4),
    block('2026-10-20T19:00:00', 'Neon Genesis Evangelion', 10),
    block('2026-10-20T19:30:00', 'Jojo', 5),
    block('2026-10-20T20:00:00', 'Inuyasha', 12)
  ];
  const renderer = fakeRenderer();
  decorateWithBillboard(blocks, renderer, (n) => n);

  const items = blocks[0].items;
  const pads = items.filter(it => it.role === 'filler_pad');
  assert.strictEqual(pads[0].id, 'dyn_board_x');
  assert.strictEqual(pads[0].targetDuration, 20);
  assert.ok(Math.abs(sum(items) - SLOT) < 1e-6, `suma ${sum(items)}`);
  assert.ok(contiguous(items), 'sin huecos ni solapes');
  assert.ok(pads.slice(1).every(p => p.path.startsWith('/b/')), 'el resto del relleno son los bumpers de siempre');

  // Lo que sigue primero, con hora
  const { entries, opts } = renderer.calls[0];
  assert.deepStrictEqual(entries.map(e => `${e.time} ${e.title}`), ['7:00 PM Neon Genesis Evangelion', '7:30 PM Jojo', '8:00 PM Inuyasha']);
  assert.match(opts.dateLabel, /^MARTES 20 OCT$/);
});

test('relleno corto: la cartelera se recorta al hueco; menos de 8 s no lleva cartelera', () => {
  const blocks = [
    block('2026-10-20T19:00:00', 'Evangelion', 10),
    block('2026-10-20T19:30:00', 'Jojo', 5),
    block('2026-10-20T20:00:00', 'Inuyasha', 12)
  ];
  decorateWithBillboard(blocks, fakeRenderer(), (n) => n);
  const pads10 = blocks[0].items.filter(it => it.role === 'filler_pad');
  assert.strictEqual(pads10.length, 1);
  assert.strictEqual(pads10[0].targetDuration, 10);
  assert.ok(Math.abs(sum(blocks[0].items) - SLOT) < 1e-6);
  assert.ok(!blocks[1].items.some(it => it.billboard), '5 s de relleno: sin cartelera');
});

test('no deja astillas: si sobra menos de 2 s, la cartelera se acorta', () => {
  const blocks = [block('2026-10-20T19:00:00', 'Evangelion', 21), block('2026-10-20T19:30:00', 'Jojo', 9)];
  decorateWithBillboard(blocks, fakeRenderer(), (n) => n);
  const pads = blocks[0].items.filter(it => it.role === 'filler_pad');
  assert.strictEqual(pads[0].targetDuration, 19);
  assert.strictEqual(pads[1].targetDuration, 2);
  assert.ok(Math.abs(sum(blocks[0].items) - SLOT) < 1e-6);
});

test('cierres seguidos aparecen en una sola fila; el último bloque no lleva cartelera', () => {
  const blocks = [
    block('2026-10-21T00:30:00', 'Ergo Proxy', 15),
    block('2026-10-21T01:00:00', '', 0, { offAir: true }),
    block('2026-10-21T01:30:00', '', 0, { offAir: true }),
    block('2026-10-21T02:00:00', '', 0, { offAir: true })
  ];
  const renderer = fakeRenderer();
  decorateWithBillboard(blocks, renderer, (n) => n);
  assert.strictEqual(renderer.calls[0].entries.length, 1);
  assert.strictEqual(renderer.calls[0].entries[0].offAir, true);
});

test('sin clip renderizado aún, el bloque queda como estaba', () => {
  const blocks = [block('2026-10-20T19:00:00', 'Evangelion', 25), block('2026-10-20T19:30:00', 'Jojo', 9)];
  const before = JSON.stringify(blocks[0].items);
  decorateWithBillboard(blocks, { getOrCreateBillboard: () => null }, (n) => n);
  assert.strictEqual(JSON.stringify(blocks[0].items), before);
});

test('plantilla: escapa los títulos y marca lo que sigue', () => {
  const svg = renderBillboardSvg({ entries: [{ time: '19:00', title: 'Tom & Jerry <Especial>' }, { time: '01:00', title: '', offAir: true }], dateLabel: 'MARTES 20 OCT' });
  assert.match(svg, /TOM &amp; JERRY &lt;ESPECIAL&gt;/);
  assert.match(svg, /A CONTINUACIÓN/);
  assert.match(svg, /CIERRE DE EMISIÓN/);
  assert.match(svg, /CARTELERA DE HOY/);
});

test('al terminar una tanda de renders avisa una vez con los clips nuevos', async () => {
  const fs = require('fs');
  const os = require('os');
  const path = require('path');
  const NextUpBumpers = require('../library/NextUpBumpers');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'x99-clips-'));
  const notices = [];
  const m = new NextUpBumpers({ bumpersDir: dir, onBatchReady: (n) => notices.push(n) });
  const fakeRender = (out, ok) => async () => { if (ok) fs.writeFileSync(out, Buffer.alloc(250000)); };
  const a = path.join(dir, 'dynamic', 'a.mp4');
  const b = path.join(dir, 'dynamic', 'b.mp4');
  const c = path.join(dir, 'dynamic', 'c.mp4');
  m.enqueue({ key: 'a', outputPath: a, run: fakeRender(a, true) });
  m.enqueue({ key: 'b', outputPath: b, run: fakeRender(b, false) });
  m.enqueue({ key: 'c', outputPath: c, run: fakeRender(c, true) });
  m.enqueue({ key: 'a', outputPath: a, run: fakeRender(a, true) }); // repetido: no se encola
  while (m.isProcessingQueue) await new Promise(r => setTimeout(r, 50));
  assert.deepStrictEqual(notices, [2]);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('"A continuación" se personaliza al abrir y al cerrar la tanda', () => {
  const { decorateWithNextUp } = require('../scheduling/NextUpDecorator');
  const blocks = [block('2026-10-20T19:00:00', 'Evangelion', 10), block('2026-10-20T19:30:00', 'Jojo', 9)];
  blocks[0].items.splice(1, 0, { id: 'generic', role: 'next_up_bumper', duration: 12, slotOffset: 0 });
  const renderer = { getOrCreateNextBumper: ({ showTitle, duration }) => ({ id: `dyn_${showTitle}`, path: '/dyn/next.mp4', duration }) };
  decorateWithNextUp(blocks, renderer, (n) => n);
  const nextUps = blocks[0].items.filter(it => it.role === 'next_up_bumper' || it.role === 'outro_bumper');
  assert.deepStrictEqual(nextUps.map(it => `${it.role}:${it.id}`), ['next_up_bumper:dyn_Jojo', 'outro_bumper:dyn_Jojo']);
});

test('cartelera: la hora en AM-PM se achica para no pisar el título', () => {
  const svg = renderBillboardSvg({ entries: [{ time: '10:30 PM', title: 'Beastars' }, { time: '7:00', title: 'Otro' }], dateLabel: 'MAR 21 OCT' });
  assert.match(svg, /font-size="46" font-weight="bold">10:30 PM</);
  assert.match(svg, /font-size="64" font-weight="bold">7:00</);
});
