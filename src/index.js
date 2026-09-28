function json(data, status = 200) {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store"
    }
  });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === "/api/health") {
      return json({
        ok: true,
        service: "CONTEXT Video",
        version: "0.1.0",
        stage: "foundation"
      });
    }

    if (url.pathname === "/api/db-health") {
      try {
        const row = await env.DB.prepare("SELECT 1 AS ok").first();
        return json({
          ok: row?.ok === 1,
          service: "CONTEXT Video",
          database: "context-video-db",
          binding: "DB",
          result: row
        });
      } catch (error) {
        return json({
          ok: false,
          service: "CONTEXT Video",
          database: "context-video-db",
          binding: "DB",
          error: String(error?.message || error)
        }, 500);
      }
    }

    if (url.pathname === "/api/youtube-health") {
      if (!env.YOUTUBE_API_KEY) {
        return json({ ok: false, youtube: false, reason: "YOUTUBE_API_KEY secret is missing" }, 500);
      }

      try {
        // channels.list costs 1 quota unit. Google's own YouTube channel ID is used only
        // to verify that the secret and YouTube Data API v3 are working. The key is never returned.
        const endpoint = new URL("https://www.googleapis.com/youtube/v3/channels");
        endpoint.searchParams.set("part", "id");
        endpoint.searchParams.set("id", "UCBR8-60-B28hp2BmDPdntcQ");
        endpoint.searchParams.set("key", env.YOUTUBE_API_KEY);

        const response = await fetch(endpoint.toString());
        const data = await response.json();

        if (!response.ok) {
          return json({
            ok: false,
            youtube: false,
            http_status: response.status,
            reason: data?.error?.message || "YouTube API request failed"
          }, response.status);
        }

        return json({
          ok: true,
          youtube: true,
          api: "YouTube Data API v3",
          quota_units_used_by_this_test: 1,
          items_returned: Array.isArray(data.items) ? data.items.length : 0,
          secret_exposed: false
        });
      } catch (error) {
        return json({ ok: false, youtube: false, reason: String(error?.message || error) }, 500);
      }
    }

    return json({
      service: "CONTEXT Video",
      version: "0.1.0",
      message: "Server foundation is ready.",
      endpoints: ["GET /api/health", "GET /api/db-health", "GET /api/youtube-health"]
    });
  },

  async scheduled(controller) {
    console.log("CONTEXT scheduled trigger", {
      cron: controller.cron,
      scheduledTime: controller.scheduledTime
    });
  }
};
