const HOME_LIMIT = 120;
const SHORTS_LIMIT = 120;

function currentHourKey(now = new Date()) {
  return now.toISOString().slice(0, 13) + ':00:00Z';
}

async function ensureRecommendationTables(env) {
  await env.DB.prepare(`
    CREATE TABLE IF NOT EXISTS recommendation_items (
      hour_key TEXT NOT NULL,
      mode TEXT NOT NULL CHECK (mode IN ('home','shorts')),
      position INTEGER NOT NULL,
      video_id TEXT NOT NULL,
      generated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (hour_key, mode, position)
    )
  `).run();
  await env.DB.prepare(`CREATE INDEX IF NOT EXISTS idx_recommendation_items_hour_mode ON recommendation_items(hour_key, mode, position)`).run();
}

async function buildMode(env, hourKey, mode, limit) {
  const where = mode === 'shorts'
    ? `v.duration_seconds IS NOT NULL AND v.duration_seconds > 0 AND v.duration_seconds <= 180`
    : `1=1`;

  const { results } = await env.DB.prepare(`
    SELECT v.video_id
    FROM videos v
    JOIN channels c ON c.channel_id = v.channel_id
    WHERE c.enabled = 1
      AND v.title IS NOT NULL
      AND TRIM(v.title) <> ''
      AND ${where}
    ORDER BY RANDOM()
    LIMIT ?
  `).bind(limit).all();

  if (!results.length) return 0;

  const statements = results.map((row, idx) => env.DB.prepare(`
    INSERT OR REPLACE INTO recommendation_items(hour_key, mode, position, video_id, generated_at)
    VALUES(?,?,?,?,CURRENT_TIMESTAMP)
  `).bind(hourKey, mode, idx + 1, row.video_id));

  for (let i = 0; i < statements.length; i += 50) {
    await env.DB.batch(statements.slice(i, i + 50));
  }
  return results.length;
}

export async function ensureHourlyRecommendations(env, force = false) {
  await ensureRecommendationTables(env);
  const hourKey = currentHourKey();

  if (!force) {
    const existing = await env.DB.prepare(`
      SELECT mode, COUNT(*) AS count
      FROM recommendation_items
      WHERE hour_key = ?
      GROUP BY mode
    `).bind(hourKey).all();
    const counts = Object.fromEntries((existing.results || []).map(r => [r.mode, Number(r.count || 0)]));
    if ((counts.home || 0) > 0 && (counts.shorts || 0) > 0) {
      return { hour_key: hourKey, created: false, home: counts.home || 0, shorts: counts.shorts || 0 };
    }
  }

  await env.DB.prepare(`DELETE FROM recommendation_items WHERE hour_key = ?`).bind(hourKey).run();
  const home = await buildMode(env, hourKey, 'home', HOME_LIMIT);
  const shorts = await buildMode(env, hourKey, 'shorts', SHORTS_LIMIT);

  await env.DB.prepare(`
    DELETE FROM recommendation_items
    WHERE generated_at < datetime('now','-48 hours')
  `).run();

  return { hour_key: hourKey, created: true, home, shorts };
}

export async function getCurrentRecommendations(env, mode = 'home', limit = 30) {
  const safeMode = mode === 'shorts' ? 'shorts' : 'home';
  const safeLimit = Math.max(1, Math.min(120, Number(limit || 30)));
  const built = await ensureHourlyRecommendations(env, false);

  const { results } = await env.DB.prepare(`
    SELECT
      r.position,
      v.video_id,
      v.title,
      v.description,
      v.published_at,
      v.duration_seconds,
      v.thumbnail_url,
      v.view_count,
      v.like_count,
      v.gate_status,
      v.gate_reason,
      c.channel_id,
      c.channel_name,
      c.category
    FROM recommendation_items r
    JOIN videos v ON v.video_id = r.video_id
    JOIN channels c ON c.channel_id = v.channel_id
    WHERE r.hour_key = ? AND r.mode = ?
    ORDER BY r.position
    LIMIT ?
  `).bind(built.hour_key, safeMode, safeLimit).all();

  return {
    hour_key: built.hour_key,
    mode: safeMode,
    count: results.length,
    source: 'beta_hourly_random',
    gate_filter_applied: false,
    videos: results.map(v => ({
      ...v,
      watch_url: safeMode === 'shorts'
        ? `https://www.youtube.com/shorts/${v.video_id}`
        : `https://www.youtube.com/watch?v=${v.video_id}`
    }))
  };
}
