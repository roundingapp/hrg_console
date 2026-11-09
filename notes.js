'use strict';

const NoteSheet = (() => {
  const waitingStates = ['awaiting_activation','queued','running','needs_reconciliation'];
  const cancelStates = ['awaiting_activation','queued'];
  const authoringStates = ['awaiting_authoring','authoring'];
  const fieldsOf = revision => {try{return revision?.fields?JSON.parse(revision.fields):null;}catch{return null;}};
  const displayFields = (note,revision) => {const fields=fieldsOf(revision);return fields?.length===16&&hasSubjective(note)?[...fields,...note.fields.slice(16)]:fields;};
  const input = () => ({text:$('#revision-text')?.value||'',fields:document.querySelector('[data-note-field]')?
    [...document.querySelectorAll('[data-note-field]')].sort((a,b)=>Number(a.dataset.noteField)-Number(b.dataset.noteField)).map(e=>e.value):undefined,
    instruction:$('#revision-instruction')?.value||''});
  const dirty = () => S.modal?.kind==='patient' && JSON.stringify(input())!==S.modal.initialInput;
  const requestFor = m => m.note?.id?(S.data.requests.find(r=>r.id===m.requestId&&r.payload.note_id===m.note.id) || S.data.requests.find(r=>r.payload.note_id===m.note.id)):null;
  const revisionFor = m => S.data.revisions.find(r=>r.id===m.revisionId);
  const blocked = m => waitingStates.includes(requestFor(m)?.state) || authoringStates.includes(revisionFor(m)?.state);
  const canCancelRequest = r => r && (cancelStates.includes(r.state) || r.evidence?.consumption_state==='approved');
  function status(r) {
    if(!r)return '';
    const state=r.evidence?.consumption_state;
    return state==='withdrawn'?'Cancelled before morning use':state==='approved'?'Approved for morning':state==='consumed'?'Used in verified morning note':state==='claimed'?'Being used by morning run':state==='superseded'?'Replaced by a newer change':state==='conflict'?'Source changed · capture the note again':state==='needs_reconciliation'?'Check Epic before retrying':requestStates[r.state]||r.state;
  }
  function sync() {
    const m=S.modal;if(m?.kind!=='patient')return;
    const r=requestFor(m),revision=revisionFor(m),hold=blocked(m),primary=$('[data-action="submit-note-change"]'),cancel=$('[data-action="cancel-note-change"]');
    const generated=authoringStates.includes(revision?.state);
    if(primary){
      primary.textContent=hold?(generated?'Preparing proposal…':'Requested'):m.noteMode==='instruction'?'Request proposal':'Request change';
      const value=input(),changed=value.fields?JSON.stringify(value.fields)!==JSON.stringify(m.note?.fields?.slice(0,value.fields.length)):value.text!==m.note?.text;
      primary.disabled=S.busy||hold||!m.note?.editable||(m.noteMode==='instruction'?!value.instruction.trim():!changed);
    }
    if(cancel){
      const active=waitingStates.includes(r?.state)||r?.evidence?.consumption_state==='approved';
      cancel.textContent=active?'Cancel request':generated||m.revisionId?'Cancel change':'Cancel';
      cancel.disabled=S.busy||(active&&!canCancelRequest(r));
    }
    const editor=$('#note-edit-fields');if(editor)editor.disabled=hold||S.busy;
    const noteProvider=$('#note-provider');if(noteProvider)noteProvider.disabled=hold||S.busy;
    document.querySelectorAll('[data-action="note-mode"]').forEach(b=>b.disabled=hold||S.busy);
    const box=$('#note-request-status');
    if(box){
      box.hidden=!r&&!revision;
      box.innerHTML=generated?'<strong>Preparing your proposed change</strong><p>The proposal will appear here for you to inspect.</p>':revision?.state==='needs_review'?'<strong>Proposed change</strong><p>Inspect the text below, then request the change.</p>':revision?.state==='authoring_failed'?`<strong>Proposal could not be prepared</strong><p>${esc(revision.error||'Try another instruction.')}</p>`:r?`<strong>${esc(status(r))}</strong>${r.evidence?.message?`<p>${esc(r.evidence.message)}</p>`:''}${r.state==='running'?'<p>The update has started; cancellation is no longer available.</p>':''}`:'';
    }
    const footer=$('#overlay .dialog-footer');if(footer)footer.hidden=m.tab!=='notes';
  }
  function history(revisions) {
    const available=revisions.filter(r=>['draft','needs_review'].includes(r.state));
    return available.length?`<details class="note-history"><summary>Earlier drafts & proposals (${available.length})</summary>${available.map(r=>`<div class="revision-history-row"><span>${esc(date(r.created_at))} · ${r.state==='needs_review'?'Proposal':'Draft'}</span><button class="btn link small" data-action="use-revision" data-id="${esc(r.id)}">Use this version</button></div>`).join('')}</details>`:'';
  }
  function open(id,owner=null,options={}) {
    const p=S.data.patients.find(p=>p.id===id);if(!p){toast('This patient is outside the available roster.');return;}
    owner=owner||(p.providers.includes(selectedProvider())?selectedProvider():p.providers[0]);
    const note=S.data.notes.find(n=>n.patient_id===id&&n.provider_id===owner),results=S.data.results.filter(r=>r.patient_id===id);
    const revisions=S.data.revisions.filter(r=>r.note_id===note?.id),request=note?S.data.requests.find(r=>r.payload.note_id===note.id):null;
    const pending=request&&waitingStates.includes(request.state);
    const revision=revisions.find(r=>r.id===(options.revisionId||(pending?request.payload.revision_id:null))) || (!options.fresh?revisions.find(r=>authoringStates.includes(r.state)):null);
    const revisedFields=displayFields(note,revision),shown=revision?.text?{...note,text:revision.text,fields:revisedFields||undefined}:note;
    const controls=`<div class="note-context"><label class="sr-only" for="note-provider">Provider’s note</label><select id="note-provider">${providerOptions(owner,p.providers)}</select><span>${['pended','pended_run'].includes(note?.state)?'Pended note':'Morning A/P'} · ${esc(age(note?.source_time))}</span></div>`;
    const body=`<div class="patient-tabs" role="tablist" aria-label="Patient workspace"><button id="patient-notes-tab" role="tab" aria-selected="true" aria-controls="patient-notes" class="active" data-action="patient-tab" data-id="notes">${icon('note')} Notes</button><button id="patient-labs-tab" role="tab" aria-selected="false" aria-controls="patient-labs" tabindex="-1" data-action="patient-tab" data-id="labs">Labs & imaging</button><button id="patient-handoff-tab" role="tab" aria-selected="false" aria-controls="patient-handoff" tabindex="-1" data-action="patient-tab" data-id="handoff">Handoff</button></div>
      <section id="patient-notes" role="tabpanel" aria-labelledby="patient-notes-tab">${controls}<div id="note-request-status" class="note-request-status" role="status" aria-live="polite" hidden></div>
      ${note?.editable?`<div class="segments note-tabs"><button class="active" data-action="note-mode" data-id="direct">Edit directly</button><button data-action="note-mode" data-id="instruction">Give an instruction</button></div><fieldset id="note-edit-fields"><div id="direct-editor">${directEditor(shown)}</div><div id="instruction-editor" hidden><label for="revision-instruction">What should AutoNote change?</label><textarea id="revision-instruction" placeholder="Describe the change. The proposal will appear here for you to inspect."></textarea></div></fieldset><p class="note-destination">${note.state==='pended'?'Updates this provider’s existing pended note.':'For this provider’s next morning preparation.'}</p>`:note?`<div class="source-note">${esc(note.text)}</div><p class="notice">${note.state==='pended_run'?'Pended in Epic by this morning’s run (the A/P as typed). Read-only here.':'Read and verify this provider’s current note to enable editing.'}</p>`:'<p class="notice">Read this provider’s current note to begin.</p>'}
      ${note?`<details class="note-source-details"><summary>Captured original & source</summary><p class="small muted">${esc(note.source_label)} · ${esc(date(note.source_time))}</p>${note.limitation?`<p class="small muted">${esc(note.limitation)}</p>`:''}<div class="source-note">${esc(note.text)}${hasSubjective(note)?esc('\n\nQuick Subjective\n'+note.fields[16]+'\n\nSubjective Stack\n'+note.fields[17]):''}</div></details>`:''}
      ${noteCaptureControls(p,owner)}${noteChoices(p,owner)}${history(revisions.filter(r=>r.id!==revision?.id))}</section>
      <section id="patient-labs" role="tabpanel" aria-labelledby="patient-labs-tab" hidden>${patientLabs(p,results)}</section><section id="patient-handoff" role="tabpanel" aria-labelledby="patient-handoff-tab" hidden>${Handoff.panel(id,owner)}</section>`;
    dialog(esc(p.name),`${esc(p.room)} · ${esc(p.building)} · MRN ${esc(p.mrn)}`,body,
      '<button class="btn" data-action="cancel-note-change">Cancel</button><button class="btn primary" data-action="submit-note-change">Request change</button>');
    S.modal={kind:'patient',patientId:id,owner,note,noteMode:'direct',tab:'notes',revisionId:revision?.id,
      requestId:request?.id,requestKey:crypto.randomUUID(),requestSignature:null};
    S.modal.initialInput=JSON.stringify(input());Handoff.mount();setTab(options.tab||'notes');sync();
  }
  function setTab(tab) {
    const m=S.modal;if(m?.kind!=='patient')return;m.tab=tab;
    for(const id of ['notes','labs','handoff']){
      const button=$('#patient-'+id+'-tab');button.classList.toggle('active',id===tab);
      button.setAttribute('aria-selected',String(id===tab));button.tabIndex=id===tab?0:-1;
      $('#patient-'+id).hidden=id!==tab;
    }
    sync();
  }
  function setMode(mode) {
    const m=S.modal;if(m?.kind!=='patient'||blocked(m))return;m.noteMode=mode;
    document.querySelectorAll('[data-action="note-mode"]').forEach(x=>x.classList.toggle('active',x.dataset.id===mode));
    $('#direct-editor').hidden=mode!=='direct';$('#instruction-editor').hidden=mode!=='instruction';sync();
  }
  async function submit() {
    const m=S.modal;if(m?.kind!=='patient'||blocked(m))return;
    const value=input(),revision=revisionFor(m);
    const body={note_id:m.note.id,base_hash:m.note.base_hash,base_version:m.note.source_version,...value};
    if(m.noteMode==='instruction'){
      const result=await api('/api/revisions',{note_id:body.note_id,base_hash:body.base_hash,base_version:body.base_version,text:'',instruction:value.instruction});
      m.revisionId=result.id;await refresh();sync();return;
    }
    delete body.instruction;
    const signature=JSON.stringify(body);
    if(m.requestSignature!==null&&m.requestSignature!==signature)m.requestKey=crypto.randomUUID();
    m.requestSignature=signature;
    let result;
    const unchangedProposal=revision&&['draft','needs_review'].includes(revision.state)&&
      (value.fields?JSON.stringify(value.fields)===JSON.stringify(displayFields(m.note,revision)):value.text===revision.text);
    if(unchangedProposal){
      if(m.proposalAttemptedKey===m.requestKey){
        S.data=dropTier3(await api('/api/state'));result=S.data.requests.find(r=>r.key===m.requestKey&&r.payload.revision_id===revision.id);
      }
      if(!result){m.proposalAttemptedKey=m.requestKey;result=await api('/api/requests',{key:m.requestKey,payload:{kind:'apply_revision',provider_id:m.owner,revision_id:revision.id}});}
    }
    else result=await api('/api/note-change',{...body,key:m.requestKey});
    m.requestId=result.id;m.revisionId=null;m.initialInput=JSON.stringify(input());
    S.data.requests=[{...result,evidence:typeof result.evidence==='string'?JSON.parse(result.evidence)||{}:result.evidence||{}},...S.data.requests.filter(r=>r.id!==result.id)];
    await refresh();toast('Change requested. Status stays here.');
  }
  async function cancel() {
    await Handoff.save();
    const m=S.modal;if(m?.kind!=='patient')return;
    const r=requestFor(m),revision=revisionFor(m);
    if(canCancelRequest(r)){await api('/api/cancel',{id:r.id});m.requestKey=crypto.randomUUID();m.requestSignature=null;await refresh();sync();toast('Request cancelled.');return;}
    if(r&&waitingStates.includes(r.state))throw Error('This request has already started and cannot be cancelled.');
    if(revision&&['draft','needs_review','awaiting_authoring','authoring','authoring_failed'].includes(revision.state)){
      await api('/api/cancel-revision',{id:revision.id});await refresh();
    }
    closeDialog(true);
  }
  async function refresh(latest=false) {
    const m=S.modal;if(m?.kind!=='patient')return;
    const keepEditor=dirty()||Handoff.dirty()||m.revisionId||blocked(m)||m.noteMode==='instruction';
    const priorRequest=requestFor(m),priorRevision=revisionFor(m);
    S.data=dropTier3(await api('/api/state'));render(true);
    if(S.modal!==m)return;
    const r=requestFor(m),revision=revisionFor(m);
    if(authoringStates.includes(priorRevision?.state)&&revision?.state==='needs_review'&&!Handoff.dirty()){
      open(m.patientId,m.owner,{revisionId:revision.id,tab:m.tab});return;
    }
    if(waitingStates.includes(priorRequest?.state)&&r?.state==='succeeded'&&!Handoff.dirty()){
      open(m.patientId,m.owner,{tab:m.tab,fresh:true});return;
    }
    if(priorRequest?.evidence?.consumption_state==='approved'&&r?.evidence?.consumption_state==='withdrawn'&&!Handoff.dirty()){
      open(m.patientId,m.owner,{tab:m.tab,fresh:true});return;
    }
    if(latest&&!keepEditor){open(m.patientId,m.owner,{tab:m.tab,fresh:true});return;}
    if(latest)refreshOpenLabs();
    sync();
  }
  return {open,dirty,sync,setTab,setMode,submit,cancel,refresh,waiting:()=>S.modal?.kind==='patient'&&blocked(S.modal)};
})();
