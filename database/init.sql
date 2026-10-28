-- ====================================================================
-- Home Channel HLS - Initial PostgreSQL Database Schema
-- Auto-executed on PostgreSQL container startup or initial database setup.
-- ====================================================================

-- App Settings
CREATE TABLE IF NOT EXISTS app_settings (
  key VARCHAR(64) PRIMARY KEY,
  value TEXT,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Shows / Series
CREATE TABLE IF NOT EXISTS shows (
  id VARCHAR(80) PRIMARY KEY,
  title VARCHAR(255) NOT NULL,
  description TEXT,
  category VARCHAR(80) DEFAULT 'General',
  color VARCHAR(20) DEFAULT '#00f0ff',
  current_episode_index INTEGER DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Episodes
CREATE TABLE IF NOT EXISTS episodes (
  id VARCHAR(80) PRIMARY KEY,
  show_id VARCHAR(80) REFERENCES shows(id) ON DELETE CASCADE,
  title VARCHAR(255) NOT NULL,
  season INTEGER DEFAULT 1,
  episode INTEGER DEFAULT 1,
  filename VARCHAR(255) NOT NULL,
  path TEXT NOT NULL,
  duration NUMERIC(10, 3) DEFAULT 0,
  duration_formatted VARCHAR(20) DEFAULT '00:00',
  size_mb NUMERIC(10, 2) DEFAULT 0,
  status VARCHAR(20) DEFAULT 'ready',
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_episodes_show_id ON episodes(show_id);

-- Commercials & Bumpers
CREATE TABLE IF NOT EXISTS commercials (
  id VARCHAR(80) PRIMARY KEY,
  title VARCHAR(255) NOT NULL,
  type VARCHAR(50) DEFAULT 'commercial',
  filename VARCHAR(255) NOT NULL,
  path TEXT NOT NULL,
  duration NUMERIC(10, 3) DEFAULT 0,
  duration_formatted VARCHAR(20) DEFAULT '00:00',
  size_mb NUMERIC(10, 2) DEFAULT 0,
  status VARCHAR(20) DEFAULT 'ready',
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_commercials_type ON commercials(type);

-- Schedule Configuration
CREATE TABLE IF NOT EXISTS schedule_config (
  id INTEGER PRIMARY KEY DEFAULT 1,
  mode VARCHAR(30) DEFAULT 'grid',
  commercials_frequency VARCHAR(20) DEFAULT 'medium',
  weekly_grid JSONB DEFAULT '{}'::jsonb,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Transcode Queue
CREATE TABLE IF NOT EXISTS transcode_jobs (
  id VARCHAR(80) PRIMARY KEY,
  input_path TEXT NOT NULL,
  original_filename VARCHAR(255) NOT NULL,
  type VARCHAR(50) DEFAULT 'show',
  show_id VARCHAR(80),
  title VARCHAR(255),
  season INTEGER DEFAULT 1,
  episode INTEGER DEFAULT 1,
  progress INTEGER DEFAULT 0,
  fps NUMERIC(6, 2) DEFAULT 0,
  status VARCHAR(20) DEFAULT 'pending',
  error TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_transcode_status ON transcode_jobs(status);

-- Schema Migrations Tracking
CREATE TABLE IF NOT EXISTS schema_migrations (
  id VARCHAR(80) PRIMARY KEY,
  applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Series Programming Preferences
CREATE TABLE IF NOT EXISTS programming_series (
  saga_key VARCHAR(80) PRIMARY KEY,
  franja VARCHAR(20) NOT NULL DEFAULT 'auto',
  frequency VARCHAR(10) NOT NULL DEFAULT 'auto',
  episode_order VARCHAR(12) NOT NULL DEFAULT 'auto',
  max_daily SMALLINT,
  marathon BOOLEAN NOT NULL DEFAULT TRUE,
  excluded BOOLEAN NOT NULL DEFAULT FALSE,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Schedule Rules (Rule-based Programming)
CREATE TABLE IF NOT EXISTS schedule_rules (
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
);

CREATE INDEX IF NOT EXISTS schedule_rules_source_idx ON schedule_rules (source);

-- Airing Log History
CREATE TABLE IF NOT EXISTS airing_log (
  id BIGSERIAL PRIMARY KEY,
  ref_key VARCHAR(120) NOT NULL,
  show_id VARCHAR(80) NOT NULL,
  episode_id VARCHAR(80) NOT NULL,
  period VARCHAR(20) NOT NULL,
  kind VARCHAR(10) NOT NULL,
  aired_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS airing_log_aired_at_idx ON airing_log (aired_at);
CREATE INDEX IF NOT EXISTS airing_log_ref_idx ON airing_log (ref_key, aired_at);

-- Proposals from Schedule AI / Auto-generation
CREATE TABLE IF NOT EXISTS schedule_proposals (
  id VARCHAR(40) PRIMARY KEY,
  status VARCHAR(12) NOT NULL DEFAULT 'pending',
  reason TEXT,
  rules JSONB NOT NULL,
  warnings JSONB NOT NULL DEFAULT '[]',
  summary JSONB NOT NULL DEFAULT '[]',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  decided_at TIMESTAMPTZ
);

-- Audience Analytics (Samples per minute)
CREATE TABLE IF NOT EXISTS audience_samples (
  at TIMESTAMPTZ PRIMARY KEY,
  web SMALLINT NOT NULL DEFAULT 0,
  tv SMALLINT NOT NULL DEFAULT 0,
  radio SMALLINT NOT NULL DEFAULT 0,
  program TEXT
);

-- Audience Client Sessions
CREATE TABLE IF NOT EXISTS audience_sessions (
  id BIGSERIAL PRIMARY KEY,
  client_hash VARCHAR(32) NOT NULL,
  kind VARCHAR(8) NOT NULL,
  started_at TIMESTAMPTZ NOT NULL,
  ended_at TIMESTAMPTZ NOT NULL,
  seconds INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS audience_sessions_started_idx ON audience_sessions (started_at);

-- Mark existing base migrations as already satisfied
INSERT INTO schema_migrations (id) VALUES
  ('2026-10-19-programador-reglas'),
  ('2026-10-20-audiencia')
ON CONFLICT (id) DO NOTHING;

-- Initial default schedule config
INSERT INTO schedule_config (id, mode, commercials_frequency, weekly_grid, updated_at)
VALUES (1, 'grid', 'medium', '{"monday":{},"tuesday":{},"wednesday":{},"thursday":{},"friday":{},"saturday":{},"sunday":{}}'::jsonb, NOW())
ON CONFLICT (id) DO NOTHING;

-- Seed Initial Creative Commons Demo Show & Episode
INSERT INTO shows (id, title, description, category, color, current_episode_index, created_at)
VALUES (
  'show_open_source_animation',
  'Open Source Animation',
  'Showcase of open-source 3D animated short films (Blender Foundation / CC-BY).',
  'Animation',
  '#00f0ff',
  0,
  NOW()
) ON CONFLICT (id) DO NOTHING;

INSERT INTO episodes (id, show_id, title, season, episode, filename, path, duration, duration_formatted, size_mb, status, created_at)
VALUES (
  'ep_open_source_01',
  'show_open_source_animation',
  'Big Buck Bunny - Short Film',
  1,
  1,
  'big_buck_bunny_1080p.mp4',
  'media/shows/show_open_source_animation/big_buck_bunny_1080p.mp4',
  30.000,
  '00:30',
  13.1,
  'ready',
  NOW()
) ON CONFLICT (id) DO NOTHING;

INSERT INTO schedule_rules (id, kind, target, days, start_time, slots, source, priority, enabled, note, created_at, updated_at)
VALUES (
  'rule_default_demo',
  'show',
  'show_open_source_animation',
  '[0, 1, 2, 3, 4, 5, 6]'::jsonb,
  '00:00',
  48,
  'manual',
  1,
  TRUE,
  'Default 24/7 Creative Commons Demo Broadcast',
  NOW(),
  NOW()
) ON CONFLICT (id) DO NOTHING;
