/**
 * Tests del cuadro "lo que sigue" durante el capítulo: momentos (mitad y final),
 * textos (solo el nombre de la serie) y la pista de imágenes para FFmpeg. También el
 * recuadro y la marquesina de la tanda comercial.
 */

const test = require('node:test');
const assert = require('node:assert');

const PlayoutQueue = require('../playout/PlayoutQueue');
const FfmpegHlsProcess = require('../playout/FfmpegHlsProcess');
const { planLowerThirds, planBreaks, trackConcat, clock } = require('../playout/LowerThirds');
const { tickerFilter, tickerText } = require('../playout/Ticker');
const { renderLowerThirdSvg } = require('../library/lowerThirdTemplate');

const at = (h, m) => new Date(2026, 9, 20, h, m, 0).toISOString();

/** Bloque de 30 min: episodio de `ep` segundos + tanda hasta completar. */
function block(start, title, ep, extra = {}) {
  const items = [];
  if (extra.offAir) {
    items.push({ role: 'signoff', duration: 1800 });
  } else {
    items.push({ role: 'main_show', duration: ep, isRepeat: !!extra.repeat, marathon: !!extra.marathon, dailyKey: extra.premiere ? 'k' : undefined });
    items.push({ role: 'commercial', duration: 1800 - ep });
  }
  return { startTime: start, endTime: start, title, items };
}

const queueOf = (blocks) => PlayoutQueue.fromBlocks(blocks);

test('a la mitad y 90 s antes del final, con el siguiente programa', () => {
  const q = queueOf([
    block(at(19, 0), 'Neon Genesis Evangelion', 1380, { premiere: true }),
    block(at(19, 30), 'Inuyasha', 1380, { premiere: true }),
    block(at(20, 0), 'Dragon Ball Z', 1380, { repeat: true })
  ]);
  const w = planLowerThirds(q, 0);
  const first = w.filter(x => x.start < 1800 && x.moment !== 'break');
  assert.deepStrictEqual(first.map(x => [x.moment, x.start, x.end]), [['mid', 690, 700], ['end', 1290, 1302]]);

  const mid = first[0].card;
  assert.strictEqual(mid.label, 'MÁS TARDE EN Home Channel');
  assert.strictEqual(`${mid.time} ${mid.title}`, '7:30 PM Inuyasha');
  assert.strictEqual(mid.tag, 'ESTRENO');
  assert.strictEqual(mid.sub, 'Después: 8:00 PM Dragon Ball Z');

  const end = first[1].card;
  assert.strictEqual(end.label, 'A CONTINUACIÓN');
  assert.strictEqual(`${end.time} ${end.title}`, '7:30 PM Inuyasha');
  assert.strictEqual(end.sub, null);

  // Segundo bloque: lo que sigue es una repetición
  assert.strictEqual(w.find(x => x.start > 1800).card.tag, 'REPETICIÓN');
});

test('al arrancar a mitad de capítulo, los tiempos descuentan el seek y no se repiten cuadros pasados', () => {
  const q = queueOf([block(at(19, 0), 'Evangelion', 1380), block(at(19, 30), 'Inuyasha', 1380)]);
  const w = planLowerThirds(q, 900);
  assert.strictEqual(w[0].moment, 'end');
  assert.strictEqual(w[0].start, 1290 - 900);
});

test('cierre de emisión, misma serie y maratón', () => {
  const q = queueOf([
    block(at(0, 0), 'Dragon Ball Super', 1380),
    block(at(0, 30), 'Ergo Proxy', 1380),
    block(at(1, 0), 'Home Channel HLS // Cierre de Emisión', 0, { offAir: true }),
    block(at(1, 30), 'Home Channel HLS // Cierre de Emisión', 0, { offAir: true }),
    block(at(5, 0), 'Avatar', 1380)
  ]);
  const ergoEnd = planLowerThirds(q, 0).find(x => x.start > 1800 && x.moment === 'end');
  assert.deepStrictEqual(ergoEnd.card, { label: 'ESTA NOCHE', time: '1:00 AM', title: 'Cierre de emisión', tag: null, sub: 'Volvemos a las 5:00 AM' });

  const m = queueOf([
    block(at(17, 30), 'Rick y Morty', 1380),
    block(at(18, 0), 'Maratón: Naruto', 1380, { marathon: true }),
    block(at(18, 30), 'Maratón: Naruto', 1380, { marathon: true }),
    block(at(19, 0), 'Maratón: Naruto', 1380, { marathon: true }),
    block(at(19, 30), 'Jojo', 1380)
  ]);
  const wm = planLowerThirds(m, 0);
  const beforeMarathon = wm.find(x => x.moment === 'mid');
  assert.strictEqual(beforeMarathon.card.title, 'Naruto', 'sin el prefijo "Maratón:"');
  assert.strictEqual(beforeMarathon.card.tag, 'MARATÓN · CAP. 1 DE 3');
  const inside = wm.filter(x => x.moment === 'mid')[1];
  assert.strictEqual(inside.card.label, 'SIGUE EL MARATÓN');
  assert.strictEqual(inside.card.tag, 'MARATÓN · CAP. 2 DE 3');

  const same = queueOf([block(at(12, 0), 'Los Simpsons', 1300), block(at(12, 30), 'Los Simpsons', 1300), block(at(13, 0), 'Jojo', 1380)]);
  assert.strictEqual(planLowerThirds(same, 0)[0].card.tag, 'OTRO CAPÍTULO');
});

