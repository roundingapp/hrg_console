'use strict';
// Read-only web copy (console.houstonrenal.com). Replaces the console's /api with the snapshot
// the mini publishes to Firestore (console/meta + console/chunk<i>). Every write path throws:
// there is no server here, and Firestore rules deny all client writes anyway.
const Hosted=(()=>{
  const STALE_MS=3*60*1000;
  let cache=null,meta=null,watching=false,banner=null;
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
      try{m=(await getDocFromServer(doc(db,'console','meta'))).data();}
      catch(e){if(e.code==='permission-denied')throw err('denied',403);throw err('Could not reach the console data. Check your connection.',503);}
      if(!m)throw err('No snapshot has been published yet.',503);
      meta=m;watch();
      if(cache&&cache.gen===m.gen)return structuredClone(cache.data);
      const parts=await Promise.all([...Array(m.count).keys()].map(i=>getDocFromServer(doc(db,'console','chunk'+i)).then(s=>s.data())));
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
    onSnapshot(doc(fb().db,'console','meta'),s=>{const m=s.data();if(!m)return;const fresh=!meta||m.gen!==meta.gen;meta=m;paintBanner();if(fresh&&typeof load==='function')load(true);},()=>{});
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
    await fb().fns.signOut(fb().auth);cache=null;meta=null;S.data=null;if(banner)banner.hidden=true;login();
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
  return {api,login,denied,decorate,state};
})();
// Sheets (note text etc.): read-only fields, and drop the "verify to enable editing" prompts.
new MutationObserver(()=>{
  document.querySelectorAll('#overlay textarea,#overlay input[type=text]').forEach(t=>{t.readOnly=true;});
  document.querySelectorAll('#overlay .notice').forEach(n=>{if(/enable editing|request a change|revis/i.test(n.textContent))n.setAttribute('data-hosted-hidden','');});
}).observe(document.getElementById('overlay')||document.body,{childList:true,subtree:true});
window.Hosted=Hosted;   // top-level const is not a window property; app.js checks window.Hosted

// Default list: the HMH master list (his 11/09 call), unless this browser already chose one.
try{if(!localStorage.getItem('autonote_list'))localStorage.setItem('autonote_list','.HRG-HMH');}catch{}
