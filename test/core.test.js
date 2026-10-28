/**
 * Tests de la lógica crítica de Home Channel (node --test).
 * No requieren Postgres, FFmpeg ni archivos de video.
 */

const test = require('node:test');
const assert = require('node:assert');
const crypto = require('crypto');
const path = require('path');

const { safeJoin, safeId } = require('../lib/paths');
const { AdminAuth, hashPassword, verifyPassword } = require('../lib/auth');
const Scheduler = require('../scheduler');

/* ---------- Rutas seguras ---------- */
test('safeJoin bloquea rutas que salen de la carpeta', () => {
  const base = '/srv/descargas';
  assert.strictEqual(safeJoin(base, 'serie/cap01.mkv'), path.resolve(base, 'serie/cap01.mkv'));
  assert.strictEqual(safeJoin(base, '../etc/passwd'), null);
  assert.strictEqual(safeJoin(base, '/etc/passwd'), null);
  assert.strictEqual(safeJoin(base, 'a/../../x'), null);
  assert.strictEqual(safeJoin(base, ''), null);
  assert.strictEqual(safeJoin(base, 'a\0b'), null);
});

test('safeId solo acepta identificadores simples', () => {
  assert.strictEqual(safeId('upload_123-abc'), 'upload_123-abc');
  assert.strictEqual(safeId('../x'), null);
  assert.strictEqual(safeId('a/b'), null);
  assert.strictEqual(safeId(42), null);
});

/* ---------- Autenticación ---------- */
function fakeDb(settings = {}) {
  return {
    ready: Promise.resolve(),
    settings: { ...settings },
    async getSetting(k) { return this.settings[k] || null; },
    async setSetting(k, v) { this.settings[k] = v; }
  };
}

test('hash nuevo y hash antiguo (sal fija) se verifican', async () => {
  const modern = await hashPassword('clave-de-prueba');
  assert.ok(modern.startsWith('pbkdf2$'));
  assert.ok(await verifyPassword('clave-de-prueba', modern));
  assert.ok(!(await verifyPassword('otra', modern)));

  const legacy = crypto.pbkdf2Sync('clave-vieja', 'x99_radikal_salt', 50000, 32, 'sha256').toString('hex');
  assert.ok(await verifyPassword('clave-vieja', legacy));
  assert.ok(!(await verifyPassword('mal', legacy)));
});

test('token de sesión: válido, manipulado, y se invalida al cambiar la clave', async () => {
  const auth = new AdminAuth(fakeDb(), {});
  await auth.reload();
  await auth.setPassword('primera-clave');

  const token = auth.issueToken();
  assert.ok(auth.verifyToken(token));
  assert.ok(!auth.verifyToken(token.replace(/.$/, c => (c === 'a' ? 'b' : 'a'))));
  assert.ok(!auth.verifyToken('basura'));

  await auth.setPassword('segunda-clave');
  assert.ok(!auth.verifyToken(token), 'el token anterior debe dejar de valer');
  assert.ok(auth.verifyToken(auth.issueToken()));
});

test('X-Forwarded-For falso no da acceso de administrador', async () => {
  const auth = new AdminAuth(fakeDb(), {});
  await auth.reload();
  const req = {
    headers: { 'x-forwarded-for': '127.0.0.1' },
    ip: '127.0.0.1',
    socket: { remoteAddress: '172.17.0.1' }
  };
  assert.strictEqual(auth.isAuthorized(req), false);

  // Acceso local desactivado por defecto
  const local = { headers: {}, socket: { remoteAddress: '127.0.0.1' } };
  assert.strictEqual(auth.isAuthorized(local), false);

  // Habilitado explícitamente: solo sin cabeceras de proxy
  const opted = new AdminAuth(fakeDb(), { ADMIN_ALLOW_LOOPBACK: '1' });
  await opted.reload();
  assert.strictEqual(opted.isAuthorized(local), true);
  assert.strictEqual(opted.isAuthorized({ headers: { 'cf-connecting-ip': '8.8.8.8' }, socket: { remoteAddress: '127.0.0.1' } }), false);
});

test('clave del entorno solo sirve mientras no hay hash guardado', async () => {
  const db = fakeDb();
  const auth = new AdminAuth(db, { PG_PASSWORD: 'clave-entorno' });
  await auth.reload();
  assert.ok(await auth.checkPassword('clave-entorno'));
  await auth.setPassword('clave-nueva');
  assert.ok(!(await auth.checkPassword('clave-entorno')));
  assert.ok(await auth.checkPassword('clave-nueva'));
});

test('límite de intentos de login', () => {
  const auth = new AdminAuth(fakeDb(), {});
  for (let i = 0; i < 8; i++) auth.recordFailure('1.2.3.4');
  assert.ok(auth.isRateLimited('1.2.3.4'));
  assert.ok(!auth.isRateLimited('5.6.7.8'));
});

