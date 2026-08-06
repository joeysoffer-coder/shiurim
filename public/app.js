import Hls from '/vendor/hls.mjs?v=1.6.16';
window.Hls = Hls;
document.documentElement.dataset.hls = Hls?.isSupported?.() ? 'supported' : 'native';

const DEFAULT_FEED='https://feeds.soundcloud.com/users/soundcloud:users:1044681742/sounds.rss';
const $=s=>document.querySelector(s); const collator=new Intl.Collator(undefined,{numeric:true,sensitivity:'base'});
const state={feeds:JSON.parse(localStorage.getItem('wavecast.feeds')||JSON.stringify([DEFAULT_FEED])),episodes:JSON.parse(localStorage.getItem('wavecast.episodes')||'[]'),positions:JSON.parse(localStorage.getItem('wavecast.positions')||'{}'),downloaded:new Set(JSON.parse(localStorage.getItem('wavecast.downloaded')||'[]')),current:null};
let filingRuleConfig={disabledBuiltInRules:[],builtInRuleEdits:{}};
const APP_THEMES={
  classic:{ink:'#17140f',paper:'#f5f0e5',muted:'#777064',line:'#d8d0c1',accent:'#d85a32',card:'#ebe4d7'},
  'navy-gold':{ink:'#14213d',paper:'#f7f1e3',muted:'#657080',line:'#c9c2b5',accent:'#c6922d',card:'#e8dfcf'},
  forest:{ink:'#15382c',paper:'#f3f0e5',muted:'#68756d',line:'#cdd5cc',accent:'#2f7d57',card:'#e2e9df'},
  burgundy:{ink:'#3b1720',paper:'#fbf3ed',muted:'#80666d',line:'#ddc9c5',accent:'#a43f52',card:'#f0dfdc'},
  blue:{ink:'#12324a',paper:'#f2f7fa',muted:'#647784',line:'#c9d9e3',accent:'#2477a8',card:'#deebf2'},
  purple:{ink:'#2d1b4e',paper:'#f7f3fb',muted:'#746781',line:'#d8cde3',accent:'#7c4bb3',card:'#ebe1f3'},
  teal:{ink:'#103f42',paper:'#eef8f6',muted:'#617b7b',line:'#c4deda',accent:'#168b82',card:'#dcefeb'},
  rose:{ink:'#4a2331',paper:'#fff5f6',muted:'#816874',line:'#e4ccd2',accent:'#c55372',card:'#f3e2e6'},
  slate:{ink:'#202a35',paper:'#f3f5f7',muted:'#69737e',line:'#cbd2d8',accent:'#4c6f91',card:'#e1e7ec'},
  sunset:{ink:'#4a2819',paper:'#fff4e7',muted:'#856d5e',line:'#e7cfba',accent:'#df7837',card:'#f4dfca'}
};
function applyAppTheme(themeId='classic'){
  const id=APP_THEMES[themeId]?themeId:'classic',theme=APP_THEMES[id],root=document.documentElement;
  Object.entries(theme).forEach(([name,value])=>root.style.setProperty(`--${name}`,value));
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content',theme.ink);
  const icon=`/icon-theme-${id}-512.png?v=97`;
  document.querySelector('.brand-mark')?.setAttribute('src',icon);
  document.querySelector('link[rel="apple-touch-icon"]')?.setAttribute('href',icon);
  document.querySelector('link[rel="manifest"]')?.setAttribute('href',`/manifest.webmanifest?theme=${encodeURIComponent(id)}&v=97`);
  localStorage.setItem('rjs.appTheme',id);
}
applyAppTheme(localStorage.getItem('rjs.appTheme')||'classic');
const audio=$('#audio'), list=$('#episodeList'); let activeFolder=null,hlsPlayer=null; $('#feedInput').value=DEFAULT_FEED;
const ANALYTICS_QUEUE_KEY='rjs.analyticsQueue',ANALYTICS_DEVICE_KEY='rjs.analyticsDevice';
const analyticsDeviceId=localStorage.getItem(ANALYTICS_DEVICE_KEY)||`${Date.now().toString(36)}-${crypto.randomUUID?.()||Math.random().toString(36).slice(2)}`;
localStorage.setItem(ANALYTICS_DEVICE_KEY,analyticsDeviceId);
const analyticsSessionId=`${Date.now().toString(36)}-${crypto.randomUUID?.()||Math.random().toString(36).slice(2)}`;
const analyticsPlatform=/iphone|ipad|ipod/i.test(navigator.userAgent)||(navigator.platform==='MacIntel'&&navigator.maxTouchPoints>1)?'ios':/android/i.test(navigator.userAgent)?'android':/windows|macintosh|linux/i.test(navigator.userAgent)?'desktop':'other';
const analyticsAppMode=window.matchMedia('(display-mode: standalone)').matches||navigator.standalone===true?'installed':'browser';
let analyticsQueue=JSON.parse(localStorage.getItem(ANALYTICS_QUEUE_KEY)||'[]'),analyticsSending=false,analyticsSearchTimer=null;
function saveAnalyticsQueue(){analyticsQueue=analyticsQueue.slice(-100);localStorage.setItem(ANALYTICS_QUEUE_KEY,JSON.stringify(analyticsQueue))}
async function flushAnalytics(){
  if(analyticsSending||!navigator.onLine||!analyticsQueue.length)return;
  analyticsSending=true;const events=analyticsQueue.slice(0,25);
  try{const response=await fetch('/api/analytics/events',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({events}),keepalive:true});if(response.ok){analyticsQueue.splice(0,events.length);saveAnalyticsQueue();if(analyticsQueue.length)setTimeout(flushAnalytics,100)}}catch{}
  finally{analyticsSending=false}
}
function trackAnalytics(eventType,data={}){
  analyticsQueue.push({eventType,deviceId:analyticsDeviceId,sessionId:analyticsSessionId,platform:analyticsPlatform,appMode:analyticsAppMode,...data});
  saveAnalyticsQueue();flushAnalytics();
}
function analyticsEpisode(episode){return episode?{episodeId:String(episode.id),episodeTitle:episode.title}:{}}
window.addEventListener('online',flushAnalytics);
window.addEventListener('pagehide',flushAnalytics);
trackAnalytics('app_open');
const save=()=>{localStorage.setItem('wavecast.feeds',JSON.stringify(state.feeds));localStorage.setItem('wavecast.episodes',JSON.stringify(state.episodes));localStorage.setItem('wavecast.positions',JSON.stringify(state.positions));localStorage.setItem('wavecast.downloaded',JSON.stringify([...state.downloaded]));};
const text=(node,name)=>node.querySelector(name)?.textContent?.trim()||'';
const filename=url=>{try{return decodeURIComponent(new URL(url).pathname.split('/').pop()||'audio')}catch{return url}};
const filenameSortKey=name=>name.replace(/^\d+-joey-soffer-\d+-/i,'').replace(/^\d+[-_ ]+/,'');
const DOWNLOAD_CACHE='js-torah-downloads-v1';
const offlineUrl=id=>`/offline/audio/${encodeURIComponent(id)}`;
const trackIdFor=e=>String(e.id||'').match(/tracks\/(\d+)/)?.[1]||String(e.audioUrl||'').match(/[?&]id=(\d+)/)?.[1]||'';
async function toggleDownload(id,button){const episode=state.episodes.find(e=>e.id===id);if(!episode||!('caches'in window)){setStatus('Offline downloads are not supported on this device.');return}button.disabled=true;try{const cache=await caches.open(DOWNLOAD_CACHE),key=offlineUrl(id);if(state.downloaded.has(id)){await cache.delete(key);state.downloaded.delete(id);trackAnalytics('download_remove',analyticsEpisode(episode));setStatus('Download removed from this device.')}else{const trackId=trackIdFor(episode);if(!trackId)throw new Error('This episode cannot be downloaded');setStatus(`Downloading ${episode.title}…`);const response=await fetch(`/api/soundcloud/download?id=${trackId}`);if(!response.ok)throw new Error(await response.text());await cache.put(key,response);state.downloaded.add(id);trackAnalytics('download',analyticsEpisode(episode));setStatus('Episode downloaded for offline listening.')}save();render()}catch(error){setStatus(`Download failed: ${error.message}`)}finally{button.disabled=false}}
function parseFeed(xml,feedUrl){const doc=new DOMParser().parseFromString(xml,'application/xml');if(doc.querySelector('parsererror'))throw new Error('That feed could not be read.');const channel=doc.querySelector('channel');const show=text(channel,'title');const showArt=channel.querySelector('image url')?.textContent||channel.querySelector('itunes\\:image')?.getAttribute('href')||'';return [...doc.querySelectorAll('item')].map((item,i)=>{const enc=item.querySelector('enclosure');const url=enc?.getAttribute('url')||'';const guid=text(item,'guid')||url||`${feedUrl}-${i}`;return{id:guid,title:text(item,'title')||'Untitled episode',show,date:text(item,'pubDate'),audioUrl:url,fileName:filename(url),duration:text(item,'itunes\\:duration'),art:item.querySelector('itunes\\:image')?.getAttribute('href')||showArt,feedUrl};}).filter(e=>e.audioUrl)}
async function refresh(force=false){
  setStatus('Refreshing complete SoundCloud catalog…');$('#refreshBtn').disabled=true;
  try{
    let apiEpisodes=[],rssEpisodes=[],apiWorked=false;
    try{
      const api=await fetch(`/api/soundcloud/episodes${force?'?refresh=1':''}`,{cache:'no-store'});
      if(!api.ok)throw new Error(await api.text());
      const payload=await api.json(),catalog=Array.isArray(payload)?payload:payload.episodes;
      if(!Array.isArray(catalog))throw new Error('SoundCloud returned an invalid catalog');
      apiEpisodes=catalog;apiWorked=true;
    }catch(apiError){}
    try{
      const batches=await Promise.all(state.feeds.map(async feed=>{const r=await fetch(`/api/feed?url=${encodeURIComponent(feed)}`);if(!r.ok)throw new Error(await r.text());return parseFeed(await r.text(),feed)}));
      rssEpisodes=batches.flat();
    }catch(rssError){if(!apiWorked)throw rssError}
    const previous=new Map(state.episodes.map(episode=>[String(episode.id),episode]));
    let removedCount=0;
    if(apiWorked){
      const soundCloudEpisode=episode=>episode.feedUrl==='soundcloud-api'||episode.feedUrl===DEFAULT_FEED||String(episode.id||'').startsWith('tag:soundcloud,');
      const currentSoundCloudIds=new Set(apiEpisodes.map(episode=>String(episode.id)));
      removedCount=state.episodes.filter(episode=>soundCloudEpisode(episode)&&!currentSoundCloudIds.has(String(episode.id))).length;
      const otherExisting=state.episodes.filter(episode=>!soundCloudEpisode(episode));
      const otherIncoming=rssEpisodes.filter(episode=>episode.feedUrl!==DEFAULT_FEED);
      const authoritative=[...apiEpisodes,...otherExisting,...otherIncoming],map=new Map();
      authoritative.forEach(episode=>map.set(String(episode.id),{...previous.get(String(episode.id)),...episode}));
      state.episodes=[...map.values()];
      if(state.current&&!map.has(String(state.current.id))){
        audio.pause();audio.removeAttribute('src');audio.load();state.current=null;localStorage.removeItem('wavecast.last');
        $('#playerTitle').textContent='Choose an episode';$('#playerShow').textContent='Rabbi Joey Soffer Shiurim';$('#playerArt').textContent='RJS';
        updatePlayerActions();
      }
    }else{
      rssEpisodes.forEach(episode=>previous.set(String(episode.id),{...previous.get(String(episode.id)),...episode}));
      state.episodes=[...previous.values()];
    }
    save();render();
    setStatus(`${apiWorked?'Complete SoundCloud catalog':'RSS fallback (SoundCloud API unavailable)'} · ${state.episodes.length} episodes${removedCount?` · removed ${removedCount} deleted`:''} · v9`);
  }catch(e){setStatus(`Couldn’t refresh: ${e.message} · v9`);render()}
  finally{$('#refreshBtn').disabled=false}
}
const FOLDER_RULES=[
  [/daf/i,'Daf Yomi'],
  [/rashi/i,'Humash Rashi'],
  [/\bhok\s+l\s*['’]?\s*yisrael\b/i,"Hok L'Yisrael"],
  [/inheritance/i,'Inheritance'],
  [/neighbors/i,'Neighbors'],
  [/brokerage/i,'Brokerage'],
  [/shaare[\s-]*(?:teshuva|teshuba)/i,'Shaare Teshuva'],
  [/business[\s-]*halach(?:a)?/i,'Business Halacha'],
  [/(?:pirkei|prikei)[\s-]*avot/i,'Pirkei Avot'],
  [/mishlei/i,'Mishlei'],
  [/ignite/i,'Ignite Your Prayers'],
  [/(?:tzedaka|tezdaka)/i,'Tzedaka'],
  [/haggadah|haggada/i,'Haggadah Shel Pesah'],
  [/esther/i,'Megilat Esther'],
  [/batra/i,'Bava Batra'],
  [/kama/i,'Bava Kama'],
  [/interest/i,'Interest'],
  [/debt/i,'Collecting Debt'],
  [/loan/i,'Loans'],
  [/law\s+of\s+(?:the\s+)?land/i,"Dina D'Malchuta"],
  [/theft\s+from/i,'Gezel Akum']
];
function capitalizeFolderLabel(name=''){return name.trim().replace(/^\p{Ll}/u,letter=>letter.toLocaleUpperCase())}
const builtInRuleId=folder=>String(folder).normalize('NFD').replace(/\p{Diacritic}/gu,'').toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu,'-').replace(/^-|-$/g,'');
function folderInfo(title=''){const normalized=title.trim().replace(/\s+/g,' '),disabled=new Set(filingRuleConfig.disabledBuiltInRules||[]);const rule=FOLDER_RULES.find(([pattern,folder])=>{const id=builtInRuleId(folder);if(disabled.has(id))return false;const edit=filingRuleConfig.builtInRuleEdits?.[id];return edit?.contains?normalized.toLocaleLowerCase().includes(edit.contains.toLocaleLowerCase()):pattern.test(normalized)});if(rule){const edit=filingRuleConfig.builtInRuleEdits?.[builtInRuleId(rule[1])];return{name:capitalizeFolderLabel(edit?.folder||rule[1]),forced:true}}const words=normalized.split(' ').filter(Boolean),folderWords=[];let countedWords=0;for(const word of words){folderWords.push(word);if(word.toLocaleLowerCase()!=='and')countedWords+=1;if(countedWords===2)break}return{name:capitalizeFolderLabel(folderWords.join(' ')||'Other'),forced:false}}
const folderInfoUncached=folderInfo,folderInfoCache=new Map();
folderInfo=function(title=''){const key=String(title);if(folderInfoCache.has(key))return folderInfoCache.get(key);const value=folderInfoUncached(key);folderInfoCache.set(key,value);return value};
function folderName(title=''){return folderInfo(title).name}
function libraryGroups(){const candidates=new Map();state.episodes.forEach(e=>{const info=folderInfo(e.title),key=info.name.toLocaleLowerCase();if(!candidates.has(key))candidates.set(key,{name:info.name,forced:info.forced,episodes:[]});const group=candidates.get(key);group.forced=group.forced||info.forced;group.episodes.push(e)});const folders=[...candidates.values()].filter(f=>f.forced||f.episodes.length>1).sort((a,b)=>collator.compare(a.name,b.name));const groupedIds=new Set(folders.flatMap(f=>f.episodes.map(e=>e.id)));return{folders,unique:state.episodes.filter(e=>!groupedIds.has(e.id))}}
function sortEpisodes(eps){const [field,dir]=$('#sortSelect').value.split('-');return [...eps].sort((a,b)=>{let n;if(field==='date')n=new Date(a.date)-new Date(b.date);else if(field==='file')n=collator.compare(filenameSortKey(a.fileName),filenameSortKey(b.fileName));else n=collator.compare(a.title,b.title);return dir==='desc'?-n:n})}
let savedFolderOrders={};
const folderOrderKey=path=>JSON.stringify(path||[]);
const newestEpisodeTime=episodes=>Math.max(0,...episodes.map(episode=>new Date(episode.date).getTime()).filter(Number.isFinite));
function applyFolderOrder(items,parentPath,nameOf,episodesOf){
  const forced=savedFolderOrders[folderOrderKey(parentPath)]||[],positions=new Map(forced.map((name,index)=>[searchText(name),index]));
  return [...items].sort((a,b)=>{const ai=positions.get(searchText(nameOf(a))),bi=positions.get(searchText(nameOf(b))),af=ai!==undefined,bf=bi!==undefined;if(af||bf){if(af!==bf)return af?-1:1;if(ai!==bi)return ai-bi}return newestEpisodeTime(episodesOf(b))-newestEpisodeTime(episodesOf(a))||collator.compare(nameOf(a),nameOf(b))});
}
function sortFolders(folders,parentPath=[]){return applyFolderOrder(folders,parentPath,folder=>folder.name,folder=>folder.episodes||[])}
function sortFolderEntries(entries,parentPath=[]){return applyFolderOrder(entries,parentPath,entry=>entry[0],entry=>entry[1]||[])}
function searchText(value=''){return String(value).normalize('NFD').replace(/\p{Diacritic}/gu,'').toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu,' ').trim()}
function editDistance(a,b){if(a===b)return 0;if(!a.length)return b.length;if(!b.length)return a.length;let previous=Array.from({length:b.length+1},(_,i)=>i);for(let i=1;i<=a.length;i++){const current=[i];for(let j=1;j<=b.length;j++)current[j]=Math.min(current[j-1]+1,previous[j]+1,previous[j-1]+(a[i-1]===b[j-1]?0:1));previous=current}return previous[b.length]}
function fuzzyWordMatch(queryWord,textWord){if(queryWord===textWord)return 20;if(queryWord.length>=3&&textWord.startsWith(queryWord))return 16;if(textWord.length>=3&&queryWord.startsWith(textWord))return 16;const allowance=queryWord.length<=3?0:queryWord.length<=4?1:queryWord.length<=7?2:3,distance=editDistance(queryWord,textWord);return distance<=allowance?12-distance:0}
function episodeSearchScore(episode,query){const wanted=searchText(query),haystack=searchText(`${episode.title} ${episode.show} ${episode.fileName}`);if(!wanted)return 1;const exactIndex=haystack.indexOf(wanted);if(exactIndex>=0)return 1000-exactIndex;const queryWords=wanted.split(' ').filter(Boolean),textWords=haystack.split(' ').filter(Boolean);let score=0;for(const queryWord of queryWords){let best=0;for(const textWord of textWords)best=Math.max(best,fuzzyWordMatch(queryWord,textWord));if(!best)return 0;score+=best}return score}
function searchEpisodes(episodes,query){const normallySorted=sortEpisodes(episodes),order=new Map(normallySorted.map((episode,index)=>[episode.id,index]));return episodes.map(episode=>({episode,score:episodeSearchScore(episode,query)})).filter(item=>item.score>0).sort((a,b)=>(b.score-a.score)||((order.get(a.episode.id)||0)-(order.get(b.episode.id)||0))).map(item=>item.episode)}
function configuredFolderPaths(nodes=managedConfig.folders||[],prefix=[]){return nodes.flatMap(node=>{const path=[...prefix,node.name];return[path,...configuredFolderPaths(node.children||[],path)]})}
function searchableFolderPaths(){
  const paths=[...libraryGroups().folders.map(folder=>[folder.name]),...configuredFolderPaths().map(transformManagedPath).filter(path=>!managedPathHidden(path))];
  const hiddenRoots=new Set(managedConfig.hiddenFolders||[]);
  state.episodes.forEach(episode=>{
    const assignment=managedAssignment(episode),path=assignment?.path?.length?transformManagedPath(assignment.path):transformManagedPath(originalManagedPath(episode));
    if(!path.length||hiddenRoots.has(path[0])||hiddenRoots.has(folderInfo(episode.title).name)||managedPathHidden(path))return;
    for(let length=1;length<=path.length;length++)paths.push(path.slice(0,length));
  });
  const unique=new Map(paths.filter(path=>path.length).map(path=>[path.join('\u0000').toLocaleLowerCase(),path]));
  return [...unique.values()];
}
function searchFolders(query){return searchableFolderPaths().map(path=>({path,score:episodeSearchScore({title:path.join(' '),show:'',fileName:''},query)})).filter(item=>item.score>0).sort((a,b)=>b.score-a.score||collator.compare(a.path.join(' '),b.path.join(' '))).map(item=>item.path)}
function episodeHTML(e,i){const p=state.positions[e.id]||{},pct=p.duration?Math.min(100,p.time/p.duration*100):0,played=pct>95,downloaded=state.downloaded.has(e.id),durationLabel=typeof e.duration==='number'?clock(e.duration):e.duration;return `<article class="episode" data-id="${esc(e.id)}"><span class="episode-number">${String(i+1).padStart(2,'0')}</span>${e.art?`<img class="art" src="${esc(e.art)}" alt="">`:'<div class="art"></div>'}<div><h3>${esc(e.title)}</h3><div class="meta">${esc(e.show)} · ${formatDate(e.date)}${durationLabel?' · '+esc(durationLabel):''}</div><div class="filename" title="${esc(e.fileName)}">${esc(e.fileName)}</div></div><div class="episode-state"><span class="availability ${downloaded?'is-downloaded':''}">${downloaded?'DOWNLOADED':'ONLINE'}</span><span class="played">${played?'PLAYED':pct?'<i class="dot"></i>IN PROGRESS':'UNPLAYED'}</span><div class="progress-track"><div class="progress-fill" style="width:${pct}%"></div></div><button class="download-btn" type="button" data-download="${esc(e.id)}">${downloaded?'Remove download':'Download'}</button></div></article>`}
function render(){const q=$('#searchInput').value.trim().toLocaleLowerCase(),groups=libraryGroups();if(q){const results=sortEpisodes(state.episodes.filter(e=>`${e.title} ${e.show} ${e.fileName}`.toLocaleLowerCase().includes(q)));$('#libraryTitle').textContent='Search results';$('#episodeCount').textContent=`${results.length} episode${results.length===1?'':'s'} across entire catalog`;list.innerHTML=results.length?results.map(episodeHTML).join(''):'<div class="empty">No episodes match your search.</div>';return}if(activeFolder){const folder=groups.folders.find(f=>f.name===activeFolder);if(!folder){activeFolder=null;return render()}const eps=sortEpisodes(folder.episodes);$('#libraryTitle').textContent=folder.name;$('#episodeCount').textContent=`${eps.length} episode${eps.length===1?'':'s'}`;list.innerHTML=`<button class="back-library" type="button" data-back>← All folders</button>${eps.length?eps.map(episodeHTML).join(''):'<div class="empty">This folder is empty.</div>'}`;return}$('#libraryTitle').textContent='Shiurim library';const folders=sortFolders(groups.folders),unique=sortEpisodes(groups.unique);$('#episodeCount').textContent=`${folders.length} folder${folders.length===1?'':'s'} · ${unique.length} individual · ${state.episodes.length} total episodes`;const folderHTML=folders.length?`<div class="folder-grid">${folders.map(f=>{const newest=[...f.episodes].sort((a,b)=>new Date(b.date)-new Date(a.date))[0];return `<button class="folder-card" type="button" data-folder="${esc(f.name)}"><span class="folder-icon">▰</span><strong>${esc(f.name)}</strong><span>${f.episodes.length} episodes</span>${newest?`<small>Latest: ${formatDate(newest.date)}</small>`:'<small>Empty folder</small>'}</button>`}).join('')}</div>`:'';const uniqueHTML=unique.length?`<h3 class="section-label">Individual episodes</h3>${unique.map(episodeHTML).join('')}`:'';list.innerHTML=folderHTML+uniqueHTML||'<div class="empty">No episodes are available.</div>'}
function playEpisode(id,autoplay=true){const e=state.episodes.find(x=>x.id===id);if(!e)return;if(state.current?.id===id){if(autoplay)audio.play().catch(()=>setStatus('Press play to start listening.'));return}state.current=e;if(hlsPlayer){hlsPlayer.destroy();hlsPlayer=null}audio.removeAttribute('src');audio.load();$('#playerTitle').textContent=e.title;$('#playerShow').textContent=e.show;$('#playerArt').innerHTML=e.art?`<img src="${esc(e.art)}" alt="">`:'JS';$('#playerArt').querySelector('img')?.setAttribute('style','width:100%;height:100%;object-fit:cover');localStorage.setItem('wavecast.last',id);const resume=()=>{const saved=state.positions[id]?.time||0;if(saved&&isFinite(audio.duration))audio.currentTime=saved>=audio.duration*.95?0:Math.min(saved,Math.max(0,audio.duration-2));if(autoplay)audio.play().catch(()=>setStatus('Press play to start listening.'))};const playUrl=state.downloaded.has(id)?offlineUrl(id):e.audioUrl,isApiStream=playUrl.startsWith('/api/soundcloud/stream');if(isApiStream&&window.Hls?.isSupported()){hlsPlayer=new window.Hls({enableWorker:true});hlsPlayer.attachMedia(audio);hlsPlayer.on(window.Hls.Events.MEDIA_ATTACHED,()=>hlsPlayer.loadSource(playUrl));hlsPlayer.on(window.Hls.Events.MANIFEST_PARSED,resume);hlsPlayer.on(window.Hls.Events.ERROR,(_,data)=>{if(!data.fatal)return;if(data.type===window.Hls.ErrorTypes.NETWORK_ERROR)hlsPlayer.startLoad();else if(data.type===window.Hls.ErrorTypes.MEDIA_ERROR)hlsPlayer.recoverMediaError();else{hlsPlayer.destroy();hlsPlayer=null;setStatus('This older episode could not be played.')}})}else{audio.src=playUrl;audio.addEventListener('loadedmetadata',resume,{once:true})}}
function setStatus(s){$('#status').textContent=s.replace(/v\d+/g,'v99')} function esc(s=''){return String(s).replace(/[&<>\"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]))} function formatDate(d){const x=new Date(d);return isNaN(x)?'Unknown date':x.toLocaleDateString(undefined,{month:'short',day:'numeric',year:'numeric'})} function clock(s){if(!isFinite(s))return'0:00';return`${Math.floor(s/60)}:${String(Math.floor(s%60)).padStart(2,'0')}`}
history.replaceState({view:'home'},'');
list.addEventListener('click',event=>{const download=event.target.closest('[data-download]'),folder=event.target.closest('[data-folder]'),back=event.target.closest('[data-back]');if(download){event.preventDefault();event.stopImmediatePropagation();toggleDownload(download.dataset.download,download);return}if(folder){history.pushState({view:'folder',folder:folder.dataset.folder},'');return}if(back){event.preventDefault();event.stopImmediatePropagation();history.back()}},true);
$('#searchInput').addEventListener('input',event=>{const query=event.target.value;if(query){if(history.state?.view!=='search')history.pushState({view:'search',query},'');else history.replaceState({...history.state,query},'')}else if(history.state?.view==='search')history.back()});
window.addEventListener('popstate',event=>{activeFolder=event.state?.view==='folder'?event.state.folder:null;$('#searchInput').value=event.state?.view==='search'?event.state.query||'':'';render()});
list.addEventListener('click',e=>{const folder=e.target.closest('[data-folder]'),back=e.target.closest('[data-back]'),row=e.target.closest('.episode');if(folder){activeFolder=folder.dataset.folder;$('#searchInput').value='';render()}else if(back){activeFolder=null;$('#searchInput').value='';render()}else if(row)playEpisode(row.dataset.id)});$('#searchInput').addEventListener('input',render);$('#sortSelect').addEventListener('input',render);$('#sortSelect').addEventListener('change',render);$('#refreshBtn').addEventListener('click',()=>refresh(true));$('#addFeedBtn').addEventListener('click',()=>{const url=$('#feedInput').value.trim();try{new URL(url);if(!state.feeds.includes(url))state.feeds.push(url);save();refresh()}catch{setStatus('Enter a valid RSS feed URL.')}});$('#playBtn').onclick=()=>state.current?(audio.paused?audio.play():audio.pause()):state.episodes[0]&&playEpisode(state.episodes[0].id);$('#backBtn').onclick=()=>audio.currentTime=Math.max(0,audio.currentTime-15);$('#forwardBtn').onclick=()=>audio.currentTime=Math.min(audio.duration||Infinity,audio.currentTime+30);$('#speedSelect').onchange=e=>audio.playbackRate=Number(e.target.value);const seekControl=$('#seek');let seekDragging=false,seekWasPlaying=false;seekControl.onpointerdown=()=>{seekDragging=true;seekWasPlaying=!audio.paused};seekControl.onkeydown=()=>{if(!seekDragging)seekWasPlaying=!audio.paused;seekDragging=true};seekControl.oninput=e=>{if(audio.duration)$('#currentTime').textContent=clock(audio.duration*Number(e.target.value)/100)};seekControl.onchange=e=>{if(!audio.duration){seekDragging=false;return}const target=audio.duration*Number(e.target.value)/100;audio.currentTime=target;seekDragging=false;$('#currentTime').textContent=clock(target);if(seekWasPlaying)audio.play().catch(()=>{});persistCurrentProgress()};seekControl.onpointercancel=()=>{seekDragging=false};audio.addEventListener('play',()=>{$('#playBtn').textContent='Ⅱ';$('#playBtn').ariaLabel='Pause';setStatus('Playing · v9')});audio.addEventListener('pause',()=>{$('#playBtn').textContent='▶';$('#playBtn').ariaLabel='Play'});audio.addEventListener('error',()=>setStatus('This episode could not be played. Refresh the catalog and try again. · v9'));audio.addEventListener('timeupdate',()=>{if(!state.current)return;if(!seekDragging){$('#currentTime').textContent=clock(audio.currentTime);$('#duration').textContent=clock(audio.duration);seekControl.value=audio.duration?audio.currentTime/audio.duration*100:0}state.positions[state.current.id]={time:audio.currentTime,duration:audio.duration||state.positions[state.current.id]?.duration||0}});window.addEventListener('beforeunload',save);document.addEventListener('keydown',e=>{if(['INPUT','SELECT','TEXTAREA'].includes(e.target.tagName))return;if(e.code==='Space'){e.preventDefault();$('#playBtn').click()}else if(e.code==='ArrowLeft'){e.preventDefault();audio.currentTime=Math.max(0,audio.currentTime-15)}else if(e.code==='ArrowRight'){e.preventDefault();audio.currentTime=Math.min(audio.duration||Infinity,audio.currentTime+30)}});
let installPrompt;
window.addEventListener('beforeinstallprompt',event=>{event.preventDefault();installPrompt=event;$('#installBtn').hidden=false});
$('#installBtn').addEventListener('click',async()=>{if(installPrompt){installPrompt.prompt();await installPrompt.userChoice;installPrompt=null;$('#installBtn').hidden=true}else{showInstallHelp()}});
function showInstallHelp(){const ios=/iphone|ipad|ipod/i.test(navigator.userAgent);$('#installHelpText').textContent=ios?'In Safari, tap the Share button, then choose “Add to Home Screen.”':'Open your browser menu and choose “Install app” or “Add to Home screen.”';$('#installHelp').hidden=false}
$('#closeInstallHelp').onclick=()=>$('#installHelp').hidden=true;
if('serviceWorker'in navigator)window.addEventListener('load',()=>navigator.serviceWorker.register('/sw.js').catch(()=>{}));
render();const last=localStorage.getItem('wavecast.last');if(last)playEpisode(last,false);refresh();
// v24 reliable mobile resume: save when backgrounded and restore after media is ready.
let lastProgressSave=0;
function persistCurrentProgress(){if(!state.current||!Number.isFinite(audio.currentTime))return;state.positions[state.current.id]={time:audio.currentTime,duration:Number.isFinite(audio.duration)?audio.duration:(state.positions[state.current.id]?.duration||0)};save()}
function restoreCurrentProgress(){if(!state.current)return;const saved=Number(state.positions[state.current.id]?.time||0);if(saved>0&&Number.isFinite(saved)&&Math.abs(audio.currentTime-saved)>1){const maximum=Number.isFinite(audio.duration)&&audio.duration>2?audio.duration-2:saved;try{audio.currentTime=Math.min(saved,maximum)}catch{}}}
audio.addEventListener('timeupdate',()=>{const now=Date.now();if(now-lastProgressSave>=2000){lastProgressSave=now;persistCurrentProgress()}});
audio.addEventListener('pause',persistCurrentProgress);
audio.addEventListener('loadedmetadata',restoreCurrentProgress);
audio.addEventListener('durationchange',restoreCurrentProgress);
audio.addEventListener('canplay',restoreCurrentProgress);
window.addEventListener('pagehide',persistCurrentProgress);
document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='hidden')persistCurrentProgress()});

