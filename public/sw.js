const CACHE='rabbi-joey-soffer-shiurim-v25';
const AUDIO_CACHE='js-torah-downloads-v1';
const SHELL=['/','/index.html','/styles.css?v=25','/app.js?v=25','/vendor/hls.mjs?v=1.6.16','/manifest.webmanifest','/icon.svg'];
self.addEventListener('install',event=>event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll(SHELL)).then(()=>self.skipWaiting())));
self.addEventListener('activate',event=>event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(key=>key.startsWith('rabbi-joey-soffer-shiurim-')&&key!==CACHE).map(key=>caches.delete(key)))).then(()=>self.clients.claim())));
self.addEventListener('fetch',event=>{
  const pathname=new URL(event.request.url).pathname;
  if(pathname.startsWith('/offline/audio/')){event.respondWith(caches.open(AUDIO_CACHE).then(cache=>cache.match(event.request)).then(hit=>hit||new Response('Episode is not downloaded',{status:404})));return}
  if(event.request.method!=='GET'||pathname.startsWith('/api/'))return;
  event.respondWith(fetch(event.request).then(response=>{const copy=response.clone();caches.open(CACHE).then(cache=>cache.put(event.request,copy));return response}).catch(()=>caches.match(event.request).then(hit=>hit||caches.match('/index.html'))));
});