test('episodios cortos solo llevan el cuadro final; bloque de una hora avisa que sigue otro capítulo', () => {
  const shortQ = queueOf([block(at(14, 0), 'Smiling Friends', 420), block(at(14, 30), 'Jojo', 1380)]);
  const ws = planLowerThirds(shortQ, 0).filter(x => x.start < 1800 && x.moment !== 'break');
  assert.deepStrictEqual(ws.map(x => x.moment), ['end']);
  assert.ok(ws[0].end <= 420, 'dentro del episodio');

  const hour = {
    startTime: at(21, 0), endTime: at(22, 0), title: 'Los Simpsons (Doble Episodio)',
    items: [{ role: 'main_show', duration: 1300 }, { role: 'commercial', duration: 200 }, { role: 'main_show', duration: 1300 }, { role: 'commercial', duration: 800 }]
  };
  const wh = planLowerThirds(queueOf([hour, block(at(22, 0), 'Beastars', 1380)]), 0).filter(x => x.moment !== 'break');
  assert.deepStrictEqual(wh.map(x => [x.moment, x.card.label]), [
    ['mid', 'SIGUE EN ESTE BLOQUE'],
    ['mid', 'MÁS TARDE EN Home Channel'],
    ['end', 'A CONTINUACIÓN']
  ]);
  assert.strictEqual(wh[0].card.title, 'Los Simpsons');
});

test('pista ffconcat: transparente, fundido, cuadro, fundido y transparente', () => {
  const windows = [{ start: 10, end: 20, png: '/c/a.png', half: '/c/a_half.png' }, { start: 30, end: 42, png: '/c/b.png', half: '/c/b_half.png' }];
  const txt = trackConcat(windows, '/c/blank.png');
  const entries = [...txt.matchAll(/file '([^']+)'\nduration ([\d.]+)/g)].map(m => [m[1].split('/').pop(), Number(m[2])]);
  assert.deepStrictEqual(entries, [
    ['blank.png', 10], ['a_half.png', 0.3], ['a.png', 9.4], ['a_half.png', 0.3],
    ['blank.png', 10], ['b_half.png', 0.3], ['b.png', 11.4], ['b_half.png', 0.3],
    ['blank.png', 1]
  ]);
  assert.match(txt, /file '\/c\/blank.png'\n$/, 'la última entrada se repite (el demuxer ignora su duración)');
});

test('FFmpeg: el cuadro se superpone después del logo y antes del formato final', () => {
  const fs = require('fs');
  const os = require('os');
  const path = require('path');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'x99-lt-'));
  const track = path.join(dir, 'lower_thirds.txt');
  const logo = path.join(dir, 'logo.png');
  fs.writeFileSync(track, 'ffconcat version 1.0\n');
  fs.writeFileSync(logo, 'x');
  const p = new FfmpegHlsProcess({ streamDir: dir, playlistFile: path.join(dir, 'p.txt'), encoder: { args: [] }, watermarkFile: logo, lowerThirdTrack: track });
  const args = p.buildArgs(12);
  const filter = args[args.indexOf('-filter_complex') + 1];
  assert.match(filter, /\[base\]\[1:v\]overlay=W-w-50:50.*\[wm\];\[wm\]\[2:v\]overlay=x=80:y=H-h-100:eof_action=pass:format=auto\[lt\];\[lt\]format=yuv420p\[vout\]/);
  assert.strictEqual(args[args.lastIndexOf('-i') + 1], track);
  const noTrack = new FfmpegHlsProcess({ streamDir: dir, playlistFile: path.join(dir, 'p.txt'), encoder: { args: [] }, watermarkFile: null });
  assert.match(noTrack.buildArgs(0)[noTrack.buildArgs(0).indexOf('-filter_complex') + 1], /^\[0:v\].*\[base\];\[base\]format=yuv420p\[vout\];/);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('plantilla: escapa el título y lo ajusta si es largo en dos líneas', () => {
  const svg = renderLowerThirdSvg({ label: 'A CONTINUACIÓN', time: '7:30 PM', title: '<Tom & Jerry> con un nombre larguísimo de verdad', tag: 'ESTRENO', sub: null });
  assert.match(svg, /&lt;TOM &amp; JERRY&gt;/);
  assert.match(svg, /LARGUÍSIMO DE VERDAD/);
  assert.match(svg, /ESTRENO/);
});

test('hora en formato AM-PM', () => {
  assert.strictEqual(clock(at(0, 5)), '12:05 AM');
  assert.strictEqual(clock(at(9, 30)), '9:30 AM');
  assert.strictEqual(clock(at(12, 0)), '12:00 PM');
  assert.strictEqual(clock(at(18, 30)), '6:30 PM');
});