const analyticsPlayedEpisodes=new Set();
let analyticsListenEpisode='',analyticsListenLast=0,analyticsListenSeconds=0;
function flushListeningAnalytics(){
  if(!analyticsListenEpisode||analyticsListenSeconds<1)return;
  const episode=state.episodes.find(item=>String(item.id)===analyticsListenEpisode)||state.current;
  trackAnalytics('listen_time',{...analyticsEpisode(episode),value:Math.round(analyticsListenSeconds)});
  analyticsListenSeconds=0;
}
audio.addEventListener('play',()=>{
  if(!state.current)return;
  const id=String(state.current.id);
  if(!analyticsPlayedEpisodes.has(id)){analyticsPlayedEpisodes.add(id);trackAnalytics('play_start',analyticsEpisode(state.current))}
  analyticsListenEpisode=id;analyticsListenLast=audio.currentTime;
});
audio.addEventListener('timeupdate',()=>{
  if(audio.paused||!state.current)return;
  const id=String(state.current.id),current=Number(audio.currentTime);
  if(id!==analyticsListenEpisode){flushListeningAnalytics();analyticsListenEpisode=id;analyticsListenLast=current;return}
  const delta=current-analyticsListenLast;
  if(delta>0&&delta<=65)analyticsListenSeconds+=delta;
  analyticsListenLast=current;
  if(analyticsListenSeconds>=60)flushListeningAnalytics();
});
audio.addEventListener('pause',flushListeningAnalytics);
window.addEventListener('pagehide',flushListeningAnalytics);
document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='hidden')flushListeningAnalytics()});

