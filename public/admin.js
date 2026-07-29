const $=id=>document.getElementById(id);
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const cap=v=>String(v||'').trim().replace(/\b\w/g,c=>c.toUpperCase());
const pathValue=path=>encodeURIComponent(JSON.stringify(path));
const readPath=value=>{try{return JSON.parse(decodeURIComponent(value))}catch{return[]}};
let token=sessionStorage.getItem('rjsAdminToken')||'',config={folders:[],rules:[],moves:[],hiddenFolders:[],hiddenPaths:[],pathTransforms:[],disabledBuiltInRules:[],builtInRuleEdits:{},overrides:{}},episodes=[],selected=null,dirty=false;
let saveTimer=null,saving=false,changeRevision=0;
let derivedCache={folderNames:new Map(),assignments:new Map(),currentFolders:null,unfiled:null,listeningPaths:null,destinationPaths:null};
function invalidateDerived(){derivedCache={folderNames:new Map(),assignments:new Map(),currentFolders:null,unfiled:null,listeningPaths:null,destinationPaths:null}}
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
const BUILTIN_MATCH_TEXT={
  'Daf Yomi':'daf','Humash Rashi':'rashi',"Hok L'Yisrael":"Hok L'Yisrael",Inheritance:'inheritance',Neighbors:'neighbors',
  Brokerage:'brokerage','Shaare Teshuva':'Shaare Teshuva','Business Halacha':'Business Halacha','Pirkei Avot':'Pirkei Avot',
  Mishlei:'Mishlei','Ignite Your Prayers':'ignite',Tzedaka:'tzedaka','Haggadah Shel Pesah':'Haggadah','Megilat Esther':'Esther',
  'Bava Batra':'Batra','Bava Kama':'Kama',Interest:'interest','Collecting Debt':'debt',Loans:'loan',"Dina D'Malchuta":'law of the land',
  'Gezel Akum':'theft from'
};
const builtInRuleId=folder=>String(folder).normalize('NFD').replace(/\p{Diacritic}/gu,'').toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu,'-').replace(/^-|-$/g,'');
const builtInRuleDetails=()=>BUILTIN_RULES.map(([pattern,folder,label])=>({id:builtInRuleId(folder),pattern,folder,label,contains:BUILTIN_MATCH_TEXT[folder]||folder}));
function activeBuiltInRules(){
  const disabled=new Set(config.disabledBuiltInRules||[]);
  return builtInRuleDetails().filter(rule=>!disabled.has(rule.id)).map(rule=>({...rule,...(config.builtInRuleEdits?.[rule.id]||{})}));
}
function builtInMatch(title=''){
  const clean=String(title).trim().replace(/\s+/g,' ');
  return activeBuiltInRules().find(rule=>{
    const edited=config.builtInRuleEdits?.[rule.id];
    return edited?.contains?clean.toLocaleLowerCase().includes(rule.contains.toLocaleLowerCase()):rule.pattern.test(clean);
  });
}
const activeBuiltInFolders=()=>new Set(activeBuiltInRules().map(rule=>cap(rule.folder)));

