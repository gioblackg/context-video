function json(data, status = 200) {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" }
  });
}

const STARTER_CHANNELS = [
  { channel_id: "UC_SgaM1zbb1Mibnsp6J0fJA", channel_name: "기묘한 밤", category: "mystery_story", source_url: "https://www.youtube.com/@기묘한밤", priority: 10 },
  { channel_id: "UCXql5C57vS4ogUt6CPEWWHA", channel_name: "김지윤의 지식Play", category: "knowledge_history", source_url: "https://www.youtube.com/@kjy_play", priority: 20 },
  { channel_id: "UC7uDyFIqExDnfXAIZqumFrQ", channel_name: "셜록현준", category: "knowledge_story", source_url: "https://www.youtube.com/channel/UC7uDyFIqExDnfXAIZqumFrQ", priority: 30 }
];

async function seedStarterChannels(env) {
  const statements = STARTER_CHANNELS.map((c) => env.DB.prepare(`
    INSERT INTO channels (channel_id, channel_name, category, source_url, enabled, priority, updated_at)
    VALUES (?, ?, ?, ?, 1, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(channel_id) DO UPDATE SET channel_name=excluded.channel_name, category=excluded.category,
      source_url=excluded.source_url, priority=excluded.priority, updated_at=CURRENT_TIMESTAMP
  `).bind(c.channel_id, c.channel_name, c.category, c.source_url, c.priority));
  await env.DB.batch(statements);
}

function parseDuration(iso) {
  const m = /^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/.exec(iso || "");
  if (!m) return null;
  return Number(m[1] || 0) * 86400 + Number(m[2] || 0) * 3600 + Number(m[3] || 0) * 60 + Number(m[4] || 0);
}

function gateVideo(video) {
  const seconds = parseDuration(video.contentDetails?.duration);
  const title = video.snippet?.title || "";
  const blocked = /(shorts?|쇼츠|티저|예고편|광고|하이라이트)/i.test(title);
  if (seconds == null) return { status: "review", reason: "duration_missing", score: null, pool: null, seconds };
  if (seconds < 1200) return { status: "fail", reason: "under_20_minutes", score: 0, pool: null, seconds };
  if (blocked) return { status: "fail", reason: "blocked_title_pattern", score: 0, pool: null, seconds };
  const pool = seconds < 2700 ? "30m" : seconds < 5400 ? "60m" : "60m_plus";
  const score = seconds >= 1800 ? 80 : 70;
  return { status: "pass", reason: "initial_duration_gate", score, pool, seconds };
}

async function yt(env, path, params) {
  const endpoint = new URL(`https://www.googleapis.com/youtube/v3/${path}`);
  for (const [k, v] of Object.entries(params)) endpoint.searchParams.set(k, String(v));
  endpoint.searchParams.set("key", env.YOUTUBE_API_KEY);
  const response = await fetch(endpoint.toString());
  const data = await response.json();
  if (!response.ok) throw new Error(data?.error?.message || `YouTube API ${response.status}`);
  return data;
}

async function collectVideos(env, perChannel = 10) {
  if (!env.YOUTUBE_API_KEY) throw new Error("YOUTUBE_API_KEY secret is missing");
  await seedStarterChannels(env);
  const { results: channels } = await env.DB.prepare("SELECT channel_id FROM channels WHERE enabled=1 ORDER BY priority").all();
  if (!channels.length) return { channels: 0, candidates: 0, saved: 0, quota_units: 0 };
  let quota = 0;
  const ids = channels.map(c => c.channel_id).join(",");
  const channelData = await yt(env, "channels", { part: "contentDetails", id: ids, maxResults: 50 });
  quota += 1;
  const uploadsByChannel = new Map();
  for (const item of channelData.items || []) uploadsByChannel.set(item.id, item.contentDetails?.relatedPlaylists?.uploads);
  const candidateIds = [];
  for (const c of channels) {
    const playlistId = uploadsByChannel.get(c.channel_id);
    if (!playlistId) continue;
    await env.DB.prepare("UPDATE channels SET uploads_playlist_id=?, updated_at=CURRENT_TIMESTAMP WHERE channel_id=?").bind(playlistId, c.channel_id).run();
    const list = await yt(env, "playlistItems", { part: "contentDetails", playlistId, maxResults: Math.min(50, perChannel) });
    quota += 1;
    for (const item of list.items || []) if (item.contentDetails?.videoId) candidateIds.push(item.contentDetails.videoId);
  }
  const uniqueIds = [...new Set(candidateIds)];
  let saved = 0;
  for (let i = 0; i < uniqueIds.length; i += 50) {
    const batch = uniqueIds.slice(i, i + 50);
    const data = await yt(env, "videos", { part: "snippet,contentDetails,statistics", id: batch.join(","), maxResults: 50 });
    quota += 1;
    const statements = [];
    for (const v of data.items || []) {
      const g = gateVideo(v); const s = v.snippet || {}; const stats = v.statistics || {};
      statements.push(env.DB.prepare(`
        INSERT INTO videos (video_id, channel_id, title, description, published_at, duration_seconds, thumbnail_url,
          view_count, like_count, gate_status, gate_reason, listen_score, time_pool, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
        ON CONFLICT(video_id) DO UPDATE SET title=excluded.title, description=excluded.description,
          duration_seconds=excluded.duration_seconds, thumbnail_url=excluded.thumbnail_url,
          view_count=excluded.view_count, like_count=excluded.like_count, gate_status=excluded.gate_status,
          gate_reason=excluded.gate_reason, listen_score=excluded.listen_score, time_pool=excluded.time_pool,
          updated_at=CURRENT_TIMESTAMP
      `).bind(v.id, s.channelId, s.title || "", s.description || "", s.publishedAt || new Date(0).toISOString(),
        g.seconds, s.thumbnails?.medium?.url || s.thumbnails?.default?.url || null,
        Number(stats.viewCount || 0), Number(stats.likeCount || 0), g.status, g.reason, g.score, g.pool));
      saved += 1;
    }
    if (statements.length) await env.DB.batch(statements);
  }
  await env.DB.prepare("UPDATE channels SET last_collected_at=CURRENT_TIMESTAMP WHERE enabled=1").run();
  return { channels: channels.length, candidates: uniqueIds.length, saved, quota_units: quota };
}

