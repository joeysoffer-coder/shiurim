const $=id=>document.getElementById(id);
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const cap=v=>String(v||'').trim().replace(/\b\w/g,c=>c.toUpperCase());
const pathValue=path=>encodeURIComponent(JSON.stringify(path));
const readPath=value=>{try{return JSON.parse(decodeURIComponent(value))}catch{return[]}};
let token=sessionStorage.getItem('rjsAdminToken')||'',config={folders:[],rules:[],moves:[],hiddenFolders:[],overrides:{}},episodes=[],selected=null,dirty=false;
let saveTimer=null,saving=false,changeRevision=0;
const auth=()=>({'Content-Type':'application/json',Authorization:`Bearer ${token}`});
const BUILTIN_RULES=[
  [/daf/i,'Daf Yomi','Title contains “daf”'],
  [/rashi/i,'Humash Rashi','Title contains “rashi”'],
  [/\bhok\s+l\s*['’]?\s*yisrael\b/i,"Hok L'Yisrael","Title contains “Hok L’Yisrael”"],
  [/inheritance/i,'Inheritance','Title contains “inheritance”'],[/neighbors/i,'Neighbors','Title contains “neighbors”'],
  [/brokerage/i,'Brokerage','Title contains “brokerage”'],[/shaare[\s-]*(?:teshuva|teshuba)/i,'Shaare Teshuva','Title contains “Shaare Teshuva”'],
  [/business[\s-]*halach(?:a)?/i,'Business Halacha','Title contains “Business Halacha”'],[/(?:pirkei|prikei)[\s-]*avot/i,'Pirkei Avot','Title contains “Pirkei Avot”'],
  [/mishlei/i,'Mishlei','Title contains “Mishlei”'],[/ignite/i,'Ignite Your Prayers','Title contains “ignite”'],[/(?:tzedaka|tezdaka)/i,'Tzedaka','Title contains “tzedaka”'],
  [/haggadah|haggada/i,'Haggadah Shel Pesah','Title contains “Haggadah”'],[/esther/i,'Megilat Esther','Title contains “Esther”'],
  [/batra/i,'Bava Batra','Title contains “Batra”'],[/kama/i,'Bava Kama','Title contains “Kama”'],[/interest/i,'Interest','Title contains “interest”'],
  [/debt/i,'Collecting Debt','Title contains “debt”'],[/loan/i,'Loans','Title contains “loan”'],[/law\s+of\s+(?:the\s+)?land/i,"Dina D'Malchuta",'Title contains “law of the land”'],
  [/theft\s+from/i,'Gezel Akum','Title contains “theft from”']
];

function normalizeTree(nodes=[]){return nodes.map(node=>({name:node.name,children:normalizeTree(node.children||(node.subfolders||[]).map(name=>({name})))}))}
function normalizeConfig(){
  config.folders=normalizeTree(config.folders||[]);
  config.rules=(config.rules||[]).map(rule=>({...rule,path:rule.path?.length?rule.path:[rule.folder,rule.subfolder].filter(Boolean)}));
  config.moves=config.moves||[];
  config.hiddenFolders=config.hiddenFolders||[];
  Object.values(config.overrides||{}).forEach(item=>{item.path=item.path?.length?item.path:[item.folder,item.subfolder].filter(Boolean)});
}
function findNode(path,nodes=config.folders){let list=nodes,node=null;for(const name of path){node=list.find(item=>item.name===name);if(!node)return null;list=node.children||=[]}return node}
function findParent(path){return path.length===1?{children:config.folders}:findNode(path.slice(0,-1))}
function allPaths(nodes=config.folders,prefix=[]){return nodes.flatMap(node=>{const path=[...prefix,node.name];return[path,...allPaths(node.children||[],path)]})}
function showAdmin(on){$('loginView').classList.toggle('hidden',on);$('adminView').classList.toggle('hidden',!on);$('logout').classList.toggle('hidden',!on)}
function changed(){dirty=true;changeRevision++;$('saveMessage').textContent='Saving automatically…';$('saveMessage').className='';clearTimeout(saveTimer);saveTimer=setTimeout(save,700)}
function destinationOptions(selected=[],excludedRoot=''){
  const chosen=JSON.stringify(selected);
  return destinationPaths().filter(path=>path[0]!==excludedRoot).map(path=>`<option value="${pathValue(path)}"${JSON.stringify(path)===chosen?' selected':''}>${esc(path.join(' › '))}</option>`).join('');
}
function refreshSelects(){
  const rule=readPath($('ruleFolder').value),assignment=readPath($('assignmentFolder').value);
  $('ruleFolder').innerHTML='<option value="">Choose a folder</option>'+destinationOptions(rule);
  $('assignmentFolder').innerHTML='<option value="">Choose a folder</option>'+destinationOptions(assignment);
}
function treeHTML(nodes=config.folders,prefix=[]){
  return nodes.map(node=>{
    const path=[...prefix,node.name],value=pathValue(path);
    return `<article class="folder-card tree-level" style="--depth:${path.length-1}">
      <div class="folder-head"><span class="folder-name">${esc(node.name)}</span><div class="small-actions">
        <button data-add-child="${value}">+ Inside</button><button data-rename="${value}">Rename</button><button class="danger" data-delete="${value}">Delete</button>
      </div></div>
      <div class="nested-tree">${treeHTML(node.children||[],path)}</div>
    </article>`;
  }).join('');
}
function renderFolders(){$('folderList').innerHTML=config.folders.length?treeHTML():'<p>No custom folders yet.</p>';refreshSelects()}
function currentFolderName(title=''){
  const clean=String(title).trim().replace(/\s+/g,' '),matched=BUILTIN_RULES.find(([pattern])=>pattern.test(clean));
  if(matched)return matched[1];
  const words=clean.split(' ').filter(Boolean),selected=[];let count=0;
  for(const word of words){selected.push(word);if(word.toLowerCase()!=='and')count++;if(count===2)break}
  return cap(selected.join(' ')||'Other');
}
function currentFolders(){
  const groups=new Map();
  episodes.forEach(episode=>{const name=currentFolderName(episode.title);if(!groups.has(name))groups.set(name,[]);groups.get(name).push(episode)});
  const forced=new Set(BUILTIN_RULES.map(rule=>rule[1]));
  return [...groups].filter(([name,items])=>forced.has(name)||items.length>1).sort((a,b)=>a[0].localeCompare(b[0],undefined,{numeric:true,sensitivity:'base'}));
}
function dafAdminFolder(title=''){const clean=String(title).trim().replace(/\s+/g,' '),match=clean.match(/\bdaf\b/i)||clean.match(/daf/i),before=(match?clean.slice(0,match.index):clean).trim();return cap(before.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu,'').trim()||'Daf Yomi')}
function rashiAdminFolder(title=''){return cap(String(title).trim().split(/\s+/)[0]?.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu,'')||'Other')}
function hokAdminFolder(title=''){const match=String(title).match(/\bhok\s+l\s*['’]?\s*yisrael\b\s*[-–—:]?\s*([^\s]+)/i),word=match?.[1]?.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu,'')||'Other';return cap(word)}
function destinationPaths(){
  const paths=[...allPaths(),...currentFolders().map(([name])=>[name])];
  episodes.forEach(episode=>{const root=currentFolderName(episode.title);if(root==='Daf Yomi')paths.push([root,dafAdminFolder(episode.title)]);if(root==='Humash Rashi')paths.push([root,rashiAdminFolder(episode.title)]);if(root==="Hok L'Yisrael")paths.push([root,hokAdminFolder(episode.title)])});
  (config.moves||[]).forEach(move=>paths.push([...move.parentPath,move.name||move.source]));
  const unique=new Map(paths.filter(path=>path.length).map(path=>[path.join('\u0000').toLowerCase(),path]));
  return [...unique.values()].sort((a,b)=>a.join(' ').localeCompare(b.join(' '),undefined,{numeric:true,sensitivity:'base'}));
}
function renderCurrentFolders(){
  const folders=currentFolders();
  $('currentFolderList').innerHTML=folders.length?folders.map(([name,items])=>{
    const move=config.moves.find(item=>item.source===name),hidden=config.hiddenFolders.includes(name),selected=move?.parentPath||[],location=hidden?'Removed from listening app':move?`${move.parentPath.join(' › ')} › ${move.name||name}`:'Home screen';
    return `<article class="current-folder"><div><strong>${esc(name)}</strong><small>${items.length} episodes · Currently: ${esc(location)}</small></div>
      <div class="move-controls"><select data-move-parent="${esc(name)}"><option value="">Move inside…</option>${destinationOptions(selected,name)}</select><input data-move-name="${esc(name)}" value="${esc(move?.name||name)}" aria-label="Folder name after move"><button data-move-folder="${esc(name)}">Move</button>${move?`<button class="danger" data-unmove-folder="${esc(name)}">Undo move</button>`:''}${hidden?`<button data-restore-folder="${esc(name)}">Restore folder</button>`:`<button class="danger" data-hide-folder="${esc(name)}">Remove from app</button>`}</div></article>`;
  }).join(''):'<p>No catalog folders found.</p>';
  const currentNames=new Set(folders.map(([name])=>name)),staleMoves=config.moves.filter(move=>!currentNames.has(move.source));
  if(staleMoves.length)$('currentFolderList').insertAdjacentHTML('beforeend',`<div class="card"><h3>Moves needing attention</h3><p class="sub">These saved names no longer exactly match a current folder.</p>${staleMoves.map(move=>`<div class="built-in-rule"><span><strong>${esc(move.source)}</strong><br>Destination: ${esc(move.parentPath.join(' › '))}</span><button class="danger" data-unmove-folder="${esc(move.source)}">Remove stale move</button></div>`).join('')}</div>`);
}
function renderBuiltInRules(){
  $('builtInRuleList').innerHTML=BUILTIN_RULES.map(([,folder,label])=>`<div class="built-in-rule"><strong>${esc(folder)}</strong><span>${esc(label)}</span></div>`).join('');
}
function renderRules(){
  $('ruleList').innerHTML=config.rules.length?config.rules.map((rule,index)=>`<article class="rule-card"><div class="rule-head"><div><strong>Title contains “${esc(rule.contains)}”</strong><br><small>Destination: ${esc((rule.path||[]).join(' › '))}${rule.strategy!=='none'?` · Adds: ${esc(rule.strategy.replaceAll('_',' '))}`:''}</small></div><button class="danger" data-delete-rule="${index}">Delete</button></div></article>`).join(''):'<p>No custom rules yet.</p>';
}
function replacePathPrefix(oldPath,newPath){
  const replace=path=>path?.slice(0,oldPath.length).every((part,i)=>part===oldPath[i])?[...newPath,...path.slice(oldPath.length)]:path;
  config.rules.forEach(rule=>rule.path=replace(rule.path));
  Object.values(config.overrides).forEach(item=>item.path=replace(item.path));
}
async function login(){
  $('loginMessage').textContent='Signing in…';
  try{const response=await fetch('/api/admin/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({password:$('password').value})}),data=await response.json();if(!response.ok)throw Error(data.error||'Incorrect password');token=data.token;sessionStorage.setItem('rjsAdminToken',token);await load()}catch(error){$('loginMessage').textContent=error.message}
}
async function load(){
  const response=await fetch('/api/admin/config',{headers:auth()});
  if(!response.ok){sessionStorage.removeItem('rjsAdminToken');token='';showAdmin(false);return}
  config=await response.json();normalizeConfig();showAdmin(true);renderFolders();renderRules();renderBuiltInRules();
  try{const data=await(await fetch('/api/soundcloud/episodes')).json();episodes=Array.isArray(data)?data:(data.episodes||[])}catch{}
  refreshSelects();renderCurrentFolders();
}
async function save(){
  clearTimeout(saveTimer);
  if(saving){saveTimer=setTimeout(save,500);return}
  saving=true;
  const revision=changeRevision,payload=JSON.stringify(config);
  $('saveMessage').textContent='Saving…';
  try{
    const response=await fetch('/api/admin/config',{method:'PUT',headers:auth(),body:payload}),data=await response.json().catch(()=>({}));
    if(!response.ok){$('saveMessage').textContent=data.error||'Could not save.';return}
    if(revision===changeRevision){config=data;normalizeConfig();dirty=false;$('saveMessage').textContent='Saved. The listener app is updated.';$('saveMessage').className='ok';renderFolders();renderRules();renderCurrentFolders()}
    else saveTimer=setTimeout(save,100);
  }finally{saving=false}
}

document.querySelector('.tabs').onclick=event=>{if(!event.target.dataset.panel)return;document.querySelectorAll('.tab').forEach(tab=>tab.classList.toggle('active',tab===event.target));document.querySelectorAll('.panel').forEach(panel=>panel.classList.add('hidden'));$(`${event.target.dataset.panel}Panel`).classList.remove('hidden')};
$('login').onclick=login;$('password').onkeydown=e=>{if(e.key==='Enter')login()};$('saveAll').onclick=save;
$('logout').onclick=()=>{sessionStorage.removeItem('rjsAdminToken');token='';showAdmin(false)};
$('addFolder').onclick=()=>{const name=cap($('newFolder').value);if(!name||config.folders.some(f=>f.name.toLowerCase()===name.toLowerCase()))return;config.folders.push({name,children:[]});$('newFolder').value='';changed();renderFolders()};
$('folderList').onclick=event=>{
  const add=event.target.dataset.addChild,rename=event.target.dataset.rename,remove=event.target.dataset.delete;
  if(add){const path=readPath(add),node=findNode(path),name=cap(prompt(`New folder inside “${path.at(-1)}”`));if(!node||!name)return;node.children||=[];if(!node.children.some(child=>child.name.toLowerCase()===name.toLowerCase()))node.children.push({name,children:[]})}
  else if(rename){const oldPath=readPath(rename),node=findNode(oldPath),name=cap(prompt('New folder name',node?.name));if(!node||!name||name===node.name)return;node.name=name;replacePathPrefix(oldPath,[...oldPath.slice(0,-1),name])}
  else if(remove){const path=readPath(remove),parent=findParent(path);if(!parent||!confirm(`Delete “${path.at(-1)}” and everything inside it?`))return;parent.children=parent.children.filter(child=>child.name!==path.at(-1));config.rules=config.rules.filter(rule=>!rule.path?.slice(0,path.length).every((part,i)=>part===path[i]));config.moves=config.moves.filter(move=>!move.parentPath?.slice(0,path.length).every((part,i)=>part===path[i]));Object.keys(config.overrides).forEach(id=>{const p=config.overrides[id].path;if(p?.slice(0,path.length).every((part,i)=>part===path[i]))delete config.overrides[id]})}
  else return;
  changed();renderFolders();renderRules();
};
$('currentFolderList').onclick=event=>{
  const source=event.target.dataset.moveFolder,undo=event.target.dataset.unmoveFolder,hide=event.target.dataset.hideFolder,restore=event.target.dataset.restoreFolder;
  if(source){
    const select=document.querySelector(`[data-move-parent="${CSS.escape(source)}"]`),nameInput=document.querySelector(`[data-move-name="${CSS.escape(source)}"]`),parentPath=readPath(select?.value);
    if(!parentPath.length)return alert('Choose the master folder where this folder should go.');
    const previous=config.moves.find(item=>item.source===source),oldPath=previous?[...previous.parentPath,previous.name||source]:[source],newName=cap(nameInput?.value)||source,newPath=[...parentPath,newName];
    const replace=path=>{
      if(path?.slice(0,oldPath.length).every((part,index)=>part===oldPath[index]))return[...newPath,...path.slice(oldPath.length)];
      if(path?.[0]===source)return[...newPath,...path.slice(1)];
      return path;
    };
    config.moves.forEach(item=>{if(item.source!==source)item.parentPath=replace(item.parentPath)});
    config.rules.forEach(rule=>rule.path=replace(rule.path));
    Object.values(config.overrides).forEach(item=>item.path=replace(item.path));
    config.moves=config.moves.filter(item=>item.source!==source);config.moves.push({source,name:newName,parentPath});
    config.hiddenFolders=config.hiddenFolders.filter(name=>name!==source);changed();renderCurrentFolders();
  }
  else if(undo){
    const previous=config.moves.find(item=>item.source===undo),oldPath=previous?[...previous.parentPath,previous.name||undo]:[undo],newPath=[undo];
    const replace=path=>path?.slice(0,oldPath.length).every((part,index)=>part===oldPath[index])?[...newPath,...path.slice(oldPath.length)]:path;
    config.moves.forEach(item=>{if(item.source!==undo)item.parentPath=replace(item.parentPath)});
    config.rules.forEach(rule=>rule.path=replace(rule.path));Object.values(config.overrides).forEach(item=>item.path=replace(item.path));
    config.moves=config.moves.filter(item=>item.source!==undo);changed();renderCurrentFolders();
  }
  else if(hide){if(!confirm(`Remove “${hide}” from the listening app? Its classes will remain available in search.`))return;config.moves=config.moves.filter(item=>item.source!==hide);if(!config.hiddenFolders.includes(hide))config.hiddenFolders.push(hide);changed();renderCurrentFolders()}
  else if(restore){config.hiddenFolders=config.hiddenFolders.filter(name=>name!==restore);changed();renderCurrentFolders()}
};
$('ruleStrategy').onchange=()=>{const value=$('ruleStrategy').value;$('markerWrap').classList.toggle('hidden',!['word_after','before_word'].includes(value));$('fixedWrap').classList.toggle('hidden',value!=='fixed')};
$('addRule').onclick=()=>{const contains=$('ruleContains').value.trim(),path=readPath($('ruleFolder').value);if(!contains||!path.length)return alert('Enter title words and choose a destination.');config.rules.unshift({id:crypto.randomUUID(),contains,path,strategy:$('ruleStrategy').value,marker:$('ruleMarker').value.trim(),subfolder:cap($('ruleSubfolder').value)});$('ruleContains').value=$('ruleMarker').value=$('ruleSubfolder').value='';changed();renderRules()};
$('ruleList').onclick=e=>{if(e.target.dataset.deleteRule===undefined)return;config.rules.splice(+e.target.dataset.deleteRule,1);changed();renderRules()};
$('episodeSearch').oninput=()=>{const query=$('episodeSearch').value.trim().toLowerCase();if(query.length<2){$('episodeResults').innerHTML='<p>Type at least two letters.</p>';return}const found=episodes.filter(e=>e.title.toLowerCase().includes(query)).slice(0,40);$('episodeResults').innerHTML=found.length?found.map(e=>`<button class="result" data-episode="${esc(e.id)}">${esc(e.title)}<small>${new Date(e.date||e.pubDate||0).toLocaleDateString()}</small></button>`).join(''):'<p>No matching classes found.</p>'};
$('episodeResults').onclick=e=>{const button=e.target.closest('[data-episode]');if(!button)return;selected=episodes.find(item=>String(item.id)===button.dataset.episode);if(!selected)return;const current=config.overrides[String(selected.id)]||{};$('selectedTitle').textContent=selected.title;$('assignmentFolder').innerHTML='<option value="">Choose a folder</option>'+destinationOptions(current.path||[]);$('assignmentCard').classList.remove('hidden');$('assignmentCard').scrollIntoView({behavior:'smooth'})};
$('saveAssignment').onclick=()=>{const path=readPath($('assignmentFolder').value);if(!selected||!path.length)return alert('Choose a destination.');config.overrides[String(selected.id)]={path};changed()};
$('removeAssignment').onclick=()=>{if(!selected)return;delete config.overrides[String(selected.id)];$('assignmentFolder').value='';changed()};
window.addEventListener('beforeunload',event=>{if(dirty){event.preventDefault();event.returnValue=''}});
token?load():showAdmin(false);