function normalizeTree(nodes=[]){return nodes.map(node=>({name:node.name,children:normalizeTree(node.children||(node.subfolders||[]).map(name=>({name})))}))}
function normalizeConfig(){
  config.folders=normalizeTree(config.folders||[]);
  config.rules=(config.rules||[]).map(rule=>({...rule,path:rule.path?.length?rule.path:[rule.folder,rule.subfolder].filter(Boolean)}));
  config.moves=config.moves||[];
  config.hiddenFolders=config.hiddenFolders||[];
  config.hiddenPaths=config.hiddenPaths||[];
  config.pathTransforms=config.pathTransforms||[];
  config.disabledBuiltInRules=Array.isArray(config.disabledBuiltInRules)?config.disabledBuiltInRules:[];
  config.builtInRuleEdits=config.builtInRuleEdits&&typeof config.builtInRuleEdits==='object'?config.builtInRuleEdits:{};
  Object.values(config.overrides||{}).forEach(item=>{item.path=item.path?.length?item.path:[item.folder,item.subfolder].filter(Boolean)});
}
function transformAdminPath(input){
  let path=[...input];
  for(let pass=0;pass<20;pass++){
    const transform=config.pathTransforms.filter(item=>item.sourcePath?.length&&item.sourcePath.every((part,index)=>path[index]===part)).sort((a,b)=>b.sourcePath.length-a.sourcePath.length)[0];
    if(!transform)break;
    const next=[...transform.targetPath,...path.slice(transform.sourcePath.length)];
    if(JSON.stringify(next)===JSON.stringify(path))break;
    path=next;
  }
  return path;
}
const adminPathHidden=path=>config.hiddenPaths.some(hidden=>hidden.length&&hidden.every((part,index)=>path[index]===part));
function findNode(path,nodes=config.folders){let list=nodes,node=null;for(const name of path){node=list.find(item=>item.name===name);if(!node)return null;list=node.children||=[]}return node}
function findParent(path){return path.length===1?{children:config.folders}:findNode(path.slice(0,-1))}
function allPaths(nodes=config.folders,prefix=[]){return nodes.flatMap(node=>{const path=[...prefix,node.name];return[path,...allPaths(node.children||[],path)]})}
function ensureNode(path){let list=config.folders,node=null;for(const name of path){node=list.find(item=>item.name.toLocaleLowerCase()===name.toLocaleLowerCase());if(!node){node={name,children:[]};list.push(node)}node.children||=[];list=node.children}return node}
function syncOverrideFolders(){
  let added=false;
  Object.values(config.overrides||{}).forEach(assignment=>{
    let list=config.folders;
    for(const name of assignment.path||[]){
      let node=list.find(item=>folderKey(item.name)===folderKey(name));
      if(!node){node={name,children:[]};list.push(node);added=true}
      node.children||=[];list=node.children;
    }
  });
  return added;
}
function showAdmin(on){$('loginView').classList.toggle('hidden',on);$('adminView').classList.toggle('hidden',!on);$('logout').classList.toggle('hidden',!on)}
function changed(){dirty=true;changeRevision++;invalidateDerived();$('saveMessage').textContent='Saving automatically…';$('saveMessage').className='';clearTimeout(saveTimer);saveTimer=setTimeout(save,700)}
function destinationOptions(selected=[],excludedRoot=''){
  const chosen=JSON.stringify(selected);
  return destinationPaths().filter(path=>path[0]!==excludedRoot).map(path=>`<option value="${pathValue(path)}"${JSON.stringify(path)===chosen?' selected':''}>${esc(path.join(' › '))}</option>`).join('');
}
function treeDestinationOptions(currentPath){
  return destinationPaths().filter(path=>!currentPath.every((part,index)=>path[index]===part)).map(path=>`<option value="${pathValue(path)}">${esc(path.join(' › '))}</option>`).join('');
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
      <div class="move-controls"><select data-tree-parent="${value}"><option value="">Move inside…</option>${treeDestinationOptions(path)}</select><button data-move-tree="${value}">Move</button></div>
      <div class="nested-tree">${treeHTML(node.children||[],path)}</div>
    </article>`;
  }).join('');
}
function renderFolders(){$('folderList').innerHTML=config.folders.length?treeHTML():'<p>No custom folders yet.</p>';refreshSelects()}
function currentFolderName(title=''){
  const cacheKey=String(title);
  if(derivedCache.folderNames.has(cacheKey))return derivedCache.folderNames.get(cacheKey);
  const clean=cacheKey.trim().replace(/\s+/g,' '),matched=builtInMatch(clean);
  if(matched){const name=cap(matched.folder);derivedCache.folderNames.set(cacheKey,name);return name}
  const words=clean.split(' ').filter(Boolean),selected=[];let count=0;
  for(const word of words){selected.push(word);if(word.toLowerCase()!=='and')count++;if(count===2)break}
  const name=cap(selected.join(' ')||'Other');derivedCache.folderNames.set(cacheKey,name);return name;
}
function currentFolders(){
  if(derivedCache.currentFolders)return derivedCache.currentFolders;
  const groups=new Map();
  episodes.forEach(episode=>{const name=currentFolderName(episode.title);if(!groups.has(name))groups.set(name,[]);groups.get(name).push(episode)});
  const forced=activeBuiltInFolders();
  derivedCache.currentFolders=[...groups].filter(([name,items])=>forced.has(name)||items.length>1).sort((a,b)=>a[0].localeCompare(b[0],undefined,{numeric:true,sensitivity:'base'}));
  return derivedCache.currentFolders;
}
const folderKey=value=>String(value||'').normalize('NFD').replace(/\p{Diacritic}/gu,'').toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu,' ').trim();
function automaticAssignmentPath(episode){
  const cacheKey=String(episode.id);
  if(derivedCache.assignments.has(cacheKey))return derivedCache.assignments.get(cacheKey);
  const override=config.overrides?.[String(episode.id)];
  if(override?.path?.length){const result=transformAdminPath(override.path);derivedCache.assignments.set(cacheKey,result);return result}
  const original=currentFolderName(episode.title),moves=config.moves||[];
  const move=moves.find(item=>item.source===original)||moves.find(item=>folderKey(item.source)===folderKey(original));
  if(move?.parentPath?.length){
    const path=[...move.parentPath,move.name||original];
    if(original==='Daf Yomi')path.push(dafAdminFolder(episode.title));
    if(original==='Humash Rashi')path.push(rashiAdminFolder(episode.title));
    if(original==="Hok L'Yisrael")path.push(hokAdminFolder(episode.title));
    const result=transformAdminPath(path);derivedCache.assignments.set(cacheKey,result);return result;
  }
  const lower=String(episode.title||'').toLocaleLowerCase();
  const rule=(config.rules||[]).find(item=>item.contains&&lower.includes(item.contains.toLocaleLowerCase()));
  if(!rule?.path?.length){derivedCache.assignments.set(cacheKey,null);return null}
  const path=[...rule.path],clean=String(episode.title||'').trim().replace(/\s+/g,' ');
  if(rule.strategy==='first_word')path.push(cap(clean.split(/\s+/)[0]||'Other'));
  if(rule.strategy==='word_after'){const index=clean.toLocaleLowerCase().indexOf(String(rule.marker||'').toLocaleLowerCase());path.push(cap(index<0?'Other':clean.slice(index+String(rule.marker||'').length).replace(/^[-–—:\s]+/,'').split(/\s+/)[0]||'Other'))}
  if(rule.strategy==='before_word'){const index=clean.toLocaleLowerCase().indexOf(String(rule.marker||'').toLocaleLowerCase());path.push(cap(index<0?'Other':clean.slice(0,index).replace(/[-–—:]+$/,'').trim()||'Other'))}
  if(rule.strategy==='fixed')path.push(rule.subfolder||'Other');
  const result=transformAdminPath(path);derivedCache.assignments.set(cacheKey,result);return result;
}
function unfiledClasses(){
  if(derivedCache.unfiled)return derivedCache.unfiled;
  const forced=activeBuiltInFolders(),counts=new Map();
  episodes.forEach(episode=>{
    if(automaticAssignmentPath(episode))return;
    const name=currentFolderName(episode.title);
    counts.set(folderKey(name),(counts.get(folderKey(name))||0)+1);
  });
  derivedCache.unfiled=episodes.filter(episode=>{
    if(automaticAssignmentPath(episode))return false;
    const name=currentFolderName(episode.title);
    return!forced.has(name)&&!config.hiddenFolders.includes(name)&&counts.get(folderKey(name))===1;
  }).sort((a,b)=>new Date(b.date||b.pubDate||0)-new Date(a.date||a.pubDate||0));
  return derivedCache.unfiled;
}
function episodeResultHTML(episode,action='Choose folder'){
  return `<button class="result" data-episode="${esc(episode.id)}">${esc(episode.title)}<small>${new Date(episode.date||episode.pubDate||0).toLocaleDateString()} · ${action}</small></button>`;
}
function renderUnfiledClasses(){
  const unfiled=unfiledClasses();
  $('unfiledCount').textContent=`${unfiled.length} class${unfiled.length===1?'':'es'} currently appear individually on the home screen.`;
  $('unfiledResults').innerHTML=unfiled.length?unfiled.map(episode=>episodeResultHTML(episode)).join(''):'<p>Every class is filed in a folder.</p>';
}
function listeningFolderPaths(){
  if(derivedCache.listeningPaths)return derivedCache.listeningPaths;
  const paths=allPaths().map(path=>({path:transformAdminPath(path),episode:null})).filter(item=>!adminPathHidden(item.path)),counts=new Map(),forced=activeBuiltInFolders();
  episodes.forEach(episode=>{if(automaticAssignmentPath(episode))return;const name=currentFolderName(episode.title);counts.set(folderKey(name),(counts.get(folderKey(name))||0)+1)});
  episodes.forEach(episode=>{
    let path=automaticAssignmentPath(episode);
    if(!path){
      const root=currentFolderName(episode.title);
      if(!forced.has(root)&&counts.get(folderKey(root))<2)return;
      path=transformAdminPath([root]);
      if(root==='Daf Yomi')path.push(dafAdminFolder(episode.title));
      if(root==='Humash Rashi')path.push(rashiAdminFolder(episode.title));
      if(root==="Hok L'Yisrael")path.push(hokAdminFolder(episode.title));
    }
    path=transformAdminPath(path);
    if(config.hiddenFolders.includes(path[0])||config.hiddenFolders.includes(currentFolderName(episode.title))||adminPathHidden(path))return;
    paths.push({path,episode});
  });
  derivedCache.listeningPaths=paths;return paths;
}
function renderListeningFolderTree(){
  const root={children:new Map(),ids:new Set()};
  const listeningPaths=listeningFolderPaths();
  listeningPaths.forEach(({path,episode})=>{
    let node=root;
    path.forEach(name=>{if(!node.children.has(name))node.children.set(name,{name,children:new Map(),ids:new Set()});node=node.children.get(name);if(episode)node.ids.add(String(episode.id))});
  });
  const destinations=[...new Map(listeningPaths.map(item=>[item.path.join('\u0000').toLocaleLowerCase(),item.path])).values()];
  const options=currentPath=>destinations.filter(path=>!currentPath.every((part,index)=>path[index]===part)).map(path=>`<option value="${pathValue(path)}">${esc(path.join(' › '))}</option>`).join('');
  const html=(nodes,prefix=[])=>[...nodes.values()].sort((a,b)=>a.name.localeCompare(b.name,undefined,{numeric:true,sensitivity:'base'})).map(node=>{const path=[...prefix,node.name],value=pathValue(path);return`<article class="folder-card tree-level"><div class="folder-head"><span class="folder-name">${esc(node.name)}</span><span class="sub">${node.ids.size} episode${node.ids.size===1?'':'s'}</span></div><div class="small-actions"><button data-final-rename="${value}">Rename</button><button class="danger" data-final-remove="${value}">Remove from app</button></div><div class="move-controls"><select data-final-parent="${value}"><option value="">Move inside…</option>${options(path)}</select><button data-final-move="${value}">Move</button></div><div class="nested-tree">${html(node.children,path)}</div></article>`}).join('');
  $('listeningFolderTree').innerHTML=html(root.children)||'<p>No folders are currently shown in the listening app.</p>';
  $('removedFolderList').innerHTML=config.hiddenPaths.length?`<h3>Removed folders</h3>${config.hiddenPaths.map(path=>`<div class="built-in-rule"><span>${esc(path.join(' › '))}</span><button data-final-restore="${pathValue(path)}">Restore</button></div>`).join('')}`:'';
}
function savePathTransform(sourcePath,targetPath){
  config.pathTransforms=config.pathTransforms.filter(item=>JSON.stringify(item.sourcePath)!==JSON.stringify(sourcePath));
  config.pathTransforms.push({sourcePath,targetPath});
}
function dafAdminFolder(title=''){const clean=String(title).trim().replace(/\s+/g,' '),match=clean.match(/\bdaf\b/i)||clean.match(/daf/i),before=(match?clean.slice(0,match.index):clean).trim();return cap(before.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu,'').trim()||'Daf Yomi')}
function rashiAdminFolder(title=''){return cap(String(title).trim().split(/\s+/)[0]?.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu,'')||'Other')}
function hokAdminFolder(title=''){const match=String(title).match(/\bhok\s+l\s*['’]?\s*yisrael\b\s*[-–—:]?\s*([^\s]+)/i),word=match?.[1]?.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu,'')||'Other';return cap(word)}
function destinationPaths(){
  if(derivedCache.destinationPaths)return derivedCache.destinationPaths;
  const paths=[...allPaths(),...currentFolders().map(([name])=>[name])];
  episodes.forEach(episode=>{const root=currentFolderName(episode.title);if(root==='Daf Yomi')paths.push([root,dafAdminFolder(episode.title)]);if(root==='Humash Rashi')paths.push([root,rashiAdminFolder(episode.title)]);if(root==="Hok L'Yisrael")paths.push([root,hokAdminFolder(episode.title)])});
  (config.moves||[]).forEach(move=>paths.push([...move.parentPath,move.name||move.source]));
  const unique=new Map(paths.filter(path=>path.length).map(path=>[path.join('\u0000').toLowerCase(),path]));
  derivedCache.destinationPaths=[...unique.values()].sort((a,b)=>a.join(' ').localeCompare(b.join(' '),undefined,{numeric:true,sensitivity:'base'}));
  return derivedCache.destinationPaths;
}
function renderCurrentFolders(){
  const catalogFolders=currentFolders(),catalogNames=new Set(catalogFolders.map(([name])=>folderKey(name)));
  const folders=[...catalogFolders.map(([name,items])=>({name,items,customOnly:false})),...config.folders.filter(node=>!catalogNames.has(folderKey(node.name))).map(node=>({name:node.name,items:[],customOnly:true}))];
  folders.sort((a,b)=>a.name.localeCompare(b.name,undefined,{numeric:true,sensitivity:'base'}));
  $('currentFolderList').innerHTML=folders.length?folders.map(({name,items,customOnly})=>{
    const move=config.moves.find(item=>item.source===name),hidden=config.hiddenFolders.includes(name),selected=move?.parentPath||[],location=hidden?'Removed from listening app':move?`${move.parentPath.join(' › ')} › ${move.name||name}`:'Home screen';
    return `<article class="current-folder"><div><strong>${esc(name)}</strong><small>${items.length} episodes · Currently: ${esc(location)}</small></div>
      <div class="move-controls"><select data-move-parent="${esc(name)}"><option value="">Move inside…</option>${destinationOptions(selected,name)}</select><input data-move-name="${esc(name)}" value="${esc(move?.name||name)}" aria-label="Folder name after move"><button data-move-folder="${esc(name)}"${customOnly?' data-custom-folder="true"':''}>Move</button>${move?`<button class="danger" data-unmove-folder="${esc(name)}">Undo move</button>`:''}${hidden?`<button data-restore-folder="${esc(name)}">Restore folder</button>`:`<button class="danger" data-hide-folder="${esc(name)}">Remove from app</button>`}</div></article>`;
  }).join(''):'<p>No catalog folders found.</p>';
  const currentNames=new Set(folders.map(({name})=>name)),staleMoves=config.moves.filter(move=>!currentNames.has(move.source));
  if(staleMoves.length)$('currentFolderList').insertAdjacentHTML('beforeend',`<div class="card"><h3>Moves needing attention</h3><p class="sub">These saved names no longer exactly match a current folder.</p>${staleMoves.map(move=>`<div class="built-in-rule"><span><strong>${esc(move.source)}</strong><br>Destination: ${esc(move.parentPath.join(' › '))}</span><button class="danger" data-unmove-folder="${esc(move.source)}">Remove stale move</button></div>`).join('')}</div>`);
}
function renderBuiltInRules(){
  const disabled=new Set(config.disabledBuiltInRules||[]),rules=builtInRuleDetails(),active=rules.filter(rule=>!disabled.has(rule.id)),removed=rules.filter(rule=>disabled.has(rule.id));
  $('builtInRuleList').innerHTML=`<div class="rule-editor-list">${active.map(rule=>{
    const edit=config.builtInRuleEdits?.[rule.id],contains=edit?.contains||rule.contains,folder=edit?.folder||rule.folder;
    return `<article class="rule-editor">
      <div class="rule-editor-title"><div><strong>${esc(folder)}</strong><small>${edit?'Modified built-in rule':'Built-in rule'}</small></div><span class="status-pill">${edit?'Edited':'Active'}</span></div>
      <div class="rule-editor-fields">
        <label>When a title contains<input data-builtin-contains="${esc(rule.id)}" value="${esc(contains)}"></label>
        <label>File it in folder<input data-builtin-folder="${esc(rule.id)}" value="${esc(folder)}"></label>
      </div>
      <div class="rule-editor-actions"><button data-save-builtin="${esc(rule.id)}">Save changes</button>${edit?`<button class="quiet" data-reset-builtin="${esc(rule.id)}">Reset</button>`:''}<button class="danger" data-disable-builtin="${esc(rule.id)}">Delete rule</button></div>
    </article>`;
  }).join('')}</div>${removed.length?`<section class="deleted-rules"><h3>Deleted built-in rules</h3><p class="sub">Restore a rule if you need it again.</p>${removed.map(rule=>`<div class="built-in-rule"><span><strong>${esc(rule.folder)}</strong><br>Title contains “${esc(config.builtInRuleEdits?.[rule.id]?.contains||rule.contains)}”</span><button data-restore-builtin="${esc(rule.id)}">Restore</button></div>`).join('')}</section>`:''}`;
}
function renderRules(){
  $('ruleList').innerHTML=config.rules.length?config.rules.map((rule,index)=>`<article class="rule-card"><div class="rule-head"><div><strong>Title contains “${esc(rule.contains)}”</strong><br><small>Destination: ${esc((rule.path||[]).join(' › '))}${rule.strategy!=='none'?` · Adds: ${esc(rule.strategy.replaceAll('_',' '))}`:''}</small></div><button class="danger" data-delete-rule="${index}">Delete</button></div></article>`).join(''):'<p>No custom rules yet.</p>';
}
function renderPanel(panel){
  if(panel==='folders'){renderFolders();renderCurrentFolders();renderListeningFolderTree()}
  else if(panel==='rules'){refreshSelects();renderRules();renderBuiltInRules()}
  else if(panel==='episodes'){refreshSelects();renderUnfiledClasses()}
}
function replacePathPrefix(oldPath,newPath){
  const replace=path=>path?.slice(0,oldPath.length).every((part,i)=>part===oldPath[i])?[...newPath,...path.slice(oldPath.length)]:path;
  config.moves.forEach(move=>move.parentPath=replace(move.parentPath));
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
  config=await response.json();normalizeConfig();const addedAssignedFolders=syncOverrideFolders();showAdmin(true);
  try{const data=await(await fetch('/api/soundcloud/episodes')).json();episodes=Array.isArray(data)?data:(data.episodes||[]);invalidateDerived()}catch{}
  renderPanel('folders');if(addedAssignedFolders)changed();
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
    if(revision===changeRevision){config=data;normalizeConfig();invalidateDerived();dirty=false;$('saveMessage').textContent='Saved. The listener app is updated.';$('saveMessage').className='ok'}
    else saveTimer=setTimeout(save,100);
  }finally{saving=false}
}

document.querySelector('.tabs').onclick=event=>{if(!event.target.dataset.panel)return;document.querySelectorAll('.tab').forEach(tab=>tab.classList.toggle('active',tab===event.target));document.querySelectorAll('.panel').forEach(panel=>panel.classList.add('hidden'));$(`${event.target.dataset.panel}Panel`).classList.remove('hidden');requestAnimationFrame(()=>renderPanel(event.target.dataset.panel))};
$('login').onclick=login;$('password').onkeydown=e=>{if(e.key==='Enter')login()};$('saveAll').onclick=save;
$('logout').onclick=()=>{sessionStorage.removeItem('rjsAdminToken');token='';showAdmin(false)};
$('addFolder').onclick=()=>{const name=cap($('newFolder').value);if(!name||config.folders.some(f=>f.name.toLowerCase()===name.toLowerCase()))return;config.folders.push({name,children:[]});$('newFolder').value='';changed();renderFolders();renderCurrentFolders();renderListeningFolderTree()};
$('folderList').onclick=event=>{
  const add=event.target.dataset.addChild,rename=event.target.dataset.rename,remove=event.target.dataset.delete,moveValue=event.target.dataset.moveTree;
  let saveImmediately=false;
  if(add){const path=readPath(add),node=findNode(path),name=cap(prompt(`New folder inside “${path.at(-1)}”`));if(!node||!name)return;node.children||=[];if(!node.children.some(child=>child.name.toLowerCase()===name.toLowerCase()))node.children.push({name,children:[]})}
  else if(rename){const oldPath=readPath(rename),node=findNode(oldPath),name=cap(prompt('New folder name',node?.name));if(!node||!name||name===node.name)return;node.name=name;replacePathPrefix(oldPath,[...oldPath.slice(0,-1),name])}
  else if(remove){const path=readPath(remove),parent=findParent(path),finalPath=transformAdminPath(path);if(!parent||!confirm(`Remove “${path.at(-1)}” and everything inside it from the listening app?`))return;if(!config.hiddenPaths.some(item=>JSON.stringify(item)===JSON.stringify(finalPath)))config.hiddenPaths.push(finalPath);parent.children=parent.children.filter(child=>child.name!==path.at(-1));config.rules=config.rules.filter(rule=>!rule.path?.slice(0,path.length).every((part,i)=>part===path[i]));config.moves=config.moves.filter(move=>!move.parentPath?.slice(0,path.length).every((part,i)=>part===path[i]));Object.keys(config.overrides).forEach(id=>{const p=config.overrides[id].path;if(p?.slice(0,path.length).every((part,i)=>part===path[i]))delete config.overrides[id]});saveImmediately=true}
  else if(moveValue){
    const oldPath=readPath(moveValue),select=document.querySelector(`[data-tree-parent="${CSS.escape(moveValue)}"]`),newParentPath=readPath(select?.value);
    if(!oldPath.length||!newParentPath.length)return alert('Choose the folder where this folder should go.');
    if(oldPath.every((part,index)=>newParentPath[index]===part))return alert('A folder cannot be moved inside itself.');
    const oldParent=findParent(oldPath),node=findNode(oldPath),destination=findNode(newParentPath)||ensureNode(newParentPath);
    if(!oldParent||!node||!destination)return alert('The folder could not be moved.');
    if((destination.children||[]).some(child=>folderKey(child.name)===folderKey(node.name)))return alert(`“${node.name}” already exists inside that folder.`);
    oldParent.children=oldParent.children.filter(child=>child!==node);
    destination.children||=[];destination.children.push(node);
    replacePathPrefix(oldPath,[...newParentPath,node.name]);
  }
  else return;
  changed();renderFolders();renderRules();renderCurrentFolders();renderListeningFolderTree();if(saveImmediately)save();
};
$('currentFolderList').onclick=event=>{
  const source=event.target.dataset.moveFolder,undo=event.target.dataset.unmoveFolder,hide=event.target.dataset.hideFolder,restore=event.target.dataset.restoreFolder;
  if(source){
    const select=document.querySelector(`[data-move-parent="${CSS.escape(source)}"]`),nameInput=document.querySelector(`[data-move-name="${CSS.escape(source)}"]`),parentPath=readPath(select?.value);
    if(!parentPath.length)return alert('Choose the master folder where this folder should go.');
    if(event.target.dataset.customFolder==='true'){
      const index=config.folders.findIndex(node=>node.name===source),node=config.folders[index];
      if(index<0||!node)return alert('This custom folder could not be found.');
      const newName=cap(nameInput?.value)||source;
      config.folders.splice(index,1);
      const parent=ensureNode(parentPath);
      node.name=newName;parent.children||=[];
      const existing=parent.children.find(child=>folderKey(child.name)===folderKey(newName));
      if(existing)existing.children=[...(existing.children||[]),...(node.children||[])];
      else parent.children.push(node);
      changed();renderFolders();renderCurrentFolders();renderListeningFolderTree();return;
    }
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
    config.hiddenFolders=config.hiddenFolders.filter(name=>name!==source);changed();renderCurrentFolders();renderListeningFolderTree();
  }
  else if(undo){
    const previous=config.moves.find(item=>item.source===undo),oldPath=previous?[...previous.parentPath,previous.name||undo]:[undo],newPath=[undo];
    const replace=path=>path?.slice(0,oldPath.length).every((part,index)=>part===oldPath[index])?[...newPath,...path.slice(oldPath.length)]:path;
    config.moves.forEach(item=>{if(item.source!==undo)item.parentPath=replace(item.parentPath)});
    config.rules.forEach(rule=>rule.path=replace(rule.path));Object.values(config.overrides).forEach(item=>item.path=replace(item.path));
    config.moves=config.moves.filter(item=>item.source!==undo);changed();renderCurrentFolders();renderListeningFolderTree();
  }
  else if(hide){if(!confirm(`Remove “${hide}” from the listening app? Its classes will remain available in search.`))return;config.moves=config.moves.filter(item=>item.source!==hide);if(!config.hiddenFolders.includes(hide))config.hiddenFolders.push(hide);changed();renderCurrentFolders();renderListeningFolderTree()}
  else if(restore){config.hiddenFolders=config.hiddenFolders.filter(name=>name!==restore);changed();renderCurrentFolders();renderListeningFolderTree()}
};
$('listeningFolderTree').onclick=event=>{
  const renameValue=event.target.dataset.finalRename,removeValue=event.target.dataset.finalRemove,moveValue=event.target.dataset.finalMove;
  if(renameValue){
    const sourcePath=readPath(renameValue),name=cap(prompt('New folder name',sourcePath.at(-1)));
    if(!name||name===sourcePath.at(-1))return;
    savePathTransform(sourcePath,[...sourcePath.slice(0,-1),name]);
  }else if(removeValue){
    const path=readPath(removeValue);
    if(!path.length||!confirm(`Remove “${path.at(-1)}” and everything inside it from the listening app? The classes will remain in the catalog and can be restored.`))return;
    if(!config.hiddenPaths.some(item=>JSON.stringify(item)===JSON.stringify(path)))config.hiddenPaths.push(path);
  }else if(moveValue){
    const sourcePath=readPath(moveValue),select=document.querySelector(`[data-final-parent="${CSS.escape(moveValue)}"]`),parentPath=readPath(select?.value);
    if(!sourcePath.length||!parentPath.length)return alert('Choose the folder where this folder should go.');
    savePathTransform(sourcePath,[...parentPath,sourcePath.at(-1)]);
  }else return;
  changed();renderFolders();renderCurrentFolders();renderListeningFolderTree();renderUnfiledClasses();if(removeValue)save();
};
$('removedFolderList').onclick=event=>{
  const value=event.target.dataset.finalRestore;
  if(!value)return;
  const path=readPath(value);
  config.hiddenPaths=config.hiddenPaths.filter(item=>JSON.stringify(item)!==JSON.stringify(path));
  changed();renderListeningFolderTree();save();
};
$('ruleStrategy').onchange=()=>{const value=$('ruleStrategy').value;$('markerWrap').classList.toggle('hidden',!['word_after','before_word'].includes(value));$('fixedWrap').classList.toggle('hidden',value!=='fixed')};
$('builtInRuleList').onclick=event=>{
  const saveId=event.target.dataset.saveBuiltin,disableId=event.target.dataset.disableBuiltin,restoreId=event.target.dataset.restoreBuiltin,resetId=event.target.dataset.resetBuiltin;
  if(saveId){
    const contains=document.querySelector(`[data-builtin-contains="${CSS.escape(saveId)}"]`)?.value.trim();
    const folder=cap(document.querySelector(`[data-builtin-folder="${CSS.escape(saveId)}"]`)?.value);
    if(!contains||!folder)return alert('Enter matching title words and a destination folder.');
    config.builtInRuleEdits[saveId]={contains,folder};
    config.disabledBuiltInRules=config.disabledBuiltInRules.filter(id=>id!==saveId);
  }else if(disableId){
    const rule=builtInRuleDetails().find(item=>item.id===disableId);
    if(!confirm(`Delete the filing rule for “${rule?.folder||'this folder'}”? You can restore it later.`))return;
    if(!config.disabledBuiltInRules.includes(disableId))config.disabledBuiltInRules.push(disableId);
  }else if(restoreId){
    config.disabledBuiltInRules=config.disabledBuiltInRules.filter(id=>id!==restoreId);
  }else if(resetId){
    delete config.builtInRuleEdits[resetId];
  }else return;
  changed();renderBuiltInRules();
};
$('addRule').onclick=()=>{const contains=$('ruleContains').value.trim(),path=readPath($('ruleFolder').value);if(!contains||!path.length)return alert('Enter title words and choose a destination.');config.rules.unshift({id:crypto.randomUUID(),contains,path,strategy:$('ruleStrategy').value,marker:$('ruleMarker').value.trim(),subfolder:cap($('ruleSubfolder').value)});$('ruleContains').value=$('ruleMarker').value=$('ruleSubfolder').value='';changed();renderRules()};
$('ruleList').onclick=e=>{if(e.target.dataset.deleteRule===undefined)return;config.rules.splice(+e.target.dataset.deleteRule,1);changed();renderRules()};
let episodeSearchFrame=0;
$('episodeSearch').oninput=()=>{cancelAnimationFrame(episodeSearchFrame);episodeSearchFrame=requestAnimationFrame(()=>{const query=$('episodeSearch').value.trim().toLowerCase();if(query.length<2){$('episodeResults').innerHTML='<p>Type at least two letters.</p>';return}const found=[];for(const episode of episodes){if(episode.title.toLowerCase().includes(query)){found.push(episode);if(found.length===40)break}}$('episodeResults').innerHTML=found.length?found.map(e=>episodeResultHTML(e,'Choose or change folder')).join(''):'<p>No matching classes found.</p>'})};
function selectEpisode(event){const button=event.target.closest('[data-episode]');if(!button)return;selected=episodes.find(item=>String(item.id)===button.dataset.episode);if(!selected)return;const current=config.overrides[String(selected.id)]||{};$('selectedTitle').textContent=selected.title;$('assignmentFolder').innerHTML='<option value="">Choose a folder</option>'+destinationOptions(current.path||[]);$('assignmentCard').classList.remove('hidden');$('assignmentCard').scrollIntoView({behavior:'smooth'})}
$('episodeResults').onclick=selectEpisode;
$('unfiledResults').onclick=selectEpisode;
$('saveAssignment').onclick=()=>{const path=readPath($('assignmentFolder').value);if(!selected||!path.length)return alert('Choose a destination.');config.overrides[String(selected.id)]={path};ensureNode(path);changed();renderFolders();renderCurrentFolders();renderListeningFolderTree();renderUnfiledClasses()};
$('removeAssignment').onclick=()=>{if(!selected)return;delete config.overrides[String(selected.id)];$('assignmentFolder').value='';changed();renderListeningFolderTree();renderUnfiledClasses()};
window.addEventListener('beforeunload',event=>{if(dirty){event.preventDefault();event.returnValue=''}});
token?load():showAdmin(false);
