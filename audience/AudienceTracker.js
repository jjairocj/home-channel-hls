/**
 * Home Channel HLS - Audiencia: cuántos están viendo la señal ahora y el historial.
 *
 * Cada reproductor (web, Smart TV, VLC, app IPTV) vuelve a pedir la lista .m3u8 cada
 * ~4 s mientras reproduce, y esa lista nunca la cachea Cloudflare: cada cliente que la
 * pidió en los últimos 30 s está viendo. El cliente se identifica con un hash (IP real
 * + reproductor + tipo) con una sal propia del canal: no se guardan IPs.
 *
 * Tipos: 'web' (el televisor de la página, ?src=web), 'tv' (Smart TV, VLC, IPTV: la
 * lista sin marca) y 'radio' (/live/radio/…). El monitor del panel (?src=admin) no cuenta.
 *
 * Cada minuto se guarda una muestra (con el programa al aire) y, cuando un cliente deja
 * de pedir la lista por más de 90 s, su sesión (inicio, fin y duración).
 */

const crypto = require('crypto');

const ACTIVE_MS = 30 * 1000;
const SESSION_GAP_MS = 90 * 1000;
/** Sesiones más cortas no se registran (alguien que abrió y cerró enseguida). */
const MIN_SESSION_SECONDS = 20;
const SAMPLE_MS = 60 * 1000;
const SALT_KEY = 'audience_salt';
/** Tope de clientes en memoria (ante pedidos falsos masivos no crece sin límite). */
const MAX_CLIENTS = 5000;
/** Reproductores distintos por IP (una casa rara vez tiene más): nadie acapara la tabla. */
const MAX_PER_IP = 8;
/** Las columnas de la muestra son SMALLINT. */
const MAX_COUNT = 32767;
const KINDS = ['web', 'tv', 'radio'];

