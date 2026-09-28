function json(data, status = 200) {
  return new Response(JSON.stringify(data, null, 2), { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" } });
}

const STARTER_CHANNELS = [
  { channel_id: "UC_SgaM1zbb1Mibnsp6J0fJA", channel_name: "기묘한 밤", category: "mystery_story", source_url: "https://www.youtube.com/@기묘한밤", priority: 10 },
  { channel_id: "UCXql5C57vS4ogUt6CPEWWHA", channel_name: "김지윤의 지식Play", category: "knowledge_history", source_url: "https://www.youtube.com/@kjy_play", priority: 20 },
  { channel_id: "UC7uDyFIqExDnfXAIZqumFrQ", channel_name: "셜록현준", category: "knowledge_story", source_url: "https://www.youtube.com/channel/UC7uDyFIqExDnfXAIZqumFrQ", priority: 30 }
];

async function seedStarterChannels(env) {
  await env.DB.batch(STARTER_CHANNELS.map(c => env.DB.prepare(`INSERT INTO channels (channel_id,channel_name,category,source_url,enabled,priority,updated_at) VALUES (?,?,?,?,1,?,CURRENT_TIMESTAMP) ON CONFLICT(channel_id) DO UPDATE SET channel_name=excluded.channel_name,category=excluded.category,source_url=excluded.source_url,priority=excluded.priority,updated_at=CURRENT_TIMESTAMP`).bind(c.channel_id,c.channel_name,c.category,c.source_url,c.priority)));
}

function parseDuration(iso) {
  const m = /^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/.exec(iso || "");
  return m ? Number(m[1]||0)*86400 + Number(m[2]||0)*3600 + Number(m[3]||0)*60 + Number(m[4]||0) : null;
}

function classifyGate(title, seconds) {
  const t = title || "";
  if (seconds == null) return { status:"review", reason:"duration_missing", score:null, pool:null };
  if (seconds < 1200) return { status:"fail", reason:"under_20_minutes", score:0, pool:null };
  // Do not block the ordinary word '광고': e.g. a documentary about advertising/signboards.
  if (/(^|\s|\[|\()#?shorts?($|\s|\]|\))|쇼츠|티저|예고편|하이라이트/i.test(t)) return { status:"fail", reason:"short_teaser_highlight", score:0, pool:null };
  if (/유료\s*광고|유료광고|협찬|브랜디드|PPL|프로모션/i.test(t)) return { status:"review", reason:"possible_sponsored_content", score:40, pool:null };

  const pool = seconds < 2700 ? "30m" : seconds < 5400 ? "60m" : "60m_plus";
  let score = seconds >= 5400 ? 90 : seconds >= 2700 ? 85 : seconds >= 1800 ? 80 : 72;

  // Strong listening/story signals available from metadata.
  if (/이야기|미스터리|괴담|사건|역사|인터뷰|몰아보기|리뷰|왜|이유|비하인드|전설|범죄|인물|지식|수다/i.test(t)) score += 5;
  // These topics often depend heavily on looking at places/buildings; keep for review rather than deleting.
  if (/숙소|리조트|투어|여행\s*필수|꿈의\s*집|인테리어|룸투어/i.test(t)) return { status:"review", reason:"possible_visual_dependency", score:Math.min(score,60), pool };

  return { status:"pass", reason:"listening_gate_v2", score:Math.min(score,100), pool };
}

function gateVideo(v) {
  const seconds = parseDuration(v.contentDetails?.duration);
  return { ...classifyGate(v.snippet?.title || "", seconds), seconds };
}

async function yt(env, path, params) {
  const u = new URL(`https://www.googleapis.com/youtube/v3/${path}`);
  for (const [k,v] of Object.entries(params)) u.searchParams.set(k,String(v));
  u.searchParams.set("key",env.YOUTUBE_API_KEY);
  const r = await fetch(u.toString()); const d = await r.json();
  if (!r.ok) throw new Error(d?.error?.message || `YouTube API ${r.status}`);
  return d;
}

async function collectVideos(env, perChannel = 50) {
  if (!env.YOUTUBE_API_KEY) throw new Error("YOUTUBE_API_KEY secret is missing");
  await seedStarterChannels(env);
  const {results:channels}=await env.DB.prepare("SELECT channel_id,uploads_playlist_id FROM channels WHERE enabled=1 ORDER BY priority").all();
  if (!channels.length) return {channels:0,candidates:0,new_candidates:0,saved:0,quota_units:0};
  let quota=0;

  // Resolve upload playlists only when they are not already stored.
  const missing=channels.filter(c=>!c.uploads_playlist_id);
  if (missing.length) {
    const data=await yt(env,"channels",{part:"contentDetails",id:missing.map(c=>c.channel_id).join(","),maxResults:50}); quota++;
    for (const item of data.items||[]) {
      const p=item.contentDetails?.relatedPlaylists?.uploads;
      if (p) { await env.DB.prepare("UPDATE channels SET uploads_playlist_id=?,updated_at=CURRENT_TIMESTAMP WHERE channel_id=?").bind(p,item.id).run(); const c=channels.find(x=>x.channel_id===item.id); if(c)c.uploads_playlist_id=p; }
    }
  }

  const candidateIds=[];
  for (const c of channels) {
    if (!c.uploads_playlist_id) continue;
    const list=await yt(env,"playlistItems",{part:"contentDetails",playlistId:c.uploads_playlist_id,maxResults:Math.min(50,perChannel)}); quota++;
    for (const item of list.items||[]) if(item.contentDetails?.videoId) candidateIds.push(item.contentDetails.videoId);
  }
  const unique=[...new Set(candidateIds)];
  const newIds=[];
  for (let i=0;i<unique.length;i+=50) {
    const batch=unique.slice(i,i+50);
    const marks=batch.map(()=>"?").join(",");
    const {results}=await env.DB.prepare(`SELECT video_id FROM videos WHERE video_id IN (${marks})`).bind(...batch).all();
    const known=new Set(results.map(x=>x.video_id));
    for(const id of batch) if(!known.has(id)) newIds.push(id);
  }

  let saved=0;
  for(let i=0;i<newIds.length;i+=50){
    const batch=newIds.slice(i,i+50);
    const data=await yt(env,"videos",{part:"snippet,contentDetails,statistics",id:batch.join(","),maxResults:50}); quota++;
    const statements=[];
    for(const v of data.items||[]){
      const g=gateVideo(v),s=v.snippet||{},st=v.statistics||{};
      statements.push(env.DB.prepare(`INSERT INTO videos (video_id,channel_id,title,description,published_at,duration_seconds,thumbnail_url,view_count,like_count,gate_status,gate_reason,listen_score,time_pool,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,CURRENT_TIMESTAMP) ON CONFLICT(video_id) DO UPDATE SET title=excluded.title,description=excluded.description,duration_seconds=excluded.duration_seconds,thumbnail_url=excluded.thumbnail_url,view_count=excluded.view_count,like_count=excluded.like_count,gate_status=excluded.gate_status,gate_reason=excluded.gate_reason,listen_score=excluded.listen_score,time_pool=excluded.time_pool,updated_at=CURRENT_TIMESTAMP`).bind(v.id,s.channelId,s.title||"",s.description||"",s.publishedAt||new Date(0).toISOString(),g.seconds,s.thumbnails?.medium?.url||s.thumbnails?.default?.url||null,Number(st.viewCount||0),Number(st.likeCount||0),g.status,g.reason,g.score,g.pool)); saved++;
    }
    if(statements.length) await env.DB.batch(statements);
  }
  await env.DB.prepare("UPDATE channels SET last_collected_at=CURRENT_TIMESTAMP WHERE enabled=1").run();
  return {channels:channels.length,candidates:unique.length,new_candidates:newIds.length,saved,quota_units:quota};
}

async function regateStored(env){
  const {results}=await env.DB.prepare("SELECT video_id,title,duration_seconds FROM videos").all();
  const statements=results.map(v=>{const g=classifyGate(v.title,Number(v.duration_seconds));return env.DB.prepare("UPDATE videos SET gate_status=?,gate_reason=?,listen_score=?,time_pool=?,updated_at=CURRENT_TIMESTAMP WHERE video_id=?").bind(g.status,g.reason,g.score,g.pool,v.video_id);});
  for(let i=0;i<statements.length;i+=50) await env.DB.batch(statements.slice(i,i+50));
  return {regated:results.length};
}

async function auditVideos(env){
  const {results:summary}=await env.DB.prepare("SELECT gate_status,COALESCE(time_pool,'-') time_pool,COALESCE(gate_reason,'-') gate_reason,COUNT(*) count FROM videos GROUP BY gate_status,time_pool,gate_reason ORDER BY gate_status,time_pool,gate_reason").all();
  const {results:byChannel}=await env.DB.prepare("SELECT c.channel_name,COUNT(v.video_id) total,SUM(CASE WHEN v.gate_status='pass' THEN 1 ELSE 0 END) passed,SUM(CASE WHEN v.gate_status='review' THEN 1 ELSE 0 END) review,SUM(CASE WHEN v.gate_status='fail' THEN 1 ELSE 0 END) failed,ROUND(AVG(v.duration_seconds)/60.0,1) avg_minutes FROM channels c LEFT JOIN videos v ON v.channel_id=c.channel_id WHERE c.enabled=1 GROUP BY c.channel_id,c.channel_name ORDER BY c.priority").all();
  const {results:videos}=await env.DB.prepare("SELECT v.video_id,c.channel_name,v.title,ROUND(v.duration_seconds/60.0,1) minutes,v.view_count,v.gate_status,v.gate_reason,v.listen_score,v.time_pool,v.published_at FROM videos v JOIN channels c ON c.channel_id=v.channel_id ORDER BY c.priority,v.published_at DESC LIMIT 200").all();
  return {total:videos.length,summary,by_channel:byChannel,videos};
}

export default {
  async fetch(request,env){
    const url=new URL(request.url);
    try {
      if(url.pathname==="/api/health") return json({ok:true,service:"CONTEXT Video",version:"0.4.0",stage:"listening-gate-v2"});
      if(url.pathname==="/api/db-health"){const row=await env.DB.prepare("SELECT 1 AS ok").first();return json({ok:row?.ok===1,database:"context-video-db",result:row});}
      if(url.pathname==="/api/youtube-health"){const d=await yt(env,"channels",{part:"id",id:"UCBR8-60-B28hp2BmDPdntcQ"});return json({ok:true,youtube:true,quota_units_used_by_this_test:1,items_returned:d.items?.length||0,secret_exposed:false});}
      if(url.pathname==="/api/pool/bootstrap"){await seedStarterChannels(env);const {results}=await env.DB.prepare("SELECT channel_id,channel_name,category,priority FROM channels WHERE enabled=1 ORDER BY priority").all();return json({ok:true,seeded:STARTER_CHANNELS.length,channels:results});}
      if(url.pathname==="/api/collect") return json({ok:true,...await collectVideos(env,50)});
      if(url.pathname==="/api/collect/bootstrap"){const row=await env.DB.prepare("SELECT COUNT(*) n FROM videos").first();if(Number(row?.n||0)>0)return json({ok:true,skipped:true,reason:"bootstrap_already_completed",videos_in_db:Number(row.n),quota_units_used:0});return json({ok:true,bootstrap:true,...await collectVideos(env,50)});}
      if(url.pathname==="/api/regate") return json({ok:true,...await regateStored(env),quota_units_used:0});
      if(url.pathname==="/api/audit") return json({ok:true,...await auditVideos(env)});
      if(url.pathname==="/api/videos"){const pool=url.searchParams.get("pool"),params=[];let sql="SELECT video_id,channel_id,title,published_at,duration_seconds,thumbnail_url,view_count,gate_status,gate_reason,listen_score,time_pool FROM videos WHERE gate_status='pass'";if(pool&&["30m","60m","60m_plus"].includes(pool)){sql+=" AND time_pool=?";params.push(pool);}sql+=" ORDER BY listen_score DESC,published_at DESC LIMIT 100";const {results}=await env.DB.prepare(sql).bind(...params).all();return json({ok:true,count:results.length,videos:results});}
      if(url.pathname==="/api/channels"){const {results}=await env.DB.prepare("SELECT channel_id,channel_name,category,priority,last_collected_at FROM channels WHERE enabled=1 ORDER BY priority").all();return json({ok:true,count:results.length,channels:results});}
      return json({service:"CONTEXT Video",version:"0.4.0",message:"Listening gate v2 is ready.",endpoints:["GET /api/collect","GET /api/regate","GET /api/audit","GET /api/videos?pool=30m|60m|60m_plus"]});
    } catch(e){return json({ok:false,reason:String(e?.message||e)},500);}
  },
  async scheduled(controller,env){try{console.log("CONTEXT scheduled collection",{cron:controller.cron,scheduledTime:controller.scheduledTime,...await collectVideos(env,50)});}catch(e){console.error("CONTEXT scheduled collection failed",{cron:controller.cron,reason:String(e?.message||e)});}}
};
