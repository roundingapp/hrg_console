'use strict';

// Grouping never replaces a result ID with a patient-wide acknowledgment.
const LabView = (() => {
  const chemistry = ['sodium','potassium','chloride','co2','bun','creatinine','glucose'];
  const cbc = ['wbc','hemoglobin','hematocrit','platelets'];
  const extras = ['calcium','magnesium','phosphorus','lactate'];
  const labels = {sodium:'Na',potassium:'K',chloride:'Cl',co2:'CO₂',bun:'BUN',creatinine:'Cr',glucose:'Glu',wbc:'WBC',hemoglobin:'Hgb',hematocrit:'Hct',platelets:'Plt',calcium:'Ca',magnesium:'Mg',phosphorus:'Phos',lactate:'Lactate'};
  const fullTime = value => /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(value || '') && Number.isFinite(Date.parse(value));
  const recent = (a,b) => (fullTime(b.result_time) ? Date.parse(b.result_time) : 0) - (fullTime(a.result_time) ? Date.parse(a.result_time) : 0) || String(b.captured_at).localeCompare(String(a.captured_at)) || a.id.localeCompare(b.id);
  const priority = results => {
    // The API excludes lab collections outside the rolling 24-hour window.
    // Reviewed findings and historical classification never raise the badge.
    const ranked = results.filter(r => r.tier > 0 && !r.reviewed_at);
    return {tier: ranked.length ? Math.min(...ranked.map(r => r.tier)) : 0, critical: ranked.some(r => r.critical)};
  };
  function patients(results, filter='new', tier=0) {
    const groups = new Map();
    for (const r of results) {
      if (!groups.has(r.patient_id)) groups.set(r.patient_id, []);
      groups.get(r.patient_id).push(r);
    }
    return [...groups].flatMap(([patient_id, items]) => {
      const eligible = items.some(r => filter === 'new' ? r.tier > 0 && !r.reviewed_at :
        (r.threshold_tier ?? r.tier) > 0 && (filter === 'all' || r.reviewed_at));
      const rank = priority(items);
      return eligible && (!tier || tier === rank.tier) ? [{patient_id, results:items, ...rank}] : [];
    }).sort((a,b) => a.tier-b.tier || Number(b.critical)-Number(a.critical) || a.patient_id.localeCompare(b.patient_id));
  }
  function split(results) {
    const latest = new Map(), earlier = [];
    for (const r of [...results].filter(r => r.kind === 'lab').sort(recent)) {
      if (latest.has(r.key)) earlier.push(r); else latest.set(r.key, r);
    }
    return {latest, earlier};
  }
  const tone = r => {
    // Preserve abnormal-value styling in history without making it an active tier.
    const tier=r.threshold_tier ?? r.tier;
    return r.critical || tier === 1 ? 'lab-urgent' : tier === 2 ? 'lab-early' : tier === 3 ? 'lab-abnormal' : '';
  };
  const status = r => r.tier_exclusion ? ({reviewed:'Reviewed',older_than_24h:'Older than 24 hours',time_unknown:'Collection time unavailable',future:'Future collection time'}[r.tier_exclusion]) : r.critical ? 'Critical' : r.tier ? 'Tier '+r.tier : 'Available';
  function preview(group) {
    const qualifying = group.results.filter(r => r.kind === 'lab' && !r.reviewed_at && r.tier === group.tier && r.tier > 0);
    if (!qualifying.length) return '';
    const {latest} = split(group.results), byKey = new Map();
    // Keep a critical draw visible even when a newer, less severe draw exists.
    for (const r of qualifying.sort((a,b) => Number(b.critical)-Number(a.critical) || recent(a,b))) {
      if (!byKey.has(r.key)) byKey.set(r.key, []);
      byKey.get(r.key).push(r);
    }
    return `<span class="tier-lab-preview" aria-label="Unreviewed Tier ${group.tier} labs">${[...byKey.values()].map(items => {
      let r = items[0], update;
      if (group.tier === 1) {
        const dated = group.results.filter(x => x.kind === 'lab' && x.key === r.key &&
          fullTime(x.result_time) && Date.parse(x.result_time) <= Date.now()).sort(recent);
        const newest = dated[0], time = newest && Date.parse(newest.result_time);
        const unambiguous = newest && dated.filter(x => Date.parse(x.result_time) === time)
          .every(x => x.value === newest.value && x.units === newest.units && !!x.units_assumed === !!newest.units_assumed);
        // If the latest draw is still Tier 1, pair it with the preceding active
        // trigger. A critical earlier trigger retains the existing preference.
        if (unambiguous && newest.id === r.id) r = items.find(x => fullTime(x.result_time) && Date.parse(x.result_time) < time) || r;
        if (unambiguous && fullTime(r.result_time) && time > Date.parse(r.result_time)) update = newest;
      }
      const older = latest.get(r.key)?.id !== r.id;
      const units = x => `${esc(x.units)}${x.units_assumed?' (assumed)':''}`;
      const mixedUnits = update && (r.units !== update.units || !!r.units_assumed !== !!update.units_assumed);
      const extra = items.filter(x => x.id !== r.id && x.id !== update?.id).length;
      return `<span class="tier-lab-item ${tone(r)}"><strong>${esc(labels[r.key] || r.short || r.label)} ${esc(r.value)}${mixedUnits?' '+units(r):''}${r.critical?' !':''}${update?` <span class="tier-lab-arrow">→</span> <span class="tier-lab-current ${tone(update)}">${esc(update.value)}${mixedUnits?' '+units(update):''}${update.critical?' !':''}</span>`:''}</strong>${mixedUnits?'':`<small>${units(r)}</small>`}<time>${older?'Earlier · ':''}${esc(fullTime(r.result_time)?date(r.result_time):r.result_time||'Time unavailable')}</time>${update?`<time>Latest · ${esc(date(update.result_time))}${update.reviewed_at?' · Reviewed':''}</time>`:''}${!r.identity_precise||update&&!update.identity_precise?'<small>Identity incomplete</small>':''}${extra?`<small>+${extra} more ${extra===1?'result':'results'}</small>`:''}</span>`;
    }).join('')}</span>`;
  }
  function cell(key, result, mixed=false) {
    const label = labels[key] || result?.short || key;
    if (!result) return `<div class="lab-cell lab-missing lab-${key}" aria-label="${esc(label)}: not captured"><span class="lab-label">${esc(label)}</span><strong>—</strong><small>Not captured</small></div>`;
    const r = result;
    return `<button class="lab-cell lab-${key} ${tone(r)}" data-action="lab-detail" data-id="${esc(r.id)}" data-result-id="${esc(r.id)}" data-reviewed="${!!r.reviewed_at}" aria-label="${esc(r.label)}, ${esc(r.value)} ${esc(r.units)}, ${status(r)}${r.reviewed_at?', reviewed':''}. Show trends and source."><span class="lab-label">${esc(label)}${r.reviewed_at?'<span class="lab-check" title="Reviewed">✓</span>':''}</span><strong>${esc(r.value)}${r.critical?'<span class="lab-critical">!</span>':''}</strong><small>${esc(r.units)}${r.units_assumed?'*':''}</small>${mixed?`<time>${esc(date(r.result_time))}</time>`:''}${!r.identity_precise?'<span class="lab-caution">Identity incomplete</span>':''}</button>`;
  }
  function panel(keys, latest, name, shape) {
    const items = keys.map(key => latest.get(key)).filter(Boolean);
    if (!items.length) return '';
    const times = new Set(items.map(r => r.result_time || ''));
    const mixed = times.size !== 1 || items.some(r => !fullTime(r.result_time));
    const lines = shape === 'chemistry'
      ? 'M0 50H72 M24 0V100 M48 0V100 M72 50L85 8 M72 50L85 92'
      : 'M0 8L28 50L0 92 M28 50H72 M72 50L100 8 M72 50L100 92';
    return `<section class="lab-panel"><div class="lab-panel-title"><h4>${name}</h4><span>${mixed?'Different / incomplete times · shown per value':esc(date(items[0].result_time))}</span></div><div class="fishbone ${shape}"><svg class="fishbone-lines" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true"><path d="${lines}"/></svg>${keys.map(key => cell(key, latest.get(key), mixed)).join('')}</div></section>`;
  }
  function resultRow(r) {
    return `<div class="lab-history-row ${tone(r)}" data-result-id="${esc(r.id)}" data-reviewed="${!!r.reviewed_at}"><span><strong>${esc(r.short || r.label)} ${esc(r.value)}</strong> <small>${esc(r.units)}${r.units_assumed?' · assumed units':''}</small><br><small>${esc(date(r.result_time))}${!r.identity_precise?' · Identity incomplete':''}</small></span><span class="small">${r.reviewed_at?'Reviewed':status(r)}</span></div>`;
  }
  function history(labs) {
    const groups = new Map(), order = [...chemistry,...cbc,...extras];
    for (const r of new Map(labs.map(r => [r.id,r])).values()) {
      if (!groups.has(r.key)) groups.set(r.key, []);
      groups.get(r.key).push(r);
    }
    const repeated = [...groups].filter(([,items]) => items.length > 1).sort(([a],[b]) =>
      (order.includes(a)?order.indexOf(a):order.length)-(order.includes(b)?order.indexOf(b):order.length) || a.localeCompare(b));
    if (!repeated.length) return '';
    const unit = r => `${esc(r.units)}${r.units_assumed?' (assumed)':''}`;
    const sections = repeated.map(([key,items]) => {
      const sharedUnits = items.every(r => r.units === items[0].units && !!r.units_assumed === !!items[0].units_assumed);
      const collections = new Map(), uncertain = [], future = [];
      for (const r of [...items].sort(recent).reverse()) {
        if (!fullTime(r.result_time)) {uncertain.push(r);continue;}
        const time = Date.parse(r.result_time);
        if (time > Date.now()) {future.push(r);continue;}
        if (!collections.has(time)) collections.set(time, []);
        collections.get(time).push(r);
      }
      const point = r => `<div class="lab-history-row lab-trend-value ${tone(r)}" data-result-id="${esc(r.id)}" data-reviewed="${!!r.reviewed_at}" aria-label="${esc(labels[key] || r.label)}, ${esc(r.value)} ${esc(r.units)}, ${esc(fullTime(r.result_time)?date(r.result_time):r.result_time||'Time unavailable')}, ${esc(status(r))}"><strong>${esc(r.value)}${r.critical?' !':''}</strong>${sharedUnits?'':`<small>${unit(r)}</small>`}${r.reviewed_at?'<small class="lab-trend-reviewed">✓ Reviewed</small>':r.tier?`<small>${r.critical?'Critical':'Tier '+r.tier}</small>`:''}${!r.identity_precise?'<small>Identity incomplete</small>':''}</div>`;
      const collection = values => `<div class="lab-trend-collection">${values.length>1?`<small class="lab-trend-same-time">${values.length} results · same time</small>`:''}${values.map(point).join('')}<time>${esc(fullTime(values[0].result_time)?date(values[0].result_time):values[0].result_time||'Time unavailable')}</time></div>`;
      const separate = (values,label) => values.length?`<div class="lab-trend-uncertain"><p>${label}</p><div class="lab-trend-chain">${values.map(r=>collection([r])).join('')}</div></div>`:'';
      return `<section class="lab-trend" data-lab-key="${esc(key)}"><div class="lab-trend-heading"><h4>${esc(labels[key] || items[0].short || items[0].label)}</h4>${sharedUnits?`<span>${unit(items[0])}</span>`:''}</div><div class="lab-trend-chain" aria-label="Oldest to latest">${[...collections.values()].map((values,i)=>`<div class="lab-trend-step">${i?'<span class="lab-trend-arrow" aria-label="then">→</span>':''}${collection(values)}</div>`).join('')}</div>${separate(uncertain,'Collection time incomplete')}${separate(future,'Future collection time')}</section>`;
    }).join('');
    return `<details class="lab-history"><summary>Lab trends (${repeated.length} tests)</summary><p class="small muted">Oldest → latest. Collection times are shown beneath each value.</p>${sections}</details>`;
  }
  function render(results) {
    const labs = results.filter(r => r.kind === 'lab');
    if (!labs.length) return '<p class="small muted lab-empty">No captured labs available.</p>';
    const {latest} = split(labs);
    const extraKeys = [...extras, ...[...latest.keys()].filter(key => ![...chemistry,...cbc,...extras].includes(key))].filter(key => latest.has(key));
    const extraItems = extraKeys.map(key => latest.get(key));
    const extraTimes = new Set(extraItems.map(r => r.result_time || ''));
    const mixed = extraTimes.size !== 1 || extraItems.some(r => !fullTime(r.result_time));
    return `<div class="lab-panels">${panel(chemistry,latest,'Chemistry','chemistry')}${panel(cbc,latest,'CBC','cbc')}${extraItems.length?`<section class="lab-panel"><div class="lab-panel-title"><h4>Additional labs</h4><span>${mixed?'Collection times shown per value':esc(date(extraItems[0].result_time))}</span></div><div class="lab-extras">${extraKeys.map(key => cell(key,latest.get(key),mixed)).join('')}</div></section>`:''}</div><div class="lab-expanded" hidden></div>${history(labs)}<p class="lab-help">Tap a value for trends and source details.${labs.some(r => r.units_assumed)?' * Source units unavailable; assumed units shown.':''}</p>`;
  }
  function details(result, results) {
    const matching = results.filter(r => r.kind === 'lab' && r.key === result.key).sort(recent);
    return `<div class="lab-detail-head"><strong>${esc(result.label)}</strong><button class="icon-button" data-action="close-lab-detail" aria-label="Close lab details">${icon('close')}</button></div>${matching.map(r => `${resultRow(r)}<p class="small muted lab-provenance">${esc(r.reason)} · ${esc(r.source)}<br>Collected ${esc(date(r.result_time))} · Captured ${esc(date(r.captured_at))}${r.specimen_id?`<br>Specimen ${esc(r.specimen_id)}`:''}${r.prior?`<br>Prior ${esc(r.prior)} ${esc(r.units)} · ${esc(date(r.prior_time))}`:''}</p>${r.reviewed_at?`<button class="btn link small" data-action="unreview" data-id="${esc(r.id)}">Undo review</button>`:''}`).join('')}`;
  }
  return {patients, priority, split, preview, render, details};
})();
