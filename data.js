'use strict';
// Data tab (chartdb, Step 4): size/growth, backups + integrity, warnings, quarantine, dual-write
// status + streak, weekly stray scan, link / vocab / unresolved queues. Read from /api/data,
// which calls the chartdb library read-only — the console never opens the SQLite files itself.
const DataView=(()=>{
  let cache=null,loading=false,error='';
  const mb=b=>b==null?'—':(b/1e6>=1000?(b/1e9).toFixed(2)+' GB':(b/1e6).toFixed(1)+' MB');
  const when=v=>v?new Date(v).toLocaleString([],{month:'short',day:'numeric',hour:'numeric',minute:'2-digit',timeZone:'America/Chicago'}):'—';
  async function refresh(){if(loading)return;loading=true;error='';try{cache=await api('/api/data');}catch(e){error=e.message;}finally{loading=false;render();}}
  function badge(ok,text){return `<span class="badge ${ok?'teal':'amber'}">${esc(text)}</span>`;}
  function kv(rows){return `<dl class="data-kv">${rows.map(([k,v])=>`<div><dt>${esc(k)}</dt><dd>${v}</dd></div>`).join('')}</dl>`;}
  function table(cols,rows){if(!rows.length)return '<p class="small muted">Nothing.</p>';return `<div class="data-table"><table><thead><tr>${cols.map(c=>`<th>${esc(c)}</th>`).join('')}</tr></thead><tbody>${rows.map(r=>`<tr>${r.map(c=>`<td>${c}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;}
  function card(title,sub,body,extra=''){return `<article class="card data-card"><div class="row start"><div class="grow"><h3>${esc(title)}</h3>${sub?`<p class="small muted">${sub}</p>`:''}</div>${extra}</div>${body}</article>`;}
  function page(){
    if(!cache&&!error&&!loading)void refresh();
    const h=head('Patient data','One database, one library. Size, backups, dual-write proof, strays and review queues.',`<button class="btn link small" data-action="data-refresh">${icon('refresh')} Refresh</button>`);
    if(error)return h+`<div class="notice inline-error" role="alert">${esc(error)}</div>`;
    if(!cache)return h+'<p class="small muted">Reading the database…</p>';
    const d=cache,m=d.metrics||{},dc=d.dualcheck||{},sc=d.scan||{},bk=d.backup||{};
    const streakOk=(dc.streak||0)>=(dc.need||7);
    return h+`<div class="data-grid">`+
      card('Size & growth',`measured ${when(m.measured_at)}`,kv([['patients.sqlite3',mb(m.db_bytes)],['raw.sqlite3',mb(m.raw_bytes)],['WAL',mb(m.wal_bytes)],['quarantine images',mb(m.images_bytes)],['rows',Object.entries(d.tables||{}).filter(([k,v])=>v).sort((a,b)=>b[1]-a[1]).slice(0,8).map(([k,v])=>`${esc(k)} ${v.toLocaleString()}`).join(' · ')]]),m.growth_warning?badge(false,'growth warning'):badge(true,'growth normal'))+
      card('Backups',`${bk.daily_count??0} daily · ${bk.monthly_count??0} monthly · 22:30 nightly`,kv([['latest',when(bk.latest_at)],['integrity',esc(bk.latest_integrity||'—')],['restore test',bk.restore_test?esc(bk.restore_test):'—'],['path',`<code>${esc(bk.latest_path||'—')}</code>`]]),badge(bk.latest_integrity==='ok'&&bk.fresh,bk.fresh?'fresh':'stale'))+
      card('Dual-write check',`${dc.day||'—'} · legacy files replayed against the DB at 23:00`,kv([['mismatches',`<strong>${dc.mismatches??'—'}</strong>`],['streak',`${dc.streak??0} / ${dc.need??7} clean days${dc.all_hooked===false?' · not every writer hooked yet':''}`],['hooked',(d.hooks||[]).map(h=>`<span class="badge ${h.hooked?'teal':'neutral'}">${esc(h.name)}</span>`).join(' ')],['parked (name-only) today',dc.unresolved_today??'—'],['dual errors today',dc.dual_errors??'—']]),badge(dc.clean===true,dc.clean===true?'clean':dc.clean===false?'mismatches':'no run yet'))+
      card('Completeness warnings',`last ${(d.warnings||[]).length} from recent runs`,table(['run','patient','type','warning'],(d.warnings||[]).slice(0,12).map(w=>[esc(w.run_id),esc(w.mrn||''),esc(w.data_type||''),esc(w.text||'')])))+
      card('Image quarantine',`${d.images?.quarantined??0} awaiting parse confirmation · ${d.images?.confirmed??0} confirmed · ${d.images?.failed??0} failed`,table(['run','count'],(d.images?.by_run||[]).slice(0,8).map(r=>[esc(r.run_id),r.n])))+
      card('Stray scan',`weekly, Sunday 08:00 · report only · last ${when(sc.scanned_at)}`,kv([['stray files outside the data dir',`<strong>${sc.stray_files??'—'}</strong> (${sc.stray_hits??0} hits)`],['legacy (retire at Step 6)',`${sc.legacy_files??'—'} files`],['top locations',table(['directory','files','hits'],(sc.top||[]).slice(0,8).map(r=>[`<code>${esc(r.dir)}</code>`,r.files,r.hits]))]]),badge((sc.stray_files||0)===0,(sc.stray_files||0)===0?'clean':'strays found'))+
      card('Review queues','identity links, vocabulary, unresolved names',kv([['link review',`${d.queues?.links??0} pending · <code>chartdb links review</code>`],['vocab pending',`${d.queues?.vocab??0} · <code>chartdb vocab pending</code>`],['unresolved identities',`${d.queues?.unresolved??0} names · <code>chartdb unresolved list</code>`],['parked deferred records',`${d.queues?.deferred??0}`]]))+
      `</div>`;
  }
  return {page,refresh};
})();
