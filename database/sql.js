/**
 * Home Channel HLS - Consultas SQL (Postgres). Un solo lugar para el esquema que usan los
 * repositorios y la sincronización.
 */

module.exports = {
  CREATE_SETTINGS_TABLE: `
    CREATE TABLE IF NOT EXISTS app_settings (
      key VARCHAR(64) PRIMARY KEY,
      value TEXT,
      updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
    );`,

  /* ---------- Lecturas (carga a memoria) ---------- */
  SELECT_SHOWS_WITH_EPISODES: `
    SELECT
      s.id, s.title, s.description, s.category, s.color, s.current_episode_index AS "currentEpisodeIndex", s.created_at AS "createdAt",
      COALESCE(
        json_agg(
          json_build_object(
            'id', e.id, 'showId', e.show_id, 'title', e.title, 'season', e.season, 'episode', e.episode,
            'filename', e.filename, 'path', e.path, 'duration', e.duration, 'durationFormatted', e.duration_formatted,
            'sizeMB', e.size_mb, 'status', e.status, 'createdAt', e.created_at
          ) ORDER BY e.season, e.episode
        ) FILTER (WHERE e.id IS NOT NULL),
        '[]'::json
      ) AS episodes
    FROM shows s
    LEFT JOIN episodes e ON e.show_id = s.id
    GROUP BY s.id
    ORDER BY s.title;`,
  SELECT_COMMERCIALS: `
    SELECT id, title, type, filename, path, duration, duration_formatted AS "durationFormatted",
      size_mb AS "sizeMB", status, created_at AS "createdAt"
    FROM commercials ORDER BY created_at;`,
  SELECT_SCHEDULE_CONFIG: `
    SELECT mode, commercials_frequency AS "commercialsFrequency", weekly_grid AS "weeklyGrid"
    FROM schedule_config WHERE id = 1;`,
  // Todos los pendientes + los últimos 200 completados
  SELECT_JOBS: `
    (
      SELECT id, input_path AS "inputPath", original_filename AS "originalFilename", type, show_id AS "showId",
        title, season, episode, progress, fps, status, error, created_at AS "createdAt"
      FROM transcode_jobs
      WHERE status IN ('pending', 'processing')
      ORDER BY CASE WHEN type IN ('commercial', 'bumper') THEN 0 ELSE 1 END, created_at ASC
    )
    UNION ALL
    (
      SELECT id, input_path AS "inputPath", original_filename AS "originalFilename", type, show_id AS "showId",
        title, season, episode, progress, fps, status, error, created_at AS "createdAt"
      FROM transcode_jobs WHERE status = 'completed' ORDER BY created_at DESC LIMIT 200
    );`,
  SELECT_SETTINGS: 'SELECT key, value FROM app_settings;',
  SELECT_SETTING: 'SELECT value FROM app_settings WHERE key = $1 LIMIT 1;',

  /* ---------- Series ---------- */
  CREATE_SHOW: `
    INSERT INTO shows (id, title, description, category, color, current_episode_index, created_at)
    VALUES ($1, $2, $3, $4, $5, 0, $6)
    ON CONFLICT (id) DO UPDATE SET title = EXCLUDED.title, description = EXCLUDED.description,
      category = EXCLUDED.category, color = EXCLUDED.color;`,
  UPSERT_SHOW_FULL: `
    INSERT INTO shows (id, title, description, category, color, current_episode_index, created_at)
    VALUES ($1, $2, $3, $4, $5, $6, $7)
    ON CONFLICT (id) DO UPDATE SET title = EXCLUDED.title, description = EXCLUDED.description, category = EXCLUDED.category,
      color = EXCLUDED.color, current_episode_index = EXCLUDED.current_episode_index;`,
  UPDATE_SHOW: `
    UPDATE shows SET title = COALESCE($1, title), description = COALESCE($2, description),
      category = COALESCE($3, category), color = COALESCE($4, color)
    WHERE id = $5;`,
  DELETE_SHOW: 'DELETE FROM shows WHERE id = $1;',
  UPDATE_SHOW_PROGRESS: 'UPDATE shows SET current_episode_index = $1 WHERE id = $2;',

  /* ---------- Episodios ---------- */
  UPSERT_EPISODE: `
    INSERT INTO episodes (id, show_id, title, season, episode, filename, path, duration, duration_formatted, size_mb, status, created_at)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
    ON CONFLICT (id) DO UPDATE SET title = EXCLUDED.title, season = EXCLUDED.season, episode = EXCLUDED.episode,
      filename = EXCLUDED.filename, path = EXCLUDED.path, duration = EXCLUDED.duration,
      duration_formatted = EXCLUDED.duration_formatted, size_mb = EXCLUDED.size_mb, status = EXCLUDED.status;`,
  UPDATE_EPISODE_FILE: `
    UPDATE episodes SET title = $1, season = $2, episode = $3, filename = $4, path = $5,
      duration = $6, duration_formatted = $7, size_mb = $8, status = $9
    WHERE id = $10;`,
  UPDATE_EPISODE_META: `
    UPDATE episodes SET title = COALESCE($1, title), season = COALESCE($2, season), episode = COALESCE($3, episode)
    WHERE id = $4;`,
  UPDATE_EPISODE_NUMBER: 'UPDATE episodes SET episode = $1 WHERE id = $2;',
  UPDATE_EPISODE_NUMBERS_BATCH: `
    UPDATE episodes AS e
    SET episode = u.ep_num
    FROM UNNEST($1::text[], $2::int[]) AS u(id, ep_num)
    WHERE e.id = u.id;`,
  UPDATE_EPISODE_DURATION: 'UPDATE episodes SET duration = $1, duration_formatted = $2 WHERE path = $3;',
  DELETE_EPISODE: 'DELETE FROM episodes WHERE id = $1;',

  /* ---------- Comerciales y bumpers ---------- */
  UPSERT_COMMERCIAL: `
    INSERT INTO commercials (id, title, type, filename, path, duration, duration_formatted, size_mb, status, created_at)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
    ON CONFLICT (id) DO UPDATE SET title = EXCLUDED.title, type = EXCLUDED.type, filename = EXCLUDED.filename,
      path = EXCLUDED.path, duration = EXCLUDED.duration, duration_formatted = EXCLUDED.duration_formatted,
      size_mb = EXCLUDED.size_mb, status = EXCLUDED.status;`,
  UPDATE_COMMERCIAL: 'UPDATE commercials SET title = $1, type = $2 WHERE id = $3;',
  UPDATE_COMMERCIAL_DURATION: 'UPDATE commercials SET duration = $1, duration_formatted = $2 WHERE path = $3;',
  DELETE_COMMERCIAL: 'DELETE FROM commercials WHERE id = $1;',

  /* ---------- Parrilla ---------- */
  UPSERT_SCHEDULE_CONFIG: `
    INSERT INTO schedule_config (id, mode, commercials_frequency, weekly_grid, updated_at)
    VALUES (1, $1, $2, $3, NOW())
    ON CONFLICT (id) DO UPDATE SET mode = EXCLUDED.mode, commercials_frequency = EXCLUDED.commercials_frequency,
      weekly_grid = EXCLUDED.weekly_grid, updated_at = NOW();`,

  /* ---------- Cola de transcodificación ---------- */
  UPSERT_JOB: `
    INSERT INTO transcode_jobs (id, input_path, original_filename, type, show_id, title, season, episode, progress, fps, status, error, created_at)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
    ON CONFLICT (id) DO UPDATE SET progress = EXCLUDED.progress, fps = EXCLUDED.fps, status = EXCLUDED.status, error = EXCLUDED.error;`,
  UPDATE_JOB: `
    UPDATE transcode_jobs SET progress = COALESCE($1, progress), fps = COALESCE($2, fps),
      status = COALESCE($3, status), error = COALESCE($4, error)
    WHERE id = $5;`,

  /* ---------- Programador: series, reglas, historial y propuestas ---------- */
  SELECT_PROGRAMMING_SERIES: `
    SELECT saga_key AS "sagaKey", franja, frequency, episode_order AS "order", max_daily AS "maxDaily",
      marathon, excluded, updated_at AS "updatedAt"
    FROM programming_series;`,
  UPSERT_PROGRAMMING_SERIES: `
    INSERT INTO programming_series (saga_key, franja, frequency, episode_order, max_daily, marathon, excluded, updated_at)
    VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
    ON CONFLICT (saga_key) DO UPDATE SET franja = EXCLUDED.franja, frequency = EXCLUDED.frequency,
      episode_order = EXCLUDED.episode_order, max_daily = EXCLUDED.max_daily, marathon = EXCLUDED.marathon,
      excluded = EXCLUDED.excluded, updated_at = NOW();`,

  SELECT_SCHEDULE_RULES: `
    SELECT id, kind, target, days, start_time AS "startTime", slots, source, priority, enabled, note,
      created_at AS "createdAt", updated_at AS "updatedAt"
    FROM schedule_rules ORDER BY created_at;`,
  UPSERT_SCHEDULE_RULE: `
    INSERT INTO schedule_rules (id, kind, target, days, start_time, slots, source, priority, enabled, note, created_at, updated_at)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, NOW())
    ON CONFLICT (id) DO UPDATE SET kind = EXCLUDED.kind, target = EXCLUDED.target, days = EXCLUDED.days,
      start_time = EXCLUDED.start_time, slots = EXCLUDED.slots, source = EXCLUDED.source,
      priority = EXCLUDED.priority, enabled = EXCLUDED.enabled, note = EXCLUDED.note, updated_at = NOW();`,
  DELETE_SCHEDULE_RULE: 'DELETE FROM schedule_rules WHERE id = $1;',

  // Historial reciente (para maratones y la vista de lo emitido)
  SELECT_RECENT_AIRINGS: `
    SELECT id, ref_key AS "refKey", show_id AS "showId", episode_id AS "episodeId", period, kind, aired_at AS "airedAt"
    FROM airing_log WHERE aired_at > NOW() - INTERVAL '15 days' ORDER BY aired_at;`,
  INSERT_AIRING: `
    INSERT INTO airing_log (ref_key, show_id, episode_id, period, kind, aired_at)
    VALUES ($1, $2, $3, $4, $5, $6);`,
  SELECT_AIRINGS_RANGE: `
    SELECT id, ref_key AS "refKey", show_id AS "showId", episode_id AS "episodeId", period, kind, aired_at AS "airedAt"
    FROM airing_log WHERE aired_at >= $1 AND aired_at < $2 ORDER BY aired_at LIMIT 2000;`,

  INSERT_AUDIENCE_SAMPLE: `
    INSERT INTO audience_samples (at, web, tv, radio, program) VALUES ($1, $2, $3, $4, $5)
    ON CONFLICT (at) DO UPDATE SET web = EXCLUDED.web, tv = EXCLUDED.tv, radio = EXCLUDED.radio, program = EXCLUDED.program;`,
  SELECT_AUDIENCE_SAMPLES: `
    SELECT at, web, tv, radio, program FROM audience_samples WHERE at >= $1 AND at < $2 ORDER BY at;`,
  INSERT_AUDIENCE_SESSION: `
    INSERT INTO audience_sessions (client_hash, kind, started_at, ended_at, seconds) VALUES ($1, $2, $3, $4, $5);`,
  SELECT_AUDIENCE_SESSIONS: `
    SELECT client_hash AS "clientHash", kind, started_at AS "startedAt", ended_at AS "endedAt", seconds
    FROM audience_sessions WHERE started_at >= $1 AND started_at < $2;`,
  PURGE_AUDIENCE_SAMPLES: 'DELETE FROM audience_samples WHERE at < $1;',
  PURGE_AUDIENCE_SESSIONS: 'DELETE FROM audience_sessions WHERE started_at < $1;',

  SELECT_PROPOSALS: `
    SELECT id, status, reason, rules, warnings, summary, created_at AS "createdAt", decided_at AS "decidedAt"
    FROM schedule_proposals ORDER BY created_at DESC LIMIT 5;`,
  UPSERT_PROPOSAL: `
    INSERT INTO schedule_proposals (id, status, reason, rules, warnings, summary, created_at, decided_at)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
    ON CONFLICT (id) DO UPDATE SET status = EXCLUDED.status, decided_at = EXCLUDED.decided_at;`,

  /* ---------- Ajustes ---------- */
  UPSERT_SETTING: `
    INSERT INTO app_settings (key, value, updated_at) VALUES ($1, $2, NOW())
    ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW();`,
  INSERT_SETTING_IF_MISSING: `
    INSERT INTO app_settings (key, value, updated_at) VALUES ($1, $2, NOW())
    ON CONFLICT (key) DO NOTHING;`
};
