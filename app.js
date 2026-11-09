'use strict';
const $=s=>document.querySelector(s), esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const paths={today:'M3 10 12 3l9 7v10a1 1 0 0 1-1 1h-5v-7H9v7H4a1 1 0 0 1-1-1z',review:'m4 12 5 5L20 6 M4 5h5 M15 20h5',patients:'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2 M19 8a4 4 0 0 1 0 8 M22 21v-2 M13 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0',work:'M9 4V2h6v2 M3 6h18v15H3z M3 11h18 M10 11v3h4v-3',plus:'M12 5v14 M5 12h14',arrow:'m9 5 7 7-7 7',check:'m5 12 4 4L19 6',refresh:'M20 7v5h-5 M4 17v-5h5 M5.4 7a8 8 0 0 1 13.2-2L20 8 M4 16l1.4 3A8 8 0 0 0 19 17',alert:'m12 3 10 18H2z M12 9v5 M12 17v.2',clock:'M12 8v5l3 2 M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0',search:'M21 21l-5-5 M18 10a8 8 0 1 1-16 0 8 8 0 0 1 16 0',close:'m6 6 12 12 M6 18 18 6',upload:'M12 16V3 M7 8l5-5 5 5 M4 15v6h16v-6',note:'M14 2H4v20h16V8z M14 2v6h6 M8 12h8 M8 16h6',settings:'M4 6h16 M4 12h16 M4 18h16 M8 3v6 M16 9v6 M10 15v6',image:'M3 3h18v18H3z m0 14 6-6 4 4 3-3 5 5 M16 7h.01',shield:'m12 2 9 4v6c0 5-9 10-9 10S3 17 3 12V6z m-5 9 4 4 6-7'};
paths.copy='M9 8h12v13H9z M15 8V3H3v13h6';
const icon=(name,cls='')=>`<span class="ico ${cls}" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="${paths[name]||paths.note}"/></svg></span>`;
const brand=()=>'<div class="brand"><img src="icon.svg" alt=""><span>Auto<span>Note</span></span></div>';
const date=s=>{if(!s)return 'Not available';const d=new Date(s);return Number.isNaN(+d)?s:d.toLocaleString([], {month:'short',day:'numeric',hour:'numeric',minute:'2-digit'});};
const age=s=>{if(!s)return 'Not checked';const d=new Date(s);if(Number.isNaN(+d))return s;const m=Math.max(0,Math.round((Date.now()-d)/60000));return m<1?'Just now':m<60?`${m}m ago`:m<1440?`${Math.floor(m/60)}h ago`:`${Math.floor(m/1440)}d ago`;};
const shortProvider=id=>S.data?.providers.find(p=>p.id===id)?.name.replace('Dr. ','')||id;
const providersFor=p=>p.providers.length?p.providers.map(x=>`<span>${esc(shortProvider(x))}</span>`).join(''):'<span>Group list · provider not established</span>';
const labels={refresh:'Refresh clinical data',morning:'Prepare morning notes',consult:'New consult intake',apply_revision:'Apply note revision',capture_note:'Read current pended note',notifications:'Refresh Haiku consult orders'};
const requestStates={queued:'Waiting for device',awaiting_activation:'Not enabled for this scope',running:'Updating in Epic',succeeded:'Verified in Epic',conflict:'Note changed · review again',needs_reconciliation:'Check Epic before retrying',not_applied:'Not applied · original verified',cancelled:'Cancelled',verified:'Verified',failed:'Needs attention'};
if(localStorage.getItem('autonote_mode')==='demo'){
  localStorage.removeItem('autonote_scope');localStorage.removeItem('autonote_list');
}
localStorage.removeItem('autonote_mode');
const S={token:sessionStorage.getItem('autonote_token')||'',
  scope:localStorage.getItem('autonote_scope')||'all',list:localStorage.getItem('autonote_list')||'all',building:localStorage.getItem('autonote_building')||'all',location:(localStorage.getItem('autonote_location')||'all').replace(/^\d{3,5}(?:-[A-Z0-9]+)?\s*[-·]\s*/i,''),view:'review',filter:'new',tier:0,query:'',data:null,error:'',modal:null,busy:false,attachment:null};
try{S.expandedPatients=new Set(JSON.parse(sessionStorage.getItem('autonote_expanded_patients')||'[]'));}catch{S.expandedPatients=new Set();}
const initial=new URLSearchParams(location.hash.slice(1));
if(initial.has('token')){S.token=initial.get('token');sessionStorage.setItem('autonote_token',S.token);history.replaceState(null,'','#review');}
const AUTOPLAN_URL=location.port==='8899'?'http://127.0.0.1:8896/':'/autonote/autoplan/';
if(location.hash.slice(1)==='autoplan')location.replace(AUTOPLAN_URL);
if(['today','review','patients','work','data'].includes(location.hash.slice(1)))S.view=location.hash.slice(1)==='today'?'review':location.hash.slice(1);

