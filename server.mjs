import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { Readable } from 'node:stream';
import { createHash, createHmac, randomUUID, timingSafeEqual } from 'node:crypto';

const port = Number(process.env.PORT || 4173);
const root = join(process.cwd(), 'public');
const types = { '.html':'text/html; charset=utf-8', '.css':'text/css; charset=utf-8', '.js':'text/javascript; charset=utf-8', '.svg':'image/svg+xml', '.png':'image/png', '.webmanifest':'application/manifest+json; charset=utf-8', '.json':'application/json; charset=utf-8' };
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
    if (url.pathname === '/vendor/hls.mjs') {
      const body = await readFile(join(process.cwd(), 'node_modules', 'hls.js', 'dist', 'hls.mjs'));
      res.writeHead(200, { 'content-type':'text/javascript; charset=utf-8', 'cache-control':'public, max-age=31536000, immutable' });
      return res.end(body);
    }
    if (url.pathname === '/admin' || url.pathname === '/admin/') {
      const body = await readFile(join(root, 'admin.html'));
      res.writeHead(200, { 'content-type':'text/html; charset=utf-8', 'cache-control':'no-store' });
      return res.end(body);
    }
    if (url.pathname === '/api/library-config' && req.method === 'GET') {
      return sendJson(res, 200, await loadLibraryConfig());
    }
    if (url.pathname === '/api/admin/login' && req.method === 'POST') {
      const body = await readJsonBody(req);
      if (!passwordMatches(String(body.password || ''))) return sendJson(res, 401, { error:'Incorrect password' });
      return sendJson(res, 200, { token:createAdminToken() });
    }
    if (url.pathname === '/api/admin/config' && req.method === 'GET') {
      if (!adminAuthorized(req)) return sendJson(res, 401, { error:'Please sign in again' });
      return sendJson(res, 200, await loadLibraryConfig());
    }
    if (url.pathname === '/api/admin/config' && req.method === 'PUT') {
      if (!adminAuthorized(req)) return sendJson(res, 401, { error:'Please sign in again' });
      const config = sanitizeLibraryConfig(await readJsonBody(req));
      await saveLibraryConfig(config);
      return sendJson(res, 200, config);
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
        if (location) {
          const protectedStream = new URL(location).hostname === 'api.soundcloud.com';
          if (!protectedStream) {
            res.writeHead(302, { location, 'cache-control':'no-store' });
            return res.end();
          }

          const resolved = await fetch(location, {
            headers:authHeaders(token),
            redirect:'manual',
            signal:AbortSignal.timeout(15000)
          });
          const playableLocation = resolved.headers.get('location');
          if (resolved.status >= 300 && resolved.status < 400 && playableLocation) {
            res.writeHead(302, { location:playableLocation, 'cache-control':'no-store' });
            return res.end();
          }
          return send(res, resolved.status || 502, 'Unable to resolve audio stream');
        }
      }
      return send(res, stream.status || 502, 'Unable to open audio stream');
    }
    if (url.pathname === '/api/soundcloud/progressive') {
      const id = url.searchParams.get('id');
      if (!/^\d+$/.test(id || '')) return send(res, 400, 'Invalid track ID');
      const token = await getSoundcloudToken();
      const stream = await fetch(`https://api.soundcloud.com/tracks/${id}/streams`, { headers:authHeaders(token), signal:AbortSignal.timeout(15000) });
      if (!stream.ok) return send(res, stream.status || 502, 'Unable to open audio stream');
      const data = await stream.json();
      const location = data.http_mp3_128_url || data.preview_mp3_128_url;
      if (!location) return send(res, 409, 'Progressive audio is unavailable');
      if (new URL(location).hostname !== 'api.soundcloud.com') {
        res.writeHead(302, { location, 'cache-control':'no-store' });
        return res.end();
      }
      const resolved = await fetch(location, { headers:authHeaders(token), redirect:'manual', signal:AbortSignal.timeout(15000) });
      const playableLocation = resolved.headers.get('location');
      if (resolved.status >= 300 && resolved.status < 400 && playableLocation) {
        res.writeHead(302, { location:playableLocation, 'cache-control':'no-store' });
        return res.end();
      }
      return send(res, resolved.status || 502, 'Unable to resolve progressive audio');
    }
    if (url.pathname === '/api/soundcloud/download') {
      const id = url.searchParams.get('id');
      if (!/^\d+$/.test(id || '')) return send(res, 400, 'Invalid track ID');
      const token = await getSoundcloudToken();
      const stream = await fetch(`https://api.soundcloud.com/tracks/${id}/streams`, { headers:authHeaders(token), signal:AbortSignal.timeout(15000) });
      if (!stream.ok) return send(res, stream.status, 'Unable to prepare download');
      const data = await stream.json();
      const location = data.http_mp3_128_url;
      if (!location) return send(res, 409, 'This episode is not available for offline download');

      let audioResponse;
      if (new URL(location).hostname === 'api.soundcloud.com') {
        const resolved = await fetch(location, { headers:authHeaders(token), redirect:'manual', signal:AbortSignal.timeout(15000) });
        const playableLocation = resolved.headers.get('location');
        if (resolved.status >= 300 && resolved.status < 400 && playableLocation) {
          audioResponse = await fetch(playableLocation, { signal:AbortSignal.timeout(30000) });
        } else if (resolved.ok) {
          audioResponse = resolved;
        } else {
          return send(res, resolved.status || 502, 'Unable to resolve download');
        }
      } else {
        audioResponse = await fetch(location, { signal:AbortSignal.timeout(30000) });
      }

      if (!audioResponse.ok || !audioResponse.body) return send(res, audioResponse.status || 502, 'Unable to download audio');
      const headers = {
        'content-type':audioResponse.headers.get('content-type') || 'audio/mpeg',
        'cache-control':'private, no-store',
        'content-disposition':`attachment; filename="episode-${id}.mp3"`
      };
      const contentLength = audioResponse.headers.get('content-length');
      if (contentLength) headers['content-length'] = contentLength;
      res.writeHead(200, headers);
      Readable.fromWeb(audioResponse.body).pipe(res);
      return;
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
function sendJson(res, status, value) { res.writeHead(status, { 'content-type':'application/json; charset=utf-8', 'cache-control':'no-store' }); res.end(JSON.stringify(value)); }

const emptyLibraryConfig = () => ({ folders:[], rules:[], overrides:{} });

async function readJsonBody(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 1_000_000) throw new Error('Request is too large');
    chunks.push(chunk);
  }
  if (!chunks.length) return {};
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

