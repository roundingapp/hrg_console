'use strict';

const Handoff=(()=>{
  const keys=['summary','plan','followup'],labels={summary:'Summary',plan:'Current plan',followup:'Follow-up'};
  let signoutSequence=0,signoutVersion='',polling=false,checkingSignout=false;
  const record=(id,owner)=>S.data.handoffs?.find(r=>r.patient_id===id&&r.provider_id===owner);
  const source=(id,owner)=>S.data.handoff_sources?.find(r=>r.patient_id===id&&r.provider_id===owner);
  const job=(id,owner)=>S.data.handoff_jobs?.find(r=>r.patient_id===id&&r.provider_id===owner);
  const value=()=>Object.fromEntries(keys.map(k=>[k,$('#handoff-'+k)?.value||'']));
  const dirty=()=>!!S.modal?.handoff&&(JSON.stringify(value())!==S.modal.handoff.saved||!!S.modal.handoff.pending);
  function panel(id,owner){
    const r=record(id,owner);
    return `<div class="handoff-editor"><p class="small"><strong>${esc(S.data.providers.find(p=>p.id===owner)?.name||owner)}</strong> · Handoff</p><p class="small muted">Your edits save here automatically.</p><div id="handoff-status" class="handoff-status"></div>${keys.map(k=>`<label for="handoff-${k}">${labels[k]}</label><textarea id="handoff-${k}" data-handoff-field="${k}" ${S.data.user.role==='viewer'?'disabled':''}>${esc(r?.sections[k]||'')}</textarea>`).join('')}<div id="handoff-save-status" class="handoff-save-status" role="status"></div><div id="handoff-actions" class="handoff-actions"></div><div id="handoff-proposal"></div><details class="handoff-source"><summary>Source & freshness</summary><div id="handoff-source"></div></details></div>`;
  }
  function mount(){
    const m=S.modal,r=record(m.patientId,m.owner);
    m.handoff={record:r,version:r?.version||0,sourceHash:source(m.patientId,m.owner)?.hash||'',saved:JSON.stringify(value()),pending:null,timer:null,error:''};sync();
  }
  function sync(){
    const m=S.modal,h=m?.handoff;if(!h||!$('#handoff-actions'))return;
    const r=h.record,s=source(m.patientId,m.owner),j=job(m.patientId,m.owner),active=['queued','running'].includes(j?.state),readonly=S.data.user.role==='viewer';
    $('#handoff-status').textContent=r?(r.reviewed_at?'Reviewed':r.origin==='manual'?'Edited':'Draft · needs review')+(r.source_hash!==(s?.hash||'')?' · source changed':''):'No handoff yet';
    $('#handoff-save-status').textContent=h.error||(h.pending?'Saving…':JSON.stringify(value())!==h.saved?'Unsaved edits':r?'Saved':'');
    $('#handoff-actions').innerHTML=readonly?'':`${active?`<span>${j.state==='queued'?'Queued':'Generating…'}</span><button class="btn compact" data-handoff-action="cancel" data-id="${esc(j.id)}">Cancel generation</button>`:`<button class="btn soft" data-handoff-action="generate" ${!s||!S.data.handoff_generation?'disabled':''}>${icon('refresh')} ${j?.state==='failed'?'Retry generation':r?'Suggest update':'Generate handoff'}</button>`}${r?`<button class="btn" data-handoff-action="review" ${dirty()||r.source_hash!==(s?.hash||'')?'disabled':''}>Mark reviewed</button>${r.can_undo?'<button class="btn link" data-handoff-action="undo">Undo</button>':''}`:''}${h.error?'<button class="btn link" data-handoff-action="retry-save">Retry save</button>':''}`;
    if(j?.state==='failed')$('#handoff-save-status').textContent+=(h.error?'':' · '+j.error);
    $('#handoff-source').innerHTML=s?`<p>${esc(s.label)} · ${esc(date(s.note_time))}</p><p>Results checked ${esc(date(s.results_checked))}</p><p>Generation uses the captured note and results. Unsent Epic note changes remain pending.</p>`:'<p>No complete verified pended note is captured for this provider. You can write a handoff directly.</p>';
    const proposed=j?.state==='proposed'&&j.base_version===h.version;
    let output;try{output=proposed?JSON.parse(j.output):null;}catch{output=null;}
    $('#handoff-proposal').innerHTML=h.conflict?`<section class="handoff-proposal"><h3>Latest saved handoff</h3><p>Your unsaved text remains in the editor above. Compare it with this saved version and the current source.</p>${keys.map(k=>`<strong>${labels[k]}</strong><p>${esc(h.conflict.record?.sections[k]||'Not documented')}</p>`).join('')}<p>Current note source: ${esc(date(source(m.patientId,m.owner)?.note_time))}</p><button class="btn primary" data-handoff-action="rebase">Save my version</button></section>`:output?`<section class="handoff-proposal"><h3>Proposed update</h3><p>Your current handoff is preserved.</p>${keys.filter(k=>output[k]!==r?.sections[k]).map(k=>`<strong>${labels[k]}</strong><p><del>${esc(r?.sections[k]||'Not documented')}</del></p><p><ins>${esc(output[k]||'Not documented')}</ins></p>`).join('')}<button class="btn primary" data-handoff-action="accept" data-id="${esc(j.id)}" ${dirty()?'disabled':''}>Use update</button><button class="btn link" data-handoff-action="cancel" data-id="${esc(j.id)}">Keep current</button></section>`:'';
  }
  async function save(){
    const m=S.modal,h=m?.handoff;if(!h)return;
    clearTimeout(h.timer);if(h.pending){await h.pending;if(S.modal===m&&JSON.stringify(value())!==h.saved)return save();return;}
    const content=value(),sent=JSON.stringify(content);if(sent===h.saved)return;
    h.error='';
    h.pending=(async()=>{
      try{
        const response=await api('/api/handoffs/edit',{patient_id:m.patientId,provider_id:m.owner,version:h.version,source_hash:h.sourceHash,sections:content});
        h.record=response.record;h.version=response.record.version;h.saved=sent;h.conflict=null;
        S.data.handoffs=[response.record,...(S.data.handoffs||[]).filter(r=>r.patient_id!==m.patientId||r.provider_id!==m.owner)];
      }catch(e){h.error=e.message;if(e.status===409){try{S.data=dropTier3(await api('/api/state'));h.conflict={record:record(m.patientId,m.owner),sourceHash:source(m.patientId,m.owner)?.hash||''};}catch{}}throw e;}finally{h.pending=null;if(S.modal===m)sync();}
    })();sync();await h.pending;
    if(S.modal===m&&JSON.stringify(value())!==h.saved)return save();
  }
  function changed(){const h=S.modal?.handoff;if(!h)return;clearTimeout(h.timer);if(!h.conflict)h.timer=setTimeout(()=>save().catch(()=>{}),700);sync();}
  async function beforeClose(callback){
    if(S.modal?.handoff){try{await save();}catch{return;}}
    callback();
  }
  async function poll(){
    if(polling||S.busy)return;polling=true;
    try{
      const m=S.modal;S.data=dropTier3(await api('/api/state'));render(true);
      if(S.modal!==m||!m?.handoff)return;
      const h=m.handoff,r=record(m.patientId,m.owner);
      if(!dirty()){
        if((r?.version||0)!==h.version){h.record=r;h.version=r?.version||0;keys.forEach(k=>$('#handoff-'+k).value=r?.sections[k]||'');h.saved=JSON.stringify(value());}
        h.sourceHash=source(m.patientId,m.owner)?.hash||'';
      }
      sync();
    }finally{polling=false;}
  }
  const waiting=()=>{const m=S.modal;return m?.kind==='patient'&&['queued','running'].includes(job(m.patientId,m.owner)?.state);};
  async function action(button){
    const m=S.modal,h=m?.handoff;if(!h)return;
    try{
      const a=button.dataset.handoffAction;
      if(a==='rebase'&&h.conflict){h.version=h.conflict.record?.version||0;h.sourceHash=h.conflict.sourceHash;h.conflict=null;h.error='';await save();return;}
      await save();
      if(a==='retry-save')return;
      if(a==='generate')await api('/api/handoffs/generate',{targets:[{patient_id:m.patientId,provider_id:m.owner}]});
      else if(a==='cancel'||a==='accept')await api('/api/handoffs/job',{id:button.dataset.id,action:a,version:h.version});
      else await api('/api/handoffs/edit',{patient_id:m.patientId,provider_id:m.owner,version:h.version,source_hash:h.sourceHash,action:a});
      await poll();
    }catch(e){h.error=e.message;sync();}
  }
  function targets(){
    const selected=S.scope==='all'?S.data.providers.map(p=>p.id):S.scope.split(',');
    const patients=new Set(scopedPatients().map(p=>p.id));
    return (S.data.handoff_sources||[]).filter(s=>selected.includes(s.provider_id)&&patients.has(s.patient_id))
      .filter(s=>{const r=record(s.patient_id,s.provider_id),j=job(s.patient_id,s.provider_id);return !['queued','running','proposed'].includes(j?.state)&&(!r||r.source_hash!==s.hash||j?.state==='failed');})
      .map(s=>({patient_id:s.patient_id,provider_id:s.provider_id}));
  }
  function page(){
    const n=targets().length;
    return `<div class="signout-toolbar"><button class="btn primary" data-action="handoff-generate-list" ${!n||!S.data.handoff_generation||S.data.user.role==='viewer'?'disabled':''}>Update changed handoffs (${n})</button><button class="btn soft" data-action="handoff-pdf" disabled>${icon('note')} Download PDF</button><button class="btn soft signout-refresh" data-action="handoff-refresh" aria-live="polite">Refresh sign-out</button></div><p class="small muted">Patients matching your filters, sorted by location. Open a name to edit their handoff.</p><div id="signout-sheet" aria-live="polite"><p class="small muted">Loading sign-out…</p></div>`;
  }
  const query=()=>'?providers='+encodeURIComponent(S.scope)+'&list='+encodeURIComponent(S.list)+'&location='+encodeURIComponent(S.location)+'&building='+encodeURIComponent(S.building);
  const signoutVisible=()=>S.view==='patients'&&S.patientView==='signout'&&!!$('#signout-sheet');
  async function checkSignout(){if(window.Hosted)return;
    if(checkingSignout||!signoutVisible()||!signoutVersion)return;
    const root=$('#signout-sheet'),scope=query(),seq=signoutSequence;
    const current=()=>root.isConnected&&scope===query()&&seq===signoutSequence;
    checkingSignout=true;
    try{
      const data=await api('/api/signout'+scope);if(!current())return;
      const button=$('[data-action="handoff-refresh"]'),changed=data.version!==signoutVersion;
      button.textContent=changed?'Updates available':'Refresh sign-out';
      button.classList.toggle('primary',changed);button.classList.toggle('soft',!changed);
      button.title=changed?'Refresh to show the latest handoffs. Your displayed list is held in place.':'Check for the latest handoffs';
    }catch(e){
      if(!current())return;
      if(e.status===401){renderUnlock();return;}
      const button=$('[data-action="handoff-refresh"]');button.textContent='Retry refresh';button.title=e.message;
    }finally{checkingSignout=false;}
  }
  async function loadSignout(){if(window.Hosted)return;
    const root=$('#signout-sheet');if(!root)return;
    const seq=++signoutSequence;signoutVersion='';
    try{const data=await api('/api/signout'+query());if(seq!==signoutSequence||!root.isConnected)return;root.innerHTML=data.html;signoutVersion=data.version;$('[data-action="handoff-pdf"]').disabled=!data.count;}
    catch(e){if(root.isConnected)root.innerHTML=`<p class="notice">${esc(e.message)}</p>`;}
  }
  async function generateList(){const selected=targets();if(!selected.length)return;await api('/api/handoffs/generate',{targets:selected});await load();toast('Handoffs queued. Each patient’s status will update here.');}
  async function download(){
    if(!signoutVersion)return;
    const response=await fetch('/autonote/api/signout.pdf'+query()+'&version='+encodeURIComponent(signoutVersion),{headers:S.token?{Authorization:'Bearer '+S.token}:{},cache:'no-store'});
    if(!response.ok){let data;try{data=await response.json();}catch{}throw Error(data?.error||'PDF download failed.');}
    const blob=await response.blob(),url=URL.createObjectURL(blob),a=document.createElement('a');
    a.href=url;a.download=response.headers.get('Content-Disposition')?.match(/filename="([^"]+)"/)?.[1]||'autonote-signout.pdf';document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),60000);
    toast('Sign-out PDF downloaded.');
  }
  document.addEventListener('input',e=>{if(e.target.matches('[data-handoff-field]'))changed();});
  document.addEventListener('focusout',e=>{if(e.target.matches('[data-handoff-field]'))save().catch(()=>{});});
  document.addEventListener('click',e=>{const b=e.target.closest('[data-handoff-action]');if(b&&!b.disabled)action(b);});
  return {panel,mount,sync,dirty,save,beforeClose,poll,waiting,page,loadSignout,signoutVisible,checkSignout,generateList,download};
})();
