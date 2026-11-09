'use strict';

const RunView=(()=>{
  const names={precache:'Overnight precache',morning:'Morning notes',triage:'Clinical capture',consult:'Consult preparation'};
  const dayLabel=day=>new Date(day+'T12:00:00').toLocaleDateString([],{month:'short',day:'numeric'});
  const clock=value=>new Date(value).toLocaleTimeString([],{hour:'numeric',minute:'2-digit',timeZone:'America/Chicago'});
  const scoped=g=>g.provider_ids.some(scopeIncludes);
  const groups=()=>S.data.run_groups||[];
  let dayState;try{dayState=new Map(JSON.parse(sessionStorage.getItem('autonote_run_days_v2')||'[]'));}catch{dayState=new Map();}
  function rememberDay(element){const key=element.dataset.runDayKey;if(!key)return;dayState.set(key,element.open);try{sessionStorage.setItem('autonote_run_days_v2',JSON.stringify([...dayState]));}catch{}}
  const status=g=>({running:'Running',unknown:'Needs verification',attention:'Needs recovery',not_started:'Not started',finished:'Finished'}[g.state]||'Status unconfirmed');
  const bad=g=>['attention','unknown'].includes(g.state);
  const owner=g=>g.provider_id==='shared'?'Shared list':shortProvider(g.provider_id);
  const passes=g=>g.run_ids.map(id=>S.data.runs.find(r=>r.id===id)).filter(Boolean);
  function counts(g){const c=g.counts;return `<div class="run-counts"><span><strong>${c.ready}</strong> ${g.pipeline==='precache'?'captured':'prepared / captured'}</span>${c.consult?`<button type="button" class="run-count-link" data-action="run-group-consults" data-id="${esc(g.id)}" aria-label="View ${c.consult} patients who need consults"><span><strong>${c.consult}</strong> need consults</span>${icon('arrow')}</button>`:''}${c.excluded?`<span><strong>${c.excluded}</strong> excluded</span>`:''}${c.held?`<span><strong>${c.held}</strong> waiting for labs</span>`:''}${c.issues?`<span class="issue"><strong>${c.issues}</strong> need recovery</span>`:''}</div>`;}
  function passRows(g){return `<div class="run-passes" aria-label="Every run pass">${passes(g).map((r,i)=>`<button class="run-pass" data-action="run-detail" data-id="${esc(r.id)}"><span class="grow"><strong>${i===0?'Initial run':'Follow-up pass '+i}</strong><span>${clock(r.started_at)} CT · ${r.completed}/${r.total??'?'} accounted for</span></span><span class="pass-state">${r.state==='finished'?'Finished':r.state==='running'?'Running':r.state==='not_started'?'Not started':'Unconfirmed'}</span>${icon('arrow')}</button>`).join('')}</div>`;}
  function card(g){return `<article class="card run-group" data-run-group="${esc(g.id)}"><div class="row start"><div class="grow"><h3>${esc(g.list)}</h3><p class="small muted">${esc(owner(g))} · ${esc(names[g.pipeline]||g.pipeline)} · ${dayLabel(g.date)}</p></div><span class="badge ${bad(g)?'amber':g.state==='finished'?'teal':'neutral'}">${status(g)}</span></div><div class="run-total"><strong>${g.completed}</strong><span>${g.total===null?'patients accounted for · at least '+g.expected_at_least+' expected':'/ '+g.total+' patients accounted for'}</span></div>${g.total!==null?`<progress aria-label="Patients accounted for" max="${Math.max(g.total,1)}" value="${g.completed}"></progress>`:''}${counts(g)}<p class="run-combined">${g.run_ids.length>1?'Combined outcome · each patient counted once':'Current outcome'}${!g.coverage_confirmed?' · incomplete pass coverage':''}</p>${passRows(g)}<button class="btn link small" data-action="run-group-detail" data-id="${esc(g.id)}">View combined patient outcomes ${icon('arrow')}</button></article>`;}
  function days(items){
    if(!items.length)return '';
    const dates=[...new Set(items.map(g=>g.date))].sort().reverse();
    const parts=Object.fromEntries(new Intl.DateTimeFormat('en-US',{timeZone:'America/Chicago',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date()).map(p=>[p.type,p.value]));
    const today=parts.year+'-'+parts.month+'-'+parts.day;
    return dates.map(day=>{
      const key='live:'+(items[0].pipeline==='precache'?'precache':'other')+':'+day,attention=items.some(g=>g.date===day&&(bad(g)||g.state==='running'));
      const count=items.filter(g=>g.date===day).reduce((n,g)=>n+g.run_ids.length,0);
      return day===today?items.filter(g=>g.date===day).map(card).join(''):`<details class="run-day" data-run-day="${day}" data-run-day-key="${esc(key)}" ${dayState.get(key)?'open':''}><summary>${dayLabel(day)} · ${count} ${count===1?'run':'runs'}${attention?' · needs attention':''}</summary>${items.filter(g=>g.date===day).map(card).join('')}</details>`;
    }).join('');
  }
  function schedule(){
    const s=S.data.precache_schedule||{};
    if(s.state==='scheduled'){
      const latest=groups().filter(g=>g.pipeline==='precache'&&g.list===s.list).sort((a,b)=>b.started_at.localeCompare(a.started_at))[0];
      return `<p class="run-schedule">${icon('clock')} Daily at ${clock(s.next_run_at)} CT <span>Next scheduled: ${date(s.next_run_at)}</span></p>${latest?`<p class="small muted">Latest recorded capture: ${dayLabel(latest.date)}</p>`:'<p class="notice">No recent precache run has been recorded.</p>'}`;
    }
    return `<p class="run-schedule">${s.state==='disabled'?'Nightly schedule is disabled':'Nightly schedule could not be verified'}</p>`;
  }
  function overnight(){
    const items=groups().filter(g=>g.pipeline==='precache'&&scoped(g));
    const s=S.data.precache_schedule||{},allowed=S.data.providers.some(p=>scopeIncludes(p.id)&&p.lists.includes(s.list));
    if(!items.length&&!allowed)return '';
    return `<section id="overnight-runs" aria-labelledby="overnight-title"><div class="sectionhead"><div><h2 id="overnight-title">Overnight precache</h2><p>Signed A/P for morning preparation. All passes stay together.</p></div></div>${allowed?schedule():''}${days(items)||'<div class="empty"><h3>No recent overnight run recorded</h3><p>The scheduled time does not confirm that capture ran.</p></div>'}<p class="audit-note">Across the selected providers’ lists. Patient filters do not hide overnight capture.</p></section>`;
  }
  // Compact overnight-precache strip for the top of the Run page (2026-11-03,
  // replaces the Today page, which he did not use). Newest precache day only.
  function strip(){
    const items=groups().filter(g=>g.pipeline==='precache'&&scoped(g));
    const s=S.data.precache_schedule||{};
    if(!items.length)return s.state==='scheduled'?`<div class="card precache-strip"><p class="small muted">${icon('clock')} Overnight precache · no recent run recorded · next ${esc(date(s.next_run_at))}</p></div>`:'';
    const day=items.map(g=>g.date).sort().reverse()[0];
    // One line (Neil 11/04: "collapsed into 1 line … click for more"); tap opens the full outcome dialog.
    return items.filter(g=>g.date===day).map(g=>{const c=g.counts;return `<button type="button" class="card precache-strip" data-action="run-group-detail" data-id="${esc(g.id)}" data-run-group="${esc(g.id)}"><span class="precache-line">Overnight precache · <strong>${g.completed}</strong>${g.total===null?'':'/'+g.total}${c.consult?' · '+c.consult+' consults':''}${c.issues?' · <span class="issue">'+c.issues+' need recovery</span>':''}</span><span class="badge ${bad(g)?'amber':g.state==='finished'?'teal':'neutral'}">${status(g)}</span>${icon('arrow')}</button>`;}).join('');
  }
  function daily(){
    const items=groups().filter(g=>g.pipeline!=='precache'&&scoped(g)&&(S.list==='all'||g.list===S.list));
    return days(items)||empty('No recent runs in this view','Choose another list or provider to see its runs.');
  }
  function detail(id){
    const g=groups().find(g=>g.id===id);if(!g)return;
    const rows=g.outcomes.filter(LocationView.matches).sort((a,b)=>Number(['failed','unknown'].includes(b.state))-Number(['failed','unknown'].includes(a.state)));
    dialog(names[g.pipeline]||'Run outcomes',`${esc(g.list)} · ${dayLabel(g.date)} · ${g.run_ids.length} ${g.run_ids.length===1?'run':'passes'}`,
      `<div class="notice ${bad(g)?'':'info'}">${status(g)} · ${g.completed}/${g.total??'?'} patients accounted for. Latest recorded outcome per patient.</div>${counts(g)}${passRows(g)}<h3 class="run-outcomes-title">Combined patient outcomes</h3>${LocationView.outcomeSummary(g.outcomes)}${rows.map(o=>`<div class="result-outcome">${icon(['pended','precached','triage_captured'].includes(o.state)?'check':'alert')}<div>${S.data.patients.some(p=>p.id===o.patient_id)?`<button data-action="patient" data-id="${esc(o.patient_id)}"><h3>${esc(o.name)}</h3></button>`:`<h3>${esc(o.name)}</h3>`}<p>${esc(o.reason||o.state.replaceAll('_',' '))}</p><p class="small muted">${esc(date(o.recorded_at))} · ${g.run_ids.indexOf(o.run_id)===0?'Initial run':'Follow-up pass '+g.run_ids.indexOf(o.run_id)}</p></div></div>`).join('')||'<p>No patient outcomes match this location.</p>'}`);
    S.modal={kind:'run-group',id};
  }
  function consults(id){
    const g=groups().find(g=>g.id===id);if(!g)return;
    const rows=g.outcomes.filter(o=>['needs_consult','needs_new_consult'].includes(o.state));
    dialog('Patients needing consults',`${esc(g.list)} · ${dayLabel(g.date)} · ${rows.length} ${rows.length===1?'patient':'patients'} · All locations`,
      rows.map(o=>{
        const p=S.data.patients.find(p=>p.id===o.patient_id),mrn=String(o.mrn||p?.mrn||'').trim();
        return `<div class="result-outcome"><div>${p?`<button data-action="patient" data-id="${esc(p.id)}"><h3>${esc(o.name)}</h3></button>`:`<h3>${esc(o.name)}</h3>`}${mrn?`<button type="button" class="patient-mrn" data-action="copy-mrn" data-mrn="${esc(mrn)}" aria-label="Copy MRN ${esc(mrn)}"><span>MRN <span class="mrn-value">${esc(mrn)}</span></span>${icon('copy')}</button>`:'<p>MRN unavailable</p>'}<p>${esc(o.reason||o.state.replaceAll('_',' '))}</p></div></div>`;
      }).join('')||'<p>No patients currently need consults in this run.</p>',
      `<button class="btn" data-action="run-group-detail" data-id="${esc(g.id)}">All patient outcomes</button>`);
    S.modal={kind:'run-consults',id};
  }
  return {overnight,strip,daily,detail,consults,rememberDay};
})();