function secureTextEqual(left, right) {
  const a = createHash('sha256').update(left).digest();
  const b = createHash('sha256').update(right).digest();
  return timingSafeEqual(a, b);
}

function passwordMatches(password) {
  const expected = process.env.ADMIN_PASSWORD || '';
  return Boolean(expected) && secureTextEqual(password, expected);
}

function adminSecret() {
  return process.env.ADMIN_TOKEN_SECRET || process.env.ADMIN_PASSWORD || '';
}

function createAdminToken() {
  const timestamp = String(Date.now());
  const signature = createHmac('sha256', adminSecret()).update(timestamp).digest('base64url');
  return `${timestamp}.${signature}`;
}

function adminAuthorized(req) {
  const token = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  const [timestamp, signature] = token.split('.');
  if (!timestamp || !signature || !adminSecret() || Date.now() - Number(timestamp) > 7 * 24 * 60 * 60 * 1000) return false;
  const expected = createHmac('sha256', adminSecret()).update(timestamp).digest('base64url');
  return secureTextEqual(signature, expected);
}

function supabaseSettings() {
  return {
    url:String(process.env.SUPABASE_URL || '').replace(/\/$/, ''),
    key:String(process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || '')
  };
}

function supabaseHeaders(key) {
  return key.startsWith('sb_secret_') ? { apikey:key } : { apikey:key, authorization:`Bearer ${key}` };
}

function sanitizeLibraryConfig(value) {
  const folders = Array.isArray(value?.folders) ? value.folders.slice(0, 500).map(folder => ({
    name:String(folder?.name || '').trim().slice(0, 120),
    subfolders:Array.isArray(folder?.subfolders) ? [...new Set(folder.subfolders.map(name => String(name || '').trim().slice(0, 120)).filter(Boolean))].slice(0, 500) : []
  })).filter(folder => folder.name) : [];
  const rules = Array.isArray(value?.rules) ? value.rules.slice(0, 1000).map(rule => ({
    id:String(rule?.id || randomUUID()).slice(0, 100),
    contains:String(rule?.contains || '').trim().slice(0, 250),
    folder:String(rule?.folder || '').trim().slice(0, 120),
    strategy:['none','first_word','word_after','before_word','fixed'].includes(rule?.strategy) ? rule.strategy : 'none',
    marker:String(rule?.marker || '').trim().slice(0, 120),
    subfolder:String(rule?.subfolder || '').trim().slice(0, 120)
  })).filter(rule => rule.contains && rule.folder) : [];
  const overrides = {};
  if (value?.overrides && typeof value.overrides === 'object') {
    Object.entries(value.overrides).slice(0, 10000).forEach(([id, assignment]) => {
      const folder = String(assignment?.folder || '').trim().slice(0, 120);
      if (folder) overrides[String(id).slice(0, 500)] = { folder, subfolder:String(assignment?.subfolder || '').trim().slice(0, 120) };
    });
  }
  return { folders, rules, overrides };
}

async function loadLibraryConfig() {
  const { url, key } = supabaseSettings();
  if (!url || !key) return emptyLibraryConfig();
  const response = await fetch(`${url}/rest/v1/app_config?id=eq.1&select=config`, {
    headers:supabaseHeaders(key),
    signal:AbortSignal.timeout(15000)
  });
  if (!response.ok) throw new Error(`Unable to load library configuration (${response.status})`);
  const rows = await response.json();
  return sanitizeLibraryConfig(rows?.[0]?.config || emptyLibraryConfig());
}

async function saveLibraryConfig(config) {
  const { url, key } = supabaseSettings();
  if (!url || !key) throw new Error('Supabase is not configured');
  const response = await fetch(`${url}/rest/v1/app_config`, {
    method:'POST',
    headers:{ ...supabaseHeaders(key), 'content-type':'application/json', prefer:'resolution=merge-duplicates,return=minimal' },
    body:JSON.stringify({ id:1, config, updated_at:new Date().toISOString() }),
    signal:AbortSignal.timeout(15000)
  });
  if (!response.ok) throw new Error(`Unable to save library configuration (${response.status})`);
}

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
    audioUrl:`/api/soundcloud/progressive?id=${track.id}`,
    fileName:`${track.title || `episode-${track.id}`}.${track.original_format || 'mp3'}`,
    duration:track.duration ? Math.round(track.duration / 1000) : '',
    art:track.artwork_url || track.user?.avatar_url || '',
    feedUrl:'soundcloud-api'
  }));
  catalogCache = { episodes, expiresAt:Date.now() + 10 * 60 * 1000 };
  return episodes;
}
server.listen(port, '0.0.0.0', () => console.log(`Rabbi Joey Soffer Shiurim ready at http://localhost:${port}`));