test('límite de intentos: superar 5000 IPs expulsa la más antigua sin desbloquear las recientes', () => {
  const auth = new AdminAuth(fakeDb(), {});
  for (let i = 0; i < 5000; i++) auth.recordFailure(`10.0.${Math.floor(i / 256)}.${i % 256}`);
  for (let i = 0; i < 8; i++) auth.recordFailure('9.9.9.9');
  assert.ok(auth.isRateLimited('9.9.9.9'), 'la IP reciente sigue bloqueada tras superar el tope de la tabla');
  assert.ok(auth.loginAttempts.size <= 5000);
});

/* ---------- Parrilla ---------- */
function makeScheduler() {
  const s = new Scheduler(null);
  s.dynamicBumperManager = null; // sin render de clips en los tests
  const bumper = (name, duration) => ({ id: name, name, filename: `${name}.mp4`, path: `/m/${name}.mp4`, duration, type: 'bumper' });
  s.mediaCache = {
    shows: [],
    programs: [
      {
        id: 'p1', title: 'Serie Larga', currentEpisodeIndex: 0,
        episodes: [1, 2, 3].map(n => ({ id: `l${n}`, name: `Serie Larga - ${n}`, showTitle: 'Serie Larga', showId: 'p1', path: `/m/l${n}.mp4`, duration: 1388.47, type: 'show' }))
      },
      {
        id: 'p2', title: 'Serie Corta', currentEpisodeIndex: 0,
        episodes: [1, 2, 3, 4].map(n => ({ id: `c${n}`, name: `Serie Corta - ${n}`, showTitle: 'Serie Corta', showId: 'p2', path: `/m/c${n}.mp4`, duration: 671.2, type: 'show' }))
      }
    ],
    bumpers: [
      bumper('bumper_00_sincronizador_ident', 45.633),
      bumper('bumper_01_animestation', 21.267),
      bumper('bumper_02_a_continuacion', 13.433),
      bumper('bumper_03_estas_viendo', 6),
      bumper('bumper_04_cierre_emision_nocturno', 60.733)
    ],
    commercials: [30.1, 29.8, 61.03, 15.5, 44.9].map((d, i) => ({ id: `co${i}`, name: `Comercial ${i}`, path: `/m/co${i}.mp4`, duration: d, type: 'commercial' }))
  };
  s.mediaCache.shows = s.mediaCache.programs.flatMap(p => p.episodes);
  return s;
}

test('cada bloque dura exactamente lo que ocupa en la parrilla (sin desfase)', () => {
  const s = makeScheduler();
  // Pocos comerciales: obliga a un relleno más largo que el clip sincronizador
  s.mediaCache.commercials = s.mediaCache.commercials.slice(0, 1);
  const blocks = s.generate24hSchedule(new Date('2026-10-14T12:10:00'));
  assert.ok(blocks.length > 0);

  let expectedStart = new Date(blocks[0].startTime).getTime();
  for (const b of blocks) {
    const total = b.items.reduce((acc, it) => acc + (it.targetDuration || it.duration), 0);
    assert.ok(Math.abs(total - b.durationSeconds) < 0.01, `bloque ${b.slotNumber} suma ${total} y debería ${b.durationSeconds}`);
    assert.strictEqual(new Date(b.startTime).getTime(), expectedStart, 'los bloques deben ser contiguos');
    expectedStart = new Date(b.endTime).getTime();
  }
  // Ningún elemento puede planificarse más largo que su archivo (FFmpeg no estira clips)
  const realLength = new Map();
  for (const it of [...s.mediaCache.bumpers, ...s.mediaCache.commercials, ...s.mediaCache.shows]) realLength.set(it.path, it.duration);
  for (const b of blocks) {
    for (const it of b.items) {
      const len = realLength.get(it.path);
      if (len) assert.ok((it.targetDuration || it.duration) <= len + 0.01, `${it.name} planificado ${it.targetDuration || it.duration}s pero el archivo dura ${len}s`);
    }
  }

  // La parrilla empieza alineada a :00 o :30
  const first = new Date(blocks[0].startTime);
  assert.ok(first.getMinutes() === 0 || first.getMinutes() === 30);
  assert.strictEqual(first.getSeconds(), 0);
});

test('franja 01:00-05:00 es cierre de emisión', () => {
  const s = makeScheduler();
  const blocks = s.generate24hSchedule(new Date('2026-10-14T00:40:00'));
  const offAir = blocks.filter(b => b.isOffAir);
  assert.strictEqual(offAir.length, 8);
  for (const b of offAir) {
    const h = new Date(b.startTime).getHours();
    assert.ok(h >= 1 && h < 5);
  }
});

/* ---------- EPG ---------- */
test('EPG usa el mismo id que el M3U y escapa caracteres XML', () => {
  const s = makeScheduler();
  const xml = s.generateXmltv('https://ejemplo.tv', [{
    startTime: '2026-10-14T18:00:00.000Z',
    endTime: '2026-10-14T18:30:00.000Z',
    title: 'Ranma ½ & <Amigos>',
    isOffAir: false
  }]);
  assert.ok(xml.includes(`<channel id="${Scheduler.EPG_CHANNEL_ID}">`));
  assert.ok(xml.includes('Ranma ½ &amp; &lt;Amigos&gt;'));
  assert.ok(!/locomotion/i.test(xml));
});
