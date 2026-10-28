/**
 * Home Channel HLS - Conexión a PostgreSQL con reconexión automática.
 *
 * Las escrituras nunca bloquean ni lanzan: si Postgres no está disponible el cambio
 * queda en memoria/JSON y se marca `dirtyWhileOffline` para subirlo al reconectar.
 * Al conectar se llama a `onConnected()` (sincronización inicial).
 */

const { Pool } = require('pg');
const SQL = require('./sql');
const { runMigrations } = require('./migrations');

const RECONNECT_MS = 10000;
const CONNECTION_ERROR_CODES = ['ECONNREFUSED', 'ECONNRESET', 'ETIMEDOUT', 'EPIPE', 'ENOTFOUND', 'EHOSTUNREACH',
  '57P01', '57P02', '57P03', '08000', '08001', '08003', '08006'];

function configFromEnv(env = process.env) {
  return {
    host: env.PG_HOST || env.DB_HOST || 'localhost',
    port: parseInt(env.PG_PORT || env.DB_PORT || '5432', 10),
    user: env.PG_USER || env.DB_USER || 'postgres',
    password: env.PG_PASSWORD || env.DB_PASSWORD || '',
    database: env.PG_DATABASE || env.DB_NAME || 'homechannel',
    max: 30,
    idleTimeoutMillis: 60000,
    connectionTimeoutMillis: 30000
  };
}

const isConnectionError = (e) =>
  CONNECTION_ERROR_CODES.includes(e && e.code) || /terminat|connection|timeout/i.test((e && e.message) || '');

class PgConnection {
  constructor(config = configFromEnv()) {
    this.config = config;
    this.pool = null;
    this.connected = false;
    this.dirtyWhileOffline = false;
    this.reconnectTimer = null;
    this.onConnected = async () => {};
  }

  get available() {
    return !!(this.pool && this.connected);
  }

  scheduleReconnect() {
    if (!this.reconnectTimer) this.reconnectTimer = setTimeout(() => this.connect(), RECONNECT_MS);
  }

  handleDisconnect(reason) {
    if (!this.connected) return;
    this.connected = false;
    console.warn(`[DB/Postgres] ⚠️ Conexión perdida (${reason}). Operando con caché local; reintentando en 10s...`);
    this.scheduleReconnect();
  }

  async connect() {
    clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
    try {
      if (this.pool) await this.pool.end().catch(() => {});
      this.pool = new Pool(this.config);
      this.pool.on('error', (err) => {
        console.warn('[DB/Postgres] Error en pool de conexiones PostgreSQL:', err.message);
        if (isConnectionError(err)) this.handleDisconnect(err.message);
      });

      const client = await this.pool.connect();
      const res = await client.query('SELECT current_database() AS db, current_user AS u;');
      client.release();
      this.connected = true;
      console.log(`[DB/Postgres] ✅ Conectado exitosamente a PostgreSQL (db: ${res.rows[0].db}, usuario: ${res.rows[0].u}, host: ${this.config.host})`);

      await this.pool.query(SQL.CREATE_SETTINGS_TABLE)
        .catch(e => console.warn('[DB/Settings] Nota al verificar app_settings:', e.message));
      await runMigrations(this.pool)
        .catch(e => console.error('[DB/Migraciones] ❌', e.message));
      await this.onConnected();
    } catch (err) {
      this.connected = false;
      console.warn(`[DB/Postgres] No se pudo conectar a PostgreSQL (${err.message}). Operando en modo caché local JSON. Reintentando en 10s...`);
      this.scheduleReconnect();
    }
  }

  /** Consulta directa (lanza si falla). Úsese solo con `available`. */
  query(sql, params = []) {
    return this.pool.query(sql, params);
  }

  /** Escritura tolerante a fallos: devuelve null si no se pudo. */
  write(label, sql, params = []) {
    if (!this.available) {
      this.dirtyWhileOffline = true;
      return Promise.resolve(null);
    }
    return this.pool.query(sql, params).catch(e => {
      console.error(`[DB/Postgres] Error ${label}:`, e.message);
      if (isConnectionError(e)) {
        this.dirtyWhileOffline = true;
        this.handleDisconnect(e.message);
      }
      return null;
    });
  }
}

module.exports = { PgConnection, configFromEnv, isConnectionError };
