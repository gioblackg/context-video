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

    return json({
      service: "CONTEXT Video",
      version: "0.1.0",
      message: "Server foundation is ready.",
      endpoints: ["GET /api/health", "GET /api/db-health"]
    });
  },

  async scheduled(controller) {
    console.log("CONTEXT scheduled trigger", {
      cron: controller.cron,
      scheduledTime: controller.scheduledTime
    });
  }
};