// v25: today's newly published classes stay above the folders for this calendar day.
let showTodaysClasses=true;
function isTodayEpisode(episode){
  const published=new Date(episode.date),today=new Date();
  return Number.isFinite(published.getTime())&&published.getFullYear()===today.getFullYear()&&published.getMonth()===today.getMonth()&&published.getDate()===today.getDate();
}
function todayEpisodes(){return state.episodes.filter(isTodayEpisode)}
const groupedLibraryWithoutToday=libraryGroups;
libraryGroups=function(){
  const candidates=new Map();
  state.episodes.filter(episode=>!isTodayEpisode(episode)).forEach(episode=>{
    const info=folderInfo(episode.title),key=info.name.toLocaleLowerCase();
    if(!candidates.has(key))candidates.set(key,{name:info.name,forced:info.forced,episodes:[]});
    const group=candidates.get(key);
    group.forced=group.forced||info.forced;
    group.episodes.push(episode);
  });
  const folders=[...candidates.values()].filter(folder=>folder.forced||folder.episodes.length>1).sort((a,b)=>collator.compare(a.name,b.name));
  const groupedIds=new Set(folders.flatMap(folder=>folder.episodes.map(episode=>episode.id)));
  return{folders,unique:state.episodes.filter(episode=>!isTodayEpisode(episode)&&!groupedIds.has(episode.id))};
};
const renderLibraryWithoutToday=render;
render=function(){
  renderLibraryWithoutToday();
  if($('#searchInput').value.trim()||activeFolder)return;
  if(!showTodaysClasses)return;
  const todays=sortEpisodes(todayEpisodes());
  if(!todays.length)return;
  list.insertAdjacentHTML('afterbegin',`<section class="todays-classes" aria-labelledby="todaysClassesTitle"><div class="today-heading"><div><p class="eyebrow">NEW TODAY</p><h3 id="todaysClassesTitle">Today’s Classes</h3></div><span>${todays.length} ${todays.length===1?'class':'classes'}</span></div>${todays.map(episodeHTML).join('')}</section>`);
  const groups=libraryGroups();
  $('#episodeCount').textContent=`${todays.length} today · ${groups.folders.length} folder${groups.folders.length===1?'':'s'} · ${groups.unique.length} individual · ${state.episodes.length} total episodes`;
};
render();

