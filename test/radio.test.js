/**
 * Tests de la radio: programación de la emisora, guiones y mediateca.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const RadioStation = require('../radio/RadioStation');
const { shuffleAvoidingArtist } = require('../radio/RadioStation');
const { TemplateScriptWriter, cleanScript } = require('../radio/DjScriptWriter');
const { stationById } = require('../radio/stations');
const { slug } = require('../radio/RadioLibrary');

const track = (i, artist, opts = {}) => ({
  id: `t${i}`, artist, title: `Tema ${i}`, duration: 240, ready: `/r/t${i}.m4a`,
  dj: opts.dj ? { mix: `/m/t${i}.m4a`, dj: 'DJ Vex' } : null
});

function makeStation(tracks, jingles = []) {
  const library = { readyTracksFor: () => tracks, readyJingles: () => jingles };
  const streamRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'radio-'));
  const st = new RadioStation({ station: stationById('metal'), library, streamRoot });
  clearInterval(st.janitor);
  return st;
}

test('rotación: no repite artista seguido si hay alternativas', () => {
  const list = [track(1, 'A'), track(2, 'A'), track(3, 'B'), track(4, 'B'), track(5, 'C'), track(6, 'C')];
  for (let n = 0; n < 20; n++) {
    const out = shuffleAvoidingArtist(list);
    for (let i = 1; i < out.length; i++) assert.notStrictEqual(out[i].artist, out[i - 1].artist);
  }
});

test('tanda de una hora: jingle cada 4 temas y el DJ presenta 1 de cada 3', () => {
  const tracks = Array.from({ length: 12 }, (_, i) => track(i, `Banda ${i % 5}`, { dj: true }));
  const st = makeStation(tracks, [{ id: 'j1', title: 'ID', ready: '/r/j1.m4a', duration: 8 }]);
  const items = st.buildBatch();
  const total = items.reduce((a, it) => a + it.duration, 0);
  assert.ok(total >= 3600 && total < 3600 + 300, `dura ~1 hora: ${total}`);

  const songs = items.filter(it => it.kind === 'track');
  const withDj = songs.filter(it => it.withDj);
  assert.ok(withDj.length >= Math.floor(songs.length / 3) - 1 && withDj.length <= Math.ceil(songs.length / 3) + 1, `${withDj.length} de ${songs.length}`);
  for (let i = 1; i < songs.length; i++) assert.ok(!(songs[i].withDj && songs[i - 1].withDj), 'el DJ no habla en dos temas seguidos');
  assert.ok(withDj.every(it => it.file.startsWith('/m/')), 'las presentadas usan la versión mezclada');

  let since = 0;
  for (const it of items) {
    if (it.kind === 'jingle') {
      assert.ok(since >= 4, 'jingle cada 4 temas');
      since = 0;
    } else since++;
  }
  assert.ok(items.some(it => it.kind === 'jingle'));
});

test('sin música la emisora no sale al aire', () => {
  const st = makeStation([]);
  st.start();
  assert.strictEqual(st.onAir, false);
  assert.strictEqual(st.status().onAir, false);
});

test('guion de plantilla: emisora, artista y título, estable por canción', async () => {
  const w = new TemplateScriptWriter();
  const t = { artist: 'In Flames', title: 'Alias', album: 'A Sense of Purpose', year: '2008' };
  const a = await w.write(t, stationById('metal'));
  assert.ok(a.includes('In Flames') && a.includes('Alias'), a);
  assert.strictEqual(await w.write(t, stationById('metal')), a);
});

test('limpieza del guion de la IA: sin comillas, acotaciones ni emojis', () => {
  assert.strictEqual(cleanScript('"¡Hola! *risas* (pausa) Esto es metal 🤘"'), '¡Hola! Esto es metal');
});

test('las locuciones grabadas se asocian por título exacto, no por coincidencia parcial', () => {
  assert.strictEqual(slug("The Mirror's Truth"), 'themirrorstruth');
  assert.strictEqual(`dj${slug('Alias')}`, slug('dj_alias'));
  assert.notStrictEqual(`dj${slug('Me')}`, slug('dj_move_through_me'));
});
