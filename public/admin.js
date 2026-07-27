const $=id=>document.getElementById(id);
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const cap=v=>String(v||'').trim().replace(/\b\w/g,c=>c.toUpperCase());
const pathValue=path=>encodeURIComponent(JSON.stringify(path));
const readPath=value=>{try{return JSON.parse(decodeURIComponent(value))}catch{return[]}};
let token=sessionStorage.getItem('rjsAdminToken')||'',config={folders:[],rules:[],overrides:{}},episodes=[],selected=null,dirty=false;
const auth=()=>({'Content-Type':'application/json',Authorization:`Bearer ${token}`});

function normalizeTree(nodes=[]){return nodes.map(node=>({name:node.name,children:normalizeTree(node.children||(node.subfolders||[]).map(name=>({name})))}))}
function normalizeConfig(){
  config.folders=normalizeTree(config.folders||[]);
  config.rules=(config.rules||[]).map(rule=>({...rule,path:rule.path?.length?rule.path:[rule.folder,rule.subfolder].filter(Boolean)}));
  Object.values(config.overrides||{}).forEach(item=>{item.path=item.path?.length?item.path:[item.folder,item.subfolder].filter(Boolean)});
}
function findNode(path,nodes=config.folders){let list=nodes,node=null;for(const name of path){node=list.find(item=>item.name===name);if(!node)return null;list=node.children||=[]}return node}
function findParent(path){return path.length===1?{children:config.folders}:findNode(path.slice(0,-1))}
function allPaths(nodes=config.folders,prefix=[]){return nodes.flatMap(node=>{const path=[...prefix,node.name];return[path,...allPaths(node.children||[],path)]})}
function showAdmin(on){$('loginView').classList.toggle('hidden',on);$('adminView').classList.toggle('hidden',!on);$('logout').classList.toggle('hidden',!on)}
function changed(){dirty=true;$('saveMessage').textContent='You have unsaved changes.';$('saveMessage').className=''}
function destinationOptions(selected=[]){
  const chosen=JSON.stringify(selected);
  return allPaths().map(path=>`<option value="${pathValue(path)}"${JSON.stringify(path)===chosen?' selected':''}>${esc(path.join(' › '))}</option>`).join('');
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
  config=await response.json();normalizeConfig();showAdmin(true);renderFolders();renderRules();
  try{const data=await(await fetch('/api/soundcloud/episodes')).json();episodes=Array.isArray(data)?data:(data.episodes||[])}catch{}
}
async function save(){
  $('saveMessage').textContent='Saving…';
  const response=await fetch('/api/admin/config',{method:'PUT',headers:auth(),body:JSON.stringify(config)}),data=await response.json().catch(()=>({}));
  if(!response.ok){$('saveMessage').textContent=data.error||'Could not save.';return}
  config=data;normalizeConfig();dirty=false;$('saveMessage').textContent='Saved. The listener app is updated.';$('saveMessage').className='ok';renderFolders();renderRules();
}

document.querySelector('.tabs').onclick=event=>{if(!event.target.dataset.panel)return;document.querySelectorAll('.tab').forEach(tab=>tab.classList.toggle('active',tab===event.target));document.querySelectorAll('.panel').forEach(panel=>panel.classList.add('hidden'));$(`${event.target.dataset.panel}Panel`).classList.remove('hidden')};
$('login').onclick=login;$('password').onkeydown=e=>{if(e.key==='Enter')login()};$('saveAll').onclick=save;
$('logout').onclick=()=>{sessionStorage.removeItem('rjsAdminToken');token='';showAdmin(false)};
$('addFolder').onclick=()=>{const name=cap($('newFolder').value);if(!name||config.folders.some(f=>f.name.toLowerCase()===name.toLowerCase()))return;config.folders.push({name,children:[]});$('newFolder').value='';changed();renderFolders()};
$('folderList').onclick=event=>{
  const add=event.target.dataset.addChild,rename=event.target.dataset.rename,remove=event.target.dataset.delete;
  if(add){const path=readPath(add),node=findNode(path),name=cap(prompt(`New folder inside “${path.at(-1)}”`));if(!node||!name)return;node.children||=[];if(!node.children.some(child=>child.name.toLowerCase()===name.toLowerCase()))node.children.push({name,children:[]})}
  else if(rename){const oldPath=readPath(rename),node=findNode(oldPath),name=cap(prompt('New folder name',node?.name));if(!node||!name||name===node.name)return;node.name=name;replacePathPrefix(oldPath,[...oldPath.slice(0,-1),name])}
  else if(remove){const path=readPath(remove),parent=findParent(path);if(!parent||!confirm(`Delete “${path.at(-1)}” and everything inside it?`))return;parent.children=parent.children.filter(child=>child.name!==path.at(-1));config.rules=config.rules.filter(rule=>!rule.path?.slice(0,path.length).every((part,i)=>part===path[i]));Object.keys(config.overrides).forEach(id=>{const p=config.overrides[id].path;if(p?.slice(0,path.length).every((part,i)=>part===path[i]))delete config.overrides[id]})}
  else return;
  changed();renderFolders();renderRules();
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
