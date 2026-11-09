'use strict';

// Location is a display scope. Clinical run requests still use their exact list.
const LocationView=(()=>{
  const clean=value=>String(value||'').trim().replace(/\s+/g,' ');
  function label(row){
    if(row?.location_scope)return row.location_scope.unit;
    const building=clean(row?.building),unit=clean(row?.unit);
    return [building,unit.toUpperCase()===building.toUpperCase()?'':unit].filter(Boolean).join(' · ')||clean(row?.location);
  }
  const key=row=>label(row).toUpperCase()||'__missing__';
  const building=row=>row?.location_scope?.building??clean(row?.building);
  const buildingKey=row=>building(row).toUpperCase()||'__missing__';
  function patient(row){
    const noteId=row?.note_id||S.data?.revisions.find(r=>r.id===row?.revision_id)?.note_id;
    const note=S.data?.notes.find(n=>n.id===noteId);
    return S.data?.patients.find(p=>p.id===(row?.patient_id||note?.patient_id)||row?.mrn&&p.mrn===row.mrn||noteId?.startsWith(p.id+':'));
  }
  const matches=row=>{const p=patient(row)||row;return (S.building==='all'||buildingKey(p)===S.building)&&(S.location==='all'||key(p)===S.location);};
  const selectedLabel=()=>[S.building==='all'?'':S.building==='__missing__'?'Building not captured':options('building').get(S.building)||S.building,S.location==='all'?'':S.location==='__missing__'?'Unit not captured':options().get(S.location)||S.location].filter(Boolean).join(' · ')||'All locations';
  function options(field='unit'){
    const choices=new Map();
    const rows=[...(S.data?.patients||[]),...(S.data?.notifications||[]),...(S.data?.runs||[]).flatMap(r=>r.outcomes||[])];
    for(const row of rows){const resolved=patient(row)||row;
      if(field==='building'){if(building(resolved))choices.set(buildingKey(resolved),building(resolved));}
      else if((S.building==='all'||buildingKey(resolved)===S.building)&&label(resolved))choices.set(key(resolved),label(resolved));
    }
    return choices;
  }
  function control(id='location-filter'){
    const choices=options(),buildings=options('building'),buildingId=id.replace('location','building');
    if(!['all','__missing__'].includes(S.building)&&!buildings.has(S.building))buildings.set(S.building,S.building+' (not in current capture)');
    // Keep a disappeared selection explicit until the user clears it.
    if(!['all','__missing__'].includes(S.location)&&!choices.has(S.location))choices.set(S.location,S.location+' (not in current capture)');
    const opts=(items,selected)=>[...items].sort((a,b)=>a[1].localeCompare(b[1],undefined,{numeric:true})).map(([key,name])=>`<option value="${esc(key)}" ${key===selected?'selected':''}>${esc(name)}</option>`).join('');
    return `<div class="location-controls"><div class="location-scope"><label for="${buildingId}">Building</label><select id="${buildingId}" data-building-filter><option value="all" ${S.building==='all'?'selected':''}>All buildings</option>${opts(buildings,S.building)}<option value="__missing__" ${S.building==='__missing__'?'selected':''}>Building not captured</option></select></div><div class="location-scope"><label for="${id}">Unit</label><select id="${id}" data-location-filter><option value="all" ${S.location==='all'?'selected':''}>All units</option>${opts(choices,S.location)}<option value="__missing__" ${S.location==='__missing__'?'selected':''}>Unit not captured</option></select></div></div>`;
  }
  function outcomeSummary(rows){
    return control('outcome-location-filter')+`<p class="small muted">${rows.filter(matches).length} of ${rows.length} patient outcomes · ${esc(selectedLabel())}. Run totals include all patients.</p>`;
  }
  function requestMatches(row){
    return ['refresh','morning','notifications'].includes(row.kind)||matches(row);
  }
  return {label,key,patient,matches,selectedLabel,control,outcomeSummary,requestMatches};
})();
