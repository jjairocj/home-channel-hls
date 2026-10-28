/**
 * Home Channel HLS - Autenticación del Master Control (admin)
 *
 * - Contraseña: hash PBKDF2 con sal aleatoria guardado en app_settings (Postgres).
 *   Se aceptan hashes antiguos (sal fija) y se migran solos al iniciar sesión.
 * - Sesión: token firmado "exp.stamp.firma". Expira, y queda invalidado al cambiar
 *   la contraseña (stamp = huella del hash vigente).
 * - Cookie HttpOnly + SameSite=Lax. Límite de intentos de login por IP.
 * - Acceso sin cookie para procesos locales: DESACTIVADO por defecto. Solo con
 *   ADMIN_ALLOW_LOOPBACK=1, desde un socket 127.0.0.1 y sin cabeceras de proxy (así un
 *   cambio de red, como network_mode: host, no convierte a todo visitante en admin).
 */

const crypto = require('crypto');
const { promisify } = require('util');
const { clientIp } = require('../audience/AudienceTracker');

const pbkdf2 = promisify(crypto.pbkdf2);

const SESSION_COOKIE = 'channel_admin_session';
const SESSION_TTL_MS = 14 * 24 * 60 * 60 * 1000;
const LEGACY_SALT = 'x99_radikal_salt';
const HASH_ITERATIONS = 210000;
const LOGIN_WINDOW_MS = 10 * 60 * 1000;
const LOGIN_MAX_ATTEMPTS = 8;

function safeEqual(a, b) {
  const sa = String(a);
  const sb = String(b);
  const ha = crypto.createHash('sha256').update(sa).digest();
  const hb = crypto.createHash('sha256').update(sb).digest();
  const match = crypto.timingSafeEqual(ha, hb);
  return match && sa.length === sb.length;
}

async function hashPassword(plainText) {
  const salt = crypto.randomBytes(16).toString('hex');
  const key = await pbkdf2(plainText, salt, HASH_ITERATIONS, 32, 'sha256');
  return `pbkdf2$${HASH_ITERATIONS}$${salt}$${key.toString('hex')}`;
}

async function verifyPassword(plainText, stored) {
  if (!plainText || !stored) return false;
  if (stored.startsWith('pbkdf2$')) {
    const [, iterStr, salt, hash] = stored.split('$');
    const key = await pbkdf2(plainText, salt, parseInt(iterStr, 10), 32, 'sha256');
    return safeEqual(key.toString('hex'), hash);
  }
  // Formato antiguo: sal fija, 50.000 iteraciones
  const key = await pbkdf2(plainText, LEGACY_SALT, 50000, 32, 'sha256');
  return safeEqual(key.toString('hex'), stored);
}

function isLoopbackSocket(req) {
  const ip = (req.socket && req.socket.remoteAddress) || '';
  return ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1';
}

/** ¿La petición pasó por un proxy (Cloudflare, nginx…)? Entonces no es un proceso local. */
function hasProxyHeaders(req) {
  const h = req.headers || {};
  return !!(h['x-forwarded-for'] || h['x-real-ip'] || h['cf-connecting-ip'] || h['forwarded']);
}

function parseCookies(req) {
  const list = {};
  const rc = req.headers.cookie;
  if (!rc) return list;
  for (const cookie of rc.split(';')) {
    const idx = cookie.indexOf('=');
    if (idx === -1) continue;
    const key = cookie.slice(0, idx).trim();
    const val = cookie.slice(idx + 1).trim();
    if (!key) continue;
    try { list[key] = decodeURIComponent(val); } catch (e) { list[key] = val; }
  }
  return list;
}

class AdminAuth {
  constructor(db, env = process.env) {
    this.db = db;
    this.env = env;
    this.secret = null;
    this.passwordHash = null;
    this.loginAttempts = new Map();
    this.readyPromise = null;
  }

  /** Carga secreto de sesión y hash vigente (espera a que Postgres intente conectar). */
  ready() {
    if (!this.readyPromise) {
      this.readyPromise = (async () => {
        if (this.db.ready) await this.db.ready;
        await this.reload();
        // Refrescar periódicamente por si se cambia la clave desde otra instancia
        setInterval(() => this.reload().catch(() => {}), 60000).unref();
      })();
    }
    return this.readyPromise;
  }

  async reload() {
    let secret = this.env.ADMIN_SECRET || await this.db.getSetting('admin_session_secret');
    if (!secret) {
      secret = crypto.randomBytes(32).toString('hex');
      await this.db.setSetting('admin_session_secret', secret);
    }
    this.secret = secret;
    this.passwordHash = await this.db.getSetting('admin_password_hash');
  }

  /** Huella de la credencial vigente: si cambia la clave, los tokens viejos dejan de valer. */
  currentStamp() {
    const source = this.passwordHash || `env:${this.env.ADMIN_PASSWORD || this.env.PG_PASSWORD || ''}`;
    return crypto.createHash('sha256').update(source).digest('hex').slice(0, 16);
  }

  sign(payload) {
    return crypto.createHmac('sha256', this.secret).update(payload).digest('hex');
  }

  issueToken() {
    const exp = Date.now() + SESSION_TTL_MS;
    const payload = `${exp}.${this.currentStamp()}`;
    return `${payload}.${this.sign(payload)}`;
  }

  verifyToken(token) {
    if (!token || !this.secret || typeof token !== 'string') return false;
    const parts = token.split('.');
    if (parts.length !== 3) return false;
    const [expStr, stamp, sig] = parts;
    if (!safeEqual(sig, this.sign(`${expStr}.${stamp}`))) return false;
    if (!(parseInt(expStr, 10) > Date.now())) return false;
    return safeEqual(stamp, this.currentStamp());
  }

