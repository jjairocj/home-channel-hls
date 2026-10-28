/**
 * Tests de la TeleGuía semanal en PDF: días de transmisión, agrupación de bloques,
 * resumen de portada y generación del documento.
 */

const test = require('node:test');
const assert = require('node:assert');
const { PassThrough } = require('stream');

const { buildWeekGuide, coverHighlights, broadcastDayStart } = require('../guide/WeekGuide');
const { renderGuidePdf, daysLabel } = require('../guide/GuidePdf');

const SLOT = 30 * 60 * 1000;

/** Planificador falso: una serie distinta por bloque, maratón el sábado 18:00–20:30. */
function fakeScheduler() {
  return {
    planBlocks(from, slots) {
      const blocks = [];
      for (let i = 0; i < slots; i++) {
        const start = new Date(from.getTime() + i * SLOT);
        const h = start.getHours();
        const sat = start.getDay() === 6;
        const block = { startTime: start.toISOString(), endTime: new Date(start.getTime() + SLOT).toISOString(), durationSeconds: 1800 };
        if (h >= 1 && h < 5) Object.assign(block, { isOffAir: true, title: 'Home Channel HLS // Cierre de Emisión' });
        else if (sat && h >= 18 && start < new Date(start).setHours(20, 30)) Object.assign(block, { title: 'Maratón: Naruto', mainShow: { marathon: true } });
        else if (h === 19 && start.getMinutes() === 0) Object.assign(block, { title: 'Yo soy Betty, la fea', mainShow: { dailyKey: 'saga:betty' }, isRepeat: sat || start.getDay() === 0 });
        else Object.assign(block, { title: `Serie ${h}:${start.getMinutes()}`, mainShow: {} });
        blocks.push(block);
      }
      return blocks;
    }
  };
}

test('el día de transmisión empieza a las 06:00 (la madrugada es del día anterior)', () => {
  assert.strictEqual(broadcastDayStart(new Date('2026-10-20T03:00:00')).getDate(), 19);
  assert.strictEqual(broadcastDayStart(new Date('2026-10-20T07:00:00')).getDate(), 20);
  assert.strictEqual(broadcastDayStart(new Date('2026-10-20T07:00:00')).getHours(), 6);
});

test('semana: 7 días de 06:00 a 06:00, con cierres y maratones agrupados', () => {
  const week = buildWeekGuide(fakeScheduler(), new Date('2026-10-19T10:00:00'));
  assert.strictEqual(week.days.length, 7);
  assert.deepStrictEqual(week.days.map(d => d.key), ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday']);

  const monday = week.days[0];
  assert.strictEqual(monday.entries[0].startLabel, '06:00');
  assert.strictEqual(monday.entries[monday.entries.length - 1].startLabel, '05:30');
  const offAir = monday.entries.filter(e => e.offAir);
  assert.strictEqual(offAir.length, 1, 'el cierre de 01:00 a 05:00 es una sola entrada');
  assert.strictEqual(offAir[0].endLabel, '05:00');
  assert.strictEqual(offAir[0].section, 'night');

  const saturday = week.days[5];
  const marathon = saturday.entries.find(e => e.kind === 'marathon');
  assert.strictEqual(marathon.title, 'Naruto');
  assert.strictEqual(marathon.slots, 5);
  assert.strictEqual(`${marathon.startLabel}-${marathon.endLabel}`, '18:00-20:30');
  assert.strictEqual(saturday.feature.kind, 'marathon');

  // Lunes: el destacado es el estreno de la noche
  assert.strictEqual(monday.feature.title, 'Yo soy Betty, la fea');
  assert.strictEqual(monday.feature.kind, 'premiere');
});

test('portada: estrenos por serie (días y hora) y maratones del fin de semana', () => {
  const week = buildWeekGuide(fakeScheduler(), new Date('2026-10-19T10:00:00'));
  const { premieres, marathons } = coverHighlights(week);
  const betty = premieres.find(p => p.title === 'Yo soy Betty, la fea');
  assert.strictEqual(betty.time, '19:00');
  assert.strictEqual(daysLabel(betty.days), 'Lunes a viernes');
  assert.strictEqual(marathons.length, 1);
  assert.strictEqual(marathons[0].day, 'saturday');
});

test('genera un PDF con portada y una página por día', async () => {
  const week = buildWeekGuide(fakeScheduler(), new Date('2026-10-19T10:00:00'));
  const sink = new PassThrough();
  const chunks = [];
  sink.on('data', c => chunks.push(c));
  const done = new Promise(resolve => sink.on('end', resolve));
  renderGuidePdf(week, sink);
  await done;
  const pdf = Buffer.concat(chunks);
  assert.strictEqual(pdf.subarray(0, 5).toString(), '%PDF-');
  const pages = pdf.toString('latin1').match(/\/Type \/Page\b(?!s)/g) || [];
  assert.ok(pages.length >= 8, `portada + 7 días (hay ${pages.length})`);
});
