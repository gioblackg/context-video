const ROOT_ID = 'context-video-beta-root';
const SHORTS_BUTTON_ID = 'context-video-shorts-next';
let homeQueue = [];
let homeCursor = 0;
let shortsQueue = [];
let shortsCursor = 0;
let lastPath = location.pathname + location.search;
let homeRenderTimer = null;

function message(payload) {
  return new Promise(resolve => chrome.runtime.sendMessage(payload, resolve));
}

async function getState() {
  const data = await chrome.storage.local.get(['shownIds', 'seenIds']);
  return {
    shown: new Set(Array.isArray(data.shownIds) ? data.shownIds : []),
    seen: new Set(Array.isArray(data.seenIds) ? data.seenIds : [])
  };
}

async function addShown(ids) {
  const { shown } = await getState();
  ids.forEach(id => shown.add(id));
  await chrome.storage.local.set({ shownIds: [...shown].slice(-5000) });
}

async function addSeen(id) {
  if (!id) return;
  const { seen } = await getState();
  seen.add(id);
  await chrome.storage.local.set({ seenIds: [...seen].slice(-5000) });
}

async function loadQueue(mode) {
  const res = await message({ type: 'CONTEXT_FETCH_RECOMMENDATIONS', mode, limit: 120 });
  if (!res?.ok) throw new Error(res?.error || '추천 데이터를 불러오지 못했습니다.');
  const { shown, seen } = await getState();
  const videos = Array.isArray(res.data?.videos) ? res.data.videos : [];
  const fresh = videos.filter(v => !shown.has(v.video_id) && !seen.has(v.video_id));
  return { data: res.data, videos: fresh.length ? fresh : videos };
}

function card(video) {
  const a = document.createElement('a');
  a.className = 'context-video-card';
  a.href = video.watch_url || `https://www.youtube.com/watch?v=${video.video_id}`;
  a.dataset.videoId = video.video_id;
  a.innerHTML = `
    <img src="${video.thumbnail_url || `https://i.ytimg.com/vi/${video.video_id}/hqdefault.jpg`}" alt="">
    <div class="context-video-card-body">
      <div class="context-video-title"></div>
      <div class="context-video-meta"></div>
    </div>`;
  a.querySelector('.context-video-title').textContent = video.title || '';
  a.querySelector('.context-video-meta').textContent = `${video.channel_name || ''}${video.category ? ' · ' + video.category : ''}`;
  a.addEventListener('click', () => addSeen(video.video_id));
  return a;
}

async function renderHome(forceReload = false) {
  if (location.pathname !== '/') return;
  let root = document.getElementById(ROOT_ID);
  if (!root) {
    root = document.createElement('section');
    root.id = ROOT_ID;
    root.innerHTML = `
      <div class="context-video-head">
        <div><strong>CONTEXT 추천</strong><span id="context-video-hour"></span></div>
        <button id="context-video-more" type="button">새로 보여줘</button>
      </div>
      <div id="context-video-status"></div>
      <div id="context-video-grid"></div>`;
    const target = document.querySelector('ytd-browse[page-subtype="home"] #contents') || document.querySelector('ytd-browse[page-subtype="home"]') || document.querySelector('ytd-app');
    if (!target) return;
    target.prepend(root);
    root.querySelector('#context-video-more').addEventListener('click', () => showNextHomeBatch());
  }

  const status = root.querySelector('#context-video-status');
  try {
    if (forceReload || !homeQueue.length) {
      status.textContent = '추천을 불러오는 중…';
      const loaded = await loadQueue('home');
      homeQueue = loaded.videos;
      homeCursor = 0;
      root.querySelector('#context-video-hour').textContent = loaded.data?.hour_key ? ` · ${loaded.data.hour_key}` : '';
    }
    await showNextHomeBatch();
    status.textContent = '';
  } catch (e) {
    status.textContent = `CONTEXT 추천을 불러오지 못했습니다: ${e.message}`;
  }
}

async function showNextHomeBatch() {
  const root = document.getElementById(ROOT_ID);
  if (!root || !homeQueue.length) return;
  if (homeCursor >= homeQueue.length) homeCursor = 0;
  const batch = homeQueue.slice(homeCursor, homeCursor + 20);
  homeCursor += batch.length;
  const grid = root.querySelector('#context-video-grid');
  grid.replaceChildren(...batch.map(card));
  await addShown(batch.map(v => v.video_id));
}

async function ensureShortsButton() {
  if (!location.pathname.startsWith('/shorts/')) {
    document.getElementById(SHORTS_BUTTON_ID)?.remove();
    return;
  }
  if (document.getElementById(SHORTS_BUTTON_ID)) return;
  const btn = document.createElement('button');
  btn.id = SHORTS_BUTTON_ID;
  btn.type = 'button';
  btn.textContent = 'CONTEXT 다음 Shorts';
  btn.addEventListener('click', async () => {
    try {
      if (!shortsQueue.length || shortsCursor >= shortsQueue.length) {
        const loaded = await loadQueue('shorts');
        shortsQueue = loaded.videos;
        shortsCursor = 0;
      }
      const next = shortsQueue[shortsCursor++];
      if (!next) return;
      await addShown([next.video_id]);
      await addSeen(next.video_id);
      location.href = `https://www.youtube.com/shorts/${next.video_id}`;
    } catch (e) {
      btn.textContent = '추천 불러오기 실패';
      setTimeout(() => { btn.textContent = 'CONTEXT 다음 Shorts'; }, 1800);
    }
  });
  document.body.appendChild(btn);
}

async function routeChanged() {
  const path = location.pathname + location.search;
  if (path === lastPath && document.getElementById(ROOT_ID)) {
    await ensureShortsButton();
    return;
  }
  lastPath = path;
  if (location.pathname === '/') {
    clearTimeout(homeRenderTimer);
    homeRenderTimer = setTimeout(() => renderHome(false), 350);
  }
  else document.getElementById(ROOT_ID)?.remove();
  await ensureShortsButton();
}

const observer = new MutationObserver(() => routeChanged());
observer.observe(document.documentElement, { childList: true, subtree: true });
window.addEventListener('yt-navigate-finish', routeChanged);
routeChanged();