  /** Sesión válida por cookie o por "Authorization: Bearer <token>". */
  hasSession(req) {
    const cookies = parseCookies(req);
    if (this.verifyToken(cookies[SESSION_COOKIE])) return true;
    const header = req.headers['authorization'] || '';
    if (header.startsWith('Bearer ') && this.verifyToken(header.slice(7).trim())) return true;
    return false;
  }

  /** APIs de admin: sesión válida, o proceso local si se habilitó explícitamente. */
  isAuthorized(req) {
    if (this.hasSession(req)) return true;
    return this.env.ADMIN_ALLOW_LOOPBACK === '1' && isLoopbackSocket(req) && !hasProxyHeaders(req);
  }

  async checkPassword(password) {
    if (this.passwordHash) {
      return verifyPassword(password, this.passwordHash);
    }
    // Sin hash guardado todavía: arranque con la clave del entorno
    const envPassword = this.env.ADMIN_PASSWORD || this.env.PG_PASSWORD;
    return !!envPassword && safeEqual(password, envPassword);
  }

  async setPassword(newPassword) {
    const hash = await hashPassword(newPassword);
    await this.db.setSetting('admin_password_hash', hash);
    this.passwordHash = hash;
  }

  /** Devuelve true si la IP superó el límite de intentos fallidos. */
  isRateLimited(ip) {
    const entry = this.loginAttempts.get(ip);
    if (!entry) return false;
    if (Date.now() > entry.resetAt) {
      this.loginAttempts.delete(ip);
      return false;
    }
    return entry.count >= LOGIN_MAX_ATTEMPTS;
  }

  recordFailure(ip) {
    const now = Date.now();
    const entry = this.loginAttempts.get(ip);
    if (!entry || now > entry.resetAt) {
      if (this.loginAttempts.size >= 5000 && !this.loginAttempts.has(ip)) {
        // Purgar primero las entradas expiradas; si sigue lleno, expulsar la más antigua (FIFO)
        for (const [k, v] of this.loginAttempts) {
          if (now > v.resetAt) this.loginAttempts.delete(k);
        }
        if (this.loginAttempts.size >= 5000) {
          const oldestKey = this.loginAttempts.keys().next().value;
          if (oldestKey !== undefined) this.loginAttempts.delete(oldestKey);
        }
      }
      this.loginAttempts.set(ip, { count: 1, resetAt: now + LOGIN_WINDOW_MS });
    } else {
      entry.count++;
    }
  }

  sessionCookie(req, token) {
    const isSecure = req.secure || req.headers['x-forwarded-proto'] === 'https';
    const maxAge = Math.floor(SESSION_TTL_MS / 1000);
    return `${SESSION_COOKIE}=${token}; Path=/; Max-Age=${maxAge}; HttpOnly; SameSite=Strict${isSecure ? '; Secure' : ''}`;
  }

  clearCookie() {
    return `${SESSION_COOKIE}=; Path=/; Max-Age=0; HttpOnly; SameSite=Strict`;
  }

  /** Rutas /api/auth/* */
  registerRoutes(app) {
    app.post('/api/auth/login', async (req, res) => {
      await this.ready();
      const ip = clientIp(req) || req.ip || 'unknown';
      if (this.isRateLimited(ip)) {
        return res.status(429).json({ success: false, error: 'DEMASIADOS INTENTOS. ESPERA 10 MINUTOS.' });
      }

      const { password } = req.body || {};
      if (!password || typeof password !== 'string') {
        return res.status(400).json({ success: false, error: 'DEBES INGRESAR UNA CONTRASEÑA.' });
      }

      let ok = false;
      try { ok = await this.checkPassword(password); } catch (e) { ok = false; }

      if (!ok) {
        this.recordFailure(ip);
        return setTimeout(() => {
          res.status(401).json({ success: false, error: 'PASSWORD INCORRECTO. ACCESO DENEGADO.' });
        }, 400);
      }

      // Guardar (o migrar a sal aleatoria) el hash de la clave correcta
      try {
        if (!this.passwordHash || !this.passwordHash.startsWith('pbkdf2$')) {
          await this.setPassword(password);
        }
      } catch (e) {
        console.warn('[Auth] No se pudo guardar el hash de la clave:', e.message);
      }

      this.loginAttempts.delete(ip);
      const token = this.issueToken();
      res.setHeader('Set-Cookie', this.sessionCookie(req, token));
      res.json({ success: true });
    });

    app.post('/api/auth/change-password', async (req, res) => {
      await this.ready();
      if (!this.hasSession(req)) {
        return res.status(401).json({ success: false, error: 'No autorizado' });
      }
      const { currentPassword, newPassword } = req.body || {};
      if (!newPassword || typeof newPassword !== 'string' || newPassword.length < 8) {
        return res.status(400).json({ success: false, error: 'La nueva contraseña debe tener al menos 8 caracteres.' });
      }
      if (!currentPassword || !(await this.checkPassword(currentPassword))) {
        return res.status(401).json({ success: false, error: 'La contraseña actual no es correcta.' });
      }

      await this.setPassword(newPassword);
      // El cambio invalida todas las sesiones anteriores; se emite una nueva para quien la cambió
      res.setHeader('Set-Cookie', this.sessionCookie(req, this.issueToken()));
      res.json({ success: true, message: 'Contraseña actualizada. Las demás sesiones fueron cerradas.' });
    });

    app.post('/api/auth/logout', (req, res) => {
      res.setHeader('Set-Cookie', this.clearCookie());
      res.json({ success: true });
    });

    app.get('/api/auth/status', async (req, res) => {
      await this.ready();
      res.json({ authenticated: this.hasSession(req) });
    });
  }
}

module.exports = { AdminAuth, hashPassword, verifyPassword, safeEqual, isLoopbackSocket, parseCookies };