// v52: server-managed folders, subfolders, rules, and manual episode assignments.
let managedConfig={theme:'classic',showTodaysClasses:true,folderOrders:{},folders:[],rules:[],moves:[],hiddenFolders:[],hiddenPaths:[],pathTransforms:[],overrides:{}},activeManagedPath=[],activeManagedSubfolder=null;
function wordsAroundMarker(title,marker,direction){
  const clean=title.trim().replace(/\s+/g,' '),lower=clean.toLocaleLowerCase(),needle=marker.trim().toLocaleLowerCase();
  const index=needle?lower.indexOf(needle):-1;
  if(index<0)return'Other';
  if(direction==='before')return capitalizeFolderLabel(clean.slice(0,index).replace(/[-–—:]+$/,'').trim()||'Other');
  return capitalizeFolderLabel(clean.slice(index+needle.length).replace(/^[-–—:\s]+/,'').split(/\s+/)[0]||'Other');
}
function originalManagedPath(episode){
  const root=folderInfo(episode.title||'').name,path=[root];
  if(root==='Daf Yomi')path.push(dafFolderName(episode.title));
  if(root==='Humash Rashi')path.push(rashiFolderName(episode.title));
  if(root==="Hok L'Yisrael")path.push(hokFolderName(episode.title));
  return path;
}
function transformManagedPath(input){
  let path=[...input];
  for(let pass=0;pass<20;pass++){
    const transform=(managedConfig.pathTransforms||[]).filter(item=>item.sourcePath?.length&&item.sourcePath.every((part,index)=>path[index]===part)).sort((a,b)=>b.sourcePath.length-a.sourcePath.length)[0];
    if(!transform)break;
    const next=[...transform.targetPath,...path.slice(transform.sourcePath.length)];
    if(JSON.stringify(next)===JSON.stringify(path))break;
    path=next;
  }
  return path;
}
function managedPathHidden(path){
  return (managedConfig.hiddenPaths||[]).some(hidden=>hidden.length&&hidden.every((part,index)=>path[index]===part));
}
function managedAssignment(episode){
  const override=managedConfig.overrides?.[String(episode.id)];
  if(override?.path?.length)return{path:transformManagedPath(override.path)};
  if(override?.folder)return{path:transformManagedPath([override.folder,override.subfolder].filter(Boolean))};
  const title=episode.title||'',lower=title.toLocaleLowerCase();
  const originalFolder=folderInfo(title).name,folderKey=value=>String(value||'').normalize('NFD').replace(/\p{Diacritic}/gu,'').toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu,' ').trim();
  const moves=managedConfig.moves||[],move=moves.find(item=>item.source===originalFolder)||moves.find(item=>folderKey(item.source)===folderKey(originalFolder));
  if(move?.parentPath?.length){
    const path=[...move.parentPath,move.name||originalFolder];
    if(originalFolder==='Daf Yomi')path.push(dafFolderName(title));
    if(originalFolder==='Humash Rashi')path.push(rashiFolderName(title));
    if(originalFolder==="Hok L'Yisrael")path.push(hokFolderName(title));
    return{path:transformManagedPath(path)};
  }
  const rule=(managedConfig.rules||[]).find(item=>item.contains&&lower.includes(item.contains.toLocaleLowerCase()));
  if(rule){
    const path=rule.path?.length?[...rule.path]:[rule.folder,rule.subfolder].filter(Boolean);
    let child='';
    if(rule.strategy==='first_word')child=capitalizeFolderLabel(title.trim().split(/\s+/)[0]||'Other');
    if(rule.strategy==='word_after')child=wordsAroundMarker(title,rule.marker,'after');
    if(rule.strategy==='before_word')child=wordsAroundMarker(title,rule.marker,'before');
    if(rule.strategy==='fixed')child=rule.subfolder||'Other';
    if(child)path.push(child);
    return path.length?{path:transformManagedPath(path)}:null;
  }
  const original=originalManagedPath(episode),transformed=transformManagedPath(original);
  if(JSON.stringify(original)!==JSON.stringify(transformed))return{path:transformed};
  return null;
}
const managedAssignmentUncached=managedAssignment,managedAssignmentCache=new Map();
managedAssignment=function(episode){
  const key=`${episode.id}\u0000${episode.title||''}`;
  if(managedAssignmentCache.has(key))return managedAssignmentCache.get(key);
  const value=managedAssignmentUncached(episode);
  managedAssignmentCache.set(key,value);
  return value;
};
let managedGroupsCache={episodes:null,config:null,value:null};
function managedLibraryGroups(){
  if(managedGroupsCache.episodes===state.episodes&&managedGroupsCache.config===managedConfig)return managedGroupsCache.value;
  const candidates=new Map(),hidden=new Set(managedConfig.hiddenFolders||[]);
  const visibleEpisodes=state.episodes.filter(episode=>{const managed=managedAssignment(episode),path=managed?.path||originalManagedPath(episode),root=path[0];return!hidden.has(root)&&!hidden.has(folderInfo(episode.title).name)&&!managedPathHidden(path)});
  visibleEpisodes.forEach(episode=>{
    const managed=managedAssignment(episode),info=managed?{name:managed.path[0],forced:true}:folderInfo(episode.title),key=info.name.toLocaleLowerCase();
    if(!candidates.has(key))candidates.set(key,{name:info.name,forced:info.forced,episodes:[]});
    const group=candidates.get(key);group.forced=group.forced||info.forced;group.episodes.push(episode);
  });
  (managedConfig.folders||[]).map(folder=>transformManagedPath([folder.name])).filter(path=>!hidden.has(path[0])&&!managedPathHidden(path)).forEach(path=>{const name=path[0],key=name.toLocaleLowerCase();if(!candidates.has(key))candidates.set(key,{name,forced:true,episodes:[]})});
  const folders=[...candidates.values()].filter(folder=>folder.forced||folder.episodes.length>1).sort((a,b)=>collator.compare(a.name,b.name));
  const groupedIds=new Set(folders.flatMap(folder=>folder.episodes.map(episode=>episode.id)));
  const value={folders,unique:visibleEpisodes.filter(episode=>!groupedIds.has(episode.id))};
  managedGroupsCache={episodes:state.episodes,config:managedConfig,value};
  return value;
}
libraryGroups=managedLibraryGroups;
const renderWithManagedLibrary=render;
render=function(){
  renderWithManagedLibrary();
  applyManagedFolderView();
};
function applyManagedFolderView(){
  if($('#searchInput').value.trim()||!activeFolder)return;
  const folder=managedConfig.folders?.find(item=>item.name===activeFolder);
  if(!folder)return;
  const assigned=state.episodes.map(episode=>({episode,assignment:managedAssignment(episode)})).filter(item=>item.assignment?.folder===activeFolder);
  const hasSubfolders=assigned.some(item=>item.assignment.subfolder);
  if(!hasSubfolders)return;
  if(activeManagedSubfolder){
    const episodes=sortEpisodes(assigned.filter(item=>(item.assignment.subfolder||'Other')===activeManagedSubfolder).map(item=>item.episode));
    $('#libraryTitle').textContent=`${activeManagedSubfolder} · ${activeFolder}`;
    $('#episodeCount').textContent=`${episodes.length} episode${episodes.length===1?'':'s'}`;
    list.innerHTML=`<button class="back-library" type="button" data-managed-back>← ${esc(activeFolder)} folders</button>${episodes.map(episodeHTML).join('')}`;
    return;
  }
  const groups=new Map();
  assigned.forEach(({episode,assignment})=>{const name=assignment.subfolder||'Other';if(!groups.has(name))groups.set(name,[]);groups.get(name).push(episode)});
  const folders=sortFolderEntries([...groups],[activeFolder]);
  $('#libraryTitle').textContent=activeFolder;
  $('#episodeCount').textContent=`${folders.length} folder${folders.length===1?'':'s'} · ${assigned.length} episodes`;
  list.innerHTML=`<button class="back-library" type="button" data-back>← All folders</button><div class="folder-grid">${folders.map(([name,episodes])=>`<button class="folder-card" type="button" data-managed-folder="${esc(name)}"><span class="folder-icon">▰</span><strong>${esc(name)}</strong><span>${episodes.length} episode${episodes.length===1?'':'s'}</span></button>`).join('')}</div>`;
}
let managedConfigLoading=false;
async function loadManagedConfig(){
  if(managedConfigLoading)return;
  managedConfigLoading=true;
  try{
    const response=await fetch('/api/library-config',{cache:'no-store'});
    if(response.ok){managedConfig=await response.json();showTodaysClasses=managedConfig.showTodaysClasses!==false;savedFolderOrders=managedConfig.folderOrders&&typeof managedConfig.folderOrders==='object'?managedConfig.folderOrders:{};applyAppTheme(managedConfig.theme);filingRuleConfig={disabledBuiltInRules:managedConfig.disabledBuiltInRules||[],builtInRuleEdits:managedConfig.builtInRuleEdits||{}};folderInfoCache.clear();managedAssignmentCache.clear();managedGroupsCache={episodes:null,config:null,value:null};render()}
  }catch{}finally{managedConfigLoading=false}
}
list.addEventListener('click',event=>{
  const folder=event.target.closest('[data-managed-folder]'),back=event.target.closest('[data-managed-back]');
  if(folder){event.preventDefault();event.stopImmediatePropagation();activeManagedSubfolder=folder.dataset.managedFolder;history.pushState({view:'managed-subfolder',folder:activeFolder,subfolder:activeManagedSubfolder},'');render()}
  else if(back){event.preventDefault();event.stopImmediatePropagation();history.back()}
},true);
window.addEventListener('popstate',event=>{
  activeManagedSubfolder=event.state?.view==='managed-subfolder'?event.state.subfolder:null;
  if(activeManagedSubfolder)activeFolder=event.state.folder;
  render();
});
$('#refreshBtn').addEventListener('click',loadManagedConfig);
document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible')loadManagedConfig()});
loadManagedConfig();
$('#refreshBtn').addEventListener('click',loadManagedConfig);
window.setInterval(()=>{if(document.visibilityState==='visible')loadManagedConfig()},15000);

