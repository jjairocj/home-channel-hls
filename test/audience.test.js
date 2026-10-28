/**
 * Tests de audiencia: quién cuenta, espectadores ahora, sesiones, muestras por minuto
 * y resúmenes (gráfica, pico, únicos, tiempo promedio y programas más vistos).
 */

const test = require('node:test');
const assert = require('node:assert');

const { AudienceTracker, classify, clientIp, MAX_CLIENTS, MAX_PER_IP } = require('../audience/AudienceTracker');
const { summarize, programName } = require('../audience/AudienceStats');

function fakeRepo() {
  return { samples: [], sessions: [], logSample(s) { this.samples.push(s); }, logSession(s) { this.sessions.push(s); }, purge() {} };
}

const req = (ip, path = '/channel.m3u8', src, ua = 'VLC/3.0') => ({ path, query: src ? { src } : {}, headers: { 'cf-connecting-ip': ip, 'user-agent': ua }, ip: '172.17.0.1', socket: { remoteAddress: '::ffff:172.17.0.1' } });

test('tipos: web (?src=web), TV/IPTV (sin marca), radio; el monitor del panel no cuenta', () => {
  assert.strictEqual(classify('/channel.m3u8', 'web'), 'web');
  assert.strictEqual(classify('/channel.m3u8', undefined), 'tv');
  assert.strictEqual(classify('/radio/crhe/radio.m3u8', undefined), 'radio');
  assert.strictEqual(classify('/channel.m3u8', 'admin'), null);
});

test('espectadores ahora: clientes que pidieron la lista en los últimos 30 s, sin IPs guardadas', () => {
  let now = 1_000_000;
  const repo = fakeRepo();
  const t = new AudienceTracker({ repo, salt: 's', now: () => now });
  t.hit(req('1.1.1.1', '/channel.m3u8', 'web', 'Chrome'));
  t.hit(req('1.1.1.1', '/channel.m3u8', 'web', 'Chrome')); // el mismo navegador
  t.hit(req('2.2.2.2'));
  t.hit(req('3.3.3.3', '/radio/crhe/radio.m3u8'));
  assert.strictEqual(t.hit(req('9.9.9.9', '/channel.m3u8', 'admin')), null);
  assert.deepStrictEqual(t.current(), { web: 1, tv: 1, radio: 1, viewers: 2 });
  assert.ok(![...t.clients.keys()].some(k => k.includes('1.1.1.1')), 'solo hashes');

  now += 31 * 1000;
  t.hit(req('2.2.2.2'));
  assert.deepStrictEqual(t.current(), { web: 0, tv: 1, radio: 0, viewers: 1 });
});

test('sesiones: se cierran tras 90 s sin pedidos; las muy cortas no se registran', () => {
  let now = 0;
  const repo = fakeRepo();
  const t = new AudienceTracker({ repo, salt: 's', now: () => now });
  for (let s = 0; s <= 600; s += 4) { now = s * 1000; t.hit(req('1.1.1.1')); } // 10 min viendo
  now = 5 * 1000;
  t.hit(req('2.2.2.2')); // abrió y cerró
  now = 700 * 1000;
  t.sweep();
  assert.strictEqual(repo.sessions.length, 1);
  assert.strictEqual(repo.sessions[0].seconds, 600);
  assert.strictEqual(repo.sessions[0].kind, 'tv');

  // Vuelve después de irse: sesión nueva
  t.hit(req('1.1.1.1'));
  assert.strictEqual(t.clients.size, 1);
  assert.strictEqual(t.openSessions()[0].seconds, 0);
});

test('muestra por minuto con el programa al aire', () => {
  const now = Date.UTC(2026, 9, 20, 23, 30, 42);
  const repo = fakeRepo();
  const t = new AudienceTracker({ repo, salt: 's', now: () => now, getProgram: () => programName('Maratón: Naruto (Doble Episodio)') });
  t.hit(req('1.1.1.1', '/channel.m3u8', 'web', 'Chrome'));
  t.hit(req('2.2.2.2'));
  t.sample();
  assert.deepStrictEqual(repo.samples[0], { at: '2026-10-20T23:30:00.000Z', web: 1, tv: 1, radio: 0, program: 'Naruto' });
  assert.strictEqual(programName('Home Channel HLS // Cierre de Emisión'), 'Cierre de emisión');
});