test('tanda comercial: recuadro toda la tanda y la programación que queda hasta el cierre', () => {
  const q = queueOf([
    block(at(23, 0), 'Ergo Proxy', 1380),
    block(at(23, 30), 'Maratón: Naruto', 1380, { marathon: true }),
    { ...block(at(0, 0), 'Maratón: Naruto', 1380, { marathon: true }), startTime: new Date(2026, 9, 21, 0, 0).toISOString() },
    { ...block(at(0, 30), 'Avatar', 1380), startTime: new Date(2026, 9, 21, 0, 30).toISOString() },
    { ...block(at(1, 0), 'Home Channel HLS // Cierre de Emisión', 0, { offAir: true }), startTime: new Date(2026, 9, 21, 1, 0).toISOString() },
    { ...block(at(5, 0), 'Dragon Ball', 1380), startTime: new Date(2026, 9, 21, 5, 0).toISOString() }
  ]);
  const breaks = planBreaks(q, 0);
  assert.strictEqual(breaks.length, 4, 'una por bloque con episodio; ni el cierre ni la última (sin nada después en la cola)');
  const [first] = breaks;
  assert.deepStrictEqual([first.start, first.end], [1380, 1800], 'toda la tanda');
  assert.strictEqual(`${first.card.label} ${first.card.time} ${first.card.title}`, 'A CONTINUACIÓN 11:30 PM Naruto');
  assert.deepStrictEqual(first.entries.map(e => `${e.time} ${e.title}`), ['11:30 PM Naruto', '12:30 AM Avatar', '1:00 AM Cierre de emisión'],
    'los bloques seguidos de la misma serie se juntan; termina en el cierre');
  assert.strictEqual(tickerText(first.entries), '11:30 PM  Naruto     •     12:30 AM  Avatar     •     1:00 AM  Cierre de emisión');

  // El recuadro de la tanda va en la misma pista que los del capítulo
  assert.ok(planLowerThirds(q, 0).some(w => w.moment === 'break' && w.start === 1380));

  // Al arrancar a mitad de la tanda se muestra lo que queda de ella; si casi terminó, nada
  assert.strictEqual(planBreaks(q, 1500)[0].start, 1);
  assert.strictEqual(planBreaks(q, 1795)[0].start, 1800 + 1380 - 1795, 'la tanda que casi terminó no cuenta: la primera es la siguiente');
});

test('tanda entre los dos capítulos de un bloque de una hora: sigue otro capítulo', () => {
  const hour = {
    startTime: at(21, 0), endTime: at(22, 0), title: 'Los Simpsons (Doble Episodio)',
    items: [{ role: 'main_show', duration: 1300 }, { role: 'commercial', duration: 140 }, { role: 'mid_bumper_station', duration: 20 }, { role: 'commercial', duration: 140 }, { role: 'main_show', duration: 1300 }, { role: 'commercial', duration: 700 }]
  };
  const breaks = planBreaks(queueOf([hour, block(at(22, 0), 'Beastars', 1380)]), 0);
  assert.deepStrictEqual([breaks[0].start, breaks[0].end], [1300, 1600], 'el Station ID del medio es parte de la tanda');
  assert.deepStrictEqual(breaks[0].card, { label: 'A CONTINUACIÓN', time: '9:26 PM', title: 'Los Simpsons', tag: 'OTRO CAPÍTULO', sub: null });
  assert.strictEqual(breaks[1].card.title, 'Beastars');
});

test('marquesina: franja, texto que corre solo en su tanda y pestaña fija', () => {
  const f = tickerFilter([{ start: 100, end: 300, file: '/s/tanda_0.txt' }, { start: 2000, end: 2200, file: '/s/tanda_1.txt' }], '/f/Oswald.ttf');
  assert.match(f, /^drawbox=x=0:y=992:w=iw:h=52:.*enable='between\(t,100.00,300.00\)\+between\(t,2000.00,2200.00\)'/);
  assert.match(f, /textfile='\/s\/tanda_0.txt':expansion=none:.*x='w-mod\(\(t-100.00\)\*88\+\(w-350\),w\+tw\)':enable='between\(t,100.00,300.00\)'/);
  assert.match(f, /text='HOY EN Home Channel'/);
  assert.strictEqual(tickerFilter([], '/f/Oswald.ttf'), null);

  const fs = require('fs');
  const os = require('os');
  const path = require('path');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'x99-tk-'));
  const p = new FfmpegHlsProcess({ streamDir: dir, playlistFile: path.join(dir, 'p.txt'), encoder: { args: [] }, watermarkFile: null, tickerFilter: 'drawbox=x=0' });
  const args = p.buildArgs(0);
  assert.match(args[args.indexOf('-filter_complex') + 1], /\[base\]drawbox=x=0\[tk\];\[tk\]format=yuv420p\[vout\]/);
  fs.rmSync(dir, { recursive: true, force: true });
});