// v38: autoplay the next episode from the list and sort order the listener selected.
let playbackQueue=[];
try{playbackQueue=JSON.parse(localStorage.getItem('rjs.playbackQueue')||'[]')}catch{}
let backgroundHandoffFrom='',ignoreEndedUntil=0;
function capturePlaybackQueue(){
  playbackQueue=[...list.querySelectorAll('.episode[data-id]')].map(row=>row.dataset.id).filter(Boolean);
  localStorage.setItem('rjs.playbackQueue',JSON.stringify(playbackQueue));
}
function nextPlaybackId(completedId){
  if(!playbackQueue.length)capturePlaybackQueue();
  const currentIndex=playbackQueue.indexOf(String(completedId));
  return currentIndex>=0?(playbackQueue[currentIndex+1]||playbackQueue[0]):null;
}
function continuePlayback(completedId){
  const nextId=nextPlaybackId(completedId);
  if(!nextId||nextId===String(completedId))return false;
  const currentIndex=playbackQueue.indexOf(String(completedId));
  setStatus(currentIndex===playbackQueue.length-1?'Restarting from the first episode…':'Playing next episode…');
  playEpisode(nextId,true);
  return true;
}
list.addEventListener('click',event=>{
  if(event.target.closest('button'))return;
  const row=event.target.closest('.episode[data-id]');
  if(row)capturePlaybackQueue();
},true);
audio.addEventListener('ended',()=>{
  if(Date.now()<ignoreEndedUntil)return;
  if(!state.current)return;
  flushListeningAnalytics();trackAnalytics('episode_complete',analyticsEpisode(state.current));
  const completedId=state.current.id;
  state.positions[completedId]={time:Number.isFinite(audio.duration)?audio.duration:audio.currentTime,duration:Number.isFinite(audio.duration)?audio.duration:(state.positions[completedId]?.duration||0)};
  save();
  render();
  if(!continuePlayback(completedId))setStatus('Episode complete.');
});
// Locked phones may suspend the page at the exact end of a track. Hand off while
// the existing media session is still active so continuous play can keep running.
audio.addEventListener('timeupdate',()=>{
  if(document.visibilityState!=='hidden'||!state.current||!Number.isFinite(audio.duration))return;
  const remaining=audio.duration-audio.currentTime,currentId=String(state.current.id);
  if(remaining<=0||remaining>1.5||backgroundHandoffFrom===currentId)return;
  const nextId=nextPlaybackId(currentId);
  if(!nextId||nextId===currentId)return;
  backgroundHandoffFrom=currentId;
  state.positions[currentId]={time:audio.duration,duration:audio.duration};
  save();
  ignoreEndedUntil=Date.now()+3000;
  continuePlayback(currentId);
});

function scheduleTodayRollover(){
  const now=new Date(),nextMidnight=new Date(now.getFullYear(),now.getMonth(),now.getDate()+1);
  window.setTimeout(()=>{render();scheduleTodayRollover()},Math.max(1000,nextMidnight-now+1000));
}
scheduleTodayRollover();

// v26: keep filenames and other identifiers available for sorting, but hide them from episode rows.
episodeHTML=function(e,i){
  const p=state.positions[e.id]||{},pct=p.duration?Math.min(100,p.time/p.duration*100):0,played=pct>95,downloaded=state.downloaded.has(e.id),durationLabel=typeof e.duration==='number'?clock(e.duration):e.duration;
  return `<article class="episode" data-id="${esc(e.id)}"><span class="episode-number">${String(i+1).padStart(2,'0')}</span>${e.art?`<img class="art" src="${esc(e.art)}" alt="">`:'<div class="art"></div>'}<div><h3>${esc(e.title)}</h3><div class="meta">${formatDate(e.date)}${durationLabel?' · '+esc(durationLabel):''}</div></div><div class="episode-state"><span class="availability ${downloaded?'is-downloaded':''}">${downloaded?'DOWNLOADED':'ONLINE'}</span><span class="played">${played?'PLAYED':pct?'<i class="dot"></i>IN PROGRESS':'UNPLAYED'}</span><div class="progress-track"><div class="progress-fill" style="width:${pct}%"></div></div><button class="download-btn" type="button" data-download="${esc(e.id)}">${downloaded?'Remove download':'Download'}</button></div></article>`;
};
render();

// v28: do not let an empty RSS duration overwrite SoundCloud's catalog duration.
const parseFeedKeepingDurations=parseFeed;
parseFeed=function(xml,feedUrl){
  return parseFeedKeepingDurations(xml,feedUrl).map(episode=>{
    if(episode.duration)return episode;
    const {duration,...withoutBlankDuration}=episode;
    return withoutBlankDuration;
  });
};

// v29: today's classes also remain visible in their normal folders.
libraryGroups=function(){
  const candidates=new Map();
  state.episodes.forEach(episode=>{
    const info=folderInfo(episode.title),key=info.name.toLocaleLowerCase();
    if(!candidates.has(key))candidates.set(key,{name:info.name,forced:info.forced,episodes:[]});
    const group=candidates.get(key);
    group.forced=group.forced||info.forced;
    group.episodes.push(episode);
  });
  const folders=[...candidates.values()].filter(folder=>folder.forced||folder.episodes.length>1).sort((a,b)=>collator.compare(a.name,b.name));
  const groupedIds=new Set(folders.flatMap(folder=>folder.episodes.map(episode=>episode.id)));
  return{folders,unique:state.episodes.filter(episode=>!groupedIds.has(episode.id))};
};

const episodeHTMLWithDuration=episodeHTML;
episodeHTML=function(episode,index){
  return episodeHTMLWithDuration(episode,index).replace('</button></div></article>',`</button><button class="share-episode-btn" type="button" data-share-episode="${esc(episode.id)}">Share episode</button></div></article>`);
};

async function shareLink({title,text,url}){
  try{
    if(navigator.share){await navigator.share({title,text,url});return}
    await navigator.clipboard.writeText(url);
    setStatus('Link copied. You can paste it into a message.');
  }catch(error){
    if(error?.name!=='AbortError')setStatus('The link could not be shared on this device.');
  }
}
function shareEpisode(id){
  const episode=state.episodes.find(item=>item.id===id);
  if(!episode)return;
  const url=new URL(location.origin);
  url.searchParams.set('episode',id);
  trackAnalytics('share_episode',analyticsEpisode(episode));
  shareLink({title:`${episode.title} by Rabbi Joey Soffer`,text:`*Today’s New Release*\n\n*${episode.title.toLocaleUpperCase()}*\n\nListen on RJS Torah`,url:url.toString()});
}
$('#shareAppBtn').addEventListener('click',()=>{trackAnalytics('share_app');shareLink({title:'RJS Torah',text:'Listen to Rabbi Joey Soffer Shiurim on RJS Torah',url:location.origin})});

