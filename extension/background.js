const DEFAULT_API_BASE = 'https://context-video.gioblackg.workers.dev';

async function getApiBase() {
  const { apiBase } = await chrome.storage.local.get('apiBase');
  return (apiBase || DEFAULT_API_BASE).replace(/\/$/, '');
}

async function fetchRecommendations(mode = 'home', limit = 60) {
  const apiBase = await getApiBase();
  const url = `${apiBase}/api/recommendations/current?mode=${encodeURIComponent(mode)}&limit=${encodeURIComponent(limit)}`;
  const res = await fetch(url, { cache: 'no-store' });
  if (!res.ok) throw new Error(`CONTEXT API ${res.status}`);
  return res.json();
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type !== 'CONTEXT_FETCH_RECOMMENDATIONS') return;
  fetchRecommendations(message.mode, message.limit)
    .then(data => sendResponse({ ok: true, data }))
    .catch(error => sendResponse({ ok: false, error: String(error?.message || error) }));
  return true;
});