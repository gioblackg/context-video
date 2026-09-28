PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS channels (
  channel_id TEXT PRIMARY KEY,
  channel_name TEXT NOT NULL,
  category TEXT NOT NULL,
  uploads_playlist_id TEXT,
  source_url TEXT,
  enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
  priority INTEGER NOT NULL DEFAULT 100,
  last_collected_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_channels_enabled_category
  ON channels(enabled, category, priority);

CREATE TABLE IF NOT EXISTS videos (
  video_id TEXT PRIMARY KEY,
  channel_id TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT,
  published_at TEXT NOT NULL,
  duration_seconds INTEGER,
  thumbnail_url TEXT,
  view_count INTEGER,
  like_count INTEGER,
  gate_status TEXT NOT NULL DEFAULT 'pending'
    CHECK (gate_status IN ('pending', 'pass', 'review', 'fail')),
  gate_reason TEXT,
  listen_score INTEGER,
  time_pool TEXT
    CHECK (time_pool IS NULL OR time_pool IN ('30m', '60m', '60m_plus')),
  collected_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (channel_id) REFERENCES channels(channel_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_videos_channel_published
  ON videos(channel_id, published_at DESC);

CREATE INDEX IF NOT EXISTS idx_videos_gate_pool_published
  ON videos(gate_status, time_pool, published_at DESC);