let activeDafFolder=null;
function dafFolderName(title=''){
  const normalized=title.trim().replace(/\s+/g,' ');
  const dafMatch=normalized.match(/\bdaf\b/i)||normalized.match(/daf/i);
  const beforeDaf=(dafMatch?normalized.slice(0,dafMatch.index):normalized).trim();
  return capitalizeFolderLabel(beforeDaf.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu,'').trim()||'Daf Yomi');
}
const renderWithTodaysClasses=render;
render=function(){
  renderWithTodaysClasses();
  if($('#searchInput').value.trim()||activeFolder!=='Daf Yomi')return;
  const dafEpisodes=state.episodes.filter(episode=>/daf/i.test(episode.title));
  if(activeDafFolder){
    const episodes=sortEpisodes(dafEpisodes.filter(episode=>dafFolderName(episode.title)===activeDafFolder));
    $('#libraryTitle').textContent=`${activeDafFolder} · Daf Yomi`;
    $('#episodeCount').textContent=`${episodes.length} episode${episodes.length===1?'':'s'}`;
    list.innerHTML=`<button class="back-library" type="button" data-daf-back>← Daf Yomi folders</button>${episodes.map(episodeHTML).join('')}`;
    return;
  }
  const subfolders=new Map();
  dafEpisodes.forEach(episode=>{
    const name=dafFolderName(episode.title);
    if(!subfolders.has(name))subfolders.set(name,[]);
    subfolders.get(name).push(episode);
  });
  const folders=sortFolderEntries([...subfolders.entries()],['Daf Yomi']);
  $('#libraryTitle').textContent='Daf Yomi';
  $('#episodeCount').textContent=`${folders.length} folder${folders.length===1?'':'s'} · ${dafEpisodes.length} episodes`;
  list.innerHTML=`<button class="back-library" type="button" data-back>← All folders</button><div class="folder-grid">${folders.map(([name,episodes])=>`<button class="folder-card" type="button" data-daf-folder="${esc(name)}"><span class="folder-icon">▰</span><strong>${esc(name)}</strong><span>${episodes.length} episode${episodes.length===1?'':'s'}</span></button>`).join('')}</div>`;
};

list.addEventListener('click',event=>{
  const share=event.target.closest('[data-share-episode]');
  if(share){event.preventDefault();event.stopImmediatePropagation();shareEpisode(share.dataset.shareEpisode);return}
  const dafFolder=event.target.closest('[data-daf-folder]');
  if(dafFolder){
    event.preventDefault();event.stopImmediatePropagation();
    activeDafFolder=dafFolder.dataset.dafFolder;
    history.pushState({view:'daf-subfolder',folder:'Daf Yomi',dafFolder:activeDafFolder},'');
    render();
    return;
  }
  const dafBack=event.target.closest('[data-daf-back]');
  if(dafBack){event.preventDefault();event.stopImmediatePropagation();history.back()}
},true);

window.addEventListener('popstate',event=>{
  activeDafFolder=event.state?.view==='daf-subfolder'?event.state.dafFolder:null;
  if(activeDafFolder)activeFolder='Daf Yomi';
  render();
});

const sharedEpisodeId=new URLSearchParams(location.search).get('episode');
if(sharedEpisodeId){
  let sharedEpisodeAttempts=0;
  const openSharedEpisode=window.setInterval(()=>{
    const episode=state.episodes.find(item=>item.id===sharedEpisodeId);
    if(!episode&&sharedEpisodeAttempts++<30)return;
    window.clearInterval(openSharedEpisode);
    if(!episode)return setStatus('That shared episode could not be found.');
    $('#searchInput').value=episode.title;
    history.replaceState({view:'search',query:episode.title},'');
    render();
    playEpisode(episode.id,false);
  },500);
}
render();

// v31: Rashi episodes live in a master folder with first-word subfolders.
let activeRashiFolder=null;
function rashiFolderName(title=''){
  return capitalizeFolderLabel(title.trim().split(/\s+/)[0]?.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu,'')||'Other');
}
const renderWithDafYomi=render;
render=function(){
  renderWithDafYomi();
  if($('#searchInput').value.trim()||activeFolder!=='Humash Rashi')return;
  const rashiEpisodes=state.episodes.filter(episode=>/rashi/i.test(episode.title));
  if(activeRashiFolder){
    const episodes=sortEpisodes(rashiEpisodes.filter(episode=>rashiFolderName(episode.title)===activeRashiFolder));
    $('#libraryTitle').textContent=`${activeRashiFolder} · Humash Rashi`;
    $('#episodeCount').textContent=`${episodes.length} episode${episodes.length===1?'':'s'}`;
    list.innerHTML=`<button class="back-library" type="button" data-rashi-back>← Humash Rashi folders</button>${episodes.map(episodeHTML).join('')}`;
    return;
  }
  const subfolders=new Map();
  rashiEpisodes.forEach(episode=>{
    const name=rashiFolderName(episode.title);
    if(!subfolders.has(name))subfolders.set(name,[]);
    subfolders.get(name).push(episode);
  });
  const folders=sortFolderEntries([...subfolders.entries()],['Humash Rashi']);
  $('#libraryTitle').textContent='Humash Rashi';
  $('#episodeCount').textContent=`${folders.length} folder${folders.length===1?'':'s'} · ${rashiEpisodes.length} episodes`;
  list.innerHTML=`<button class="back-library" type="button" data-back>← All folders</button><div class="folder-grid">${folders.map(([name,episodes])=>`<button class="folder-card" type="button" data-rashi-folder="${esc(name)}"><span class="folder-icon">▰</span><strong>${esc(name)}</strong><span>${episodes.length} episode${episodes.length===1?'':'s'}</span></button>`).join('')}</div>`;
};

list.addEventListener('click',event=>{
  const folder=event.target.closest('[data-rashi-folder]');
  if(folder){
    event.preventDefault();event.stopImmediatePropagation();
    activeRashiFolder=folder.dataset.rashiFolder;
    history.pushState({view:'rashi-subfolder',folder:'Humash Rashi',rashiFolder:activeRashiFolder},'');
    render();
    return;
  }
  const back=event.target.closest('[data-rashi-back]');
  if(back){event.preventDefault();event.stopImmediatePropagation();history.back()}
},true);

window.addEventListener('popstate',event=>{
  activeRashiFolder=event.state?.view==='rashi-subfolder'?event.state.rashiFolder:null;
  if(activeRashiFolder)activeFolder='Humash Rashi';
  render();
});
render();

// v39: favorites are private to this device and available from the sort dropdown.
state.favorites=new Set(JSON.parse(localStorage.getItem('wavecast.favorites')||'[]'));
const episodeHTMLWithSharing=episodeHTML;
episodeHTML=function(episode,index){
  const favorite=state.favorites.has(episode.id);
  const originalHTML=episodeHTMLWithSharing(episode,index);
  const downloadButton=(originalHTML.match(/<button class="download-btn"[\s\S]*?<\/button>/)?.[0]||'').replace('Remove download','Remove');
  const shareButton=(originalHTML.match(/<button class="share-episode-btn"[\s\S]*?<\/button>/)?.[0]||'').replace('Share episode','Share');
  const favoriteButton=`<button class="favorite-btn ${favorite?'is-favorite':''}" type="button" data-favorite="${esc(episode.id)}" aria-pressed="${favorite}">${favorite?'★ Favorite':'☆ Favorite'}</button>`;
  const withoutOldActions=originalHTML.replace(/<button class="download-btn"[\s\S]*?<\/button>/,'').replace(/<button class="share-episode-btn"[\s\S]*?<\/button>/,'');
  return withoutOldActions.replace('</div></article>',`<div class="episode-actions">${favoriteButton}${downloadButton}${shareButton}</div></div></article>`);
};
function saveFavorites(){localStorage.setItem('wavecast.favorites',JSON.stringify([...state.favorites]))}
function toggleFavorite(id){
  const episode=state.episodes.find(item=>item.id===id);
  if(state.favorites.has(id)){state.favorites.delete(id);trackAnalytics('favorite_remove',analyticsEpisode(episode))}
  else{state.favorites.add(id);trackAnalytics('favorite',analyticsEpisode(episode))}
  saveFavorites();
  render();
}
function renderFavoritesView(){
  if($('#sortSelect').value!=='favorites-desc')return;
  activeFolder=null;activeDafFolder=null;activeRashiFolder=null;
  const query=$('#searchInput').value.trim().toLocaleLowerCase();
  const favorites=state.episodes.filter(episode=>state.favorites.has(episode.id)&&(!query||`${episode.title} ${episode.show} ${episode.fileName}`.toLocaleLowerCase().includes(query))).sort((a,b)=>new Date(b.date)-new Date(a.date));
  $('#libraryTitle').textContent='Favorites';
  $('#episodeCount').textContent=`${favorites.length} favorite${favorites.length===1?'':'s'}`;
  list.innerHTML=favorites.length?favorites.map(episodeHTML).join(''):'<div class="empty">No favorite episodes yet. Tap Favorite on any episode to add it here.</div>';
}
const renderWithFavorites=render;
render=function(){renderWithFavorites();renderFavoritesView()};
list.addEventListener('click',event=>{
  const favoriteButton=event.target.closest('[data-favorite]');
  if(favoriteButton){event.preventDefault();event.stopImmediatePropagation();toggleFavorite(favoriteButton.dataset.favorite)}
},true);
$('#sortSelect').addEventListener('change',()=>render());
$('#searchInput').addEventListener('input',()=>{if($('#sortSelect').value==='favorites-desc')render()});
render();

// v42: show Download app in the browser and Share app in the installed PWA.
function isInstalledApp(){
  return window.matchMedia('(display-mode: standalone)').matches||window.navigator.standalone===true;
}
function updateAppAction(){
  const installed=isInstalledApp();
  $('#installBtn').hidden=installed;
  $('#shareAppBtn').hidden=!installed;
}
updateAppAction();
window.addEventListener('appinstalled',updateAppAction);
window.matchMedia('(display-mode: standalone)').addEventListener?.('change',updateAppAction);

// v43: maintain the active media session and autoplay intent across locked-screen transitions.
const playEpisodeWithMediaSession=playEpisode;
playEpisode=function(id,autoplay=true){
  if(autoplay)audio.autoplay=true;
  playEpisodeWithMediaSession(id,autoplay);
  const episode=state.episodes.find(item=>item.id===id);
  if(episode&&'mediaSession'in navigator&&'MediaMetadata'in window){
    navigator.mediaSession.metadata=new MediaMetadata({
      title:episode.title,
      artist:'Rabbi Joey Soffer',
      album:'RJS Torah',
      artwork:episode.art?[{src:episode.art}]:[]
    });
  }
};
audio.addEventListener('playing',()=>{
  if('mediaSession'in navigator)navigator.mediaSession.playbackState='playing';
});
audio.addEventListener('pause',()=>{
  if('mediaSession'in navigator)navigator.mediaSession.playbackState='paused';
});
audio.addEventListener('timeupdate',()=>{
  if(!('mediaSession'in navigator)||!navigator.mediaSession.setPositionState||!Number.isFinite(audio.duration)||audio.duration<=0)return;
  try{navigator.mediaSession.setPositionState({duration:audio.duration,playbackRate:audio.playbackRate||1,position:Math.min(audio.currentTime,audio.duration)})}catch{}
});
if('mediaSession'in navigator){
  const setMediaAction=(action,handler)=>{try{navigator.mediaSession.setActionHandler(action,handler)}catch{}};
  setMediaAction('play',()=>audio.play());
  setMediaAction('pause',()=>audio.pause());
  setMediaAction('seekbackward',details=>{audio.currentTime=Math.max(0,audio.currentTime-(details.seekOffset||15))});
  setMediaAction('seekforward',details=>{audio.currentTime=Math.min(audio.duration||Infinity,audio.currentTime+(details.seekOffset||30))});
  setMediaAction('nexttrack',()=>{
    const nextId=state.current?nextPlaybackId(state.current.id):null;
    if(nextId)playEpisode(nextId,true);
  });
  setMediaAction('previoustrack',()=>{
    const index=state.current?playbackQueue.indexOf(state.current.id):-1,previousId=index>0?playbackQueue[index-1]:null;
    if(previousId)playEpisode(previousId,true);else audio.currentTime=0;
  });
}

