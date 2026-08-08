/* LCARS_strip — live fleet monitor (product build).
   Polls /api/fleet from the self-contained direct-poll backend; node list and
   hardware specs come from the server config (fleet.json). Gear button opens
   the add/remove-node console (POST /api/config, auto-probe on add). */
(() => {
'use strict';
const $ = s => document.querySelector(s);
const el = (t,c,txt) => { const e=document.createElement(t); if(c)e.className=c; if(txt!=null)e.textContent=txt; return e; };

/* scale the fixed 1424x280 strip to fit the display */
const strip = $('#strip');
function fit(){ const s=Math.min((innerWidth-6)/1424,(innerHeight-6)/280);
  strip.style.transform=`scale(${s})`; strip.style.transformOrigin='center'; }
addEventListener('resize',fit); fit();

/* ---- live data model ---- */
const nodes=[]; const byId={}; let built=false, memberKey='';
function upsert(a){
  let n=byId[a.id];
  if(!n){ n={id:a.id,name:a.name,use:a.use||'',type:a.type,host:a.host||'',
      hero:!!a.hero,retro:!!a.retro,hasGpu:a.gpu===true,hw:a.hw||{},
      m:{cpu:0,net:0,ram:0,disk:0,gpu:0},t:{cpu:0,net:0,ram:0,disk:0,gpu:0},
      online:true,up:0,upAt:0,latency:null,gputemp:null,pingHist:Array.from({length:40},()=>0)};
    byId[a.id]=n; nodes.push(n); }
  n.name=a.name;n.use=a.use||'';n.hw=a.hw||n.hw;n.hasGpu=a.gpu===true;n.host=a.host||n.host;
  ['cpu','net','ram','disk'].forEach(k=>{ if(typeof a[k]==='number') n.t[k]=a[k]; });
  if(typeof a.gpuutil==='number') n.t.gpu=a.gpuutil;
  n.online=a.online!==false;
  if(typeof a.uptime==='number'){ n.up=a.uptime; n.upAt=perfNow(); }
  if(typeof a.gputemp==='number') n.gputemp=a.gputemp;
  if(typeof a.latency==='number'){ n.latency=a.latency;
    n.pingHist.push(n.online?a.latency:0); n.pingHist.shift(); }
  else if(n.type==='xp-snmp'){ n.pingHist.push(n.online?(n.latency||1):0); n.pingHist.shift(); }
  return n;
}
function perfNow(){ return (typeof performance!=='undefined'?performance.now():0)/1000; }
async function pollFleet(){
  try{
    const r=await fetch('/api/fleet',{cache:'no-store'}); const d=await r.json();
    if(d.title){const tl=$('.tb-label');
      if(tl&&tl.textContent!==d.title){tl.textContent=d.title;document.title='LCARS_strip // '+d.title;}}
    const list=d.nodes||[];
    const key=list.map(x=>x.id).join(',');
    if(key!==memberKey){                       // membership changed: reset model
      memberKey=key;
      nodes.length=0; Object.keys(byId).forEach(k=>delete byId[k]);
      list.forEach(upsert); applySavedOrder(); buildStrip();
      built=nodes.length>0; $('#strip').classList.toggle('booting',!built);
    } else list.forEach(upsert);
    net('ok');
  }catch(e){ net('down'); }
}
function net(s){ const b=$('#netstat'); if(b){ b.dataset.s=s; b.textContent = s==='ok'?'◉ LIVE':'◌ RETRY'; } }
setInterval(pollFleet,2000); pollFleet();

let forceMode='mix';
function meterType(mk){ if(forceMode==='needle'||forceMode==='retro')return'needle';
  if(forceMode==='led')return'led'; return (mk==='cpu'||mk==='net')?'needle':'led'; }
function isRetro(n){ return forceMode==='retro' || (forceMode==='mix' && n.retro); }

/* canvas sized ONCE via offsetWidth (unaffected by the CSS scale transform) */
function setupCanvas(cv){const d=devicePixelRatio||1,w=cv.offsetWidth,h=cv.offsetHeight;
  if(!w||!h)return false;cv.width=w*d;cv.height=h*d;const x=cv.getContext('2d');
  x.setTransform(d,0,0,d,0,0);cv._ctx=x;cv._w=w;cv._h=h;return true;}
const zoneColor=v=>v<70?'#2bff66':v<88?'#ffd11a':'#ff3b2e';
const zoneState=v=>v<70?'up':v<88?'warn':'down';

function drawNeedle(cv,v,retro){
  if(!cv._ctx||cv._w!==cv.offsetWidth||cv._h!==cv.offsetHeight){if(!setupCanvas(cv))return;}
  const x=cv._ctx,w=cv._w,h=cv._h;x.clearRect(0,0,w,h);
  const cx=w/2, cy=h*0.82, R=Math.min(w*0.44,h*0.62);
  const a0=Math.PI*1.20, a1=Math.PI*1.80;
  x.lineWidth=Math.max(3,R*0.15);
  for(let i=0;i<=48;i++){const t=i/48,a=a0+(a1-a0)*t;
    x.strokeStyle=t<0.70?'#15c246':t<0.88?'#c69a1e':'#cc2c1e';
    x.beginPath();x.arc(cx,cy,R,a-0.011,a+0.011);x.stroke();}
  x.strokeStyle=retro?'#a6ffbe':'#bcd3e6';x.fillStyle='#8fb0d0';
  x.font='7px "Pixelify Sans",monospace';x.textAlign='center';x.textBaseline='middle';
  for(let i=0;i<=4;i++){const t=i/4,a=a0+(a1-a0)*t,c=Math.cos(a),s=Math.sin(a);
    x.lineWidth=(i%2)?1:1.6;
    x.beginPath();x.moveTo(cx+c*(R-R*0.20),cy+s*(R-R*0.20));x.lineTo(cx+c*(R-2),cy+s*(R-2));x.stroke();
    if(i%2===0)x.fillText(String(t*100),cx+c*(R-R*0.36),cy+s*(R-R*0.36));}
  const a=a0+(a1-a0)*(Math.max(0,Math.min(100,v))/100);
  x.shadowBlur=0;x.strokeStyle='#eef1f5';x.lineWidth=2;x.lineCap='round';
  x.beginPath();x.moveTo(cx-Math.cos(a)*R*0.14,cy-Math.sin(a)*R*0.14);
  x.lineTo(cx+Math.cos(a)*(R-3),cy+Math.sin(a)*(R-3));x.stroke();
  x.fillStyle='#1a1d22';x.beginPath();x.arc(cx,cy,3.4,0,7);x.fill();
  x.strokeStyle='#5a6472';x.lineWidth=1;x.beginPath();x.arc(cx,cy,3.4,0,7);x.stroke();
  x.fillStyle=zoneColor(v);x.font='11px "DSEG7 Classic",monospace';x.textBaseline='alphabetic';
  x.fillText(String(Math.round(v)).padStart(2,'0'),cx,h*0.99);
}
const LN=22;
function buildLedbar(host){host.innerHTML='';host._segs=[];
  for(let i=0;i<LN;i++){const s=el('div','seg');host.appendChild(s);host._segs.push(s);}host._peak=0;}
function drawPing(cv,hist,ok){
  if(!cv._ctx||cv._w!==cv.offsetWidth||cv._h!==cv.offsetHeight){if(!setupCanvas(cv))return;}
  const x=cv._ctx,w=cv._w,h=cv._h;x.clearRect(0,0,w,h);const n=hist.length,bw=w/n;
  for(let i=0;i<n;i++){const p=hist[i],v=Math.min(1,p/45),bh=Math.max(1,v*h*0.92);
    x.fillStyle=!ok?'#4a3a1a':p>28?'#ff3b2e':p>13?'#ffd11a':'#2bff66';
    x.fillRect(i*bw,h-bh,Math.max(1,bw-1),bh);}}
function drawLedbar(host,v){const segs=host._segs,on=Math.round(Math.max(0,Math.min(100,v))/100*LN);
  host._peak=Math.max(on,host._peak-0.2);const pk=Math.round(host._peak);
  segs.forEach((s,i)=>{const idx=i+1,z=idx>LN*0.88?'r':idx>LN*0.7?'a':'g';
    s.className='seg'+(idx<=on?' on '+z:'')+(idx===pk&&idx>on?' on '+z+' peak':'');});}

const content=$('#content');
function nodeHead(n,roleTxt){const head=el('div','node-head'),hl=el('div','nh-left');
  hl.appendChild(el('span','node-name',n.name));hl.appendChild(el('span','node-use',n.use));
  head.appendChild(hl);head.appendChild(el('span','node-role',roleTxt||(n.hero?'HUB':n.type==='xp-snmp'?'lite':'node')));return head;}
function buildFull(n){
  const retro=isRetro(n);
  const col=el('div','node'+(n.hero?' hero':'')+(n.retro?' retrocard':''));col.dataset.id=n.id;col._node=n;col._g={};
  col.appendChild(nodeHead(n));
  const meters=el('div','meters');
  ['cpu','net','ram','disk'].forEach(mk=>{
    const type=meterType(mk),g=el('div','gauge'),face=el('div','face'+(retro?' retro':''));
    if(type==='led'){const bar=el('div','ledbar');buildLedbar(bar);face.appendChild(bar);g._bar=bar;}
    else{const cv=el('canvas');face.appendChild(cv);g._cv=cv;g._retro=retro;}
    g.appendChild(face);g.appendChild(el('div','mlab',mk.toUpperCase()));
    meters.appendChild(g);col._g[mk]=g;});
  const tankMk=n.hasGpu?'gpu':'net';
  const tank=el('div','tank');tank.appendChild(el('div','tcap',n.hasGpu?'GPU':'NET'));
  const fill=el('div','fill');tank.appendChild(fill);meters.appendChild(tank);
  col._tank=fill;col._tankMk=tankMk;
  col.appendChild(meters);
  const row=el('div','ledrow');
  [['LINK','link'],['CPU','cpu'],['RAM','ram'],['DISK','disk']].forEach(([lab,k])=>{
    const s=el('div','svc'),d=el('span','led');d.dataset.k=k;
    s.appendChild(d);s.appendChild(el('span','l',lab));row.appendChild(s);});
  col.appendChild(row);
  return col;
}
function buildStrip(){ content.innerHTML='';
  nodes.forEach(n=>content.appendChild(buildFull(n)));
}
function render(){
  document.querySelectorAll('.node').forEach(col=>{const n=col._node; if(!n)return;
    col.classList.toggle('offline',!n.online);
    ['cpu','net','ram','disk','gpu'].forEach(k=>{
      const tgt=n.online?n.t[k]:0; n.m[k]+=(tgt-n.m[k])*0.11;});
    col.querySelectorAll('.svc .led').forEach(d=>{const k=d.dataset.k;
      d.dataset.s = k==='link' ? (n.online?'up':'down') : (n.online?zoneState(n.m[k]):'down');});
    for(const mk in col._g){const g=col._g[mk],v=n.m[mk];
      if(g._bar)drawLedbar(g._bar,v);else drawNeedle(g._cv,v,g._retro);}
    col._tank.style.height=Math.max(0,Math.min(100,n.m[col._tankMk])).toFixed(1)+'%';
  });
  if(drillNode)renderDrill();
  requestAnimationFrame(render);
}
function fmtUp(s){s=Math.max(0,s|0);const d=Math.floor(s/86400),h=Math.floor(s%86400/3600),m=Math.floor(s%3600/60);
  return String(d).padStart(2,'0')+'d '+String(h).padStart(2,'0')+':'+String(m).padStart(2,'0');}
function liveUp(n){ return n.up + (n.upAt?(perfNow()-n.upAt):0); }
setInterval(()=>{const t=new Date();
  $('#clock').textContent=[t.getHours(),t.getMinutes(),t.getSeconds()].map(x=>String(x).padStart(2,'0')).join(':');
  const p=nodes.find(n=>n.hero)||nodes[0]; if(p)$('#upt').textContent=fmtUp(liveUp(p));},1000);
function neonEgg(){ // colour by word: NEON=pink, pulse=blue, Tech=pink, shop=blue
  const words=[['NEON','#ff3df0'],['pulse','#3df0ff'],['Tech','#ff3df0'],['shop','#3df0ff']];
  let o='';words.forEach(([w,c])=>o+=`<span style="color:${c};text-shadow:0 0 6px ${c}">${w}</span>`);
  return '&nbsp;&nbsp;&nbsp;✦ '+o+' ✦&nbsp;&nbsp;&nbsp;';}
function buildTicker(){
  const off=nodes.filter(n=>!n.online).length;
  const parts=[off?`<span class="warn">◉ ${off} NODE${off>1?'S':''} OFFLINE</span>`
                  :'<span class="ok">◉ FLEET NOMINAL</span>'];
  nodes.forEach(n=>{const hot=n.m.cpu>85||(n.gputemp||0)>80||!n.online;
    parts.push('&nbsp;&nbsp;•&nbsp;&nbsp;'+n.name+' '+
      (!n.online?'<span class="warn">OFFLINE</span>':hot?'<span class="warn">HOT</span>':'<span class="ok">OK</span>')+
      ' &nbsp; cpu '+Math.round(n.m.cpu)+'%');});
  parts.push('&nbsp;&nbsp;•&nbsp;&nbsp;<span class="warn">'+nodes.length+' nodes · direct poll</span>');
  parts.push(neonEgg());
  $('#ticker').innerHTML=parts.join('')+'&nbsp;&nbsp;&nbsp;';}
setInterval(buildTicker,4200);buildTicker();

document.querySelectorAll('.pill').forEach(p=>p.addEventListener('click',()=>{
  document.querySelectorAll('.pill').forEach(q=>q.removeAttribute('data-on'));
  p.setAttribute('data-on','');forceMode=p.dataset.mode;if(built)buildStrip();}));

/* ---- drill-down ---- */
const drill=$('#drill'),drillPanel=$('#drillPanel');let drillNode=null;
function openDrill(n){drillNode=n;drill.hidden=false;
  const hwRows=Object.entries(n.hw).map(([k,val])=>`<div class="hwrow"><b>${k}</b><span>${val}</span></div>`).join('');
  drillPanel._cells=null;
  const link = n.type==='xp-snmp' ? 'SNMP direct' : n.type==='windows' ? 'exporter :9182' : 'netdata :19999';
  drillPanel.innerHTML=`
   <button class="dp-x" id="dpX">[ ✕ ]</button>
   <div class="dp-side"><div class="elbow2"></div>
     <div class="dp-name">${n.name}</div>
     <div class="dp-sub">${n.use}</div>
     <div class="dp-sub">${n.host} · ${link}</div>
     <div class="dp-hw">${hwRows}</div></div>
   <div class="dp-body" id="dpBody"></div>`;
  const cells=[['CPU %','cpu','needle'],['NET %','net','needle'],['RAM %','ram','bar'],['DISK %','disk','bar']];
  if(n.hasGpu){cells.push(['GPU %','gpu','needle']);cells.push(['GPU °C','gputemp','lcd']);}
  cells.push(['UPTIME','up','lcd']);
  cells.push(n.type==='xp-snmp'?['LATENCY','latency','lcd']:['STATUS','online','word']);
  const body=drillPanel.querySelector('#dpBody');
  cells.forEach(([lab,mk,type])=>{const c=el('div','dp-cell');c.appendChild(el('div','mlab',lab));c._mk=mk;c._type=type;
    if(type==='lcd'){const b=el('div','big','—');c.appendChild(b);c._lcd=b;}
    else if(type==='word'){const b=el('div','big word','—');c.appendChild(b);c._word=b;}
    else if(type==='bar'){const face=el('div','face');const bar=el('div','ledbar');buildLedbar(bar);face.appendChild(bar);c.appendChild(face);c._bar=bar;}
    else{const face=el('div','face');const cv=el('canvas');face.appendChild(cv);c.appendChild(face);c._cv=cv;c._retro=n.retro;}
    body.appendChild(c);});
  drillPanel._cells=body.querySelectorAll('.dp-cell');
  drillPanel.querySelector('#dpX').addEventListener('click',e=>{e.stopPropagation();closeDrill();});
}
function renderDrill(){const n=drillNode;if(!drillPanel._cells)return;
  drillPanel._cells.forEach(c=>{
    if(c._type==='lcd'){
      if(c._mk==='up')c._lcd.textContent=fmtUp(liveUp(n));
      else if(c._mk==='gputemp')c._lcd.innerHTML=(n.gputemp!=null?Math.round(n.gputemp):'--')+'<span class="u">°C</span>';
      else if(c._mk==='latency')c._lcd.innerHTML=(n.online&&n.latency!=null?n.latency:'--')+'<span class="u">MS</span>';
    }
    else if(c._type==='word'){c._word.textContent=n.online?'ONLINE':'OFFLINE';
      c._word.style.color=n.online?'var(--grn)':'var(--red)';}
    else if(c._bar)drawLedbar(c._bar,n.m[c._mk]);
    else if(c._cv)drawNeedle(c._cv,n.m[c._mk],c._retro);});}
function closeDrill(){drill.hidden=true;drillNode=null;}
drill.addEventListener('click',e=>{if(e.target===drill)closeDrill();});

/* ---- node console (gear button): add / remove nodes ---- */
const cfg=$('#cfg'),cfgPanel=$('#cfgPanel');
let cfgData=null, probeResult=null;
async function openCfg(){
  cfg.hidden=false; probeResult=null;
  try{ cfgData=await (await fetch('/api/config',{cache:'no-store'})).json(); }
  catch(e){ cfgData={nodes:[]}; }
  paintCfg();
}
function closeCfg(){cfg.hidden=true;}
cfg.addEventListener('click',e=>{if(e.target===cfg)closeCfg();});
async function saveCfg(){
  try{
    const r=await fetch('/api/config',{method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify(cfgData)});
    const d=await r.json();
    if(!d.ok) throw new Error(d.err||'save failed');
    $('#cfgMsg').textContent='✓ SAVED';$('#cfgMsg').className='cfg-msg ok';
    pollFleet();
  }catch(e){ $('#cfgMsg').textContent='✕ '+e.message;$('#cfgMsg').className='cfg-msg err'; }
}
function paintCfg(){
  cfgPanel.innerHTML=`
   <button class="dp-x" id="cfgX">[ ✕ ]</button>
   <div class="dp-side"><div class="elbow2"></div>
     <div class="dp-name">NODE CONSOLE</div>
     <div class="dp-sub">fleet configuration</div>
     <div class="dp-sub" id="cfgMsg" class="cfg-msg"></div></div>
   <div class="cfg-body">
     <div class="cfg-row cfg-title-row">
       <span class="mlab">PANEL TITLE</span>
       <input id="cfgTitle" class="cfg-in" maxlength="40" autocomplete="off">
       <button class="cfg-btn" id="btnTitle">SET</button>
     </div>
     <div class="cfg-list" id="cfgList"></div>
     <div class="cfg-add">
       <div class="mlab">ADD NODE</div>
       <div class="cfg-row">
         <input id="addHost" class="cfg-in" placeholder="IP ADDRESS" autocomplete="off">
         <button class="cfg-btn" id="btnScan">SCAN</button>
       </div>
       <div class="cfg-probe" id="probeOut">enter an IP and scan — type is auto-detected</div>
       <div class="cfg-row">
         <input id="addName" class="cfg-in" placeholder="DISPLAY NAME" autocomplete="off">
         <input id="addUse" class="cfg-in" placeholder="ROLE (optional)" autocomplete="off">
         <button class="cfg-btn go" id="btnAdd">ADD</button>
       </div>
     </div>
   </div>`;
  const list=cfgPanel.querySelector('#cfgList');
  (cfgData.nodes||[]).forEach((n,i)=>{
    const row=el('div','cfg-node');
    row.appendChild(el('span','cfg-nname',n.name));
    row.appendChild(el('span','cfg-nhost',n.host));
    row.appendChild(el('span','cfg-ntype',n.type+(n.gpu?' · gpu':'')));
    const rm=el('button','cfg-btn rm','−');
    rm.addEventListener('click',async()=>{
      if(!confirm('Remove '+n.name+' from the fleet?'))return;
      cfgData.nodes.splice(i,1); await saveCfg(); paintCfg();});
    row.appendChild(rm);
    list.appendChild(row);});
  cfgPanel.querySelector('#cfgX').addEventListener('click',e=>{e.stopPropagation();closeCfg();});
  cfgPanel.querySelector('#btnScan').addEventListener('click',doProbe);
  cfgPanel.querySelector('#btnAdd').addEventListener('click',doAdd);
  const ti=cfgPanel.querySelector('#cfgTitle');ti.value=cfgData.title||'';
  cfgPanel.querySelector('#btnTitle').addEventListener('click',async()=>{
    cfgData.title=ti.value.trim()||'FLEET MONITOR';await saveCfg();});
}
async function doProbe(){
  const host=cfgPanel.querySelector('#addHost').value.trim();
  const out=cfgPanel.querySelector('#probeOut');
  if(!host){out.textContent='enter an IP first';return;}
  out.textContent='◌ scanning '+host+' …';
  try{
    const r=await fetch('/api/probe',{method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({host})});
    probeResult=await r.json();
    if(probeResult.detected){
      out.innerHTML='◉ <b>'+probeResult.detected.toUpperCase()+'</b> detected'+
        (probeResult.suggest&&probeResult.suggest.gpu?' · GPU':'')+
        (probeResult.ping_ms!=null?' · '+probeResult.ping_ms+'ms':'');
      const nm=cfgPanel.querySelector('#addName');
      if(!nm.value&&probeResult.suggest)nm.value=probeResult.suggest.name;
    } else {
      out.textContent=probeResult.ping_ms!=null
        ?'⚠ host alive ('+probeResult.ping_ms+'ms) but no agent found — install one (see nodes/ in the repo)'
        :'✕ no response — check the IP / power / firewall';
    }
  }catch(e){ out.textContent='✕ probe failed: '+e.message; }
}
async function doAdd(){
  const host=cfgPanel.querySelector('#addHost').value.trim();
  const name=cfgPanel.querySelector('#addName').value.trim();
  const use=cfgPanel.querySelector('#addUse').value.trim();
  const out=cfgPanel.querySelector('#probeOut');
  if(!host){out.textContent='enter an IP first';return;}
  const base=(probeResult&&probeResult.host===host&&probeResult.suggest)?probeResult.suggest
             :{host,type:'linux'};
  const node={...base,host,name:name||base.name||host,use};
  cfgData.nodes=cfgData.nodes||[];cfgData.nodes.push(node);
  await saveCfg(); paintCfg();
}
const gear=$('#gear'); if(gear)gear.addEventListener('click',openCfg);

/* ---- unified gesture: tap→drill · horizontal drag→pan · long-press→drag-reorder ---- */
function makeSortable(container,opts){
  const {itemSel,pan,onTap,onReorder}=opts;
  let startX=0,startY=0,startScroll=0,mode=null,holdT=null,dragging=null,downItem=null;
  const clear=()=>{clearTimeout(holdT);if(dragging)dragging.classList.remove('dragging');
    if(pan)container.classList.remove('grabbing');mode=null;dragging=null;downItem=null;};
  container.addEventListener('pointerdown',e=>{
    downItem=e.target.closest(itemSel);startX=e.clientX;startY=e.clientY;
    startScroll=pan?container.scrollLeft:0;mode=null;
    if(downItem)holdT=setTimeout(()=>{mode='reorder';dragging=downItem;
      downItem.classList.add('dragging');if(navigator.vibrate)navigator.vibrate(15);},420);});
  window.addEventListener('pointermove',e=>{
    if(!downItem&&mode!=='pan')return;
    const dx=e.clientX-startX,dy=e.clientY-startY;
    if(mode==='reorder'&&dragging){
      const over=document.elementFromPoint(e.clientX,e.clientY),tgt=over&&over.closest(itemSel);
      if(tgt&&tgt!==dragging&&tgt.parentNode===dragging.parentNode){
        const r=tgt.getBoundingClientRect();
        tgt.parentNode.insertBefore(dragging,(e.clientX>r.left+r.width/2)?tgt.nextSibling:tgt);}
      e.preventDefault();return;}
    if(mode===null&&(Math.abs(dx)>10||Math.abs(dy)>10)){clearTimeout(holdT);
      mode=pan?'pan':'x';if(pan)container.classList.add('grabbing');}
    if(mode==='pan'){container.scrollLeft=startScroll-dx;e.preventDefault();}},{passive:false});
  window.addEventListener('pointerup',e=>{
    if(mode==='reorder'&&onReorder)onReorder();
    else if(mode===null&&downItem&&onTap&&Math.abs(e.clientX-startX)<8&&Math.abs(e.clientY-startY)<8)onTap(downItem);
    clear();});
  if(pan)container.addEventListener('wheel',e=>{if(e.deltaY){container.scrollLeft+=e.deltaY;e.preventDefault();}},{passive:false});
}
function saveNodeOrder(){const ids=[...content.querySelectorAll('.node')].map(n=>n.dataset.id);
  try{localStorage.setItem('lcars.nodeOrder',JSON.stringify(ids));}catch(_){}
  nodes.sort((a,b)=>ids.indexOf(a.id)-ids.indexOf(b.id));}
function applySavedOrder(){try{const ids=JSON.parse(localStorage.getItem('lcars.nodeOrder')||'[]');
  if(ids.length)nodes.sort((a,b)=>(ids.indexOf(a.id)+1||999)-(ids.indexOf(b.id)+1||999));}catch(_){}}
makeSortable(content,{itemSel:'.node',pan:true,onTap:it=>openDrill(it._node),onReorder:saveNodeOrder});
makeSortable(drillPanel,{itemSel:'.dp-cell',pan:false});

requestAnimationFrame(render);
/* test hooks */
const _h=location.hash;
if(_h.startsWith('#drill')){const id=_h.split('=')[1];
  const w=setInterval(()=>{if(built){clearInterval(w);openDrill(byId[id]||nodes[0]);}},120);}
else if(_h==='#end'){const w=setInterval(()=>{if(built){clearInterval(w);content.scrollLeft=content.scrollWidth;}},120);}
else if(_h==='#config'){const w=setInterval(()=>{if(built){clearInterval(w);openCfg();}},120);}
})();
