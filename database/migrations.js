/**
 * Home Channel HLS - Migraciones del esquema de Postgres.
 *
 * Cada migración se aplica una sola vez (se registra en schema_migrations) dentro de
 * una transacción, al conectar con la base. Agregar migraciones al final de la lista,
 * nunca modificar una ya aplicada.
 */

const MIGRATIONS = [
  {
    id: '2026-10-19-programador-reglas',
    description: 'Programador por reglas: series, reglas, historial de emisiones y propuestas',
    sql: [
      // Preferencias de programación de cada serie o grupo de temporadas (saga)
      `CREATE TABLE IF NOT EXISTS programming_series (
        saga_key VARCHAR(80) PRIMARY KEY,
        franja VARCHAR(20) NOT NULL DEFAULT 'auto',
        frequency VARCHAR(10) NOT NULL DEFAULT 'auto',
        episode_order VARCHAR(12) NOT NULL DEFAULT 'auto',
        max_daily SMALLINT,
        marathon BOOLEAN NOT NULL DEFAULT TRUE,
        excluded BOOLEAN NOT NULL DEFAULT FALSE,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )`,
      // Reglas de la grilla: "esta serie, estos días, a esta hora, durante N bloques"
      `CREATE TABLE IF NOT EXISTS schedule_rules (
        id VARCHAR(40) PRIMARY KEY,
        kind VARCHAR(10) NOT NULL DEFAULT 'show',
        target VARCHAR(120),
        days JSONB NOT NULL,
        start_time VARCHAR(5) NOT NULL,
        slots SMALLINT NOT NULL DEFAULT 1,
        source VARCHAR(10) NOT NULL DEFAULT 'manual',
        priority SMALLINT NOT NULL DEFAULT 0,
        enabled BOOLEAN NOT NULL DEFAULT TRUE,
        note TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )`,
      'CREATE INDEX IF NOT EXISTS schedule_rules_source_idx ON schedule_rules (source)',
      // Historial de lo que salió al aire (estrenos, repeticiones, maratones, al azar)
      `CREATE TABLE IF NOT EXISTS airing_log (
        id BIGSERIAL PRIMARY KEY,
        ref_key VARCHAR(120) NOT NULL,
        show_id VARCHAR(80) NOT NULL,
        episode_id VARCHAR(80) NOT NULL,
        period VARCHAR(20) NOT NULL,
        kind VARCHAR(10) NOT NULL,
        aired_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )`,
      'CREATE INDEX IF NOT EXISTS airing_log_aired_at_idx ON airing_log (aired_at)',
      'CREATE INDEX IF NOT EXISTS airing_log_ref_idx ON airing_log (ref_key, aired_at)',
      // Propuestas de la programación automática (reglas sugeridas)
      `CREATE TABLE IF NOT EXISTS schedule_proposals (
        id VARCHAR(40) PRIMARY KEY,
        status VARCHAR(12) NOT NULL DEFAULT 'pending',
        reason TEXT,
        rules JSONB NOT NULL,
        warnings JSONB NOT NULL DEFAULT '[]',
        summary JSONB NOT NULL DEFAULT '[]',
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        decided_at TIMESTAMPTZ
      )`
    ]
  },
  {
    id: '2026-10-20-audiencia',
    description: 'Audiencia: espectadores por minuto y sesiones de visualización',
    sql: [
      // Una muestra por minuto: cuántos estaban viendo (web, TV/IPTV, radio) y qué había al aire
      `CREATE TABLE IF NOT EXISTS audience_samples (
        at TIMESTAMPTZ PRIMARY KEY,
        web SMALLINT NOT NULL DEFAULT 0,
        tv SMALLINT NOT NULL DEFAULT 0,
        radio SMALLINT NOT NULL DEFAULT 0,
        program TEXT
      )`,
      // Cada visualización (cliente anónimo: hash de IP y reproductor)
      `CREATE TABLE IF NOT EXISTS audience_sessions (
        id BIGSERIAL PRIMARY KEY,
        client_hash VARCHAR(32) NOT NULL,
        kind VARCHAR(8) NOT NULL,
        started_at TIMESTAMPTZ NOT NULL,
        ended_at TIMESTAMPTZ NOT NULL,
        seconds INTEGER NOT NULL
      )`,
      'CREATE INDEX IF NOT EXISTS audience_sessions_started_idx ON audience_sessions (started_at)'
    ]
  }
];

const CREATE_MIGRATIONS_TABLE = `CREATE TABLE IF NOT EXISTS schema_migrations (
  id VARCHAR(80) PRIMARY KEY,
  applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
)`;

/**
 * Aplica las migraciones pendientes.
 * @param {import('pg').Pool} pool
 * @returns {Promise<string[]>} ids aplicadas en esta llamada
 */
async function runMigrations(pool) {
  await pool.query(CREATE_MIGRATIONS_TABLE);
  const done = new Set((await pool.query('SELECT id FROM schema_migrations')).rows.map(r => r.id));
  const applied = [];
  for (const m of MIGRATIONS) {
    if (done.has(m.id)) continue;
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      for (const sql of m.sql) await client.query(sql);
      await client.query('INSERT INTO schema_migrations (id) VALUES ($1)', [m.id]);
      await client.query('COMMIT');
      applied.push(m.id);
      console.log(`[DB/Migraciones] ✅ ${m.id}: ${m.description}`);
    } catch (e) {
      await client.query('ROLLBACK').catch(() => {});
      throw new Error(`Migración ${m.id} falló: ${e.message}`);
    } finally {
      client.release();
    }
  }
  return applied;
}

module.exports = { MIGRATIONS, runMigrations };