// v46: Hok L'Yisrael is a master folder grouped by the word after L'Yisrael.
let activeHokFolder=null;
function hokFolderName(title=''){
  const match=title.match(/\bhok\s+l\s*['’]?\s*yisrael\b\s*[-–—:]?\s*([^\s]+)/i);
  const word=match?.[1]?.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu,'')||'Other';
  return capitalizeFolderLabel(word);
}
const renderWithHokYisrael=render;
render=function(){
  renderWithHokYisrael();
  if($('#searchInput').value.trim()||activeFolder!=="Hok L'Yisrael")return;
  const hokEpisodes=state.episodes.filter(episode=>/\bhok\s+l\s*['’]?\s*yisrael\b/i.test(episode.title));
  if(activeHokFolder){
    const episodes=sortEpisodes(hokEpisodes.filter(episode=>hokFolderName(episode.title)===activeHokFolder));
    $('#libraryTitle').textContent=`${activeHokFolder} · Hok L’Yisrael`;
    $('#episodeCount').textContent=`${episodes.length} episode${episodes.length===1?'':'s'}`;
    list.innerHTML=`<button class="back-library" type="button" data-hok-back>← Hok L’Yisrael folders</button>${episodes.map(episodeHTML).join('')}`;
    return;
  }
  const subfolders=new Map();
  hokEpisodes.forEach(episode=>{
    const name=hokFolderName(episode.title);
    if(!subfolders.has(name))subfolders.set(name,[]);
    subfolders.get(name).push(episode);
  });
  const folders=sortFolderEntries([...subfolders.entries()],["Hok L'Yisrael"]);
  $('#libraryTitle').textContent='Hok L’Yisrael';
  $('#episodeCount').textContent=`${folders.length} folder${folders.length===1?'':'s'} · ${hokEpisodes.length} episodes`;
  list.innerHTML=`<button class="back-library" type="button" data-back>← All folders</button><div class="folder-grid">${folders.map(([name,episodes])=>`<button class="folder-card" type="button" data-hok-folder="${esc(name)}"><span class="folder-icon">▰</span><strong>${esc(name)}</strong><span>${episodes.length} episode${episodes.length===1?'':'s'}</span></button>`).join('')}</div>`;
};
list.addEventListener('click',event=>{
  const folder=event.target.closest('[data-hok-folder]');
  if(folder){
    event.preventDefault();event.stopImmediatePropagation();
    activeHokFolder=folder.dataset.hokFolder;
    history.pushState({view:'hok-subfolder',folder:"Hok L'Yisrael",hokFolder:activeHokFolder},'');
    render();
    return;
  }
  const back=event.target.closest('[data-hok-back]');
  if(back){event.preventDefault();event.stopImmediatePropagation();history.back()}
},true);
window.addEventListener('popstate',event=>{
  activeHokFolder=event.state?.view==='hok-subfolder'?event.state.hokFolder:null;
  if(activeHokFolder)activeFolder="Hok L'Yisrael";
  render();
});
render();

// v49: keep Favorite, Download, and Share controls available in Now Playing.
const playerFavoriteBtn=$('#playerFavoriteBtn'),playerDownloadBtn=$('#playerDownloadBtn'),playerShareBtn=$('#playerShareBtn');
function updatePlayerActions(){
  const episode=state.current,hasEpisode=Boolean(episode);
  playerFavoriteBtn.disabled=!hasEpisode;playerDownloadBtn.disabled=!hasEpisode;playerShareBtn.disabled=!hasEpisode;
  if(!episode){playerFavoriteBtn.textContent='☆ Favorite';playerDownloadBtn.textContent='Download';return}
  const favorite=state.favorites.has(episode.id),downloaded=state.downloaded.has(episode.id);
  playerFavoriteBtn.textContent=favorite?'★ Favorite':'☆ Favorite';
  playerFavoriteBtn.classList.toggle('is-favorite',favorite);
  playerFavoriteBtn.setAttribute('aria-pressed',String(favorite));
  playerDownloadBtn.textContent=downloaded?'Remove':'Download';
}
const playEpisodeWithPlayerActions=playEpisode;
playEpisode=function(id,autoplay=true){playEpisodeWithPlayerActions(id,autoplay);updatePlayerActions()};
const toggleFavoriteWithPlayerActions=toggleFavorite;
toggleFavorite=function(id){toggleFavoriteWithPlayerActions(id);updatePlayerActions()};
const toggleDownloadWithPlayerActions=toggleDownload;
toggleDownload=async function(id,button){await toggleDownloadWithPlayerActions(id,button);updatePlayerActions()};
playerFavoriteBtn.addEventListener('click',()=>{if(state.current)toggleFavorite(state.current.id)});
playerDownloadBtn.addEventListener('click',()=>{if(state.current)toggleDownload(state.current.id,playerDownloadBtn)});
playerShareBtn.addEventListener('click',()=>{if(state.current)shareEpisode(state.current.id)});
updatePlayerActions();

// v50: normalize the home title and begin every folder view at the top of its list.
const renderWithCapitalLibrary=render;
render=function(){
  renderWithCapitalLibrary();
  if(!activeFolder&&!$('#searchInput').value.trim()&&$('#sortSelect').value!=='favorites-desc')$('#libraryTitle').textContent='Shiurim Library';
};
function scrollToLibraryTop(){
  window.requestAnimationFrame(()=>document.querySelector('.library-heading')?.scrollIntoView({behavior:'auto',block:'start'}));
}
document.addEventListener('click',event=>{
  if(event.target.closest('[data-folder],[data-back],[data-daf-folder],[data-daf-back],[data-rashi-folder],[data-rashi-back],[data-hok-folder],[data-hok-back]'))window.setTimeout(scrollToLibraryTop,0);
},true);
window.addEventListener('popstate',()=>window.setTimeout(scrollToLibraryTop,0));
render();

// Keep server-managed filing as the final authority after all legacy folder views.
libraryGroups=managedLibraryGroups;
const renderBeforeFinalManagedView=render;
render=function(){renderBeforeFinalManagedView();applyManagedFolderView()};
render();

// v53: typo-tolerant full-catalog search, with exact matches ranked first.
const renderBeforeFuzzySearch=render;
render=function(){
  renderBeforeFuzzySearch();
  const query=$('#searchInput').value.trim();
  if(!query||$('#sortSelect').value==='favorites-desc')return;
  const results=searchEpisodes(state.episodes,query),folders=searchFolders(query);
  $('#libraryTitle').textContent='Search results';
  $('#episodeCount').textContent=`${folders.length} folder${folders.length===1?'':'s'} · ${results.length} episode${results.length===1?'':'s'} across entire catalog`;
  const folderResults=folders.length?`<h3 class="section-label">Matching folders</h3><div class="folder-grid">${folders.map(path=>`<button class="folder-card" type="button" data-search-folder="${esc(encodeURIComponent(JSON.stringify(path)))}"><span class="folder-icon">▰</span><strong>${esc(path.at(-1))}</strong><small>${esc(path.join(' › '))}</small></button>`).join('')}</div>`:'';
  const episodeResults=results.length?`<h3 class="section-label">Matching classes</h3>${results.map(episodeHTML).join('')}`:'';
  list.innerHTML=folderResults+episodeResults||'<div class="empty">No exact or similar folder, title, or filename matches were found.</div>';
};
render();

// v54: render and navigate server-managed folders at unlimited depth.
function applyNestedManagedFolderView(){
  if($('#searchInput').value.trim()||!activeFolder)return;
  const currentPath=[activeFolder,...activeManagedPath];
  const finalConfiguredPaths=configuredFolderPaths().map(transformManagedPath).filter(path=>!managedPathHidden(path));
  const configuredExists=finalConfiguredPaths.some(path=>path.length===currentPath.length&&path.every((part,index)=>part===currentPath[index]));
  const assigned=state.episodes.map(episode=>({episode,path:managedAssignment(episode)?.path||transformManagedPath(originalManagedPath(episode))})).filter(item=>!managedPathHidden(item.path)&&item.path.slice(0,currentPath.length).every((part,index)=>part===currentPath[index]));
  if(!configuredExists&&!assigned.length)return;
  const direct=sortEpisodes(assigned.filter(item=>item.path.length===currentPath.length).map(item=>item.episode));
  const children=new Map();
  assigned.filter(item=>item.path.length>currentPath.length).forEach(item=>{const name=item.path[currentPath.length];if(!children.has(name))children.set(name,[]);children.get(name).push(item.episode)});
  finalConfiguredPaths.filter(path=>path.length>currentPath.length&&currentPath.every((part,index)=>path[index]===part)).forEach(path=>{const name=path[currentPath.length];if(!children.has(name))children.set(name,[])});
  const childFolders=sortFolderEntries([...children],currentPath);
  if(!childFolders.length&&!activeManagedPath.length)return;
  $('#libraryTitle').textContent=currentPath.join(' · ');
  $('#episodeCount').textContent=`${childFolders.length} folder${childFolders.length===1?'':'s'} · ${assigned.length} episodes`;
  const back=activeManagedPath.length?`<button class="back-library" type="button" data-managed-deep-back>← ${esc(currentPath.at(-2))}</button>`:`<button class="back-library" type="button" data-back>← All folders</button>`;
  const cards=childFolders.length?`<div class="folder-grid">${childFolders.map(([name,episodes])=>`<button class="folder-card" type="button" data-managed-deep="${esc(name)}"><span class="folder-icon">▰</span><strong>${esc(name)}</strong><span>${episodes.length} episode${episodes.length===1?'':'s'}</span></button>`).join('')}</div>`:'';
  const classes=direct.length?`${childFolders.length?'<h3 class="section-label">Classes in this folder</h3>':''}${direct.map(episodeHTML).join('')}`:(!childFolders.length?'<div class="empty">This folder is empty.</div>':'');
  list.innerHTML=back+cards+classes;
}
list.addEventListener('click',event=>{
  const child=event.target.closest('[data-managed-deep]'),back=event.target.closest('[data-managed-deep-back]');
  if(child){event.preventDefault();event.stopImmediatePropagation();activeManagedPath.push(child.dataset.managedDeep);history.pushState({view:'managed-deep',folder:activeFolder,path:[...activeManagedPath]},'');render()}
  else if(back){event.preventDefault();event.stopImmediatePropagation();history.back()}
  else if(event.target.closest('[data-folder]'))activeManagedPath=[];
},true);
list.addEventListener('click',event=>{
  const button=event.target.closest('[data-search-folder]');
  if(!button)return;
  event.preventDefault();event.stopImmediatePropagation();
  let path=[];try{path=JSON.parse(decodeURIComponent(button.dataset.searchFolder))}catch{}
  if(!path.length)return;
  $('#searchInput').value='';activeFolder=path[0];activeManagedPath=path.slice(1);
  history.pushState(activeManagedPath.length?{view:'managed-deep',folder:activeFolder,path:[...activeManagedPath]}:{view:'folder',folder:activeFolder},'');
  render();scrollToLibraryTop();
},true);
window.addEventListener('popstate',event=>{activeManagedPath=event.state?.view==='managed-deep'?(event.state.path||[]):[];if(activeManagedPath.length)activeFolder=event.state.folder;render()});
const renderBeforeUnlimitedFolders=render;
render=function(){renderBeforeUnlimitedFolders();applyNestedManagedFolderView()};
$('#searchInput').addEventListener('input',()=>render());
$('#sortSelect').addEventListener('change',()=>render());
render();

// v74: replace accumulated legacy search/sort listeners with one fast handler each.
const legacySearchInput=$('#searchInput'),fastSearchInput=legacySearchInput.cloneNode(true);
legacySearchInput.replaceWith(fastSearchInput);
let searchRenderTimer=null;
fastSearchInput.addEventListener('input',event=>{
  const query=event.target.value;
  if(query){
    if(history.state?.view!=='search')history.pushState({view:'search',query},'');
    else history.replaceState({...history.state,query},'');
  }else if(history.state?.view==='search')history.replaceState({view:'home'},'');
  clearTimeout(searchRenderTimer);
  searchRenderTimer=setTimeout(render,120);
  clearTimeout(analyticsSearchTimer);
  if(query.trim().length>=2)analyticsSearchTimer=setTimeout(()=>trackAnalytics('search',{value:query.trim().length}),800);
});
const legacySortSelect=$('#sortSelect'),fastSortSelect=legacySortSelect.cloneNode(true);
legacySortSelect.replaceWith(fastSortSelect);
fastSortSelect.addEventListener('change',render);
const folderViewNames=new Set(['folder','managed-subfolder','daf-subfolder','rashi-subfolder','hok-subfolder','managed-deep']);
document.addEventListener('click',event=>{
  if(event.target.closest('[data-folder],[data-managed-folder],[data-daf-folder],[data-rashi-folder],[data-hok-folder],[data-search-folder],[data-managed-deep],[data-managed-child]'))fastSortSelect.value='file-asc';
  else if(event.target.closest('[data-back]'))fastSortSelect.value='date-desc';
  else if(event.target.closest('[data-managed-deep-back],[data-managed-back],[data-daf-back],[data-rashi-back],[data-hok-back]'))fastSortSelect.value='file-asc';
},true);
window.addEventListener('popstate',event=>{fastSortSelect.value=folderViewNames.has(event.state?.view)?'file-asc':'date-desc';setTimeout(render,0)});
document.addEventListener('click',event=>{
  if(event.target.closest('.contact-rabbi'))trackAnalytics('contact');
  const folder=event.target.closest('[data-folder],[data-managed-folder],[data-daf-folder],[data-rashi-folder],[data-hok-folder],[data-search-folder],[data-managed-child]');
  if(folder){const name=folder.querySelector('strong')?.textContent?.trim()||folder.dataset.folder||folder.dataset.managedFolder||folder.dataset.dafFolder||folder.dataset.rashiFolder||folder.dataset.hokFolder||'';if(name)trackAnalytics('folder_open',{folder:name})}
},true);

const helpTour=$('#helpTour'),helpTooltip=$('#helpTooltip'),helpSpotlight=$('#helpSpotlight'),helpArrow=$('#helpArrow'),helpDots=$('#helpDots');
const helpSteps=[
  {target:'.topbar',title:'App Tools',text:'Start here to contact Rabbi Joey, install or share the app, refresh the podcast feed, or open this Help tour again at any time.'},
  {target:'.library-heading',title:'Your Shiurim Library',text:'Today’s Classes, folders, subfolders, and individual shiurim all appear here. Folders with the newest classes appear first unless Rabbi Joey has chosen a custom folder order.'},
  {target:'#searchInput',title:'Search the Entire Catalog',text:'Type an episode title, audio filename, or folder name. Search checks every folder and understands similar spellings, so small typing mistakes can still find the right class.'},
  {target:'#sortSelect',title:'Sort and Find Favorites',text:'Inside every folder, classes begin in audio filename A to Z order. You can change them to newest, oldest, title, or another filename order. Select Favorites only to see every class you saved.'},
  {target:'#episodeList > :first-child',title:'Open Folders or Play a Class',text:'Tap a folder to see what is inside, or tap an episode to listen. Today’s releases are highlighted for one day while also remaining filed in the correct topic folder.'},
  {target:'.player-episode-actions',title:'Favorite, Download, or Share',text:'Favorite saves the class to your list. Download stores it on this device for offline listening. Share opens the phone’s sharing choices with a direct episode link.'},
  {target:'#player',title:'Now Playing Controls',text:'Play or pause, skip back 15 seconds, move forward 30 seconds, drag the progress bar, and choose a speed from 1× to 2×. Your place is remembered, and the next class plays automatically.'}
];
let helpPage=0,helpTouchStart=0,helpPreviousFocus=null,helpPreviousScroll=0,helpLayoutToken=0;
helpDots.innerHTML=helpSteps.map((_,index)=>`<button type="button" data-help-page="${index}" aria-label="Go to help step ${index+1}"></button>`).join('');
function placeHelpStep(target){
  if(helpTour.hidden||!target)return;
  const rect=target.getBoundingClientRect(),padding=7;
  const top=Math.max(6,rect.top-padding),left=Math.max(6,rect.left-padding),right=Math.min(innerWidth-6,rect.right+padding),bottom=Math.min(innerHeight-6,rect.bottom+padding);
  helpSpotlight.style.cssText=`top:${top}px;left:${left}px;width:${Math.max(20,right-left)}px;height:${Math.max(20,bottom-top)}px`;
  const tipRect=helpTooltip.getBoundingClientRect(),gap=21;
  const putBelow=innerHeight-bottom>=tipRect.height+gap+8||top<tipRect.height+gap+8;
  const tipTop=Math.max(8,Math.min(innerHeight-tipRect.height-8,putBelow?bottom+gap:top-tipRect.height-gap));
  const targetCenter=Math.max(18,Math.min(innerWidth-18,(left+right)/2));
  const tipLeft=Math.max(12,Math.min(innerWidth-tipRect.width-12,targetCenter-tipRect.width/2));
  helpTooltip.style.top=`${tipTop}px`;helpTooltip.style.left=`${tipLeft}px`;
  helpArrow.className=`guided-arrow ${putBelow?'points-up':'points-down'}`;
  helpArrow.style.left=`${Math.max(tipLeft+18,Math.min(tipLeft+tipRect.width-42,targetCenter-12))}px`;
  helpArrow.style.top=`${putBelow?tipTop-14:tipTop+tipRect.height}px`;
}
function showHelpPage(index){
  helpPage=Math.max(0,Math.min(helpSteps.length-1,index));
  const step=helpSteps[helpPage],target=document.querySelector(step.target)||$('.library-heading');
  $('#helpStep').textContent=`${helpPage+1} OF ${helpSteps.length}`;$('#helpTitle').textContent=step.title;$('#helpText').textContent=step.text;
  [...helpDots.children].forEach((dot,dotIndex)=>dot.classList.toggle('active',dotIndex===helpPage));
  $('#helpBack').disabled=helpPage===0;$('#helpNext').textContent=helpPage===helpSteps.length-1?'Done':'Next';
  const token=++helpLayoutToken;
  const fixedTarget=target.closest('.topbar,.player');
  if(!fixedTarget)target.scrollIntoView({behavior:'smooth',block:'center',inline:'nearest'});
  requestAnimationFrame(()=>{if(token===helpLayoutToken)placeHelpStep(target)});
  setTimeout(()=>{if(token===helpLayoutToken)placeHelpStep(target)},350);
}
function openHelp(){
  helpPreviousFocus=document.activeElement;helpPreviousScroll=window.scrollY;helpTour.hidden=false;showHelpPage(0);trackAnalytics('help_open');$('#helpClose').focus();
}
function closeHelp(completed=false){
  if(helpTour.hidden)return;helpTour.hidden=true;helpLayoutToken++;window.scrollTo(0,helpPreviousScroll);if(completed)trackAnalytics('help_complete');helpPreviousFocus?.focus();
}
$('#helpBtn').addEventListener('click',openHelp);
$('#helpClose').addEventListener('click',()=>closeHelp(false));
$('#helpBack').addEventListener('click',()=>showHelpPage(helpPage-1));
$('#helpNext').addEventListener('click',()=>helpPage===helpSteps.length-1?closeHelp(true):showHelpPage(helpPage+1));
helpDots.addEventListener('click',event=>{const dot=event.target.closest('[data-help-page]');if(dot)showHelpPage(Number(dot.dataset.helpPage))});
helpTour.addEventListener('touchstart',event=>{helpTouchStart=event.changedTouches[0].clientX},{passive:true});
helpTour.addEventListener('touchend',event=>{const distance=event.changedTouches[0].clientX-helpTouchStart;if(Math.abs(distance)>45)showHelpPage(helpPage+(distance<0?1:-1))},{passive:true});
window.addEventListener('resize',()=>{if(!helpTour.hidden)showHelpPage(helpPage)});
window.addEventListener('scroll',()=>{if(!helpTour.hidden){const target=document.querySelector(helpSteps[helpPage].target)||$('.library-heading');placeHelpStep(target)}},{passive:true});
document.addEventListener('keydown',event=>{if(helpTour.hidden)return;if(event.key==='ArrowRight')showHelpPage(helpPage+1);else if(event.key==='ArrowLeft')showHelpPage(helpPage-1)});

// Open the tour once on the first launch from an installed app icon.
const HELP_FIRST_LAUNCH_KEY='rjs.helpTourInstalledSeen';
if(isInstalledApp()){
  let hasSeenInstalledHelp=false;
  try{
    hasSeenInstalledHelp=localStorage.getItem(HELP_FIRST_LAUNCH_KEY)==='1';
    if(!hasSeenInstalledHelp)localStorage.setItem(HELP_FIRST_LAUNCH_KEY,'1');
  }catch{}
  if(!hasSeenInstalledHelp)setTimeout(()=>{if(helpTour.hidden)openHelp()},350);
}