test('resumen: gráfica por intervalos, pico, únicos, tiempo promedio y programas más vistos', () => {
  const from = new Date('2026-10-20T18:00:00Z');
  const to = new Date('2026-10-20T20:00:00Z');
  const samples = [];
  for (let m = 0; m < 120; m++) {
    if (m >= 60 && m < 70) continue; // servidor apagado 10 min
    const at = new Date(from.getTime() + m * 60000).toISOString();
    const program = m < 30 ? 'Inuyasha' : (m < 90 ? 'Yo soy Betty, la fea' : 'Naruto');
    samples.push({ at, web: m < 30 ? 1 : 3, tv: m === 45 ? 4 : 1, radio: m < 10 ? 2 : 0, program });
  }
  const sessions = [
    { clientHash: 'a', kind: 'web', seconds: 1800 },
    { clientHash: 'a', kind: 'web', seconds: 600 },
    { clientHash: 'b', kind: 'tv', seconds: 3600 },
    { clientHash: 'r', kind: 'radio', seconds: 900 }
  ];
  const r = summarize({ samples, sessions, from, to, bucketMinutes: 30 });

  assert.strictEqual(r.points.length, 4);
  assert.deepStrictEqual(r.points.map(p => p.viewers), [2, 4.1, 4, 4]);
  assert.strictEqual(r.points[1].peak, 7);
  assert.strictEqual(r.points[0].program, 'Inuyasha');
  assert.strictEqual(r.stats.peak, 7);
  assert.strictEqual(r.stats.peakAt, '2026-10-20T18:45:00.000Z');
  assert.strictEqual(r.stats.unique, 2, 'la radio va aparte');
  assert.strictEqual(r.stats.sessions, 3);
  assert.strictEqual(r.stats.avgMinutes, 33.3);
  assert.strictEqual(r.stats.radioPeak, 2);
  assert.strictEqual(r.stats.radioUnique, 1);
  assert.deepStrictEqual(r.programs.map(p => p.title), ['Yo soy Betty, la fea', 'Naruto', 'Inuyasha']);
  assert.deepStrictEqual(r.programs[0], { title: 'Yo soy Betty, la fea', avg: 4.1, peak: 7, minutes: 50 });

  // Sin muestras en un intervalo: hueco en la gráfica (null), no cero
  const gap = summarize({ samples, sessions, from, to, bucketMinutes: 10 });
  assert.strictEqual(gap.points[6].viewers, null);
});

test('la IP de Cloudflare solo se cree si la conexión llega por la red local; tope de clientes', () => {
  const via = (remoteAddress) => ({ headers: { 'cf-connecting-ip': '203.0.113.9' }, socket: { remoteAddress } });
  assert.strictEqual(clientIp(via('::ffff:172.17.0.1')), '203.0.113.9', 'túnel local');
  assert.strictEqual(clientIp(via('127.0.0.1')), '203.0.113.9');
  assert.strictEqual(clientIp(via('198.51.100.7')), '198.51.100.7', 'directo con encabezado inventado: se ignora');

  // Una IP cambiando de reproductor no acapara la tabla
  const t = new AudienceTracker({ repo: fakeRepo(), salt: 's', now: () => 0 });
  for (let i = 0; i < 100; i++) t.hit(req('10.9.9.9', '/channel.m3u8', undefined, `ua${i}`));
  assert.strictEqual(t.clients.size, MAX_PER_IP);
  assert.ok(t.hit(req('10.8.8.8')), 'otro espectador sigue entrando');

  // Tabla llena: entra el nuevo y sale el menos reciente
  let now = 0;
  const full = new AudienceTracker({ repo: fakeRepo(), salt: 's', now: () => now });
  for (let i = 0; i < MAX_CLIENTS; i++) { now = i; full.hit(req(`10.1.${i >> 8}.${i & 255}`)); }
  now = MAX_CLIENTS;
  assert.ok(full.hit(req('10.200.0.1')), 'un espectador nuevo no queda afuera');
  assert.strictEqual(full.clients.size, MAX_CLIENTS);
  assert.ok(![...full.clients.values()].some(c => c.lastSeen === 0), 'salió el menos reciente');
});
