function json(data, status = 200) {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" }
  });
}

const STARTER_CHANNELS = [
  {
    channel_id: "UC_SgaM1zbb1Mibnsp6J0fJA",
    channel_name: "기묘한 밤",
    category: "mystery_story",
    source_url: "https://www.youtube.com/@기묘한밤",
    priority: 10
  },
  {
    channel_id: "UCXql5C57vS4ogUt6CPEWWHA",
    channel_name: "김지윤의 지식Play",
    category: "knowledge_history",
    source_url: "https://www.youtube.com/@kjy_play",
    priority: 20
  },
  {
    channel_id: "UC7uDyFIqExDnfXAIZqumFrQ",
    channel_name: "셜록현준",
    category: "knowledge_story",
    source_url: "https://www.youtube.com/channel/UC7uDyFIqExDnfXAIZqumFrQ",
    priority: 30
  }
];

async function seedStarterChannels(env) {
  const statements = STARTER_CHANNELS.map((c) => env.DB.prepare(`
    INSERT INTO channels (channel_id, channel_name, category, source_url, enabled, priority, updated_at)
    VALUES (?, ?, ?, ?, 1, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(channel_id) DO UPDATE SET
      channel_name = excluded.channel_name,
      category = excluded.category,
      source_url = excluded.source_url,
      priority = excluded.priority,
      updated_at = CURRENT_TIMESTAMP
  `).bind(c.channel_id, c.channel_name, c.category, c.source_url, c.priority));
  await env.DB.batch(statements);
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === "/api/health") {
      return json({ ok: true, service: "CONTEXT Video", version: "0.2.0", stage: "starter-pool" });
    }

    if (url.pathname === "/api/db-health") {
      try {
        const row = await env.DB.prepare("SELECT 1 AS ok").first();
        return json({ ok: row?.ok === 1, service: "CONTEXT Video", database: "context-video-db", binding: "DB", result: row });
      } catch (error) {
        return json({ ok: false, error: String(error?.message || error) }, 500);
      }
    }

    if (url.pathname === "/api/youtube-health") {
      if (!env.YOUTUBE_API_KEY) return json({ ok: false, youtube: false, reason: "YOUTUBE_API_KEY secret is missing" }, 500);
      const endpoint = new URL("https://www.googleapis.com/youtube/v3/channels");
      endpoint.searchParams.set("part", "id");
      endpoint.searchParams.set("id", "UCBR8-60-B28hp2BmDPdntcQ");
      endpoint.searchParams.set("key", env.YOUTUBE_API_KEY);
      const response = await fetch(endpoint.toString());
      const data = await response.json();
      if (!response.ok) return json({ ok: false, youtube: false, http_status: response.status, reason: data?.error?.message || "YouTube API request failed" }, response.status);
      return json({ ok: true, youtube: true, api: "YouTube Data API v3", quota_units_used_by_this_test: 1, items_returned: data.items?.length || 0, secret_exposed: false });
    }

    if (url.pathname === "/api/pool/bootstrap") {
      try {
        await seedStarterChannels(env);
        const { results } = await env.DB.prepare("SELECT channel_id, channel_name, category, priority FROM channels WHERE enabled = 1 ORDER BY priority, channel_name").all();
        return json({ ok: true, seeded: STARTER_CHANNELS.length, channels: results });
      } catch (error) {
        return json({ ok: false, reason: String(error?.message || error) }, 500);
      }
    }

    if (url.pathname === "/api/channels") {
      const { results } = await env.DB.prepare("SELECT channel_id, channel_name, category, priority, last_collected_at FROM channels WHERE enabled = 1 ORDER BY priority, channel_name").all();
      return json({ ok: true, count: results.length, channels: results });
    }

    return json({
      service: "CONTEXT Video",
      version: "0.2.0",
      message: "Starter channel pool is ready.",
      endpoints: ["GET /api/health", "GET /api/db-health", "GET /api/youtube-health", "GET /api/pool/bootstrap", "GET /api/channels"]
    });
  },

  async scheduled(controller, env) {
    await seedStarterChannels(env);
    console.log("CONTEXT scheduled trigger", { cron: controller.cron, scheduledTime: controller.scheduledTime });
  }
};
