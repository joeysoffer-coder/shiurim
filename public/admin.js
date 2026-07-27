const $=id=>document.getElementById(id);
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const cap=v=>String(v||'').trim().replace(/\b\w/g,c=>c.toUpperCase());
let token=sessionStorage.getItem('rjsAdminToken')||'',config={folders:[],rules:[],overrides:{}},episodes=[],selected=null,dirty=false;
const auth=()=>({'Content-Type':'application/json',Authorization:`Bearer ${token}`});

function showAdmin(on){$('loginView').classList.toggle('hidden',on);$('adminView').classList.toggle('hidden',!on);$('logout').classList.toggle('hidden',!on)}
function changed(){dirty=true;$('saveMessage').textContent='You have unsaved changes.';$('saveMessage').className=''}
function options(selected=''){return config.folders.map(f=>`<option value="${esc(f.name)}"${f.name===selected?' selected':''}>${esc(f.name)}</option>`).join('')}
function refreshSelects(){
  const r=$('ruleFolder').value,a=$('assignmentFolder').value;
  $('ruleFolder').innerHTML='<option value="">Choose a folder</option>'+options(r);
  $('assignmentFolder').innerHTML='<option value="">Choose a folder</option>'+options(a);
  const folder=config.folders.find(f=>f.name===$('assignmentFolder').value);
  $('subfolderChoices').innerHTML=(folder?.subfolders||[]).map(s=>`<option value="${esc(s)}"></option>`).join('');
}
function renderFolders(){
  $('folderList').innerHTML=config.folders.length?config.folders.map((f,i)=>`<article class="folder-card"><div class="folder-head"><span class="folder-name">${esc(f.name)}</span><div class="small-actions"><button data-rename="${i}">Rename</button><button class="danger" data-delete="${i}">Delete</button></div></div><div class="chips">${(f.subfolders||[]).map((s,j)=>`<span class="chip">${esc(s)}<button data-remove-sub="${i}:${j}">×</button></span>`).join('')}<button data-add-sub="${i}">+ Subfolder</button></div></article>`).join(''):'<p>No custom folders yet.</p>';
  refreshSelects();
}
function renderRules(){
  $('ruleList').innerHTML=config.rules.length?config.rules.map((r,i)=>`<article class="rule-card"><div class="rule-head"><div><strong>Title contains “${esc(r.contains)}”</strong><br><small>Folder: ${esc(r.folder)}${r.strategy!=='none'?` · ${esc(r.strategy.replaceAll('_',' '))}`:''}</small></div><button class="danger" data-delete-rule="${i}">Delete</button></div></article>`).join(''):'<p>No custom rules yet.</p>';
}
async function login(){
  $('loginMessage').textContent='Signing in…';
  try{
    const r=await fetch('/api/admin/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({password:$('password').value})}),d=await r.json();
    if(!r.ok)throw Error(d.error||'Incorrect password');token=d.token;sessionStorage.setItem('rjsAdminToken',token);await load();
  }catch(e){$('loginMessage').textContent=e.message}
}
async function load(){
  const r=await fetch('/api/admin/config',{headers:auth()});
  if(!r.ok){sessionStorage.removeItem('rjsAdminToken');token='';showAdmin(false);return}
  config=await r.json();showAdmin(true);renderFolders();renderRules();
  try{const d=await(await fetch('/api/soundcloud/episodes')).json();episodes=Array.isArray(d)?d:(d.episodes||[])}catch{}
}
async function save(){
  $('saveMessage').textContent='Saving…';
  const r=await fetch('/api/admin/config',{method:'PUT',headers:auth(),body:JSON.stringify(config)}),d=await r.json().catch(()=>({}));
  if(!r.ok){$('saveMessage').textContent=d.error||'Could not save.';return}
  config=d;dirty=false;$('saveMessage').textContent='Saved. The listener app is updated.';$('saveMessage').className='ok';renderFolders();renderRules();
}

document.querySelector('.tabs').addEventListener('click',e=>{
  if(!e.target.dataset.panel)return;
  document.querySelectorAll('.tab').forEach(x=>x.classList.toggle('active',x===e.target));
  document.querySelectorAll('.panel').forEach(x=>x.classList.add('hidden'));
  $(`${e.target.dataset.panel}Panel`).classList.remove('hidden');
});
$('login').onclick=login;$('password').onkeydown=e=>{if(e.key==='Enter')login()};$('saveAll').onclick=save;
$('logout').onclick=()=>{sessionStorage.removeItem('rjsAdminToken');token='';showAdmin(false)};
$('addFolder').onclick=()=>{
  const name=cap($('newFolder').value);if(!name||config.folders.some(f=>f.name.toLowerCase()===name.toLowerCase()))return;
  config.folders.push({name,subfolders:[]});$('newFolder').value='';changed();renderFolders();
};
$('folderList').onclick=e=>{
  const ren=e.target.dataset.rename,del=e.target.dataset.delete,add=e.target.dataset.addSub,rem=e.target.dataset.removeSub;
  if(ren!==undefined){const old=config.folders[+ren].name,name=cap(prompt('New folder name',old));if(!name||name===old)return;config.folders[+ren].name=name;config.rules.forEach(r=>{if(r.folder===old)r.folder=name});Object.values(config.overrides).forEach(o=>{if(o.folder===old)o.folder=name})}
  else if(del!==undefined){const f=config.folders[+del];if(!confirm(`Delete “${f.name}”?`))return;config.folders.splice(+del,1);config.rules=config.rules.filter(r=>r.folder!==f.name);Object.keys(config.overrides).forEach(id=>{if(config.overrides[id].folder===f.name)delete config.overrides[id]})}
  else if(add!==undefined){const name=cap(prompt('Subfolder name'));if(!name)return;const s=config.folders[+add].subfolders||=[];if(!s.some(x=>x.toLowerCase()===name.toLowerCase()))s.push(name)}
  else if(rem){const[i,j]=rem.split(':').map(Number);config.folders[i].subfolders.splice(j,1)}else return;
  changed();renderFolders();renderRules();
};
$('ruleStrategy').onchange=()=>{const v=$('ruleStrategy').value;$('markerWrap').classList.toggle('hidden',!['word_after','before_word'].includes(v));$('fixedWrap').classList.toggle('hidden',v!=='fixed')};
$('addRule').onclick=()=>{
  const contains=$('ruleContains').value.trim(),folder=$('ruleFolder').value;if(!contains||!folder)return alert('Enter title words and choose a folder.');
  config.rules.unshift({id:crypto.randomUUID(),contains,folder,strategy:$('ruleStrategy').value,marker:$('ruleMarker').value.trim(),subfolder:cap($('ruleSubfolder').value)});
  $('ruleContains').value=$('ruleMarker').value=$('ruleSubfolder').value='';changed();renderRules();
};
$('ruleList').onclick=e=>{if(e.target.dataset.deleteRule===undefined)return;config.rules.splice(+e.target.dataset.deleteRule,1);changed();renderRules()};
$('episodeSearch').oninput=()=>{
  const q=$('episodeSearch').value.trim().toLowerCase();if(q.length<2){$('episodeResults').innerHTML='<p>Type at least two letters.</p>';return}
  const found=episodes.filter(e=>e.title.toLowerCase().includes(q)).slice(0,40);
  $('episodeResults').innerHTML=found.length?found.map(e=>`<button class="result" data-episode="${esc(e.id)}">${esc(e.title)}<small>${new Date(e.date||e.pubDate||0).toLocaleDateString()}</small></button>`).join(''):'<p>No matching classes found.</p>';
};
$('episodeResults').onclick=e=>{
  const b=e.target.closest('[data-episode]');if(!b)return;selected=episodes.find(x=>String(x.id)===b.dataset.episode);if(!selected)return;
  const o=config.overrides[String(selected.id)]||{};$('selectedTitle').textContent=selected.title;$('assignmentFolder').value=o.folder||'';refreshSelects();$('assignmentSubfolder').value=o.subfolder||'';$('assignmentCard').classList.remove('hidden');$('assignmentCard').scrollIntoView({behavior:'smooth'});
};
$('assignmentFolder').onchange=refreshSelects;
$('saveAssignment').onclick=()=>{if(!selected||!$('assignmentFolder').value)return alert('Choose a folder.');config.overrides[String(selected.id)]={folder:$('assignmentFolder').value,subfolder:cap($('assignmentSubfolder').value)};changed()};
$('removeAssignment').onclick=()=>{if(!selected)return;delete config.overrides[String(selected.id)];$('assignmentFolder').value=$('assignmentSubfolder').value='';changed()};
window.addEventListener('beforeunload',e=>{if(dirty){e.preventDefault();e.returnValue=''}});
token?load():showAdmin(false);