async function api(path,body){
  if(window.Hosted)return Hosted.api(path,body);
  const usedToken=S.token;
  const r=await fetch('/autonote'+path,{method:body===undefined?'GET':'POST',headers:{...(S.token?{Authorization:'Bearer '+S.token}:{}),...(body===undefined?{}:{'Content-Type':'application/json','X-AutoNote-Request':'1'})},body:body===undefined?undefined:JSON.stringify(body),cache:'no-store'});
  let value;try{value=await r.json();}catch{throw Error('The console did not return a readable response.');}
  if(!r.ok){if(r.status===401){S.token='';sessionStorage.removeItem('autonote_token');if(usedToken&&path==='/api/state'&&body===undefined)return api(path);}const e=Error(value.error||'Request failed.');e.status=r.status;throw e;}
  return value;
}
async function load(quiet=false){
  if(quiet&&Handoff.signoutVisible())return Handoff.checkSignout();
  try{S.data=dropTier3(await api('/api/state'));if(S.data.user.private_access){S.token='';sessionStorage.removeItem('autonote_token');}S.error='';if(S.scope!=='all'&&!S.scope.split(',').every(id=>S.data.providers.some(p=>p.id===id)))S.scope='all';if(S.list!=='all'&&!S.data.patients.some(p=>p.lists.includes(S.list)))S.list='all';render(quiet);}
  catch(e){if(window.Hosted&&e.status===403)return Hosted.denied();S.error=e.message;if(e.status===401)renderUnlock();else if(S.data)render(quiet);else $('#app').innerHTML=`<div class="unlock">${brand()}<h1>Couldn’t load your day</h1><p>${esc(e.message)}</p><button class="btn primary" data-action="reload">Try again</button></div>`;}
}
function renderUnlock(){
  if(window.Hosted)return Hosted.login();
  $('#app').innerHTML=`<div class="unlock">${brand()}<h1>Your day, in view.</h1><p>Enter your private access key to open the console on this device.</p><form id="unlock-form"><label class="sr-only" for="access-key">Access key</label><input id="access-key" type="password" autocomplete="off" placeholder="Access key" required><button class="btn primary" type="submit">Open console ${icon('arrow')}</button></form><p class="form-error">${esc(S.error)}</p><small class="muted">Your session is kept in this browser tab. Private access through your Mac.</small></div>`;
}
function scopeIncludes(id){return S.scope==='all'||S.scope.split(',').includes(id);}
function scopeLabel(){return S.scope==='all'?'All providers':S.scope.split(',').map(shortProvider).join(' + ');}
function scopedPatients(){return (S.data?.patients||[]).filter(p=>(S.scope==='all'||p.providers.some(scopeIncludes))&&(S.list==='all'||p.lists.includes(S.list))&&LocationView.matches(p));}
function scopedResults(){const ids=new Set(scopedPatients().map(p=>p.id));return (S.data?.results||[]).filter(r=>ids.has(r.patient_id));}
function reviewPatients(){return LabView.patients(scopedResults(),S.filter,S.tier);}
function setView(view){S.view=view;S.query='';history.replaceState(null,'','#'+view);render();window.scrollTo(0,0);}
function nav(bottom=false){return `<nav class="${bottom?'bottomnav':'nav'}" aria-label="${bottom?'Mobile':'Main'} navigation">${(window.Hosted?[['review','Run'],['patients','Patients']]:[['review','Run'],['patients','Patients'],['work','Requests'],['data','Data']]).map(([id,label])=>`<button data-action="navigate" data-view="${id}" class="${S.view===id?'active':''}" ${S.view===id?'aria-current="page"':''}>${icon(id)}<span>${label}</span>${id==='review'&&scopedResults().some(r=>r.tier&&!r.reviewed_at)?bottom?'<span class="nav-dot"></span>':`<span class="count">${LabView.patients(scopedResults()).length}</span>`:''}</button>`).join('')}<button data-action="autoplan" title="AutoPlan shadow notes — opens the AutoPlan review page">${icon('check')}<span>AutoPlan</span></button></nav>`;}
// AutoPlan review page in a tab (10/23). Same origin via Tailscale /autoplan; the
// frame is kept across background re-renders so typed comments are not lost.
function autoplanPage(){return `<div class="autoplan-tab"><div class="autoplan-tabhead"><h1>AutoPlan</h1><a class="btn link small" href="/autoplan/" target="_blank" rel="noopener">Open full page ${icon('arrow')}</a></div><iframe id="autoplan-frame" class="autoplan-frame" src="/autoplan/" title="AutoPlan review"></iframe></div>`;}
function scope(){const lists=[...new Set(S.data.patients.filter(p=>S.scope==='all'||p.providers.some(scopeIncludes)).flatMap(p=>p.lists))];return `<div class="scope" aria-label="Provider filter"><button class="pill ${S.scope==='all'?'active':''}" data-action="scope" data-id="all">All providers</button>${S.data.providers.map(p=>`<button class="pill ${S.scope!=='all'&&scopeIncludes(p.id)?'active':''}" data-action="scope" data-id="${esc(p.id)}"><span class="scope-dot"></span>${esc(p.name)}</button>`).join('')}<button class="pill" data-action="provider-group">Choose a group…</button></div><div class="patient-filters"><div class="list-scope"><label for="list-filter">List</label><select id="list-filter"><option value="all">All selected providers’ lists</option>${lists.map(l=>`<option value="${esc(l)}" ${l===S.list?'selected':''}>${esc(l)}</option>`).join('')}</select></div>${LocationView.control()}</div>`;}
function head(title,subtitle,extra=''){return `<div class="pagehead"><div><div class="eyebrow">${esc(new Date().toLocaleDateString([],{weekday:'long',month:'long',day:'numeric'}))}</div><h1>${title}</h1><p>${subtitle}</p></div>${extra}</div>`;}
// Tier 3 is off (Dr. Sutaria, 2026-10-31): a tier-3 result is no longer a
// flag anywhere — not in To review, counts, the nav dot or the tier menu. Its
// abnormal colour stays (threshold_tier), so the value still reads as abnormal.
const MAX_TIER=2;
function dropTier3(d){for(const r of d?.results||[]){if(r.tier>MAX_TIER){r.threshold_tier=r.threshold_tier??r.tier;r.tier=0;}}return d;}
function bottomNav(html){let h=document.getElementById('bottomnav-host');if(!h){h=document.createElement('div');h.id='bottomnav-host';document.body.appendChild(h);}if(h.dataset.html!==html){h.dataset.html=html;h.innerHTML=html;}}
function render(quiet=false){
  if(!S.data)return;
  if(window.Hosted){if(!['review','patients'].includes(S.view))S.view='review';S.patientView='patients';}
  if(S.data.user?.role==='partner'){S.view='review';document.title='AutoNote · Morning run';$('#app').innerHTML=`<div class="shell partner"><div class="workspace"><main id="main">${S.error?`<div class="notice inline-error" role="alert">${esc(S.error)}</div>`:''}${RunBoard.page()}</main></div></div>`;bottomNav('');return;}
  if(S.view==='autoplan'&&document.getElementById('autoplan-frame'))return;
  if(quiet&&Handoff.signoutVisible()){void Handoff.checkSignout();return;}
  document.title='AutoNote · '+({today:'Today',review:'Morning run',patients:'Patients',work:'Requests',autoplan:'AutoPlan',data:'Data'}[S.view]);
  const body={today:today,review:reviewPage,patients:patientsPage,work:workPage,autoplan:autoplanPage,data:()=>DataView.page()}[S.view]();
  $('#app').innerHTML=`<div class="shell"><aside class="sidebar">${brand()}<div class="eyebrow">Your workspace</div>${nav()}<div class="sidebar-footer"><div class="person"><span class="avatar">NS</span><div><strong class="small">${esc(S.data.user.name)}</strong><p class="small muted">Private workspace</p></div></div><button class="btn link small" data-action="settings">${icon('settings')} Console settings</button></div></aside><div class="workspace"><header class="topbar">${brand()}<button class="modebutton desktop-mode" data-action="settings"><span class="dot teal"></span>Connected · local data ${icon('arrow')}</button><div class="top-actions"><button class="icon-button" data-action="settings" aria-label="Console settings">${icon('settings')}</button><button class="btn primary" data-action="consult">${icon('plus')} New consult</button></div></header><main id="main">${S.error?`<div class="notice inline-error" role="alert">${esc(S.error)} <button class="btn link" data-action="reload">Retry</button></div>`:''}${body}</main></div></div>`;
  bottomNav(nav(true));
  syncCardControls();
  Handoff.loadSignout();
  if(window.Hosted)Hosted.decorate();
}
function cardControls(){return '<button class="btn link small" data-action="toggle-cards" aria-expanded="false">Expand all</button>';}
function syncCardControls(){
  const cards=[...document.querySelectorAll('#main .patient-card')],all=cards.length>0&&cards.every(c=>c.open);
  document.querySelectorAll('[data-action="toggle-cards"]').forEach(b=>{b.hidden=!cards.length;b.textContent=all?'Collapse all':'Expand all';b.setAttribute('aria-expanded',String(all));});
  const bulk=$('[data-action="review-all"]');if(bulk)bulk.disabled=!patientReviewIds($('#main')).length;
}
function rememberCards(){try{sessionStorage.setItem('autonote_expanded_patients',JSON.stringify([...S.expandedPatients]));}catch{}}
function toggleCards(){
  const cards=[...document.querySelectorAll('#main .patient-card')],expand=cards.some(c=>!c.open);
  cards.forEach(c=>{c.open=expand;if(expand)S.expandedPatients.add(c.dataset.cardKey);else S.expandedPatients.delete(c.dataset.cardKey);});
  rememberCards();syncCardControls();
}
function empty(title,detail,ico='check'){return `<div class="empty">${icon(ico)}<h3>${title}</h3><p>${detail}</p></div>`;}
function today(){
  const results=scopedResults(),fresh=LabView.patients(results),one=fresh.filter(r=>r.tier===1),two=fresh.filter(r=>r.tier===2),reviewed=LabView.patients(results,'reviewed').filter(g=>!g.results.some(r=>r.tier&&!r.reviewed_at));
  const patients=scopedPatients(),checked=patients.filter(p=>p.captured_at),old=patients.filter(p=>!p.captured_at||Date.now()-new Date(p.captured_at)>8*3600000).length;
  return head('Your day, in view.',`${patients.length} patients${S.scope==='all'?' across your lists':' · '+esc(scopeLabel())}. Start with what needs your attention.`)+scope()+RunView.overnight()+
  `<div class="summary-grid"><button class="summary-card urgent" data-action="review-tier" data-tier="1"><span class="eyebrow">Review first</span>${icon('alert')}<span class="number">${one.length}</span><span class="label">Tier 1 patients</span><span class="hint">Highest unreviewed priority</span></button><button class="summary-card early" data-action="review-tier" data-tier="2"><span class="eyebrow">Early rounds</span>${icon('clock')}<span class="number">${two.length}</span><span class="label">Tier 2 patients</span><span class="hint">Highest unreviewed priority</span></button><button class="summary-card reviewed" data-action="reviewed"><span class="eyebrow">Caught up</span>${icon('check')}<span class="number">${reviewed.length}</span><span class="label">Patients reviewed</span><span class="hint">Available priority findings</span></button></div>
  <div class="columns"><div><div class="sectionhead"><div><h2>Morning & other runs</h2><p>Every pass, with combined patient outcomes.</p></div><button class="btn link" data-action="new-run">Start a run ${icon('arrow')}</button></div>${RunView.daily()}
  <div class="sectionhead"><div><h2>Start here</h2><p>Each patient once, ordered by review priority.</p></div><div class="card-controls">${cardControls()}<button class="btn link" data-action="navigate" data-view="review">View all ${icon('arrow')}</button></div></div>${fresh.length?fresh.slice(0,3).map(patientFinding).join(''):empty('You’ve reviewed the available findings',old?'Some patient captures are old or missing. Refresh before concluding there is nothing new.':'A new specimen or amended report will appear here.')}</div>
  <div class="side-column"><div><div class="sectionhead"><h2>Clinical freshness</h2></div><div class="card refresh-card">${icon('refresh')}<h3>${old?`${old} patients need a fresh check`:'Your latest captures are available'}</h3><p>${checked.length} of ${patients.length} patients have capture evidence. Result times remain attached to each finding.</p><button class="btn primary" data-action="refresh">${icon('refresh')} Refresh clinical data</button></div><div class="card"><h3>Keep the distinction clear</h3><ul class="mini-list"><li>${icon('clock')} Result time <span class="small">When the lab/report is from</span></li><li>${icon('refresh')} Last checked <span class="small">When AutoNote captured it</span></li><li>${icon('check')} Reviewed <span class="small">What you acknowledged</span></li></ul></div></div>
  <div><div class="sectionhead"><h2>Next steps</h2></div><div class="card"><ul class="mini-list"><li><button class="btn link" data-action="consult">${icon('plus')} Add a new consult</button></li><li><button class="btn link" data-action="navigate" data-view="patients">${icon('note')} Update a patient’s note</button></li><li><button class="btn link" data-action="navigate" data-view="work">${icon('work')} Check your requests</button></li></ul></div>${S.data.warnings.length?`<div class="notice">${esc(S.data.warnings[0])}<br><button class="btn link" data-action="settings">View data coverage</button></div>`:''}</div></div></div>`;
}
function outcomeCounts(run){const all=run.outcomes||[],success=new Set(['pended','card_captured','precached','triage_captured','probe_note_exists','traversed_read_only']),covered=new Set(['not_on_list','chart_deceased','skipped_precached_tonight','skipped_fresh_capture','skipped_existing','already_pended','skipped_already_pended','skipped_consult_covered','hospice_skipped']);return {ready:all.filter(o=>success.has(o.state)).length,consult:all.filter(o=>['needs_consult','needs_new_consult'].includes(o.state)).length,covered:all.filter(o=>covered.has(o.state)).length,held:all.filter(o=>o.state==='deferred_labs_pending').length,issues:all.filter(o=>!success.has(o.state)&&!covered.has(o.state)&&o.state!=='deferred_labs_pending'&&!['needs_consult','needs_new_consult'].includes(o.state)).length};}
function patientReviewIds(root){
  return [...new Set([...root.querySelectorAll('[data-result-id][data-reviewed="false"]')].filter(e=>{
    if(e.closest('[hidden]'))return false;
    for(let p=e.parentElement;p&&p!==root;p=p.parentElement)if(p.tagName==='DETAILS'&&!p.open&&!p.classList.contains('lab-history'))return false;
    return true;
  }).map(e=>e.dataset.resultId))];
}
function imagingFinding(r){return `<section class="group-imaging" data-result-id="${esc(r.id)}" data-reviewed="${!!r.reviewed_at}"><div class="row"><h3>${icon('image')} ${esc(r.label)}</h3><span class="badge ${r.critical?'red':r.reviewed_at?'teal':'neutral'}">${r.critical?'Critical':r.reviewed_at?'Reviewed':r.tier?'Tier '+r.tier:'Report'}</span></div><p class="impression">${esc(r.report)}</p><p class="small muted">${esc(date(r.result_time))} · ${esc(r.status||'Status unavailable')}${r.report_incomplete?' · Excerpt only':''}${!r.identity_precise?' · Report identity incomplete':''}</p>${r.reviewed_at?`<button class="btn link small" data-action="unreview" data-id="${esc(r.id)}">Undo review</button>`:''} </section>`;}
function resultPresentation(results){return `${LabView.render(results)}${results.filter(r=>r.kind!=='lab').map(imagingFinding).join('')}`;}
function patientLabs(p,results){return `<div class="result-group" data-patient-results data-patient-id="${esc(p.id)}"><div class="source-title"><span>Available labs & imaging</span><span>Checked ${esc(age(p.captured_at))}</span></div>${resultPresentation(results)}${results.some(r=>!r.reviewed_at)?'<button class="btn soft" data-action="review-patient">'+icon('check')+' Review patient</button>':''}</div>`;}
function refreshOpenLabs(){const root=$('[data-patient-results]');if(!root)return;const p=S.data.patients.find(p=>p.id===root.dataset.patientId);if(p)root.outerHTML=patientLabs(p,S.data.results.filter(r=>r.patient_id===p.id));}
function patientFinding(group){
  const p=S.data.patients.find(p=>p.id===group.patient_id);if(!p)return '';
  const pending=group.results.some(r=>!r.reviewed_at),key='live:'+p.id,mrn=String(p.mrn??'').trim();
  const identity=mrn?`<button type="button" class="patient-mrn" data-action="copy-mrn" data-mrn="${esc(mrn)}" aria-label="Copy MRN ${esc(mrn)}" title="Tap to copy MRN"><span>MRN <span class="mrn-value">${esc(mrn)}</span></span>${icon('copy')}</button>`:'<span class="patient-mrn unavailable">MRN unavailable</span>';
  return `<details class="card finding result-group patient-card tier${group.tier} ${pending?'':'is-reviewed'}" data-patient-id="${esc(p.id)}" data-card-key="${esc(key)}" ${S.expandedPatients.has(key)?'open':''}><summary class="patient-card-summary"><span class="grow"><strong class="finding-name">${esc(p.name)}</strong>${identity}<span class="location">${esc(p.room)} · ${esc(LocationView.label(p))}</span></span>${LabView.preview(group)}<span class="badge ${group.tier===1?'red':group.tier===2?'amber':'neutral'}">${group.critical?'Critical':group.tier?'Tier '+group.tier:pending?'History':'Reviewed'}</span>${icon('arrow','card-chevron')}</summary><div class="patient-card-body"><div class="row"><div class="provider-tags">${providersFor(p)}</div><button class="btn link small" data-action="patient" data-id="${esc(p.id)}">${icon('note')} Open notes</button></div>${resultPresentation(group.results)}<div class="finding-foot"><div class="times">Checked ${esc(age(p.captured_at))}</div>${pending?`<button class="btn soft" data-action="review-patient">${icon('check')} Review patient</button>`:`<span class="review-check">${icon('check')} Reviewed</span>`}</div></div></details>`;
}
function reviewPage(){return RunBoard.page();}
function patientsPage(){return head('Your patients','Find a patient, review their data, and direct the next step.')+scope()+`<div class="segments handoff-tabs"><button data-action="patient-view" data-id="patients" class="${S.patientView==='signout'?'':'active'}">Patients</button><button data-action="patient-view" data-id="signout" class="${S.patientView==='signout'?'active':''}">Sign-out</button></div>`+(S.patientView==='signout'?Handoff.page():`<label class="search">${icon('search')}<input id="patient-search" type="search" placeholder="Name, MRN, room, or building" value="${esc(S.query)}" autocomplete="off" aria-label="Search patients"></label><div id="patient-results">${patientRows()}</div>`);}
function patientRows(){const q=S.query.trim().toLowerCase(),patients=scopedPatients().filter(p=>[p.name,p.mrn,p.room,p.building,p.unit].join(' ').toLowerCase().includes(q));return patients.length?`<div class="patient-list">${patients.map(p=>{const urgent=S.data.results.filter(r=>r.patient_id===p.id&&r.tier===1&&!r.reviewed_at).length;return `<button class="patient-row" data-action="patient" data-id="${esc(p.id)}"><span class="room">${esc(p.room||'—')}</span><span class="grow"><h3>${esc(p.name)}</h3><span class="small muted">${esc(LocationView.label(p))} · MRN ${esc(p.mrn)}</span><span class="provider-tags">${providersFor(p)}</span></span>${urgent?`<span class="badge red">${urgent} priority</span>`:''}${icon('arrow','chevron')}</button>`;}).join('')}</div>`:empty('No patients match','Choose All locations or adjust the provider, list, or search.','search');}
function workPage(){const requests=S.data.requests.filter(r=>LocationView.requestMatches(r.payload)&&scopeIncludes(r.payload.provider_id)&&(S.list==='all'||r.payload.list===S.list||r.payload.lists?.includes(S.list)||!r.payload.list&&!r.payload.lists));return head('Your requests','A clear record of what you asked for and where it stands.')+scope()+`<div class="notice info">${esc(S.data.activation.message)}</div>${S.location!=='all'||S.building!=='all'?`<p class="small muted">Patient requests: ${esc(LocationView.selectedLabel())}. List-wide requests remain visible.</p>`:''}${requests.length?requests.map(requestCard).join(''):empty('Nothing waiting on your behalf','Refresh a list, add a consult, or request a note revision. Its status will stay here.','work')}<div class="sectionhead"><h2>Recent note revisions</h2></div>${S.data.revisions.filter(r=>scopeIncludes(r.provider_id)&&LocationView.matches(r)&&(S.list==='all'||LocationView.patient(r)?.lists.includes(S.list))).map(r=>{const p=S.data.patients.find(p=>r.note_id.startsWith(p.id+':'));return `<div class="card"><div class="row"><div><h3>${esc(p?.name||'Patient revision')}</h3><p class="small muted">${esc(shortProvider(r.provider_id))} · ${esc(r.state.replaceAll('_',' '))}</p></div><button class="btn soft" data-action="patient" data-id="${esc(p?.id||'')}">Review</button></div></div>`;}).join('')||'<p class="small muted">Saved revisions and authored proposals will appear here.</p>'}`;}
function refreshOutcomeSummary(outcomes){return [['captured','captured'],['claimed','in progress'],['pending','waiting'],['needs_reconciliation','need attention'],['not_attempted','not attempted']].map(([state,label])=>{const count=outcomes.filter(o=>o.state===state).length;return count||state==='captured'?`${count} ${label}`:'';}).filter(Boolean).join(' · ');}
function requestCard(r){const p=r.payload,local=p.destination==='provider A/P revision',status=r.evidence?.consumption_state==='withdrawn'?'Morning revision withdrawn':r.evidence?.consumption_state==='superseded'?'Replaced by newer revision':r.evidence?.consumption_state==='claimed'?'Being used by morning run':r.evidence?.consumption_state==='consumed'?'Used in verified morning note':r.evidence?.consumption_state==='conflict'?'Source changed · review revision':r.evidence?.consumption_state==='needs_reconciliation'?'Morning result needs reconciliation':r.state==='running'?(p.kind==='refresh'?'Refreshing clinical data':local?'Saving morning revision':p.kind==='morning'?'Preparing morning notes':p.kind==='capture_note'?'Reading current note':'Updating in Epic'):r.state==='succeeded'?(p.kind==='refresh'?'Refresh verified':local?'Approved for morning':'Verified in Epic'):(requestStates[r.state]||r.state);return `<article class="card request-card"><div class="row start"><div class="request-label">${esc(labels[p.kind]||p.kind)}</div><span class="badge ${r.state==='cancelled'?'neutral':'amber'}">${esc(status)}</span></div><div class="request-detail">${esc(shortProvider(p.provider_id))} · ${esc(p.list||p.name||p.destination||'Patient-specific request')}${p.kind==='consult'?`<br>MRN ${esc(p.mrn)} · ${p.lists.map(esc).join(' · ')}<br>${p.prepare?'Consult preparation explicitly requested':'List additions only · no consult preparation'}`:''}</div><div class="time">Requested ${date(r.created_at)}</div>${r.evidence?.message?`<p class="small">${esc(r.evidence.message)}</p>`:''}${p.kind==='refresh'&&r.evidence?.outcomes?`<p class="small">${esc(refreshOutcomeSummary(r.evidence.outcomes))}</p>`:''}${r.evidence?.same_note_row?'<p class="small">Verified in Epic · existing note updated</p>':''}${['awaiting_activation','queued'].includes(r.state)?`<button class="btn compact" data-action="cancel" data-id="${r.id}">Cancel request</button>`:''}</article>`;}


