'use strict';

// One gesture for the page and every independently scrolling sheet. Draft text
// stays in its editor; refreshing never submits a clinical action or persists PHI.
const ConsoleRefresh=(()=>{
  const threshold=72;
  const indicator=document.createElement('div');
  indicator.id='pull-refresh';indicator.hidden=true;
  indicator.setAttribute('role','status');indicator.setAttribute('aria-live','polite');
  indicator.innerHTML=icon('refresh')+'<span></span>';document.body.append(indicator);
  let gesture=null,refreshing=false,hideTimer,suppressClick=false;
  function show(text,anchor,progress=1){
    clearTimeout(hideTimer);indicator.hidden=false;
    indicator.querySelector('span:last-child').textContent=text;
    const header=anchor?.closest('.dialog')?.querySelector('.dialog-head')||document.querySelector('.topbar');
    indicator.style.top=Math.max(8,(header?.getBoundingClientRect().bottom||0)+8)+'px';
    indicator.style.setProperty('--pull-turn',(progress*180)+'deg');
  }
  function reset(){gesture=null;if(!refreshing)indicator.hidden=true;}
  function scrollArea(target){
    for(let e=target;e&&e!==document.body;e=e.parentElement){
      if(/auto|scroll/.test(getComputedStyle(e).overflowY)&&e.scrollHeight>e.clientHeight+1)return e;
    }
    return target.closest('.dialog')?.querySelector('.dialog-body')||document.scrollingElement;
  }
  async function run(anchor=document.querySelector('.dialog-body')){
    if(refreshing||S.busy)return;
    if(!S.data){location.reload();return;}
    refreshing=true;S.busy=true;NoteSheet.sync();indicator.classList.add('refreshing');
    show('Refreshing…',anchor);
    try{
      const modal=S.modal;
      if(modal?.kind==='patient')await NoteSheet.refresh(true);
      else{
        S.data=dropTier3(await api('/api/state'));render();
        if(S.modal===modal){
          if(modal?.kind==='settings')settings();
          if(modal?.kind==='run')runDetail(modal.id);
          if(modal?.kind==='run-group')RunView.detail(modal.id);
          // Consult/provider forms and other open sheets retain their controls.
        }
      }
      S.error='';
      show('Console refreshed',document.querySelector('.dialog-body'));
    }catch(e){
      show('Couldn’t refresh',document.querySelector('.dialog-body'));
      toast(e.message+' Pull down to retry.');
    }finally{
      refreshing=false;S.busy=false;NoteSheet.sync();indicator.classList.remove('refreshing');
      hideTimer=setTimeout(()=>indicator.hidden=true,1800);
    }
  }
  document.addEventListener('touchstart',e=>{
    suppressClick=false;
    if(refreshing||S.busy||e.touches.length!==1){reset();return;}
    const target=e.target instanceof Element?e.target:null;
    if(!target||target.closest('input,textarea,select,[contenteditable="true"],.bottomnav')||getSelection()?.toString()){reset();return;}
    const area=scrollArea(target);
    if(area.scrollTop>0){reset();return;}
    const t=e.touches[0];gesture={area,x:t.clientX,y:t.clientY,id:t.identifier,distance:0,view:S.view,modal:S.modal};
  },{passive:true});
  document.addEventListener('touchmove',e=>{
    if(!gesture)return;
    if(e.touches.length!==1||gesture.view!==S.view||gesture.modal!==S.modal){reset();return;}
    const t=e.touches[0],dy=t.clientY-gesture.y,dx=Math.abs(t.clientX-gesture.x);
    if(t.identifier!==gesture.id||dy<0||dx>Math.max(10,dy)||gesture.area.scrollTop>0){reset();return;}
    if(dy<8)return;
    if(!e.cancelable){reset();return;}
    e.preventDefault();gesture.distance=dy;
    show(dy>=threshold?'Release to refresh':'Pull down to refresh',gesture.area,Math.min(dy/threshold,1));
  },{passive:false});
  document.addEventListener('touchend',e=>{
    if(!gesture)return;
    const current=gesture,ready=current.distance>=threshold&&e.touches.length===0;
    if(current.distance>=8){
      if(e.cancelable)e.preventDefault();
      suppressClick=true;setTimeout(()=>suppressClick=false,400);
    }
    reset();if(ready)void run(current.area);
  },{passive:false});
  document.addEventListener('touchcancel',reset,{passive:true});
  document.addEventListener('click',e=>{if(suppressClick&&e.isTrusted){e.preventDefault();e.stopImmediatePropagation();suppressClick=false;}},true);
  return {run};
})();
