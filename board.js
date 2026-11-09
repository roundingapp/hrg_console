'use strict';

// Live morning-run board: the run's whole roster grouped by unit, each card a
// note status + device + tier + a text fishbone. Rebuilt from every poll.
const RunBoard=(()=>{
  const statusText={queued:'Queued',in_progress:'In progress',pended:'Pended',signed:'Signed',consult:'Needs consult',held:'Waiting for labs',cardonly:'Labs only',needsnote:'Needs note',skipped:'Skipped',failed:'Failed',retry:'Retry',interrupted:'Interrupted'};
  const statusFilters=[['all','All'],['in_progress','In progress'],['pended','Pended'],['signed','Signed'],['consult','Consult'],['held','Labs'],['cardonly','Labs only'],['needsnote','Needs note'],['retry','Retry'],['attention','Failed'],['queued','Queued'],['skipped','Skipped'],['processed','Processed']];
  const F={status:'all',building:'all',provider:'all',tier:0,query:'',list:'',view:'review'};
  try{Object.assign(F,JSON.parse(sessionStorage.getItem('autonote_board')||'{}'));}catch{}
  const remember=()=>{try{sessionStorage.setItem('autonote_board',JSON.stringify({...F,query:''}));}catch{}};
  const lists=()=>S.data?.board?.lists||[];
  const current=()=>lists().find(b=>b.slug===F.list)||lists()[0];
  const resultsFor=id=>(S.data?.results||[]).filter(r=>r.patient_id===id);
  const building=p=>p.location_scope?.building||String(p.unit||'').replace(/^HMH\s+/,'').split(/\s+/)[0]||'Unknown';
  const unit=p=>p.location_scope?.unit||p.unit||'No location';
  // Building as it reads on the card, in front of the room: 'HMH DUNN' → 'Dunn';
  // other campuses keep their prefix ('HMCCH JONES').
  // Hospitalist (the roster row's attending) as it reads on the card:
  // 'Vu, Lien Ngoc, MD' → 'Vu, Lien Ngoc'. Full text stays in the tooltip.
  const attending=a=>String(a).replace(/,\s*(MD|DO|NP|PA|PA-C|APRN|FNP|AGACNP-BC|MBBS)\.?\s*$/i,'').trim();
  const bldg=p=>{const b=String(p.location_scope?.building||'').trim();if(!b)return '';
    return /^HMH\s/.test(b)?b.replace(/^HMH\s+/,'').split(/\s+/).map(w=>w.length>2?w[0]+w.slice(1).toLowerCase():w).join(' '):b;};
  // Board preferences (Console settings → Run board): per tier, what to group
  // by and how to order. Saved on the console per user so phone and desktop
  // agree; this browser keeps a copy for when the console can't be reached.
  const TRIGGER_NAMES={potassium:'Potassium',phosphorus:'Phosphorus',sodium:'Sodium',co2:'CO₂',lactate:'Lactate',magnesium:'Magnesium',calcium:'Calcium',imaging:'Imaging'};
  const STATUS_ORDER=['failed','interrupted','retry','needsnote','in_progress','consult','held','queued','pended','signed','cardonly','skipped'];
  // Provider filter (master-list run, 10/30): tags come from today's provider-list walks.
  // My list = Dr. Sutaria's own list only, and only on his view (10/31).
  const MY_LIST='Sutaria';
  const providerOk=p=>F.provider==='all'||(F.provider==='unassigned'?!(p.providers||[]).length:(p.providers||[]).includes(F.provider==='mine'?MY_LIST:F.provider));
  const GROUPS=[['unit','Unit'],['trigger','Lab trigger'],['status','Note status'],['device','Device'],['none','No grouping']];
  const ORDERS=[['newest','Newest activity first'],['oldest','Oldest activity first'],['bed','Unit & bed'],['name','Name A–Z']];
  const SCOPES=[['0','All patients'],['1','Tier 1'],['2','Tier 2'],['3','Tier 3']];
  const DEFAULTS={rules:{0:{group:'unit',order:'bed'},1:{group:'unit',order:'newest'},2:{group:'trigger',order:'newest'},3:{group:'unit',order:'newest'}},
    triggers:Object.keys(TRIGGER_NAMES),shade:true};
  const clone=x=>JSON.parse(JSON.stringify(x));
  let localPrefs=null;try{localPrefs=JSON.parse(localStorage.getItem('autonote_board_prefs')||'null');}catch{}
  function prefs(){
    const saved=S.data?.prefs?.board||localPrefs||{},out=clone(DEFAULTS);
    for(const k of Object.keys(out.rules)){const r=saved.rules?.[k]||{};
      if(GROUPS.some(([g])=>g===r.group))out.rules[k].group=r.group;
      if(ORDERS.some(([o])=>o===r.order))out.rules[k].order=r.order;}
    if(Array.isArray(saved.triggers)){const known=saved.triggers.filter(k=>k in TRIGGER_NAMES);out.triggers=[...new Set([...known,...out.triggers])];}
    if(typeof saved.shade==='boolean')out.shade=saved.shade;
    return out;
  }
  let saveNote='';
  async function savePrefs(next){
    localPrefs=next;try{localStorage.setItem('autonote_board_prefs',JSON.stringify(next));}catch{}
    if(S.data){S.data.prefs={...(S.data.prefs||{}),board:next};}
    try{await api('/api/prefs',{board:next});saveNote='Saved for every device.';}
    catch(e){saveNote='Saved on this device only — the console could not store it ('+e.message+').';}
    const box=document.getElementById('board-settings');if(box)box.outerHTML=settingsBlock();
  }
  // Tapping a card's header shades it light green (kept per patient for the
  // day in this browser; resets tomorrow).
  const shadeKey='autonote_board_shade_'+new Date().toLocaleDateString('en-CA');
  let shades={};try{shades=JSON.parse(localStorage.getItem(shadeKey)||'{}')||{};}catch{}
  // A level attribute, not an inline style: the console's CSP (style-src 'self')
  // drops style="" attributes in rendered HTML, so the 10 s poll erased the shade.
  const shadeAttr=id=>shades[id]&&prefs().shade?' data-shade':'';
  const collapsedKey='autonote_board_collapsed_groups',DONE_KEY='sec:done';
  let collapsed=new Set();try{collapsed=new Set(JSON.parse(localStorage.getItem(collapsedKey)||'[]'));}catch{}
  document.addEventListener('toggle',e=>{
    const g=e.target.isConnected&&e.target.classList&&e.target.classList.contains('rb-group')?e.target.dataset.groupKey:'';if(!g)return;
    if(e.target.open!==(g===DONE_KEY))collapsed.delete(g);else collapsed.add(g);
    try{localStorage.setItem(collapsedKey,JSON.stringify([...collapsed]));}catch{}
  },true);
  // A card tapped green stays where it is in "To review" (shaded) until he
  // switches tabs — no card moves under his finger (Dr. Sutaria, 2026-10-31:
  // "just two separate lists"). Switching tabs clears the hold.
  const held=new Set();
  document.addEventListener('click',e=>{
    const sum=e.target.closest('.rb-card>summary');if(!sum||e.target.closest('button,a,input')||!prefs().shade)return;
    const c=sum.parentElement,id=c.dataset.patientId;if(!id)return;
    if(!shades[id])held.add(id);
    shades[id]=1;c.setAttribute('data-shade','');
    try{localStorage.setItem(shadeKey,JSON.stringify(shades));}catch{}
    const b=current();if(b)syncTierLeft(b);
  });
  // Long press on a card face = mark it unreviewed (drops the green shade,
  // card goes back to "To review"). The click that ends the press is eaten so
  // it neither toggles the card nor re-shades it.
  let lp=null,lpFired=0;
  const lpCancel=()=>{if(lp){clearTimeout(lp.t);lp=null;}};
  document.addEventListener('pointerdown',e=>{
    const sum=e.target.closest('.rb-card>summary');if(!sum||e.target.closest('button,a,input'))return;
    const id=sum.parentElement.dataset.patientId;if(!id)return;
    lpCancel();
    lp={x:e.clientX,y:e.clientY,t:setTimeout(()=>{
      lp=null;lpFired=Date.now();
      delete shades[id];held.delete(id);
      try{localStorage.setItem(shadeKey,JSON.stringify(shades));}catch{}
      try{navigator.vibrate&&navigator.vibrate(30);}catch{}
      refreshResults();
    },550)};
  },true);
  document.addEventListener('pointermove',e=>{if(lp&&Math.hypot(e.clientX-lp.x,e.clientY-lp.y)>10)lpCancel();},true);
  ['pointerup','pointercancel','scroll'].forEach(t=>document.addEventListener(t,lpCancel,true));
  window.addEventListener('click',e=>{
    if(Date.now()-lpFired<800&&e.target.closest('.rb-card>summary')){e.preventDefault();e.stopPropagation();lpFired=0;}
  },true);
  document.addEventListener('contextmenu',e=>{if(e.target.closest('.rb-card>summary'))e.preventDefault();},true);
  // Tier pill number = patients in that tier not yet shaded green, so it
  // counts down as cards are reviewed. Shading off ⇒ nobody counts as reviewed.
  const reviewed=id=>!!(shades[id]&&prefs().shade);
  // …among the patients the OTHER filters (status, building, search) show — so
  // the pill and the list's "To review" can never disagree.
  const tierLeft=(b,t)=>b.patients.filter(p=>matches(p,true)&&LabView.priority(resultsFor(p.patient_id)).tier===t&&!reviewed(p.patient_id)).length;
  // Tier dropdown options read 'Tier 1 · 4' (4 = not yet reviewed).
  const syncTierLeft=b=>{document.querySelectorAll('[data-tier-left]').forEach(el=>{el.textContent='Tier '+el.dataset.tierLeft+' · '+tierLeft(b,Number(el.dataset.tierLeft));});
    const vc=viewCounts(b),t=document.getElementById('rb-n-todo'),d=document.getElementById('rb-n-done');if(t)t.textContent=vc.todo;if(d)d.textContent=vc.done;};

  // Three short lines: BMP fishbone, CBC, then Mg / Phos / Ca stacked.
  function fishbone(results){
    const labs=results.filter(r=>r.kind==='lab');
    if(!labs.length)return '';
    const {latest}=LabView.split(labs);
    const tone=r=>{const t=r.threshold_tier??r.tier;return r.critical||t===1?'lab-urgent':t===2?'lab-early':t===3?'lab-abnormal':'';};
    const v=k=>{const r=latest.get(k);return r?{t:String(r.value).replace(/\s+/g,'')+(r.critical?'!':''),c:tone(r)}:{t:'·',c:'fb-missing'};};
    const pad=(x,w,a='r')=>{const n=Math.max(0,w-x.t.length),l=a==='r'?n:a==='c'?Math.floor(n/2):0;return ' '.repeat(l)+`<span class="${x.c}">${esc(x.t)}</span>`+' '.repeat(n-l);};
    const width=(...xs)=>Math.max(...xs.map(x=>x.t.length));
    const blocks=[];
    const na=v('sodium'),k=v('potassium'),cl=v('chloride'),co2=v('co2'),bun=v('bun'),cr=v('creatinine'),glu=v('glucose');
    if(['sodium','potassium','chloride','co2','bun','creatinine','glucose'].some(x=>latest.has(x))){
      const a=width(na,k),b=width(cl,co2),c=width(bun,cr),g=glu.t.length;
      blocks.push([`${pad(na,a)}│${pad(cl,b)}│${pad(bun,c,'l')}╱${' '.repeat(g)}`,
        `${'─'.repeat(a)}┼${'─'.repeat(b)}┼${'─'.repeat(c)}&lt;${pad(glu,g,'l')}`,
        `${pad(k,a)}│${pad(co2,b)}│${pad(cr,c,'l')}╲${' '.repeat(g)}`]);
    }
    const wbc=v('wbc'),hgb=v('hemoglobin'),hct=v('hematocrit'),plt=v('platelets');
    if(['wbc','hemoglobin','hematocrit','platelets'].some(x=>latest.has(x))){
      const w=wbc.t.length,h=Math.max(3,width(hgb,hct)),p=plt.t.length;
      blocks.push([`${' '.repeat(w+1)}${pad(hgb,h,'c')}${' '.repeat(p+1)}`,
        `${pad(wbc,w)}&gt;${'─'.repeat(h)}&lt;${pad(plt,p,'l')}`,
        `${' '.repeat(w+1)}${pad(hct,h,'c')}${' '.repeat(p+1)}`]);
    }
    const mg=v('magnesium'),ph=v('phosphorus'),ca=v('calcium');
    if(['magnesium','phosphorus','calcium'].some(x=>latest.has(x))){
      const w=width(mg,ph,ca);
      blocks.push([`Mg ${pad(mg,w,'l')}`,`Ph ${pad(ph,w,'l')}`,`Ca ${pad(ca,w,'l')}`]);
    }
    // Lactate only when it is flagged (a tier or critical) — it is a trigger.
    const lac=latest.get('lactate');
    if(lac&&(lac.critical||(lac.threshold_tier??lac.tier))){const x=v('lactate');blocks.push([`Lac ${pad(x,x.t.length,'l')}`,'','']);}
    if(!blocks.length)return '';
    const newest=Math.max(...labs.map(r=>Date.parse(r.result_time)||0));
    const old=newest&&Date.now()-newest>24*3600000;
    const when=newest?new Date(newest).toLocaleTimeString([],{hour:'numeric',minute:'2-digit'}):'';
    return `<pre class="rb-fish ${old?'rb-old':''}" title="${old?'Newest lab is older than 24 hours':'Latest values · newest collected '+esc(when)}">${[0,1,2].map(i=>blocks.map(b=>b[i]).join('   ')).join('\n')}</pre>`;
  }

  const SHORT={'Selected Medications':'Meds','Medical Decision Making':'MDM','Nutrition':'Diet','Imaging':'Img'};
  // The note's own subjective stack (labs dropped — the fishbone has them).
  // No A/P on the card (10/31, his call: yesterday's A/P is not wanted).
  function stack(p){
    return stack0(p)+pendedAp(p);
  }
  // The A/P typed into today's pended note, at the very bottom of the card.
  function pendedAp(p){
    if(!p.pended_ap?.text)return '';
    return `<div class="rb-stack rb-pap"><div class="rb-sec"><span class="rb-sec-t" title="Pended A/P · composed ${esc(date(p.pended_ap.at))}">A/P</span><div>${esc(p.pended_ap.text)}</div></div></div>`;
  }
  function stack0(p){
    const st=p.stack;
    if(!st)return `<p class="rb-nolabs">${['queued','in_progress'].includes(p.status)?'Stack appears once the template is read':p.status==='cardonly'?'No stack read':'No note written this run'}</p>`;
    return `<div class="rb-stack">${st.lead?`<p class="rb-lead">${esc(st.lead)}</p>`:''}${st.sections.map(([t,b])=>`<div class="rb-sec"><span class="rb-sec-t">${esc(SHORT[t]||t)}</span><div>${esc(b)}</div></div>`).join('')}</div>`;
  }

  // Imaging reports that put this patient in their tier — on the card face
  // when the card is listed under the Imaging trigger.
  function imagingFace(p){
    const tier=F.tier||LabView.priority(resultsFor(p.patient_id)).tier;
    const rows=resultsFor(p.patient_id).filter(r=>r.kind!=='lab'&&r.tier===tier&&!r.reviewed_at);
    return rows.map(r=>`<div class="rb-img"><strong>${esc(r.label)}</strong> ${esc(String(r.report||'No report text').replace(/\s+/g,' ').trim())}</div>`).join('');
  }

  function card(p,opts={}){
    const results=resultsFor(p.patient_id),rank=LabView.priority(results),key='board:'+p.patient_id;
    const fish=fishbone(results);
    const status=`<span class="rb-status rb-${p.status}" title="${esc(p.label+(p.stage?' · '+p.stage:'')+(p.since?' · '+date(p.since):''))}">${esc(p.status==='in_progress'&&p.stage?p.stage:p.status==='failed'?'Failed':p.status==='retry'?'Retry':p.label||statusText[p.status])}</span>`;
    const tier=rank.tier?`<span class="rb-tier t${rank.tier}">${rank.critical?'!':''}T${rank.tier}</span>`:'';
    const noLabs=['queued','in_progress','held'].includes(p.status)?'labs pending':'no lab results today';
    return `<details class="rb-card patient-card tier${rank.tier}" data-patient-id="${esc(p.patient_id)}" data-card-key="${esc(key)}"${shadeAttr(p.patient_id)} ${S.expandedPatients.has(key)?'open':''}><summary><div class="rb-line">${p.mrn?`<button type="button" class="rb-name rb-name-copy" data-action="copy-mrn" data-mrn="${esc(p.mrn)}" aria-label="Copy MRN ${esc(p.mrn)}" title="Tap to copy MRN"><strong>${esc(p.name)}</strong></button>`:`<strong class="rb-name">${esc(p.name)}</strong>`}${p.mrn?`<button type="button" class="patient-mrn" data-action="copy-mrn" data-mrn="${esc(p.mrn)}" aria-label="Copy MRN ${esc(p.mrn)}" title="Tap to copy MRN"><span class="mrn-value">${esc(p.mrn)}</span>${icon('copy')}</button>`:''}${tier}${p.flags.map(f=>`<span class="rb-flag" title="Wildcard left in the pended note">${esc(f)}</span>`).join('')}<span class="rb-dev">${esc(p.device_label||'—')}</span><span class="rb-stcol">${status}${(p.providers||[]).length?`<span class="rb-prov" title="Provider list">${esc(p.providers.join(', '))}</span>`:''}</span></div><div class="rb-where"><span class="rb-bed">${esc([bldg(p),p.bed||'—'].filter(Boolean).join(' '))}${p.away?' · in '+esc(p.away):''}</span>${p.attending?`<span class="rb-att" title="Hospitalist: ${esc(p.attending)}">${esc(attending(p.attending))}</span>`:''}</div>${fish||`<div class="rb-nolabs">${noLabs}</div>`}${imagingFace(p)}</summary><div class="rb-body"><div class="rb-meta"><span>${esc(p.label)}${p.since?' · '+esc(date(p.since)):''}${p.planned&&p.planned!==p.device?' · planned '+esc(p.planned):''}</span>${S.data?.user?.role==='partner'?'':`<button class="btn link small" data-action="patient" data-id="${esc(p.patient_id)}"${p.pended_ap?.text?' data-owner="sutaria" title="Open the pended note"':''}>${icon('note')} Notes</button>`}<button class="btn link small rb-unreview" data-action="board-unreview" data-id="${esc(p.patient_id)}">Mark unreviewed</button></div>${stack(p)}</div></details>`;
  }

  function statusOk(p){
    if(F.status==='processed'){const live=current()?.live;return !(['queued','in_progress','retry'].includes(p.status)||(live&&['held','interrupted'].includes(p.status)));}
    return F.status==='attention'?['failed','interrupted'].includes(p.status):F.status==='all'||p.status===F.status;
  }
  function matches(p,anyTier){
    const rank=LabView.priority(resultsFor(p.patient_id));
    if(!anyTier&&F.tier&&rank.tier!==F.tier)return false;
    if(!statusOk(p))return false;
    if(F.building!=='all'&&building(p)!==F.building)return false;
    if(!providerOk(p))return false;
    const q=F.query.trim().toLowerCase();
    return !q||[p.name,p.mrn,p.bed,p.unit,p.away,p.device_label,p.attending].join(' ').toLowerCase().includes(q);
  }

  // Full list (rounding view): the SAME cards as To review (same taps, shade,
  // long press), just every patient by unit then bed — no reviewed split.
  // Only the building and search filters apply.
  function fullList(b){
    const q=F.query.trim().toLowerCase();
    const shown=b.patients.filter(p=>statusOk(p)&&(F.building==='all'||building(p)===F.building)&&providerOk(p)&&(!q||[p.name,p.mrn,p.bed,p.unit,p.away,p.attending].join(' ').toLowerCase().includes(q)));
    if(!shown.length)return empty('No patients match','Clear the status or building filter, or the search.','search');
    const groups=new Map();
    for(const p of shown){const k=unit(p);if(!groups.has(k))groups.set(k,[]);groups.get(k).push(p);}
    const bedCmp=(x,y)=>String(x.bed||'~').localeCompare(String(y.bed||'~'),undefined,{numeric:true});
    return `<p class="small muted rb-lcount">${shown.length} patient${shown.length===1?'':'s'}</p>`+[...groups].map(([k,ps])=>{const g='list:'+k;
      return `<details class="rb-group" data-group-key="${esc(g)}"${collapsed.has(g)?'':' open'}><summary class="rb-unit">${icon('arrow')}<span>${esc(k)}</span><span class="rb-unit-n"> · ${ps.length}</span></summary><div class="rb-group-cards">${ps.sort(bedCmp).map(p=>card(p)).join('')}</div></details>`;}).join('');
  }

  function results(){
    const b=current();if(!b)return '';
    if(F.view==='list')return fullList(b);
    // To review = ONLY patients with an unreviewed flag (tier 1-3). Unflagged
    // patients live in Full list only (Dr. Sutaria, 2026-10-31).
    const shown=b.patients.filter(p=>matches(p)&&LabView.priority(resultsFor(p.patient_id)).tier>0);
    if(!shown.length)return empty('No flagged patients','Nobody matching these filters has an unreviewed flag. Full list shows everyone.','search');
    if(!prefs().shade)return grouped(shown,'');
    // Two separate tabs: To review / Reviewed. A card shaded while on To
    // review is held there until the tab changes.
    const {todo,done}=split(shown);
    if(F.view==='done')return done.length?grouped(done,'done:'):empty('Nothing reviewed yet','Tap a card on To review to mark it reviewed. Long press brings it back.','check');
    return todo.length?grouped(todo,''):'<div class="rb-allreviewed">All reviewed</div>';
  }
  function split(shown){
    const done=shown.filter(p=>reviewed(p.patient_id)&&!held.has(p.patient_id));
    return {done,todo:shown.filter(p=>!done.includes(p))};
  }
  function viewCounts(b){
    const shown=b.patients.filter(p=>matches(p)&&LabView.priority(resultsFor(p.patient_id)).tier>0);
    return {todo:shown.filter(p=>!reviewed(p.patient_id)).length,done:shown.filter(p=>reviewed(p.patient_id)).length};
  }
  // Cards grouped per the tier's rule. `prefix` keeps a unit collapsed in
  // "Reviewed" independent of the same unit in "To review".
  function grouped(shown,prefix){
    const P=prefs(),rule=P.rules[F.tier]||P.rules[0],t=p=>String(p.since||''),pos=new Map(shown.map((p,i)=>[p,i]));
    const trigger=p=>{const tier=F.tier||LabView.priority(resultsFor(p.patient_id)).tier;if(!tier)return 'No lab trigger';
      const keys=new Set(resultsFor(p.patient_id).filter(r=>r.tier===tier&&!r.reviewed_at).map(r=>r.kind==='lab'?r.key:'imaging'));
      const hit=P.triggers.find(k=>keys.has(k));return hit?TRIGGER_NAMES[hit]:'Other';};
    const keyOf={unit,trigger,status:p=>statusText[p.status]||p.status,device:p=>p.device_label||'No device',none:()=>''}[rule.group];
    const cmp={newest:(x,y)=>t(y).localeCompare(t(x)),oldest:(x,y)=>(!t(x))-(!t(y))||t(x).localeCompare(t(y)),
      bed:(x,y)=>pos.get(x)-pos.get(y),name:(x,y)=>String(x.name).localeCompare(String(y.name))}[rule.order];
    // Fixed-order groups first (trigger order from settings, status by urgency).
    const groups=new Map(rule.group==='trigger'?P.triggers.map(k=>[TRIGGER_NAMES[k],[]]):rule.group==='status'?STATUS_ORDER.map(k=>[statusText[k],[]]):[]);
    for(const p of shown){const k=keyOf(p);if(!groups.has(k))groups.set(k,[]);groups.get(k).push(p);}
    let entries=[...groups].filter(([,ps])=>ps.length).map(([k,ps])=>[k,ps.sort((x,y)=>cmp(x,y)||pos.get(x)-pos.get(y))]);
    if(rule.group==='unit'||rule.group==='device'){
      if(rule.order==='name')entries.sort(([a],[b])=>a.localeCompare(b));
      else if(rule.order==='newest'||rule.order==='oldest')entries.sort(([,a],[,b])=>cmp(a[0],b[0]));
    }
    const counted=rule.group!=='unit';
    const cards=(k,ps)=>ps.map(p=>card(p,{imaging:rule.group==='trigger'&&k===TRIGGER_NAMES.imaging})).join('');
    if(rule.group==='none')return entries.map(([k,ps])=>cards(k,ps)).join('');
    // Tap a group header to collapse it; kept in this browser across polls.
    return entries.map(([k,ps])=>{const g=prefix+rule.group+':'+k;
      return `<details class="rb-group" data-group-key="${esc(g)}"${collapsed.has(g)?'':' open'}><summary class="rb-unit">${icon('arrow')}<span>${esc(k)}</span><span class="rb-unit-n${counted?'':' when-closed'}"> · ${ps.length}</span></summary><div class="rb-group-cards">${cards(k,ps)}</div></details>`;}).join('');
  }

  // Console settings → Run board.
  function settingsBlock(){
    const P=prefs(),sel=(kind,scope,opts,v)=>`<select data-board-pref="${kind}" data-scope="${scope}" aria-label="${kind} for ${scope==='0'?'all patients':'tier '+scope}">${opts.map(([id,l])=>`<option value="${id}" ${id===v?'selected':''}>${l}</option>`).join('')}</select>`;
    return `<div class="settings-block" id="board-settings"><h3>Run board</h3><p>How each view of the morning-run board is grouped and ordered. “Newest activity” is the last time the run touched the patient.</p>
      <div class="rb-prefs">${SCOPES.map(([id,l])=>`<div class="rb-pref-row"><strong>${l}</strong>${sel('group',id,GROUPS,P.rules[id].group)}${sel('order',id,ORDERS,P.rules[id].order)}</div>`).join('')}</div>
      <p class="small muted">Lab trigger order — a patient with several abnormal labs is listed under the first one here.</p>
      <ol class="rb-trigger-order">${P.triggers.map((k,i)=>`<li><span>${TRIGGER_NAMES[k]}</span><button type="button" class="btn link small" data-board-trigger="${k}" data-dir="-1" ${i?'':'disabled'} aria-label="Move ${TRIGGER_NAMES[k]} up">↑</button><button type="button" class="btn link small" data-board-trigger="${k}" data-dir="1" ${i<P.triggers.length-1?'':'disabled'} aria-label="Move ${TRIGGER_NAMES[k]} down">↓</button></li>`).join('')}</ol>
      <label class="rb-pref-check"><input type="checkbox" data-board-pref="shade" ${P.shade?'checked':''}> Tap a card to shade it green (clears each day)</label>
      <div class="rb-pref-actions"><button type="button" class="btn link small" data-board-clear-shade>Clear today’s shading</button><button type="button" class="btn link small" data-board-reset>Restore defaults</button></div>
      ${saveNote?`<p class="small muted" role="status">${esc(saveNote)}</p>`:''}</div>`;
  }
  document.addEventListener('change',e=>{
    const s=e.target.closest&&e.target.closest('[data-board-select]');
    if(s){action(s.dataset.boardSelect,{dataset:{id:s.value}});return;}
    const el=e.target.closest('[data-board-pref]');if(!el)return;
    const P=prefs();
    if(el.dataset.boardPref==='shade')P.shade=el.checked;else P.rules[el.dataset.scope][el.dataset.boardPref]=el.value;
    savePrefs(P);render();
  });
  document.addEventListener('click',e=>{
    const up=e.target.closest('[data-board-trigger]'),reset=e.target.closest('[data-board-reset]'),clear=e.target.closest('[data-board-clear-shade]');
    if(up){const P=prefs(),i=P.triggers.indexOf(up.dataset.boardTrigger),j=i+Number(up.dataset.dir);
      if(i<0||j<0||j>=P.triggers.length)return;[P.triggers[i],P.triggers[j]]=[P.triggers[j],P.triggers[i]];savePrefs(P);render();}
    else if(reset){savePrefs(clone(DEFAULTS));render();}
    else if(clear){shades={};try{localStorage.removeItem(shadeKey);}catch{}saveNote='Today’s shading cleared.';render();const box=document.getElementById('board-settings');if(box)box.outerHTML=settingsBlock();}
  });

  function providerSel(b,sel){
    const ps=b.providers||[];if(!ps.length)return '';
    const un=b.patients.filter(p=>!(p.providers||[]).length).length;
    const opts=[['all','All providers'],...(S.data?.user?.role!=='partner'&&ps.some(x=>x.label===MY_LIST)?[['mine','My list · '+MY_LIST]]:[]),...ps.map(x=>[x.label,x.label+' · '+x.count]),['unassigned','Unassigned · '+un]];
    if(!opts.some(([id])=>id===F.provider))F.provider='all';
    return sel('board-provider','Provider',opts,F.provider);
  }
  const asOf=b=>{const t=(b.providers||[]).map(x=>x.as_of).sort()[0];return t?' · assignments as of '+new Date(t).toLocaleTimeString([],{hour:'numeric',minute:'2-digit'}):'';};
  function page(){
    const b=current();
    if(!b)return RunView.strip()+head('Morning run','No morning run today yet. The board fills in as soon as a run publishes its list.')+empty('No run to show','Start a morning run; every patient appears here before the first note.','clock');
    const c=b.counts||{},n=k=>c[k]||0,count=(k,l,cls='',f=k)=>`<button type="button" class="rb-count ${cls}${F.status===f?' on':''}" data-action="board-count" data-id="${f}" title="Show these patients"><strong>${n(k)}</strong> ${l}</button>`;
    const buildings=[...new Set(b.patients.map(building))].sort();
    if(F.tier>MAX_TIER)F.tier=0;const tiers=[1,2].map(t=>[t,tierLeft(b,t)]);
    const pill=(action,value,label,active)=>`<button class="rb-pill ${active?'active':''}" data-action="${action}" data-id="${esc(value)}">${label}</button>`;
    // Filters as dropdowns (one row, no sideways scrolling on a phone).
    const sel=(action,label,opts,v,tierOpts)=>`<select class="rb-select${opts[0]&&v!==opts[0][0]?' active':''}" data-board-select="${action}" aria-label="${label}">${opts.map(([id,l])=>`<option value="${esc(id)}"${tierOpts&&id!=='0'?` data-tier-left="${esc(id)}"`:''}${id===v?' selected':''}>${esc(l)}</option>`).join('')}</select>`;
    return RunView.strip()+`<div class="rb-head"><div><h1>${esc(b.list)}</h1><p class="small muted">${b.live?'<span class="rb-live"></span>Live · ':''}${b.passes.length} pass${b.passes.length===1?'':'es'} · started ${esc(date(b.started_at))}${esc(asOf(b))} · updated ${esc(age(S.data.updated_at))}</p></div>${lists().length>1?`<div class="rb-lists">${lists().map(x=>pill('board-list',x.slug,esc(x.list)+(x.live?' ●':''),x.slug===b.slug)).join('')}</div>`:''}</div>
      <div class="rb-counts"><button type="button" class="rb-count${F.status==='all'?' on':''}" data-action="board-count" data-id="all" title="Show everyone"><strong>${b.total}</strong> patients</button>${count('processed','processed')}${count('pended','pended','ok')}${count('cardonly','labs only')}${count('consult','consult','warn')}${count('held','waiting for labs','warn')}${count('in_progress','in progress','run')}${count('retry','retry','warn')}${count('skipped','skipped')}${n('failed')+n('interrupted')?`<button type="button" class="rb-count bad${F.status==='attention'?' on':''}" data-action="board-count" data-id="attention" title="Show these patients"><strong>${n('failed')+n('interrupted')}</strong> failed</button>`:''}</div>
      <div class="rb-filters"><label class="rb-search">${icon('search')}<input id="board-search" type="search" placeholder="Name, MRN, bed, device, hospitalist" value="${esc(F.query)}" autocomplete="off" aria-label="Search the run"></label>
      <div class="rb-row rb-selects"><span class="rb-views">${(()=>{const vc=viewCounts(b),sh=prefs().shade;return pill('board-view','review',`To review · <span id="rb-n-todo">${vc.todo}</span>`,F.view==='review'||(!sh&&F.view==='done'))+(sh?pill('board-view','done',`Reviewed · <span id="rb-n-done">${vc.done}</span>`,F.view==='done'):'');})()}${pill('board-view','list','Full list',F.view==='list')}</span>${sel('board-tier','Tier',[['0','All tiers'],...tiers.map(([t,k])=>[String(t),'Tier '+t+' · '+k])],String(F.tier||0),true)}${sel('board-building','Building',[['all','All buildings'],...buildings.map(x=>[x,x])],F.building)}${providerSel(b,sel)}${cardControls()}${S.data?.user?.role==='partner'?'':'<button class="btn link small" data-action="settings">Sort settings</button>'}</div></div>
      <div id="board-results" class="rb-list">${results()}</div>`;
  }

  function action(a,b){
    if(a==='board-list')F.list=b.dataset.id;
    else if(a==='board-tier')F.tier=Number(b.dataset.id);
    else if(a==='board-view'){F.view=['list','done'].includes(b.dataset.id)?b.dataset.id:'review';held.clear();}
    else if(a==='board-status')F.status=b.dataset.id;
    else if(a==='board-count'){const id=b.dataset.id;F.status=(F.status===id||id==='all')?'all':id;if(F.status!=='all'){F.view='list';F.tier=0;F.building='all';F.provider='all';F.query='';}held.clear();}
    else if(a==='board-building')F.building=b.dataset.id;
    else if(a==='board-provider')F.provider=b.dataset.id;
    else if(a==='board-unreview'){const id=b.dataset.id;delete shades[id];held.delete(id);try{localStorage.setItem(shadeKey,JSON.stringify(shades));}catch{}}
    else return false;
    remember();render();return true;
  }
  function refreshResults(){const root=$('#board-results');if(root)root.innerHTML=results();const b=current();if(b)syncTierLeft(b);syncCardControls();}
  function search(value){F.query=value;refreshResults();}
  return {page,action,search,fishbone,settingsBlock};
})();
