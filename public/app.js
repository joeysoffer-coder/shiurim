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
function folderInfo(title=''){const normalized=title.trim().replace(/\s+/g,' ');const rule=FOLDER_RULES.find(([pattern])=>pattern.test(normalized));if(rule)return{name:capitalizeFolderLabel(rule[1]),forced:true};const words=normalized.split(' ').filter(Boolean),folderWords=[];let countedWords=0;for(const word of words){folderWords.push(word);if(word.toLocaleLowerCase()!=='and')countedWords+=1;if(countedWords===2)break}return{name:capitalizeFolderLabel(folderWords.join(' ')||'Other'),forced:false}}
function folderName(title=''){return folderInfo(title).name}
function libraryGroups(){const candidates=new Map();state.episodes.forEach(e=>{const info=folderInfo(e.title),key=info.name.toLocaleLowerCase();if(!candidates.has(key))candidates.set(key,{name:info.name,forced:info.forced,episodes:[]});const group=candidates.get(key);group.forced=group.forced||info.forced;group.episodes.push(e)});const folders=[...candidates.values()].filter(f=>f.forced||f.episodes.length>1).sort((a,b)=>collator.compare(a.name,b.name));const groupedIds=new Set(folders.flatMap(f=>f.episodes.map(e=>e.id)));return{folders,unique:state.episodes.filter(e=>!groupedIds.has(e.id))}}
function sortEpisodes(eps){const [field,dir]=$('#sortSelect').value.split('-');return [...eps].sort((a,b)=>{let n;if(field==='date')n=new Date(a.date)-new Date(b.date);else if(field==='file')n=collator.compare(filenameSortKey(a.fileName),filenameSortKey(b.fileName));else n=collator.compare(a.title,b.title);return dir==='desc'?-n:n})}
function sortFolders(folders){const [field,dir]=$('#sortSelect').value.split('-');return [...folders].sort((a,b)=>{if(field==='date'){const datesA=a.episodes.map(e=>new Date(e.date).getTime()).filter(Number.isFinite),datesB=b.episodes.map(e=>new Date(e.date).getTime()).filter(Number.isFinite);const valueA=dir==='desc'?Math.max(...datesA):Math.min(...datesA),valueB=dir==='desc'?Math.max(...datesB):Math.min(...datesB);return dir==='desc'?valueB-valueA:valueA-valueB}const compared=collator.compare(a.name,b.name);return dir==='desc'?-compared:compared})}
function searchText(value=''){return String(value).normalize('NFD').replace(/\p{Diacritic}/gu,'').toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu,' ').trim()}
function editDistance(a,b){if(a===b)return 0;if(!a.length)return b.length;if(!b.length)return a.length;let previous=Array.from({length:b.length+1},(_,i)=>i);for(let i=1;i<=a.length;i++){const current=[i];for(let j=1;j<=b.length;j++)current[j]=Math.min(current[j-1]+1,previous[j]+1,previous[j-1]+(a[i-1]===b[j-1]?0:1));previous=current}return previous[b.length]}
function fuzzyWordMatch(queryWord,textWord){if(queryWord===textWord)return 20;if(queryWord.length>=3&&textWord.startsWith(queryWord))return 16;if(textWord.length>=3&&queryWord.startsWith(textWord))return 16;const allowance=queryWord.length<=3?0:queryWord.length<=4?1:queryWord.length<=7?2:3,distance=editDistance(queryWord,textWord);return distance<=allowance?12-distance:0}
function episodeSearchScore(episode,query){const wanted=searchText(query),haystack=searchText(`${episode.title} ${episode.show} ${episode.fileName}`);if(!wanted)return 1;const exactIndex=haystack.indexOf(wanted);if(exactIndex>=0)return 1000-exactIndex;const queryWords=wanted.split(' ').filter(Boolean),textWords=haystack.split(' ').filter(Boolean);let score=0;for(const queryWord of queryWords){let best=0;for(const textWord of textWords)best=Math.max(best,fuzzyWordMatch(queryWord,textWord));if(!best)return 0;score+=best}return score}
function searchEpisodes(episodes,query){const normallySorted=sortEpisodes(episodes),order=new Map(normallySorted.map((episode,index)=>[episode.id,index]));return episodes.map(episode=>({episode,score:episodeSearchScore(episode,query)})).filter(item=>item.score>0).sort((a,b)=>(b.score-a.score)||((order.get(a.episode.id)||0)-(order.get(b.episode.id)||0))).map(item=>item.episode)}
function configuredFolderPaths(nodes=managedConfig.folders||[],prefix=[]){return nodes.flatMap(node=>{const path=[...prefix,node.name];return[path,...configuredFolderPaths(node.children||[],path)]})}
function searchableFolderPaths(){
  const paths=[...libraryGroups().folders.map(folder=>[folder.name]),...configuredFolderPaths()];
  state.episodes.forEach(episode=>{const assignment=managedAssignment(episode);if(assignment?.path)for(let length=1;length<=assignment.path.length;length++)paths.push(assignment.path.slice(0,length))});
  const unique=new Map(paths.filter(path=>path.length).map(path=>[path.join('\u0000').toLocaleLowerCase(),path]));
  return [...unique.values()];
}
function searchFolders(query){return searchableFolderPaths().map(path=>({path,score:episodeSearchScore({title:path.join(' '),show:'',fileName:''},query)})).filter(item=>item.score>0).sort((a,b)=>b.score-a.score||collator.compare(a.path.join(' '),b.path.join(' '))).map(item=>item.path)}
function episodeHTML(e,i){const p=state.positions[e.id]||{},pct=p.duration?Math.min(100,p.time/p.duration*100):0,played=pct>95,downloaded=state.downloaded.has(e.id),durationLabel=typeof e.duration==='number'?clock(e.duration):e.duration;return `<article class="episode" data-id="${esc(e.id)}"><span class="episode-number">${String(i+1).padStart(2,'0')}</span>${e.art?`<img class="art" src="${esc(e.art)}" alt="">`:'<div class="art"></div>'}<div><h3>${esc(e.title)}</h3><div class="meta">${esc(e.show)} · ${formatDate(e.date)}${durationLabel?' · '+esc(durationLabel):''}</div><div class="filename" title="${esc(e.fileName)}">${esc(e.fileName)}</div></div><div class="episode-state"><span class="availability ${downloaded?'is-downloaded':''}">${downloaded?'DOWNLOADED':'ONLINE'}</span><span class="played">${played?'PLAYED':pct?'<i class="dot"></i>IN PROGRESS':'UNPLAYED'}</span><div class="progress-track"><div class="progress-fill" style="width:${pct}%"></div></div><button class="download-btn" type="button" data-download="${esc(e.id)}">${downloaded?'Remove download':'Download'}</button></div></article>`}
function render(){const q=$('#searchInput').value.trim().toLocaleLowerCase(),groups=libraryGroups();if(q){const results=sortEpisodes(state.episodes.filter(e=>`${e.title} ${e.show} ${e.fileName}`.toLocaleLowerCase().includes(q)));$('#libraryTitle').textContent='Search results';$('#episodeCount').textContent=`${results.length} episode${results.length===1?'':'s'} across entire catalog`;list.innerHTML=results.length?results.map(episodeHTML).join(''):'<div class="empty">No episodes match your search.</div>';return}if(activeFolder){const folder=groups.folders.find(f=>f.name===activeFolder);if(!folder){activeFolder=null;return render()}const eps=sortEpisodes(folder.episodes);$('#libraryTitle').textContent=folder.name;$('#episodeCount').textContent=`${eps.length} episode${eps.length===1?'':'s'}`;list.innerHTML=`<button class="back-library" type="button" data-back>← All folders</button>${eps.length?eps.map(episodeHTML).join(''):'<div class="empty">This folder is empty.</div>'}`;return}$('#libraryTitle').textContent='Shiurim library';const folders=sortFolders(groups.folders),unique=sortEpisodes(groups.unique);$('#episodeCount').textContent=`${folders.length} folder${folders.length===1?'':'s'} · ${unique.length} individual`;const folderHTML=folders.length?`<div class="folder-grid">${folders.map(f=>{const newest=[...f.episodes].sort((a,b)=>new Date(b.date)-new Date(a.date))[0];return `<button class="folder-card" type="button" data-folder="${esc(f.name)}"><span class="folder-icon">▰</span><strong>${esc(f.name)}</strong><span>${f.episodes.length} episodes</span>${newest?`<small>Latest: ${formatDate(newest.date)}</small>`:'<small>Empty folder</small>'}</button>`}).join('')}</div>`:'';const uniqueHTML=unique.length?`<h3 class="section-label">Individual episodes</h3>${unique.map(episodeHTML).join('')}`:'';list.innerHTML=folderHTML+uniqueHTML||'<div class="empty">No episodes are available.</div>'}
function playEpisode(id,autoplay=true){const e=state.episodes.find(x=>x.id===id);if(!e)return;if(state.current?.id===id){if(autoplay)audio.play().catch(()=>setStatus('Press play to start listening.'));return}state.current=e;if(hlsPlayer){hlsPlayer.destroy();hlsPlayer=null}audio.removeAttribute('src');audio.load();$('#playerTitle').textContent=e.title;$('#playerShow').textContent=e.show;$('#playerArt').innerHTML=e.art?`<img src="${esc(e.art)}" alt="">`:'JS';$('#playerArt').querySelector('img')?.setAttribute('style','width:100%;height:100%;object-fit:cover');localStorage.setItem('wavecast.last',id);const resume=()=>{const saved=state.positions[id]?.time||0;if(saved&&isFinite(audio.duration))audio.currentTime=saved>=audio.duration*.95?0:Math.min(saved,Math.max(0,audio.duration-2));if(autoplay)audio.play().catch(()=>setStatus('Press play to start listening.'))};const playUrl=state.downloaded.has(id)?offlineUrl(id):e.audioUrl,isApiStream=playUrl.startsWith('/api/soundcloud/stream');if(isApiStream&&window.Hls?.isSupported()){hlsPlayer=new window.Hls({enableWorker:true});hlsPlayer.attachMedia(audio);hlsPlayer.on(window.Hls.Events.MEDIA_ATTACHED,()=>hlsPlayer.loadSource(playUrl));hlsPlayer.on(window.Hls.Events.MANIFEST_PARSED,resume);hlsPlayer.on(window.Hls.Events.ERROR,(_,data)=>{if(!data.fatal)return;if(data.type===window.Hls.ErrorTypes.NETWORK_ERROR)hlsPlayer.startLoad();else if(data.type===window.Hls.ErrorTypes.MEDIA_ERROR)hlsPlayer.recoverMediaError();else{hlsPlayer.destroy();hlsPlayer=null;setStatus('This older episode could not be played.')}})}else{audio.src=playUrl;audio.addEventListener('loadedmetadata',resume,{once:true})}}
function setStatus(s){$('#status').textContent=s.replace(/v\d+/g,'v69')} function esc(s=''){return String(s).replace(/[&<>\"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]))} function formatDate(d){const x=new Date(d);return isNaN(x)?'Unknown date':x.toLocaleDateString(undefined,{month:'short',day:'numeric',year:'numeric'})} function clock(s){if(!isFinite(s))return'0:00';return`${Math.floor(s/60)}:${String(Math.floor(s%60)).padStart(2,'0')}`}
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

// v52: server-managed folders, subfolders, rules, and manual episode assignments.
let managedConfig={folders:[],rules:[],overrides:{}},activeManagedPath=[],activeManagedSubfolder=null;
function wordsAroundMarker(title,marker,direction){
  const clean=title.trim().replace(/\s+/g,' '),lower=clean.toLocaleLowerCase(),needle=marker.trim().toLocaleLowerCase();
  const index=needle?lower.indexOf(needle):-1;
  if(index<0)return'Other';
  if(direction==='before')return capitalizeFolderLabel(clean.slice(0,index).replace(/[-–—:]+$/,'').trim()||'Other');
  return capitalizeFolderLabel(clean.slice(index+needle.length).replace(/^[-–—:\s]+/,'').split(/\s+/)[0]||'Other');
}
function managedAssignment(episode){
  const override=managedConfig.overrides?.[String(episode.id)];
  if(override?.path?.length)return{path:override.path};
  if(override?.folder)return{path:[override.folder,override.subfolder].filter(Boolean)};
  const title=episode.title||'',lower=title.toLocaleLowerCase();
  const originalFolder=folderInfo(title).name,folderKey=value=>String(value||'').normalize('NFD').replace(/\p{Diacritic}/gu,'').toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu,' ').trim();
  const moves=managedConfig.moves||[],move=moves.find(item=>item.source===originalFolder)||moves.find(item=>folderKey(item.source)===folderKey(originalFolder));
  if(move?.parentPath?.length){
    const path=[...move.parentPath,move.name||originalFolder];
    if(originalFolder==='Daf Yomi')path.push(dafFolderName(title));
    if(originalFolder==='Humash Rashi')path.push(rashiFolderName(title));
    if(originalFolder==="Hok L'Yisrael")path.push(hokFolderName(title));
    return{path};
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
    return path.length?{path}:null;
  }
  return null;
}
function managedLibraryGroups(){
  const candidates=new Map(),hidden=new Set(managedConfig.hiddenFolders||[]);
  const visibleEpisodes=state.episodes.filter(episode=>{const managed=managedAssignment(episode),root=managed?.path?.[0]||folderInfo(episode.title).name;return!hidden.has(root)&&!hidden.has(folderInfo(episode.title).name)});
  visibleEpisodes.forEach(episode=>{
    const managed=managedAssignment(episode),info=managed?{name:managed.path[0],forced:true}:folderInfo(episode.title),key=info.name.toLocaleLowerCase();
    if(!candidates.has(key))candidates.set(key,{name:info.name,forced:info.forced,episodes:[]});
    const group=candidates.get(key);group.forced=group.forced||info.forced;group.episodes.push(episode);
  });
  (managedConfig.folders||[]).filter(folder=>!hidden.has(folder.name)).forEach(folder=>{const key=folder.name.toLocaleLowerCase();if(!candidates.has(key))candidates.set(key,{name:folder.name,forced:true,episodes:[]})});
  const folders=[...candidates.values()].filter(folder=>folder.forced||folder.episodes.length>1).sort((a,b)=>collator.compare(a.name,b.name));
  const groupedIds=new Set(folders.flatMap(folder=>folder.episodes.map(episode=>episode.id)));
  return{folders,unique:visibleEpisodes.filter(episode=>!groupedIds.has(episode.id))};
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
  const folders=[...groups].sort((a,b)=>Math.max(...b[1].map(e=>new Date(e.date).getTime()||0))-Math.max(...a[1].map(e=>new Date(e.date).getTime()||0))||collator.compare(a[0],b[0]));
  $('#libraryTitle').textContent=activeFolder;
  $('#episodeCount').textContent=`${folders.length} folder${folders.length===1?'':'s'} · ${assigned.length} episodes`;
  list.innerHTML=`<button class="back-library" type="button" data-back>← All folders</button><div class="folder-grid">${folders.map(([name,episodes])=>`<button class="folder-card" type="button" data-managed-folder="${esc(name)}"><span class="folder-icon">▰</span><strong>${esc(name)}</strong><span>${episodes.length} episode${episodes.length===1?'':'s'}</span></button>`).join('')}</div>`;
}
async function loadManagedConfig(){
  try{
    const response=await fetch('/api/library-config',{cache:'no-store'});
    if(response.ok){managedConfig=await response.json();render()}
  }catch{}
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
refresh();

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
  shareLink({title:`${episode.title} by Rabbi Joey Soffer`,text:`*Today’s New Release*\n\nListen to ${episode.title} on RJS Torah`,url:url.toString()});
}
$('#shareAppBtn').addEventListener('click',()=>shareLink({
  title:'RJS Torah',
  text:'Listen to Rabbi Joey Soffer Shiurim on RJS Torah',
  url:location.origin
}));

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
  const folders=[...subfolders.entries()].sort((a,b)=>{const newestA=Math.max(...a[1].map(episode=>new Date(episode.date).getTime()).filter(Number.isFinite)),newestB=Math.max(...b[1].map(episode=>new Date(episode.date).getTime()).filter(Number.isFinite));return newestB-newestA||collator.compare(a[0],b[0])});
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
  const folders=[...subfolders.entries()].sort((a,b)=>{const newestA=Math.max(...a[1].map(episode=>new Date(episode.date).getTime()).filter(Number.isFinite)),newestB=Math.max(...b[1].map(episode=>new Date(episode.date).getTime()).filter(Number.isFinite));return newestB-newestA||collator.compare(a[0],b[0])});
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
  if(state.favorites.has(id))state.favorites.delete(id);else state.favorites.add(id);
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
  const folders=[...subfolders.entries()].sort((a,b)=>{const newestA=Math.max(...a[1].map(episode=>new Date(episode.date).getTime()).filter(Number.isFinite)),newestB=Math.max(...b[1].map(episode=>new Date(episode.date).getTime()).filter(Number.isFinite));return newestB-newestA||collator.compare(a[0],b[0])});
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
  const originalPath=episode=>{const root=folderInfo(episode.title).name,path=[root];if(root==='Daf Yomi')path.push(dafFolderName(episode.title));if(root==='Humash Rashi')path.push(rashiFolderName(episode.title));if(root==="Hok L'Yisrael")path.push(hokFolderName(episode.title));return path};
  const currentPath=[activeFolder,...activeManagedPath];
  let configuredNode=managedConfig.folders?.find(item=>item.name===activeFolder);
  for(const name of activeManagedPath){configuredNode=(configuredNode?.children||[]).find(item=>item.name===name)}
  const assigned=state.episodes.map(episode=>({episode,path:managedAssignment(episode)?.path||originalPath(episode)})).filter(item=>item.path.slice(0,currentPath.length).every((part,index)=>part===currentPath[index]));
  if(!configuredNode&&!assigned.length)return;
  const direct=sortEpisodes(assigned.filter(item=>item.path.length===currentPath.length).map(item=>item.episode));
  const children=new Map();
  assigned.filter(item=>item.path.length>currentPath.length).forEach(item=>{const name=item.path[currentPath.length];if(!children.has(name))children.set(name,[]);children.get(name).push(item.episode)});
  (configuredNode?.children||[]).forEach(child=>{if(!children.has(child.name))children.set(child.name,[])});
  const childFolders=[...children].sort((a,b)=>Math.max(...b[1].map(episode=>new Date(episode.date).getTime()||0))-Math.max(...a[1].map(episode=>new Date(episode.date).getTime()||0))||collator.compare(a[0],b[0]));
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
