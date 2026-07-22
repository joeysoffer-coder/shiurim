import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';

const port = Number(process.env.PORT || 4173);
const root = join(process.cwd(), 'public');
const types = { '.html':'text/html; charset=utf-8', '.css':'text/css; charset=utf-8', '.js':'text/javascript; charset=utf-8', '.svg':'image/svg+xml' };
const soundcloudUserId = process.env.SOUNDCLOUD_USER_ID || '1044681742';
let soundcloudToken = null;
let tokenExpiresAt = 0;
let catalogCache = { episodes: null, expiresAt: 0 };

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);
    if (url.pathname === '/vendor/hls.min.js') {
      const body = await readFile(join(process.cwd(), 'node_modules', 'hls.js', 'dist', 'hls.min.js'));
      res.writeHead(200, { 'content-type':'text/javascript; charset=utf-8', 'cache-control':'public, max-age=31536000, immutable' });
      return res.end(body);
    }
    if (url.pathname === '/api/soundcloud/episodes') {
      const episodes = await getSoundcloudEpisodes();
      res.writeHead(200, { 'content-type':'application/json; charset=utf-8', 'cache-control':'no-store' });
      return res.end(JSON.stringify({ source:'soundcloud-api', episodes }));
    }
    if (url.pathname === '/api/soundcloud/stream') {
      const id = url.searchParams.get('id');
      if (!/^\d+$/.test(id || '')) return send(res, 400, 'Invalid track ID');
      const token = await getSoundcloudToken();
      const stream = await fetch(`https://api.soundcloud.com/tracks/${id}/streams`, { headers:authHeaders(token), signal:AbortSignal.timeout(15000) });
      if (stream.ok) {
        const data = await stream.json();
        const location = data.hls_aac_160_url
          || data.hls_aac_96_url
          || data.hls_mp3_128_url
          || data.hls_opus_64_url
          || Object.entries(data).find(([key, value]) => key.startsWith('hls_') && key.endsWith('_url') && typeof value === 'string')?.[1]
          || data.http_mp3_128_url
          || data.preview_mp3_128_url;
        if (location) { res.writeHead(302, { location, 'cache-control':'no-store' }); return res.end(); }
      }
      return send(res, stream.status || 502, 'Unable to open audio stream');
    }
    if (url.pathname === '/api/feed') {
      const target = url.searchParams.get('url');
      if (!target || !/^https?:\/\//i.test(target)) return send(res, 400, 'Invalid feed URL');
      const upstream = await fetch(target, { headers: { 'user-agent': 'Joey-Soffer/1.0 RSS reader' }, signal: AbortSignal.timeout(15000) });
      if (!upstream.ok) return send(res, upstream.status, `Feed returned ${upstream.status}`);
      res.writeHead(200, { 'content-type': 'application/xml; charset=utf-8', 'cache-control': 'no-store' });
      return res.end(await upstream.text());
    }
    const requested = url.pathname === '/' ? 'index.html' : decodeURIComponent(url.pathname.slice(1));
    const file = normalize(join(root, requested));
    if (!file.startsWith(root)) return send(res, 403, 'Forbidden');
    const body = await readFile(file);
    res.writeHead(200, { 'content-type': types[extname(file)] || 'application/octet-stream' });
    res.end(body);
  } catch (error) {
    console.error(error);
    send(res, error?.code === 'ENOENT' ? 404 : 500, error?.code === 'ENOENT' ? 'Not found' : 'Server error');
  }
});

function send(res, status, text) { res.writeHead(status, { 'content-type':'text/plain; charset=utf-8' }); res.end(text); }

function authHeaders(token) { return { accept:'application/json; charset=utf-8', authorization:`OAuth ${token}` }; }

async function getSoundcloudToken() {
  if (soundcloudToken && Date.now() < tokenExpiresAt) return soundcloudToken;
  const clientId = process.env.SOUNDCLOUD_CLIENT_ID;
  const clientSecret = process.env.SOUNDCLOUD_CLIENT_SECRET;
  if (!clientId || !clientSecret) throw new Error('SoundCloud API credentials are not configured');
  const basic = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
  const response = await fetch('https://secure.soundcloud.com/oauth/token', {
    method:'POST', headers:{ accept:'application/json; charset=utf-8', 'content-type':'application/x-www-form-urlencoded', authorization:`Basic ${basic}` },
    body:'grant_type=client_credentials', signal:AbortSignal.timeout(15000)
  });
  if (!response.ok) throw new Error(`SoundCloud authorization failed (${response.status})`);
  const data = await response.json();
  soundcloudToken = data.access_token;
  tokenExpiresAt = Date.now() + Math.max(60, Number(data.expires_in || 3600) - 120) * 1000;
  return soundcloudToken;
}

async function getSoundcloudEpisodes() {
  if (catalogCache.episodes && Date.now() < catalogCache.expiresAt) return catalogCache.episodes;
  const token = await getSoundcloudToken();
  let next = `https://api.soundcloud.com/users/${soundcloudUserId}/tracks?limit=200&linked_partitioning=true`;
  const tracks = [];
  for (let page = 0; next && page < 100; page += 1) {
    const response = await fetch(next, { headers:authHeaders(token), signal:AbortSignal.timeout(20000) });
    if (!response.ok) throw new Error(`SoundCloud catalog request failed (${response.status})`);
    const data = await response.json();
    const collection = Array.isArray(data) ? data : data.collection || [];
    tracks.push(...collection);
    next = Array.isArray(data) ? null : data.next_href;
  }
  const episodes = tracks.map(track => ({
    id:`tag:soundcloud,2010:tracks/${track.id}`,
    title:track.title || 'Untitled episode',
    show:'Rabbi Joey Soffer Shiurim',
    date:track.created_at,
    audioUrl:`/api/soundcloud/stream?id=${track.id}`,
    fileName:`${track.title || `episode-${track.id}`}.${track.original_format || 'mp3'}`,
    duration:track.duration ? Math.round(track.duration / 1000) : '',
    art:track.artwork_url || track.user?.avatar_url || '',
    feedUrl:'soundcloud-api'
  }));
  catalogCache = { episodes, expiresAt:Date.now() + 10 * 60 * 1000 };
  return episodes;
}
server.listen(port, '0.0.0.0', () => console.log(`Rabbi Joey Soffer Shiurim ready at http://localhost:${port}`));