/** Tipo de cliente según la ruta pedida y la marca ?src=. null = no cuenta. */
function classify(path, src) {
  if (/\/radio\//.test(path)) return 'radio';
  if (src === 'admin') return null;
  if (src === 'web') return 'web';
  return 'tv';
}

/** Conexiones desde la máquina o la red local (el túnel de Cloudflare, un proxy local). */
function isLocalAddress(addr) {
  const a = String(addr || '').replace(/^::ffff:/, '');
  return a === '::1' || a === '127.0.0.1' || /^127\./.test(a) || /^10\./.test(a) || /^192\.168\./.test(a)
    || /^172\.(1[6-9]|2\d|3[01])\./.test(a) || /^169\.254\./.test(a) || /^f[cd][0-9a-f]{2}:/i.test(a) || /^fe80:/i.test(a);
}

/**
 * IP real del espectador. Los encabezados de Cloudflare/proxy solo se creen si la
 * conexión llegó por la red local (el túnel); si alguien llega directo con encabezados
 * inventados, se usa la dirección de su conexión.
 */
function clientIp(req) {
  const socketAddr = (req.socket && req.socket.remoteAddress) || req.ip || '';
  if (!isLocalAddress(socketAddr)) return socketAddr;
  const h = req.headers || {};
  return h['cf-connecting-ip'] || (h['x-forwarded-for'] || '').split(',')[0].trim() || socketAddr;
}

class AudienceTracker {
  /**
   * @param {Object} deps
   * @param {Object} deps.repo - AudienceRepository
   * @param {string} deps.salt - sal para el hash de clientes
   * @param {Function} [deps.getProgram] - () => título de lo que está al aire
   * @param {Function} [deps.now]
   */
  constructor({ repo, salt, getProgram = () => null, now = () => Date.now() }) {
    this.repo = repo;
    this.salt = salt;
    this.getProgram = getProgram;
    this.now = now;
    this.clients = new Map();
    this.perIp = new Map(); // hash de IP -> cantidad de clientes
    this.timer = null;
    this.lastPurgeDay = null;
  }

  static fromDb(db, opts = {}) {
    const tracker = new AudienceTracker({ repo: db.audience, salt: null, ...opts });
    tracker.db = db;
    return tracker;
  }

  /**
   * Carga la sal guardada en la base (la genera la primera vez) y empieza a muestrear.
   * Llamar después de db.ready, para usar la sal de Postgres y no una nueva.
   */
  begin() {
    if (this.db && !this.salt) {
      let salt = this.db.getJsonSetting(SALT_KEY, null);
      if (!salt) {
        salt = crypto.randomBytes(16).toString('hex');
        this.db.setJsonSetting(SALT_KEY, salt);
      }
      this.salt = salt;
    }
    this.start();
  }

  hash(parts) {
    return crypto.createHash('sha256').update(`${this.salt || 'inicio'}|${parts.join('|')}`).digest('hex').slice(0, 16);
  }

  /** Registra un pedido de lista .m3u8. */
  hit(req) {
    const kind = classify(req.path || '', req.query && req.query.src);
    if (!kind) return null;
    const ip = clientIp(req);
    const key = this.hash([ip, (req.headers && req.headers['user-agent']) || '', kind]);
    const now = this.now();
    const client = this.clients.get(key);
    if (client && now - client.lastSeen <= SESSION_GAP_MS) {
      client.lastSeen = now;
      return client;
    }
    if (client) this.closeSession(client);

    const ipKey = this.hash([ip]);
    if ((this.perIp.get(ipKey) || 0) >= MAX_PER_IP) return null;
    if (this.clients.size >= MAX_CLIENTS) this.makeRoom();
    const fresh = { key, ipKey, kind, start: now, lastSeen: now };
    this.clients.set(key, fresh);
    this.perIp.set(ipKey, (this.perIp.get(ipKey) || 0) + 1);
    return fresh;
  }

  /** Tabla llena: primero se cierran los inactivos; si no alcanza, sale el menos reciente. */
  makeRoom() {
    this.sweep();
    if (this.clients.size < MAX_CLIENTS) return;
    let oldest = null;
    for (const c of this.clients.values()) if (!oldest || c.lastSeen < oldest.lastSeen) oldest = c;
    if (oldest) this.closeSession(oldest);
  }

  /** Cuántos están viendo ahora, por tipo. */
  current() {
    const now = this.now();
    const counts = { web: 0, tv: 0, radio: 0 };
    for (const c of this.clients.values()) {
      if (now - c.lastSeen <= ACTIVE_MS) counts[c.kind]++;
    }
    return { ...counts, viewers: counts.web + counts.tv };
  }

  /** Sesiones abiertas (para el historial del día en curso). */
  openSessions() {
    return [...this.clients.values()].map(c => ({
      clientHash: c.key,
      kind: c.kind,
      startedAt: new Date(c.start).toISOString(),
      endedAt: new Date(c.lastSeen).toISOString(),
      seconds: Math.round((c.lastSeen - c.start) / 1000)
    }));
  }

  closeSession(client) {
    this.clients.delete(client.key);
    const left = (this.perIp.get(client.ipKey) || 1) - 1;
    if (left > 0) this.perIp.set(client.ipKey, left);
    else this.perIp.delete(client.ipKey);
    const seconds = Math.round((client.lastSeen - client.start) / 1000);
    if (seconds < MIN_SESSION_SECONDS) return;
    this.repo.logSession({
      clientHash: client.key,
      kind: client.kind,
      startedAt: new Date(client.start).toISOString(),
      endedAt: new Date(client.lastSeen).toISOString(),
      seconds
    });
  }

  /** Cierra las sesiones de quienes dejaron de ver. */
  sweep() {
    const now = this.now();
    for (const c of [...this.clients.values()]) {
      if (now - c.lastSeen > SESSION_GAP_MS) this.closeSession(c);
    }
  }

  /** Muestra del minuto (con el programa al aire). */
  sample() {
    const at = new Date(Math.floor(this.now() / SAMPLE_MS) * SAMPLE_MS).toISOString();
    const clamp = (n) => Math.min(MAX_COUNT, n);
    const { web, tv, radio } = this.current();
    let program = null;
    try { program = this.getProgram() || null; } catch (e) {}
    this.repo.logSample({ at, web: clamp(web), tv: clamp(tv), radio: clamp(radio), program });
  }

  tick() {
    this.sweep();
    this.sample();
    const day = new Date(this.now()).toDateString();
    if (day !== this.lastPurgeDay) {
      this.lastPurgeDay = day;
      if (this.repo.purge) this.repo.purge();
    }
  }

  start() {
    if (this.timer) return;
    // Primera muestra al empezar el minuto siguiente; luego cada minuto
    const wait = SAMPLE_MS - (this.now() % SAMPLE_MS) + 500;
    this.timer = setTimeout(() => {
      this.tick();
      this.timer = setInterval(() => this.tick(), SAMPLE_MS);
      this.timer.unref?.();
    }, wait);
    this.timer.unref?.();
  }

  /** Al apagar: registra las sesiones abiertas. */
  stop() {
    clearTimeout(this.timer);
    clearInterval(this.timer);
    this.timer = null;
    for (const c of [...this.clients.values()]) this.closeSession(c);
  }
}

module.exports = { AudienceTracker, classify, clientIp, isLocalAddress, ACTIVE_MS, SESSION_GAP_MS, MAX_CLIENTS, MAX_PER_IP, KINDS };
