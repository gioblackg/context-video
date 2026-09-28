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
  async fetch(request) {
    const url = new URL(request.url);

    if (url.pathname === "/api/health") {
      return json({
        ok: true,
        service: "CONTEXT Video",
        version: "0.1.0",
        stage: "foundation"
      });
    }

    return json({
      service: "CONTEXT Video",
      version: "0.1.0",
      message: "Server foundation is ready.",
      endpoints: ["GET /api/health"]
    });
  },

  async scheduled(controller) {
    console.log("CONTEXT scheduled trigger", {
      cron: controller.cron,
      scheduledTime: controller.scheduledTime
    });
  }
};
