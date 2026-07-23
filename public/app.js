import Hls from '/vendor/hls.mjs?v=1.6.16';
window.Hls = Hls;
document.documentElement.dataset.hls = Hls?.isSupported?.() ? 'supported' : 'native';

const DEFAULT_FEED='https://feeds.soundcloud.com/users/soundcloud:users:1044681742/sounds.rss';
const $=s=>document.querySelector(s); const collator=new Intl.Collator(undefined,{numeric:true,sensitivity:'base'});
const state={feeds:JSON.parse(localStorage.getItem('wavecast.feeds')||JSON.stringify([DEFAULT_FEED])),episodes:JSON.parse(localStorage.getItem('wavecast.episodes')||'[]'),positions:JSON.parse(localStorage.getItem('wavecast.positions')||'{}'),downloaded:new Set(JSON.parse(localStorage.getItem('wavecast.downloaded')||'[]')),current:null};
const audio=$('#audio'), list=$('#episodeList'); let activeFolder=null,hlsPlayer=null; $('#feedInput').value=DEFAULT_FEED;
const save=()=>{localStorage.setItem('wavecast.feeds',JSON.stringify(state.feeds));localStorage.setItem('wavecast.episodes',JSON.stringify(state.episodes));localStorage.setItem('wavecast.positions',JSON.stringify(state.positions));localStorage.setItem('wavecast.downloaded',JSON.stringify([...state.downloaded]));};
const text=(node,name)=>node.querySelector(name)?.textContent?.trim()||'';
const filename=url=>{try{return decodeURIComponent(new URL(url).pathname.split('/').pop()||'audio')}catch{return url}};
const filenameSortKey=name=>name.replace(/^\d+-joey-soffer-\d+-/i,'').replace(/^\d+[-_ ]+/,'');
const DOWNLOAD_CACHE='js-torah-downloads-v1';
const offlineUrl=id=>`/offline/audio/${encodeURIComponent(id)}`;
const trackIdFor=e=>String(e.id||'').match(/tracks\/(\d+)/)?.[1]||String(e.audioUrl||'').match(/[?&]id=(\d+)/)?.[1]||'';
async function toggleDownload(id,button){const episode=state.episodes.find(e=>e.id===id);if(!episode||!('caches'in window)){setStatus('Offline downloads are not supported on this device.');return}button.disabled=true;try{const cache=await caches.open(DOWNLOAD_CACHE),key=offlineUrl(id);if(state.downloaded.has(id)){await cache.delete(key);state.downloaded.delete(id);setStatus('Download removed from this device.')}else{const trackId=trackIdFor(episode);if(!trackId)throw new Error('This episode cannot be downloaded');setStatus(`Downloading ${episode.title}…`);const response=await fetch(`/api/soundcloud/download?id=${trackId}`);if(!response.ok)throw new Error(await response.text());await cache.put(key,response);state.downloaded.add(id);setStatus('Episode downloaded for offline listening.')}save();render()}catch(error){setStatus(`Download failed: ${error.message}`)}finally{button.disabled=false}}
function parseFeed(xml,feedUrl){const doc=new DOMParser().parseFromString(xml,'application/xml');if(doc.querySelector('parsererror'))throw new Error('That feed could not be read.');const channel=doc.querySelector('channel');const show=text(channel,'title');const showArt=channel.querySelector('image url')?.textContent||channel.querySelector('itunes\\:image')?.getAttribute('href')||'';return [...doc.querySelectorAll('item')].map((item,i)=>{const enc=item.querySelector('enclosure');const url=enc?.getAttribute('url')||'';const guid=text(item,'guid')||url||`${feedUrl}-${i}`;return{id:guid,title:text(item,'title')||'Untitled episode',show,date:text(item,'pubDate'),audioUrl:url,fileName:filename(url),duration:text(item,'itunes\\:duration'),art:item.querySelector('itunes\\:image')?.getAttribute('href')||showArt,feedUrl};}).filter(e=>e.audioUrl)}
async function refresh(){setStatus('Refreshing complete SoundCloud catalog…');$('#refreshBtn').disabled=true;try{let apiEpisodes=[],rssEpisodes=[],apiWorked=false;try{const api=await fetch('/api/soundcloud/episodes');if(!api.ok)throw new Error(await api.text());const payload=await api.json();apiEpisodes=Array.isArray(payload)?payload:payload.episodes;apiWorked=true}catch(apiError){}try{const batches=await Promise.all(state.feeds.map(async feed=>{const r=await fetch(`/api/feed?url=${encodeURIComponent(feed)}`);if(!r.ok)throw new Error(await r.text());return parseFeed(await r.text(),feed)}));rssEpisodes=batches.flat()}catch(rssError){if(!apiWorked)throw rssError}const incoming=[...apiEpisodes,...rssEpisodes],map=new Map(state.episodes.map(e=>[e.id,e]));incoming.forEach(e=>map.set(e.id,{...map.get(e.id),...e}));state.episodes=[...map.values()];save();render();setStatus(`${apiWorked?'Complete SoundCloud catalog':'RSS fallback (SoundCloud API unavailable)'} · ${state.episodes.length} episodes · v9`);}catch(e){setStatus(`Couldn’t refresh: ${e.message} · v9`);render();}finally{$('#refreshBtn').disabled=false}}
const FOLDER_RULES=[
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
function folderInfo(title=''){const normalized=title.trim().replace(/\s+/g,' ');const rule=FOLDER_RULES.find(([pattern])=>pattern.test(normalized));if(rule)return{name:rule[1],forced:true};const words=normalized.split(' ').filter(Boolean);return{name:words.slice(0,2).join(' ')||'Other',forced:false}}
function folderName(title=''){return folderInfo(title).name}
function libraryGroups(){const candidates=new Map();state.episodes.forEach(e=>{const info=folderInfo(e.title),key=info.name.toLocaleLowerCase();if(!candidates.has(key))candidates.set(key,{name:info.name,forced:info.forced,episodes:[]});const group=candidates.get(key);group.forced=group.forced||info.forced;group.episodes.push(e)});const folders=[...candidates.values()].filter(f=>f.forced||f.episodes.length>1).sort((a,b)=>collator.compare(a.name,b.name));const groupedIds=new Set(folders.flatMap(f=>f.episodes.map(e=>e.id)));return{folders,unique:state.episodes.filter(e=>!groupedIds.has(e.id))}}
function sortEpisodes(eps){const [field,dir]=$('#sortSelect').value.split('-');return [...eps].sort((a,b)=>{let n;if(field==='date')n=new Date(a.date)-new Date(b.date);else if(field==='file')n=collator.compare(filenameSortKey(a.fileName),filenameSortKey(b.fileName));else n=collator.compare(a.title,b.title);return dir==='desc'?-n:n})}
function sortFolders(folders){const [field,dir]=$('#sortSelect').value.split('-');return [...folders].sort((a,b)=>{if(field==='date'){const datesA=a.episodes.map(e=>new Date(e.date).getTime()).filter(Number.isFinite),datesB=b.episodes.map(e=>new Date(e.date).getTime()).filter(Number.isFinite);const valueA=dir==='desc'?Math.max(...datesA):Math.min(...datesA),valueB=dir==='desc'?Math.max(...datesB):Math.min(...datesB);return dir==='desc'?valueB-valueA:valueA-valueB}const compared=collator.compare(a.name,b.name);return dir==='desc'?-compared:compared})}
function episodeHTML(e,i){const p=state.positions[e.id]||{},pct=p.duration?Math.min(100,p.time/p.duration*100):0,played=pct>95,downloaded=state.downloaded.has(e.id),durationLabel=typeof e.duration==='number'?clock(e.duration):e.duration;return `<article class="episode" data-id="${esc(e.id)}"><span class="episode-number">${String(i+1).padStart(2,'0')}</span>${e.art?`<img class="art" src="${esc(e.art)}" alt="">`:'<div class="art"></div>'}<div><h3>${esc(e.title)}</h3><div class="meta">${esc(e.show)} · ${formatDate(e.date)}${durationLabel?' · '+esc(durationLabel):''}</div><div class="filename" title="${esc(e.fileName)}">${esc(e.fileName)}</div></div><div class="episode-state"><span class="availability ${downloaded?'is-downloaded':''}">${downloaded?'DOWNLOADED':'ONLINE'}</span><span class="played">${played?'PLAYED':pct?'<i class="dot"></i>IN PROGRESS':'UNPLAYED'}</span><div class="progress-track"><div class="progress-fill" style="width:${pct}%"></div></div><button class="download-btn" type="button" data-download="${esc(e.id)}">${downloaded?'Remove download':'Download'}</button></div></article>`}
function render(){const q=$('#searchInput').value.trim().toLocaleLowerCase(),groups=libraryGroups();if(q){const results=sortEpisodes(state.episodes.filter(e=>`${e.title} ${e.show} ${e.fileName}`.toLocaleLowerCase().includes(q)));$('#libraryTitle').textContent='Search results';$('#episodeCount').textContent=`${results.length} episode${results.length===1?'':'s'} across entire catalog`;list.innerHTML=results.length?results.map(episodeHTML).join(''):'<div class="empty">No episodes match your search.</div>';return}if(activeFolder){const folder=groups.folders.find(f=>f.name===activeFolder);if(!folder){activeFolder=null;return render()}const eps=sortEpisodes(folder.episodes);$('#libraryTitle').textContent=folder.name;$('#episodeCount').textContent=`${eps.length} episode${eps.length===1?'':'s'}`;list.innerHTML=`<button class="back-library" type="button" data-back>← All folders</button>${eps.length?eps.map(episodeHTML).join(''):'<div class="empty">This folder is empty.</div>'}`;return}$('#libraryTitle').textContent='Shiurim library';const folders=sortFolders(groups.folders),unique=sortEpisodes(groups.unique);$('#episodeCount').textContent=`${folders.length} folder${folders.length===1?'':'s'} · ${unique.length} individual`;const folderHTML=folders.length?`<div class="folder-grid">${folders.map(f=>{const newest=[...f.episodes].sort((a,b)=>new Date(b.date)-new Date(a.date))[0];return `<button class="folder-card" type="button" data-folder="${esc(f.name)}"><span class="folder-icon">▰</span><strong>${esc(f.name)}</strong><span>${f.episodes.length} episodes</span><small>Latest: ${formatDate(newest.date)}</small></button>`}).join('')}</div>`:'';const uniqueHTML=unique.length?`<h3 class="section-label">Individual episodes</h3>${unique.map(episodeHTML).join('')}`:'';list.innerHTML=folderHTML+uniqueHTML||'<div class="empty">No episodes are available.</div>'}
function playEpisode(id,autoplay=true){const e=state.episodes.find(x=>x.id===id);if(!e)return;if(state.current?.id===id){if(autoplay)audio.play().catch(()=>setStatus('Press play to start listening.'));return}state.current=e;if(hlsPlayer){hlsPlayer.destroy();hlsPlayer=null}audio.removeAttribute('src');audio.load();$('#playerTitle').textContent=e.title;$('#playerShow').textContent=e.show;$('#playerArt').innerHTML=e.art?`<img src="${esc(e.art)}" alt="">`:'JS';$('#playerArt').querySelector('img')?.setAttribute('style','width:100%;height:100%;object-fit:cover');localStorage.setItem('wavecast.last',id);const resume=()=>{const saved=state.positions[id]?.time||0;if(saved&&isFinite(audio.duration))audio.currentTime=Math.min(saved,Math.max(0,audio.duration-2));if(autoplay)audio.play().catch(()=>setStatus('Press play to start listening.'))};const playUrl=state.downloaded.has(id)?offlineUrl(id):e.audioUrl,isApiStream=playUrl.startsWith('/api/soundcloud/stream');if(isApiStream&&window.Hls?.isSupported()){hlsPlayer=new window.Hls({enableWorker:true});hlsPlayer.attachMedia(audio);hlsPlayer.on(window.Hls.Events.MEDIA_ATTACHED,()=>hlsPlayer.loadSource(playUrl));hlsPlayer.on(window.Hls.Events.MANIFEST_PARSED,resume);hlsPlayer.on(window.Hls.Events.ERROR,(_,data)=>{if(!data.fatal)return;if(data.type===window.Hls.ErrorTypes.NETWORK_ERROR)hlsPlayer.startLoad();else if(data.type===window.Hls.ErrorTypes.MEDIA_ERROR)hlsPlayer.recoverMediaError();else{hlsPlayer.destroy();hlsPlayer=null;setStatus('This older episode could not be played.')}})}else{audio.src=playUrl;audio.addEventListener('loadedmetadata',resume,{once:true})}}
function setStatus(s){$('#status').textContent=s.replace(/v9/g,'v23')} function esc(s=''){return String(s).replace(/[&<>\"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]))} function formatDate(d){const x=new Date(d);return isNaN(x)?'Unknown date':x.toLocaleDateString(undefined,{month:'short',day:'numeric',year:'numeric'})} function clock(s){if(!isFinite(s))return'0:00';return`${Math.floor(s/60)}:${String(Math.floor(s%60)).padStart(2,'0')}`}
history.replaceState({view:'home'},'');
list.addEventListener('click',event=>{const download=event.target.closest('[data-download]'),folder=event.target.closest('[data-folder]'),back=event.target.closest('[data-back]');if(download){event.preventDefault();event.stopImmediatePropagation();toggleDownload(download.dataset.download,download);return}if(folder){history.pushState({view:'folder',folder:folder.dataset.folder},'');return}if(back){event.preventDefault();event.stopImmediatePropagation();history.back()}},true);
$('#searchInput').addEventListener('input',event=>{const query=event.target.value;if(query){if(history.state?.view!=='search')history.pushState({view:'search',query},'');else history.replaceState({...history.state,query},'')}else if(history.state?.view==='search')history.back()});
window.addEventListener('popstate',event=>{activeFolder=event.state?.view==='folder'?event.state.folder:null;$('#searchInput').value=event.state?.view==='search'?event.state.query||'':'';render()});
list.addEventListener('click',e=>{const folder=e.target.closest('[data-folder]'),back=e.target.closest('[data-back]'),row=e.target.closest('.episode');if(folder){activeFolder=folder.dataset.folder;$('#searchInput').value='';render()}else if(back){activeFolder=null;$('#searchInput').value='';render()}else if(row)playEpisode(row.dataset.id)});$('#searchInput').addEventListener('input',render);$('#sortSelect').addEventListener('input',render);$('#sortSelect').addEventListener('change',render);$('#refreshBtn').addEventListener('click',refresh);$('#addFeedBtn').addEventListener('click',()=>{const url=$('#feedInput').value.trim();try{new URL(url);if(!state.feeds.includes(url))state.feeds.push(url);save();refresh()}catch{setStatus('Enter a valid RSS feed URL.')}});$('#playBtn').onclick=()=>state.current?(audio.paused?audio.play():audio.pause()):state.episodes[0]&&playEpisode(state.episodes[0].id);$('#backBtn').onclick=()=>audio.currentTime=Math.max(0,audio.currentTime-15);$('#forwardBtn').onclick=()=>audio.currentTime=Math.min(audio.duration||Infinity,audio.currentTime+30);$('#speedSelect').onchange=e=>audio.playbackRate=Number(e.target.value);$('#seek').oninput=e=>{if(audio.duration)audio.currentTime=audio.duration*Number(e.target.value)/100};audio.addEventListener('play',()=>{$('#playBtn').textContent='Ⅱ';$('#playBtn').ariaLabel='Pause';setStatus('Playing · v9')});audio.addEventListener('pause',()=>{$('#playBtn').textContent='▶';$('#playBtn').ariaLabel='Play'});audio.addEventListener('error',()=>setStatus('This episode could not be played. Refresh the catalog and try again. · v9'));audio.addEventListener('timeupdate',()=>{if(!state.current)return;$('#currentTime').textContent=clock(audio.currentTime);$('#duration').textContent=clock(audio.duration);$('#seek').value=audio.duration?audio.currentTime/audio.duration*100:0;state.positions[state.current.id]={time:audio.currentTime,duration:audio.duration||state.positions[state.current.id]?.duration||0};if(Math.floor(audio.currentTime)%5===0){save();render()}});window.addEventListener('beforeunload',save);document.addEventListener('keydown',e=>{if(['INPUT','SELECT','TEXTAREA'].includes(e.target.tagName))return;if(e.code==='Space'){e.preventDefault();$('#playBtn').click()}else if(e.code==='ArrowLeft'){e.preventDefault();audio.currentTime=Math.max(0,audio.currentTime-15)}else if(e.code==='ArrowRight'){e.preventDefault();audio.currentTime=Math.min(audio.duration||Infinity,audio.currentTime+30)}});
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

// v25: today's newly published classes stay above the folders for this calendar day.
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
  const todays=sortEpisodes(todayEpisodes());
  if(!todays.length)return;
  list.insertAdjacentHTML('afterbegin',`<section class="todays-classes" aria-labelledby="todaysClassesTitle"><div class="today-heading"><div><p class="eyebrow">NEW TODAY</p><h3 id="todaysClassesTitle">Today’s Classes</h3></div><span>${todays.length} ${todays.length===1?'class':'classes'}</span></div>${todays.map(episodeHTML).join('')}</section>`);
  const groups=libraryGroups();
  $('#episodeCount').textContent=`${todays.length} today · ${groups.folders.length} folder${groups.folders.length===1?'':'s'} · ${groups.unique.length} individual`;
};
render();
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
