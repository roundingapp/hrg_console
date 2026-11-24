'use strict';
// Read-only web copy (console.houstonrenal.com). Replaces the console's /api with the snapshot
// the mini publishes to Firestore (console/meta + console/chunk<i>). Every write path throws:
// there is no server here, and Firestore rules deny all client writes anyway.
const Hosted=(()=>{
  const STALE_MS=3*60*1000;
  // Neil reads `console`; partner viewers (Run tab only) are denied there and read `console_partner`.
  let cache=null,meta=null,watching=false,banner=null,col='console',unwatch=null;
  const fb=()=>window._fb;
  const ready=()=>window._fb?Promise.resolve():new Promise(r=>window.addEventListener('firebase-ready',r,{once:true}));
  function authed(){return new Promise(r=>{const u=fb().auth.currentUser;if(u)return r(u);const off=fb().fns.onAuthStateChanged(fb().auth,x=>{off();r(x);});});}
  function err(msg,status){const e=Error(msg);e.status=status;return e;}
  async function decode(b64){
    const bin=Uint8Array.from(atob(b64),c=>c.charCodeAt(0));
    const stream=new Blob([bin]).stream().pipeThrough(new DecompressionStream('gzip'));
    return JSON.parse(await new Response(stream).text());
  }
  async function state(){
    await ready();
    const user=await authed();
    if(!user)throw err('Sign in to continue.',401);
    const {doc,getDocFromServer}=fb().fns,db=fb().db;
    for(let attempt=0;attempt<3;attempt++){
      let m;
      try{m=(await getDocFromServer(doc(db,col,'meta'))).data();}
      catch(e){
        if(e.code==='permission-denied'&&col==='console'){col='console_partner';attempt--;continue;}
        if(e.code==='permission-denied')throw err('denied',403);throw err('Could not reach the console data. Check your connection.',503);}
      if(!m)throw err('No snapshot has been published yet.',503);
      meta=m;watch();
      if(cache&&cache.gen===m.gen)return structuredClone(cache.data);
      const parts=await Promise.all([...Array(m.count).keys()].map(i=>getDocFromServer(doc(db,col,'chunk'+i)).then(s=>s.data())));
      if(parts.some(p=>!p||p.gen!==m.gen))continue;   // a newer snapshot landed mid-read; read again
      const data=await decode(parts.map(p=>p.data).join(''));
      cache={gen:m.gen,data};
      return structuredClone(data);
    }
    throw err('The snapshot kept changing while loading. Try again.',503);
  }
  function watch(){
    if(watching)return;watching=true;
    const {doc,onSnapshot}=fb().fns;
    unwatch=onSnapshot(doc(fb().db,col,'meta'),s=>{const m=s.data();if(!m)return;const fresh=!meta||m.gen!==meta.gen;meta=m;paintBanner();if(fresh&&typeof load==='function')load(true);},()=>{});
  }
  async function api(path,body){
    if(body!==undefined)throw err('Read-only copy — make changes in the AutoNote console on the Mac.',405);
    if(path==='/api/state')return state();
    throw err('Not available in the read-only copy.',404);
  }
  const hm=t=>new Date(t).toLocaleTimeString([],{hour:'numeric',minute:'2-digit'});
  function paintBanner(){
    if(!banner){banner=document.createElement('div');banner.id='hosted-banner';banner.setAttribute('role','status');document.body.prepend(banner);}
    if(!meta){banner.hidden=true;return;}
    const t=new Date(meta.published_at),stale=Date.now()-t>STALE_MS;
    banner.hidden=false;banner.className=stale?'stale':'';
    banner.innerHTML=`<span>Read-only</span> · ${stale?'Not updated since':'Updated'} ${esc(hm(t))}${stale?' — the Mac may be offline':''}<button type="button" data-hosted-signout>Sign out</button>`;
  }
  setInterval(paintBanner,15000);
  function login(message){
    $('#app').innerHTML=`<div class="unlock">${brand()}<h1>HRG Console</h1><p>${esc(message||'Sign in with your HRG Pay Tracker email and password. Read-only.')}</p><form id="hosted-login"><input id="hosted-email" type="email" autocomplete="username" placeholder="Email" required><input id="hosted-password" type="password" autocomplete="current-password" placeholder="Password" required><button class="btn primary" type="submit">Sign in ${icon('arrow')}</button><p class="small muted" id="hosted-login-error" role="alert"></p></form></div>`;
  }
  function denied(){
    $('#app').innerHTML=`<div class="unlock">${brand()}<h1>Not approved</h1><p>This account isn’t on the console’s approved list.</p><button class="btn primary" data-hosted-signout>Sign out</button></div>`;
  }
  document.addEventListener('submit',async e=>{
    if(e.target.id!=='hosted-login')return;e.preventDefault();
    const out=$('#hosted-login-error');out.textContent='Signing in…';
    try{await ready();await fb().fns.signInWithEmailAndPassword(fb().auth,$('#hosted-email').value.trim(),$('#hosted-password').value);out.textContent='';load();}
    catch(x){out.textContent=/invalid|wrong|user-not-found|credential/.test(x.code||'')?'Email or password is incorrect.':'Sign-in failed. Try again.';}
  });
  document.addEventListener('click',async e=>{
    if(!e.target.closest('[data-hosted-signout]'))return;
    await fb().fns.signOut(fb().auth);cache=null;meta=null;col='console';if(unwatch)unwatch();unwatch=null;watching=false;S.data=null;if(banner)banner.hidden=true;login();
  },true);

  // Provider-list chips on the Run board: wrap, never scroll sideways. Each shows when its
  // list was last read and when the next re-walk window is (30-min re-walks stop at 10:00).
  function listStatus(l,rw){
    if(!l.as_of)return {text:'Not read today',cls:'bad'};
    const st=rw?.lists?.[l.list];
    if(st?.failed)return {text:'Not read since '+hm(l.as_of),cls:'bad'};
    if(rw?.active&&st?.walking)return {text:'Updated '+hm(l.as_of)+' · refreshing now',cls:''};
    if(rw?.active&&st?.next_start){
      const a=new Date(st.next_start),b=new Date(+a+15*60000);
      if(Date.now()>+b)return {text:'Updated '+hm(l.as_of)+' · refresh delayed (phones busy)',cls:'warn'};
      return {text:'Updated '+hm(l.as_of)+' · next '+hm(a)+'–'+hm(b),cls:''};
    }
    return {text:'Updated '+hm(l.as_of),cls:''};
  }
  function chips(){
    const h=S.data?.hosted;if(!h?.lists?.length)return '';
    const sel=document.querySelector('[data-board-select="board-provider"]'),cur=sel?.value||'all';
    const chip=(id,label,count,status,disabled)=>`<button type="button" class="hosted-chip${cur===id?' active':''}${status?.cls?' '+status.cls:''}" data-hosted-chip="${esc(id)}"${disabled?' disabled':''}><strong>${esc(label)}</strong>${count==null?'':` <span>${count}</span>`}${status?`<small>${esc(status.text)}</small>`:''}</button>`;
    return `<div class="hosted-chips" aria-label="Provider lists">${chip('all','All · HRG-HMH',null,null,false)}${h.lists.map(l=>chip(l.label,l.label,l.count,listStatus(l,h.rewalk),!l.as_of||!sel||![...sel.options].some(o=>o.value===l.label))).join('')}</div>`;
  }
  function decorate(){
    paintBanner();
    document.querySelectorAll('.hosted-chips').forEach(e=>e.remove());
    if(S.view!=='review')return;
    const anchor=document.querySelector('#main .rb-counts');if(anchor)anchor.insertAdjacentHTML('beforebegin',chips());
  }
  document.addEventListener('click',e=>{
    const c=e.target.closest('[data-hosted-chip]');if(!c||c.disabled)return;
    RunBoard.action('board-provider',{dataset:{id:c.dataset.hostedChip}});
  });
  // ── Card view dot (Neil 2026-11-24; spec in console/TASKS.md) ─────────────────────────────
  // Partners: each tap that OPENS a Run-board card writes one entry to `console_opens`
  // ({uid, patient, ts}; rules: create-only, own uid, server time). Neil (col==='console')
  // never writes; he sees one dot per card after the provider name:
  //   green = any provider opened it today (CT) · grey = no recorded open, before 10:00 ·
  //   red = no recorded open by 10:00. Tap = popup with each provider's open times.
  // A write that fails (offline, denied) leaves no record — the popup says "no recorded open".
  const OPENS='console_opens',ctDay=t=>new Date(t).toLocaleDateString('en-CA',{timeZone:'America/Chicago'});
  const ctHour=()=>+new Date().toLocaleString('en-US',{timeZone:'America/Chicago',hour:'numeric',hour12:false})%24;
  let opens=null,openNames={},opensAt=0,opensBusy=false;
  const lastWrite={};
  document.addEventListener('click',e=>{
    if(col!=='console_partner')return;
    const sum=e.target.closest('.rb-card>summary');if(!sum||e.target.closest('button,a,input'))return;
    const card=sum.parentElement,id=card.dataset.patientId;if(!id||card.open)return;   // about to open
    if(Date.now()-(lastWrite[id]||0)<60000)return;lastWrite[id]=Date.now();
    const u=fb()?.auth.currentUser;if(!u)return;
    const {collection,addDoc,serverTimestamp}=fb().fns;
    addDoc(collection(fb().db,OPENS),{uid:u.uid,patient:String(id),ts:serverTimestamp()}).catch(()=>{});
  },true);
  async function loadOpens(){
    if(opensBusy||Date.now()-opensAt<20000)return false;opensBusy=true;
    try{
      const {collection,query,where,getDocsFromServer,Timestamp,doc,getDocFromServer}=fb().fns,db=fb().db;
      if(!Object.keys(openNames).length){try{openNames=(await getDocFromServer(doc(db,'console_opens_meta','names'))).data()||{};}catch{}}
      const snap=await getDocsFromServer(query(collection(db,OPENS),where('ts','>=',Timestamp.fromMillis(Date.now()-50*3600*1000))));
      const by={};snap.forEach(d=>{const o=d.data();if(!o.ts)return;(by[o.patient]=by[o.patient]||[]).push({uid:o.uid,t:o.ts.toMillis()});});
      opens=by;opensAt=Date.now();return true;
    }catch{return false;}finally{opensBusy=false;}
  }
  const who=uid=>openNames[uid]?.name||'Unknown provider';
  function dotState(id){
    const today=ctDay(Date.now()),seen=(opens?.[id]||[]).some(o=>ctDay(o.t)===today);
    return seen?'green':ctHour()>=10?'red':'grey';
  }
  function paintDots(){
    if(col!=='console'||S.view!=='review')return;
    document.querySelectorAll('#main .rb-card').forEach(c=>{
      const id=c.dataset.patientId,host=c.querySelector('.rb-stcol');if(!id||!host)return;
      let d=host.querySelector('.hv-dot');
      if(!d){d=document.createElement('button');d.type='button';d.className='hv-dot';(host.querySelector('.rb-prov')||host).appendChild(d);}
      const s=opens?dotState(id):'unknown';d.dataset.state=s;d.dataset.pid=id;
      d.setAttribute('aria-label',s==='green'?'Opened by a provider today':s==='unknown'?'Could not load provider opens':'No recorded provider open today');
    });
  }
  function popup(btn){
    closePopup();
    const id=btn.dataset.pid,card=btn.closest('.rb-card'),today=ctDay(Date.now()),yest=ctDay(Date.now()-86400000);
    const rows=(opens?.[id]||[]).slice().sort((a,b)=>a.t-b.t),group=day=>{const g={};rows.filter(o=>ctDay(o.t)===day).forEach(o=>(g[o.uid]=g[o.uid]||[]).push(o.t));return g;};
    const t=group(today),y=group(yest),fmt=ts=>ts.map(x=>new Date(x).toLocaleTimeString('en-US',{timeZone:'America/Chicago',hour:'numeric',minute:'2-digit'})).join(', ');
    const lists=[...(card?.querySelector('.rb-prov')?.textContent||'').split(',').map(s=>s.trim()).filter(Boolean)];
    const notYet=lists.filter(l=>!Object.keys(t).some(u=>openNames[u]?.list===l));
    const line=(u,ts)=>`<li><strong>${esc(who(u))}</strong> · ${esc(fmt(ts))}${ts.length>1?` <span class="muted">(${ts.length}×)</span>`:''}</li>`;
    const el=document.createElement('div');el.id='hv-pop';el.setAttribute('role','dialog');
    if(!opens){el.innerHTML='<p>Could not load who opened this card. Check your connection and try again.</p>';}else
    el.innerHTML=`<h4>Opened today</h4>${Object.keys(t).length?`<ul>${Object.entries(t).map(([u,ts])=>line(u,ts)).join('')}</ul>`:'<p class="muted">No recorded open today.</p>'}`+
      (notYet.length?`<p class="muted">Not opened today: ${esc(notYet.join(', '))}</p>`:'')+
      `<h4>Yesterday</h4>${Object.keys(y).length?`<ul>${Object.entries(y).map(([u,ts])=>line(u,ts)).join('')}</ul>`:'<p class="muted">No recorded open.</p>'}`+
      `<p class="small muted">Only opens on console.houstonrenal.com are recorded; an open made offline may be missing.</p>`;
    document.body.appendChild(el);
    const r=btn.getBoundingClientRect(),w=Math.min(300,window.innerWidth-32);el.style.width=w+'px';
    el.style.left=Math.max(16,Math.min(r.right-w,window.innerWidth-w-16))+'px';el.style.top=Math.max(8,Math.min(r.bottom+6,window.innerHeight-el.offsetHeight-8))+'px';
  }
  function closePopup(){document.getElementById('hv-pop')?.remove();}
  document.addEventListener('click',e=>{
    const d=e.target.closest('.hv-dot');
    if(d){e.preventDefault();e.stopPropagation();if(document.getElementById('hv-pop')?.dataset.pid===d.dataset.pid){closePopup();return;}popup(d);document.getElementById('hv-pop').dataset.pid=d.dataset.pid;return;}
    if(!e.target.closest('#hv-pop'))closePopup();
  },true);
  document.addEventListener('pointerdown',e=>{if(e.target.closest('.hv-dot'))e.stopPropagation();},true);   // no long-press "unreviewed" on the dot
  document.addEventListener('keydown',e=>{if(e.key==='Escape')closePopup();});
  function decorateDots(){
    if(col!=='console')return;
    paintDots();
    loadOpens().then(ok=>{if(ok)paintDots();});
  }
  setInterval(()=>{if(col==='console'&&S.view==='review')paintDots();},60000);   // grey → red at 10:00 without a reload
  const baseDecorate=decorate;
  return {api,login,denied,decorate:()=>{baseDecorate();decorateDots();},state};
})();
// Sheets (note text etc.): read-only fields, and drop the "verify to enable editing" prompts.
new MutationObserver(()=>{
  document.querySelectorAll('#overlay textarea,#overlay input[type=text]').forEach(t=>{t.readOnly=true;});
  document.querySelectorAll('#overlay .notice').forEach(n=>{if(/enable editing|request a change|revis/i.test(n.textContent))n.setAttribute('data-hosted-hidden','');});
}).observe(document.getElementById('overlay')||document.body,{childList:true,subtree:true});
window.Hosted=Hosted;   // top-level const is not a window property; app.js checks window.Hosted

// Default list: the HMH master list (his 11/09 call), unless this browser already chose one.
try{if(!localStorage.getItem('autonote_list'))localStorage.setItem('autonote_list','.HRG-HMH');}catch{}