let lastFocus=null;
function dialog(title,subtitle,body,footer='',narrow=false){
  if(!S.modal)lastFocus=document.activeElement;
  $('#overlay').innerHTML=`<div class="backdrop"><section class="dialog ${narrow?'narrow':''}" role="dialog" aria-modal="true" aria-labelledby="dialog-title"><header class="dialog-head"><div><h2 id="dialog-title">${title}</h2><p>${subtitle}</p></div><button class="icon-button" data-action="close" aria-label="Close dialog">${icon('close')}</button></header><div class="dialog-body">${body}<div id="modal-error" class="form-error" role="alert"></div></div>${footer?`<footer class="dialog-footer">${footer}</footer>`:''}</section></div>`;
  document.body.classList.add('body-lock');setTimeout(()=>$('#overlay .icon-button')?.focus(),0);
}
function unsavedNote(){return NoteSheet.dirty()||Handoff.dirty();}
function closeDialog(force=false){if(!force&&unsavedNote()&&!confirm('Discard your unsaved note changes?'))return false;S.modal=null;S.attachment=null;$('#overlay').innerHTML='';document.body.classList.remove('body-lock');lastFocus?.focus();return true;}
function selectedProvider(){return S.scope==='all'?S.data.providers[0]?.id:S.scope.split(',')[0];}
function providerOptions(current=selectedProvider(),owners=null){return S.data.providers.filter(p=>!owners||owners.includes(p.id)).map(p=>`<option value="${esc(p.id)}" ${current===p.id?'selected':''}>${esc(p.name)}</option>`).join('');}
function openRefresh(kind='refresh'){
  const owner=selectedProvider(),provider=S.data.providers.find(p=>p.id===owner);
  dialog(kind==='refresh'?'Refresh clinical data':'Prepare morning notes',kind==='refresh'?'Choose the list you want checked.':'Keep each provider’s work explicit.',`<label for="action-provider">Provider</label><select id="action-provider">${providerOptions(owner)}</select><label for="action-list">Exact list</label><select id="action-list">${provider.lists.map(l=>`<option>${esc(l)}</option>`).join('')}</select><div class="notice info">${kind==='refresh'?'Refresh labs, imaging, medications, and vitals using a temporary template. Discard is verified. Existing notes and A/P revisions are preserved.':'Prepare and pend notes for the selected provider and list. This request never signs notes.'}</div><p class="small muted">Requests cover the entire selected list. Enabled lists start when their assigned devices are available. Follow progress and patient outcomes in Requests.</p>`,`<button class="btn" data-action="close">Cancel</button><button class="btn primary" data-action="submit-run">Save request</button>`,true);
  S.modal={kind,requestKey:crypto.randomUUID()};
}
function openConsult(notification=null){
  S.attachment=null;const owner=selectedProvider();
  dialog('New consult','Add the patient to the right lists. Prepare only when you choose.',`<div class="segments"><button class="active" data-action="intake-tab" data-tab="screenshot">Screenshot / text</button><button data-action="intake-tab" data-tab="notification">Haiku order</button><button data-action="intake-tab" data-tab="mrn">MRN</button></div><div id="intake-screenshot"><label class="dropzone" id="dropzone" for="screenshot-file">${icon('upload')}<strong>Paste or choose a screenshot</strong><p>PNG, JPEG, WebP · text is extracted on this Mac</p><input type="file" id="screenshot-file" accept="image/png,image/jpeg,image/webp"></label><div id="upload-status" class="small muted"></div><label for="intake-text">Consult message or extracted text</label><textarea id="intake-text" placeholder="Paste the message here. Confirm the patient details below."></textarea></div><div id="intake-notification" class="hidden"><button class="btn soft" data-action="refresh-notifications">${icon('refresh')} Check Haiku for new orders</button><div class="notice info">${S.data.notifications.length?'Select a captured notification. Patient identity is still verified before any Epic action.':'No verified notification capture is available. This does not mean there are no new orders.'}</div><div id="notification-patients">${notificationPatients()}</div></div><div class="step-label">Patient & ownership</div><div class="fieldgrid"><div><label for="consult-mrn">MRN</label><input id="consult-mrn" inputmode="numeric" autocomplete="off" placeholder="Enter MRN"></div><div><label for="consult-name">Patient name</label><input id="consult-name" autocomplete="off" placeholder="Confirm name"></div></div><label for="consult-provider">Responsible provider</label><select id="consult-provider">${providerOptions(owner)}</select><div class="step-label">Add to lists</div><div id="consult-lists" class="listchecks">${consultLists(owner)}</div><label for="other-list">Another exact list (optional)</label><input id="other-list" placeholder="Exact Epic list name"><div class="divider"></div><label class="check"><input id="prepare-consult" type="checkbox"><span><strong>Also prepare the consult note</strong><br><span class="muted">Leave off to add to lists only.</span></span></label><label class="check"><input id="confirm-identity" type="checkbox"><span>I checked the intended patient and MRN above. AutoNote must verify their identity and list membership in Epic.</span></label>`,`<button class="btn" data-action="close">Cancel</button><button class="btn primary" data-action="submit-consult">Review request ${icon('arrow')}</button>`);
  S.modal={kind:'consult',requestKey:crypto.randomUUID()};if(notification)fillNotification(notification);
}
function notificationPatients(){const rows=S.data.notifications.filter(n=>(!n.provider_id||scopeIncludes(n.provider_id))&&LocationView.matches(n));return LocationView.control('notification-location-filter')+(rows.map(n=>`<button class="patient-row" data-action="pick-notification" data-id="${esc(n.id)}"><span class="grow"><h3>${esc(n.name)}</h3><span class="small muted">${esc(n.text)}</span></span>${icon('arrow')}</button>`).join('')||'<p class="small muted">No captured notifications match these filters.</p>');}
function consultLists(owner){const provider=S.data.providers.find(p=>p.id===owner);return ['.HRG-HMH',...provider.lists.filter(l=>l!=='.HRG-HMH')].map(l=>`<label class="check"><input type="checkbox" name="consult-list" value="${esc(l)}" checked ${l==='.HRG-HMH'?'disabled':''}><span>${esc(l)}${l==='.HRG-HMH'?' · always included':''}</span></label>`).join('');}
function fillNotification(id){const n=S.data.notifications.find(n=>n.id===id);if(!n)return;$('#consult-mrn').value=n.mrn;$('#consult-name').value=n.name;$('#intake-text').value=n.text;toast('Notification selected. Confirm the patient details.');}
function openPatient(id,owner=null){return NoteSheet.open(id,owner);}
function runDetail(id){const r=S.data.runs.find(r=>r.id===id);if(!r)return;const c=outcomeCounts(r);dialog(esc(r.pipeline==='precache'?'Overnight capture':'Run details'),`${esc(r.list)} · ${date(r.started_at)}`,`<div class="notice info">${esc(r.liveness||'Run completion recorded')} · ${r.completed}/${r.total??'?'} patients accounted for.</div><div class="row"><span class="badge teal">${c.ready} prepared/captured</span><span class="badge amber">${c.consult} consults</span><span class="badge red">${c.issues} need attention</span></div>${LocationView.outcomeSummary(r.outcomes)}${r.outcomes.filter(LocationView.matches).map(o=>`<div class="result-outcome">${icon(['pended','precached','triage_captured'].includes(o.state)?'check':'alert',o.state==='failed'?'bad':'')}<div><button data-action="patient" data-id="${esc(o.patient_id)}"><h3>${esc(o.name)}</h3></button><p>${esc(o.reason||o.state.replaceAll('_',' '))}</p></div></div>`).join('')||'<p class="audit-note">No patient outcomes match this location.</p>'}`);S.modal={kind:'run',id};}
function settings(){dialog('Console settings','Your connected workspace.',`<div class="settings-block"><h3>Refresh console</h3><p>Pull down from the top of any screen or sheet to refresh. Text you’re editing stays in place.</p><button class="btn soft" data-action="refresh-console">${icon('refresh')} Refresh console</button><button class="btn" data-action="reload-console">Reload app</button></div>${RunBoard.settingsBlock()}<div class="settings-block"><h3>Clinical execution</h3><p>${esc(S.data.activation.message)} Approved morning revisions are used only after the normal source and note checks pass. Other workflows show their activation state in Requests.</p></div><div class="settings-block"><h3>Coverage & freshness</h3><p>Source checked ${esc(date(S.data.updated_at))}. This is a source-read time, not the specimen time.</p>${S.data.warnings.map(w=>`<div class="notice">${esc(w)}</div>`).join('')||'<p>No source-read warnings reported.</p>'}</div><div class="settings-block"><h3>Your review preferences</h3><p>Tier 1: K &gt;5 / &lt;3; Na &gt;150 / &lt;125; CO₂ &lt;17; Phos &gt;6 / &lt;1.5; Mg &lt;1.2; lactate &gt;3; total Ca &gt;11. Values use the configured US units. Critical source flags remain prominent.</p><p>Lab tiers include only unreviewed results collected in the last 24 hours. Older or undated labs stay in history. These are review priorities. Review is personal and never implies clinical resolution.</p></div><div class="settings-block"><h3>Access</h3><p>${esc(S.data.user.name)} · ${esc(S.data.user.role)}. Additional users remain disabled until their provider permissions are configured.</p>${S.data.user.private_access?'<p class="small muted">Your private connection opens this workspace automatically.</p>':'<button class="btn" data-action="lock">Lock this browser tab</button>'}</div>`,'',true);S.modal={kind:'settings'};}
function toast(message){$('#toast').textContent=message;$('#toast').classList.add('show');clearTimeout(toast.timer);toast.timer=setTimeout(()=>$('#toast').classList.remove('show'),4500);}
async function copyMrn(button){
  const mrn=button.dataset.mrn;if(!mrn)return;
  try{await navigator.clipboard.writeText(mrn);toast('MRN copied');}
  catch{toast('Couldn’t copy. Touch and hold the MRN to copy it.');}
}
function modalError(e){if($('#modal-error'))$('#modal-error').textContent=e.message;else toast(e.message);}
async function busy(fn,element){if(S.busy)return;S.busy=true;if(element)element.disabled=true;NoteSheet.sync();try{await fn();}catch(e){modalError(e);}finally{S.busy=false;if(element?.isConnected)element.disabled=false;NoteSheet.sync();}}
async function sendRequest(payload,key){await api('/api/requests',{key,payload});closeDialog();await load();setView('work');toast('Request saved. Follow its status here.');}
async function upload(file){if(!file)return;if(file.size>8000000)throw Error('Choose a screenshot smaller than 8 MB.');$('#upload-status').textContent='Reading screenshot on this Mac…';const raw=await new Promise((resolve,reject)=>{const r=new FileReader();r.onload=()=>resolve(r.result);r.onerror=reject;r.readAsDataURL(file);});const value=await api('/api/extract',{image:raw});S.attachment=value.attachment;$('#intake-text').value=value.text;$('#upload-status').textContent=value.message;const match=value.text.match(/\bMRN\s*[:#]?\s*(\d{5,12})\b/i);if(match)$('#consult-mrn').value=match[1];}

document.addEventListener('submit',e=>{if(e.target.id==='unlock-form'){e.preventDefault();S.token=$('#access-key').value.trim();sessionStorage.setItem('autonote_token',S.token);load();}});
document.addEventListener('toggle',e=>{
  if(!e.target.isConnected)return;
  const key=e.target.dataset.cardKey;
  if(key){if(e.target.open)S.expandedPatients.add(key);else S.expandedPatients.delete(key);rememberCards();}
  RunView.rememberDay(e.target);
  syncCardControls();
},true);
document.addEventListener('keydown',e=>{if(e.target.closest('.patient-tabs')&&['ArrowLeft','ArrowRight','Home','End'].includes(e.key)){e.preventDefault();const tabs=['notes','labs','handoff'],index=tabs.indexOf(S.modal.tab),tab=tabs[e.key==='Home'?0:e.key==='End'?2:(index+(e.key==='ArrowRight'?1:2))%3];NoteSheet.setTab(tab);$('#patient-'+tab+'-tab').focus();}});
document.addEventListener('input',e=>{if(e.target.id==='board-search')RunBoard.search(e.target.value);if(e.target.id==='patient-search'){S.query=e.target.value;$('#patient-results').innerHTML=patientRows();}if(e.target.closest('#note-edit-fields'))NoteSheet.sync();});
document.addEventListener('change',e=>{
  if(e.target.matches('[data-location-filter],[data-building-filter]')){
    if(e.target.matches('[data-building-filter]')){S.building=e.target.value;S.location='all';localStorage.setItem('autonote_building',S.building);}
    else S.location=e.target.value;
    localStorage.setItem('autonote_location',S.location);render();
    if(S.modal?.kind==='run')runDetail(S.modal.id);
    if(S.modal?.kind==='run-group')RunView.detail(S.modal.id);
    if(S.modal?.kind==='consult')$('#notification-patients').innerHTML=notificationPatients();
  }
  if(e.target.id==='list-filter'){S.list=e.target.value;localStorage.setItem('autonote_list',S.list);render();}
  if(e.target.id==='action-provider'){const p=S.data.providers.find(p=>p.id===e.target.value);$('#action-list').innerHTML=p.lists.map(l=>`<option>${esc(l)}</option>`).join('');}
  if(e.target.id==='consult-provider')$('#consult-lists').innerHTML=consultLists(e.target.value);
  if(e.target.id==='note-provider'){if(unsavedNote()&&!confirm('Switch provider and discard your unsaved edit?')){e.target.value=S.modal.owner;return;}openPatient(S.modal.patientId,e.target.value);}
  if(e.target.id==='screenshot-file')busy(()=>upload(e.target.files[0]));
});
document.addEventListener('paste',e=>{if(S.modal?.kind!=='consult')return;const image=[...(e.clipboardData?.items||[])].find(x=>x.type.startsWith('image/'));if(image){e.preventDefault();busy(()=>upload(image.getAsFile()));}});
document.addEventListener('dragover',e=>{if(e.target.closest('#dropzone')){e.preventDefault();$('#dropzone').classList.add('drag');}});
document.addEventListener('dragleave',e=>{if(e.target.closest('#dropzone'))$('#dropzone').classList.remove('drag');});
document.addEventListener('drop',e=>{if(e.target.closest('#dropzone')){e.preventDefault();$('#dropzone').classList.remove('drag');busy(()=>upload(e.dataTransfer.files[0]));}});
document.addEventListener('keydown',e=>{if(!S.modal)return;if(e.key==='Escape')Handoff.beforeClose(()=>closeDialog());if(e.key==='Tab'){const els=[...$('#overlay').querySelectorAll('button,input,textarea,select,a[href]')].filter(x=>!x.disabled&&x.getClientRects().length);if(!els.length)return;const first=els[0],last=els.at(-1);if(e.shiftKey&&document.activeElement===first){last.focus();e.preventDefault();}else if(!e.shiftKey&&document.activeElement===last){first.focus();e.preventDefault();}}});
document.addEventListener('click',e=>{const b=e.target.closest('[data-action]');if(!b||b.disabled)return;const a=b.dataset.action;
  if(a==='copy-mrn'){e.preventDefault();e.stopPropagation();return copyMrn(b);}
  if(RunBoard.action(a,b))return;
  if(a==='navigate')return setView(b.dataset.view);
  if(a==='autoplan'){location.href=AUTOPLAN_URL;return;}
  if(a==='data-refresh')return DataView.refresh();
  if(a==='toggle-cards')return toggleCards();
  if(a==='scope'){S.scope=b.dataset.id;S.list='all';localStorage.setItem('autonote_scope',S.scope);localStorage.setItem('autonote_list','all');return render();}
  if(a==='provider-group'){dialog('Choose providers','Keep this group selected across the console.',`<div class="listchecks">${S.data.providers.map(p=>`<label class="check"><input type="checkbox" name="provider-group" value="${esc(p.id)}" ${scopeIncludes(p.id)?'checked':''}><span>${esc(p.name)}</span></label>`).join('')}</div>`,`<button class="btn" data-action="close">Cancel</button><button class="btn primary" data-action="set-provider-group">Use selected providers</button>`,true);S.modal={kind:'providers'};return;}
  if(a==='set-provider-group'){const ids=[...document.querySelectorAll('[name="provider-group"]:checked')].map(e=>e.value);if(!ids.length)return modalError(Error('Choose at least one provider.'));S.scope=ids.length===S.data.providers.length?'all':ids.join(',');S.list='all';localStorage.setItem('autonote_scope',S.scope);localStorage.setItem('autonote_list','all');closeDialog();return render();}
  if(a==='review-tier'){S.tier=Number(b.dataset.tier);S.filter='new';return setView('review');}
  if(a==='reviewed'){S.tier=0;S.filter='reviewed';return setView('review');}
  if(a==='tier'){S.tier=Number(b.dataset.tier);return render();}
  if(a==='filter'){S.filter=b.dataset.id;return render();}
  if(a==='reload')return load();
  if(a==='refresh-console')return ConsoleRefresh.run();
  if(a==='reload-console')return location.reload();
  if(a==='settings')return settings();
  if(a==='refresh')return openRefresh();
  if(a==='new-run')return openRefresh('morning');
  if(a==='consult')return openConsult();
  if(a==='patient')return openPatient(b.dataset.id,b.dataset.owner||null);
  if(a==='lab-detail'){
    const root=b.closest('.result-group'),r=S.data.results.find(r=>r.id===b.dataset.id);if(!r)return;
    const detail=root.querySelector('.lab-expanded');detail.hidden=false;
    detail.innerHTML=LabView.details(r,S.data.results.filter(x=>x.patient_id===r.patient_id));
    return;
  }
  if(a==='close-lab-detail'){b.closest('.lab-expanded').hidden=true;return;}
  if(a==='run-detail')return runDetail(b.dataset.id);
  if(a==='run-group-detail')return RunView.detail(b.dataset.id);
  if(a==='run-group-consults')return RunView.consults(b.dataset.id);
  if(a==='close')return Handoff.beforeClose(()=>closeDialog());
  if(a==='patient-view'){S.patientView=b.dataset.id;return render();}
  if(a==='handoff-patient')return NoteSheet.open(b.dataset.id,b.dataset.provider,{tab:'handoff'});
  if(a==='handoff-generate-list')return busy(()=>Handoff.generateList(),b);
  if(a==='handoff-pdf')return busy(()=>Handoff.download(),b);
  if(a==='handoff-refresh')return busy(()=>load(),b);
  if(a==='lock'||a==='unlock-again'){closeDialog();S.token='';S.data=null;sessionStorage.removeItem('autonote_token');return renderUnlock();}
  if(a==='intake-tab'){document.querySelectorAll('[data-action="intake-tab"]').forEach(x=>x.classList.toggle('active',x===b));$('#intake-screenshot').classList.toggle('hidden',b.dataset.tab!=='screenshot');$('#intake-notification').classList.toggle('hidden',b.dataset.tab!=='notification');if(b.dataset.tab==='mrn')$('#consult-mrn').focus();return;}
  if(a==='pick-notification')return fillNotification(b.dataset.id);
  if(a==='note-mode')return NoteSheet.setMode(b.dataset.id);
  if(a==='patient-tab')return NoteSheet.setTab(b.dataset.id);
  if(a==='use-revision'){if(unsavedNote()&&!confirm('Replace your unsaved edit with this version?'))return;return NoteSheet.open(S.modal.patientId,S.modal.owner,{revisionId:b.dataset.id});}
  if(a==='review-all'){
    const ids=patientReviewIds($('#main'));if(!ids.length)return toast('Expand a patient to review their captured findings.');dialog('Mark these findings reviewed?',`${ids.length} captured findings · ${S.scope==='all'?'all providers':esc(scopeLabel())}`,`<p class="detail-summary">This reviews the current captured findings for the expanded patients, including older results under Lab trends. A newly discovered result, new specimen, or amended report will still surface.</p><p class="small muted">This does not mark the clinical issues resolved or acknowledge results for another user.</p>`,`<button class="btn" data-action="close">Cancel</button><button class="btn primary" data-action="confirm-review">${icon('check')} Mark reviewed</button>`,true);S.modal={kind:'review',ids};return;
  }
  if(a==='submit-consult'){
    const payload={kind:'consult',provider_id:$('#consult-provider').value,mrn:$('#consult-mrn').value.trim(),name:$('#consult-name').value.trim(),lists:[...document.querySelectorAll('[name="consult-list"]:checked')].map(x=>x.value),prepare:$('#prepare-consult').checked,intake:$('#intake-text').value,identity_confirmed:$('#confirm-identity').checked,attachment:S.attachment};
    if($('#other-list').value.trim())payload.lists.push($('#other-list').value);
    if(!payload.mrn||!payload.identity_confirmed)return modalError(Error('Enter the MRN and confirm the intended patient.'));
    const requestKey=S.modal.requestKey;
    dialog('Confirm consult request',`${esc(payload.name||'Patient')} · MRN ${esc(payload.mrn)}`,`<div class="card"><h3>${esc(shortProvider(payload.provider_id))}</h3><p class="small muted">Add to ${payload.lists.map(esc).join(' · ')}</p></div><div class="notice ${payload.prepare?'':'info'}">${payload.prepare?'You are explicitly requesting consult note preparation after verified list additions.':'Add to lists only. No consult note will be prepared.'}</div><p class="small muted">Enabled routes start after you submit. Each list addition and any requested consult note must be verified in Epic.</p>`,`<button class="btn" data-action="close">Cancel</button><button class="btn primary" data-action="confirm-request">Save request</button>`,true);S.modal={kind:'confirm',payload,requestKey};return;
  }

  busy(async()=>{
    if(a==='review-patient'){const ids=patientReviewIds(b.closest('.result-group'));if(!ids.length)return toast('Expand a patient to review their captured findings.');await api('/api/review',{ids});await load();refreshOpenLabs();toast(`Patient reviewed. New or changed findings will bring them back.`);}
    if(a==='unreview'){await api('/api/unreview',{id:b.dataset.id});await load();refreshOpenLabs();toast('Returned to your review queue.');}
    if(a==='confirm-review'){const ids=S.modal.ids;await api('/api/review',{ids});closeDialog();await load();toast(`${ids.length} findings marked reviewed for you.`);}
    if(a==='refresh-notifications'){const provider=$('#consult-provider').value,p=S.data.providers.find(p=>p.id===provider);await sendRequest({kind:'notifications',provider_id:provider,list:p.lists[0]},crypto.randomUUID());}
    if(a==='choose-note'){const request=S.data.requests.find(r=>r.id===b.dataset.request),row=request.evidence.note_choices[Number(b.dataset.choice)];await sendRequest({...request.payload,row},crypto.randomUUID());}
    if(a==='capture-note'){const m=S.modal,p=S.data.patients.find(p=>p.id===m.patientId);await sendRequest({kind:'capture_note',provider_id:m.owner,patient_id:p.id,list:$('#capture-note-list').value},crypto.randomUUID());}
    if(a==='reload-patient'){const m=S.modal;if(unsavedNote())throw Error('Save your changes before refreshing this panel.');await load();openPatient(m.patientId,m.owner);}
    if(a==='submit-run')await sendRequest({kind:S.modal.kind,provider_id:$('#action-provider').value,list:$('#action-list').value},S.modal.requestKey);
    if(a==='confirm-request')await sendRequest(S.modal.payload,S.modal.requestKey);
    if(a==='cancel'){await api('/api/cancel',{id:b.dataset.id});await load();toast('Request cancelled.');}
    if(a==='submit-note-change')await NoteSheet.submit();
    if(a==='cancel-note-change'){try{await NoteSheet.cancel();}catch(e){await NoteSheet.refresh();throw e;}}
  },b);
});
window.addEventListener('hashchange',()=>{const v=location.hash.slice(1);if(v==='autoplan')return location.assign(AUTOPLAN_URL);if(['today','review','patients','work'].includes(v)){S.view=v==='today'?'review':v;render();}});
setInterval(()=>{if(!S.data||S.busy||document.visibilityState!=='visible')return;if(NoteSheet.waiting())return busy(()=>NoteSheet.refresh());if(Handoff.waiting())return Handoff.poll().catch(()=>{});if(!S.modal&&!document.querySelector('.patient-card[open] .lab-history[open],.patient-card[open] .lab-expanded:not([hidden])')&&document.activeElement?.tagName!=='INPUT')load(true);},10000);
load();

function hasSubjective(note){return note?.state==='pended'&&note.editable===true&&note.ownership_verified===true&&note.fields?.length===18;}
function directEditor(note){
  if(!note.fields)return `<label for="revision-text">Your revised A/P</label><textarea id="revision-text" class="editor">${esc(note.text)}</textarea>`;
  const field=(text,i)=>`<label for="note-field-${i}">${i===0?'Assessment':i===16?'Quick Subjective':i===17?'Subjective Stack':'Plan line '+i}</label><textarea id="note-field-${i}" data-note-field="${i}" rows="${i===17?8:i===0||i===16?4:text?2:1}">${esc(text)}</textarea>`;
  const filled=note.fields.slice(0,16).map((text,i)=>text||i===0?field(text,i):'').join(''),empty=note.fields.slice(0,16).map((text,i)=>!text&&i?field(text,i):'').join('');
  return filled+(empty?`<details class="unused-plan"><summary>Add to an unused plan line</summary>${empty}</details>`:'')+(hasSubjective(note)?`<div class="subjective-fields">${field(note.fields[16],16)}${field(note.fields[17],17)}</div>`:'');
}
function noteCaptureControls(patient,owner){const provider=S.data.providers.find(p=>p.id===owner),lists=patient.lists.filter(l=>provider?.lists.includes(l));if(!lists.length)return '';const hasNote=S.data.notes.some(n=>n.patient_id===patient.id&&n.provider_id===owner&&n.editable);return `<details class="note-capture-details" ${hasNote?'':'open'}><summary>Read or refresh note from Epic</summary><label for="capture-note-list">Patient list</label><select id="capture-note-list">${lists.map(l=>`<option ${l===S.list?'selected':''}>${esc(l)}</option>`).join('')}</select><button class="btn soft" data-action="capture-note">${icon('refresh')} Read current pended note</button></details>`;}

function noteChoices(patient,owner){const request=S.data.requests.find(r=>r.payload.kind==="capture_note"&&r.payload.patient_id===patient.id&&r.payload.provider_id===owner&&r.evidence?.note_choices?.length);if(!request)return "";return `<h3>Choose the note to read</h3>${request.evidence.note_choices.map((row,i)=>`<button class="patient-row" data-action="choose-note" data-request="${esc(request.id)}" data-choice="${i}"><span class="grow"><span class="small">${esc(row)}</span></span>${icon("arrow")}</button>`).join("")}`;}