async function auditVideos(env) {
  const { results: summary } = await env.DB.prepare(`
    SELECT gate_status, COALESCE(time_pool, '-') AS time_pool, COALESCE(gate_reason, '-') AS gate_reason, COUNT(*) AS count
    FROM videos GROUP BY gate_status, time_pool, gate_reason ORDER BY gate_status, time_pool, gate_reason
  `).all();
  const { results: byChannel } = await env.DB.prepare(`
    SELECT c.channel_name, COUNT(v.video_id) AS total,
      SUM(CASE WHEN v.gate_status='pass' THEN 1 ELSE 0 END) AS passed,
      SUM(CASE WHEN v.gate_status='fail' THEN 1 ELSE 0 END) AS failed,
      ROUND(AVG(v.duration_seconds)/60.0, 1) AS avg_minutes
    FROM channels c LEFT JOIN videos v ON v.channel_id=c.channel_id
    WHERE c.enabled=1 GROUP BY c.channel_id,c.channel_name ORDER BY c.priority
  `).all();
  const { results: videos } = await env.DB.prepare(`
    SELECT v.video_id,c.channel_name,v.title,ROUND(v.duration_seconds/60.0,1) AS minutes,
      v.view_count,v.gate_status,v.gate_reason,v.listen_score,v.time_pool,v.published_at
    FROM videos v JOIN channels c ON c.channel_id=v.channel_id
    ORDER BY c.priority,v.published_at DESC LIMIT 100
  `).all();
  return { total: videos.length, summary, by_channel: byChannel, videos };
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === "/api/health") return json({ ok: true, service: "CONTEXT Video", version: "0.3.1", stage: "collector-audit" });
    if (url.pathname === "/api/db-health") { try { const row=await env.DB.prepare("SELECT 1 AS ok").first(); return json({ok:row?.ok===1,database:"context-video-db",result:row}); } catch(e){return json({ok:false,reason:String(e?.message||e)},500);} }
    if (url.pathname === "/api/youtube-health") { if(!env.YOUTUBE_API_KEY)return json({ok:false,youtube:false,reason:"YOUTUBE_API_KEY secret is missing"},500); try{const data=await yt(env,"channels",{part:"id",id:"UCBR8-60-B28hp2BmDPdntcQ"});return json({ok:true,youtube:true,api:"YouTube Data API v3",quota_units_used_by_this_test:1,items_returned:data.items?.length||0,secret_exposed:false});}catch(e){return json({ok:false,youtube:false,reason:String(e?.message||e)},500);} }
    if (url.pathname === "/api/pool/bootstrap") { try{await seedStarterChannels(env);const {results}=await env.DB.prepare("SELECT channel_id,channel_name,category,priority FROM channels WHERE enabled=1 ORDER BY priority").all();return json({ok:true,seeded:STARTER_CHANNELS.length,channels:results});}catch(e){return json({ok:false,reason:String(e?.message||e)},500);} }
    if (url.pathname === "/api/collect/bootstrap") { try{const row=await env.DB.prepare("SELECT COUNT(*) AS n FROM videos").first();if(Number(row?.n||0)>0)return json({ok:true,skipped:true,reason:"bootstrap_already_completed",videos_in_db:Number(row.n),quota_units_used:0});const result=await collectVideos(env,10);return json({ok:true,bootstrap:true,...result});}catch(e){return json({ok:false,reason:String(e?.message||e)},500);} }
    if (url.pathname === "/api/audit") { try{return json({ok:true,...await auditVideos(env)});}catch(e){return json({ok:false,reason:String(e?.message||e)},500);} }
    if (url.pathname === "/api/videos") { const pool=url.searchParams.get("pool");const params=[];let sql="SELECT video_id,channel_id,title,published_at,duration_seconds,thumbnail_url,view_count,gate_status,gate_reason,listen_score,time_pool FROM videos WHERE gate_status='pass'";if(pool&&["30m","60m","60m_plus"].includes(pool)){sql+=" AND time_pool=?";params.push(pool);}sql+=" ORDER BY published_at DESC LIMIT 100";const {results}=await env.DB.prepare(sql).bind(...params).all();return json({ok:true,count:results.length,videos:results}); }
    if (url.pathname === "/api/channels") { const {results}=await env.DB.prepare("SELECT channel_id,channel_name,category,priority,last_collected_at FROM channels WHERE enabled=1 ORDER BY priority").all();return json({ok:true,count:results.length,channels:results}); }
    return json({service:"CONTEXT Video",version:"0.3.1",message:"Collector audit is ready.",endpoints:["GET /api/health","GET /api/db-health","GET /api/youtube-health","GET /api/pool/bootstrap","GET /api/collect/bootstrap","GET /api/audit","GET /api/channels","GET /api/videos?pool=30m|60m|60m_plus"]});
  },
  async scheduled(controller, env) { try{const result=await collectVideos(env,10);console.log("CONTEXT scheduled collection",{cron:controller.cron,scheduledTime:controller.scheduledTime,...result});}catch(error){console.error("CONTEXT scheduled collection failed",{cron:controller.cron,reason:String(error?.message||error)});} }
};
