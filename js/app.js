/* LCARS_strip mockup — fake-data engine + meter rendering + touch drill-down.
   Real build will replace the fake data with Netdata API polls. */
(() => {
'use strict';
const $ = s => document.querySelector(s);
const el = (t,c,txt) => { const e=document.createElement(t); if(c)e.className=c; if(txt!=null)e.textContent=txt; return e; };

/* scale the fixed 1424x280 strip to fit the test display (5:4 now, LCD later) */
const strip = $('#strip');
function fit(){ const s=Math.min((innerWidth-6)/1424,(innerHeight-6)/280);
  strip.style.transform=`scale(${s})`; strip.style.transformOrigin='center'; }
addEventListener('resize',fit); fit();

const rnd=(a,b)=>a+Math.random()*(b-a);
function mkNode(c){return Object.assign({
  type:'full',retro:false,hero:false,
  m:{cpu:rnd(5,40),net:rnd(5,30),ram:rnd(30,60),disk:rnd(10,50),temp:rnd(38,52)},
  t:{cpu:0,net:0,ram:0,disk:0,temp:0},
  svc:{plex:'up',pm2:'up',pg:'up',net:'up'},
  traffic:rnd(20,120),cap:512,up:rnd(1,40)*86400+rnd(0,80000),
  ping:rnd(2,16),reachable:true,pingHist:Array.from({length:40},()=>rnd(2,16)),
},c);}
// Specs from BatCave TechStack.txt (working doc — VERIFY on go-live; IPs/RAM/drives drift)
const nodes=[
  mkNode({id:'starbase1',name:'STARBASE1',role:'child',use:'MEDIA · PLEX · DNS',
    hw:{CPU:'Xeon E5-1620 v2 · 4c/8t',RAM:'128 GB ECC',GPU:'ASPEED BMC',STORAGE:'10TB+1TB RAID · 640GB OS',OS:'Zentyal 8 · U22.04'}}),
  mkNode({id:'starbase2',name:'STARBASE2',role:'PARENT',use:'WEB · DB · MONITOR',hero:true,
    hw:{CPU:'Core i5-7500T · 4c/4t',RAM:'16 GB DDR4',GPU:'Intel HD 630',STORAGE:'238 GB SSD',OS:'Ubuntu 26.04'}}),
  mkNode({id:'pop-os',name:'CYBERTOWER',role:'child',use:'DEV WORKSTATION',retro:true,
    hw:{CPU:'Core i7-6700 · 4c/8t',RAM:'16 GB DDR4-3600',GPU:'RTX 4060 Ti',STORAGE:'Crucial P310 1TB',OS:'Pop!_OS Cosmic'}}),
  mkNode({id:'skytech',name:'SKYTECH',role:'child',use:'RACING SIM',
    hw:{CPU:'Core i9-10900F · 10c/20t',RAM:'128 GB DDR4',GPU:'RTX 5070 Ti 16G',STORAGE:'WD SN570 1TB',OS:'Windows 11 Pro',AGENT:'windows_exporter'}}),
  mkNode({id:'vonholten308',name:'VONHOLTEN308',role:'child',use:'STARSHIP · MOBILE',
    hw:{CPU:'Core i7-13650HX · 14c/20t',RAM:'32 GB',GPU:'RTX 4060 8G',STORAGE:'WD SN850X 2TB',OS:'Windows 11 Pro',AGENT:'windows_exporter'}}),
  mkNode({id:'kidsdesk',name:'KIDS DESK',role:'child',use:'FAMILY PC',
    hw:{CPU:'—',RAM:'—',GPU:'—',STORAGE:'—',OS:'Linux (verify)'}}),
  mkNode({id:'labstudio',name:'LAB STUDIO',role:'child',use:'PLEX RECEIVER',
    hw:{CPU:'Core i7-3770K · 4c/8t',RAM:'32 GB DDR3',GPU:'GTX 1080 Ti 11G',STORAGE:'WD Blue 500GB SSD',OS:'Pop!_OS · 192.168.68.111'}}),
  mkNode({id:'retrobeast-v2',name:'RETROBEAST-V2',role:'lite',use:'WINDOWS XP',type:'lite',retro:true,
    hw:{CPU:'Athlon XP 3200+ · 2.2GHz',RAM:'3 GB DDR-333',GPU:'Radeon HD 3850 AGP',STORAGE:'WD Blue 500GB SSD',OS:'Windows XP',AGENT:'SNMP + ping'}}),
];
let forceMode='mix';
/* meter type per metric: mix = CPU/NET needles, RAM/DISK LED bars */
function meterType(mk){ if(forceMode==='needle'||forceMode==='retro')return'needle';
  if(forceMode==='led')return'led'; return (mk==='cpu'||mk==='net')?'needle':'led'; }
function isRetro(n){ return forceMode==='retro' || (forceMode==='mix' && n.retro); }

function retarget(){ nodes.forEach(n=>{
  if(n.type==='lite'){
    if(Math.random()<0.025)n.reachable=!n.reachable;
    n.ping=Math.min(80,Math.max(1,n.ping+rnd(-4,5)));
    n.pingHist.push(n.reachable?n.ping:0);n.pingHist.shift();return;
  }
  n.t.cpu=Math.min(100,Math.max(2,n.m.cpu+rnd(-25,28)));
  n.t.net=Math.random()<0.25?rnd(60,98):Math.min(100,Math.max(2,n.m.net+rnd(-30,30)));
  n.t.ram=Math.min(95,Math.max(20,n.m.ram+rnd(-6,6)));
  n.t.disk=Math.min(96,Math.max(8,n.m.disk+rnd(-1.5,1.6)));
  n.t.temp=Math.min(78,Math.max(34,n.m.temp+rnd(-3,3)));
  n.traffic=Math.min(n.cap,n.traffic+n.m.net/100*rnd(.2,1.4));
  if(n.traffic>=n.cap)n.traffic=rnd(5,20);
  const k=['plex','pm2','pg','net'][Math.floor(rnd(0,4))];
  n.svc[k]=Math.random()<0.05?'warn':'up';
}); }
setInterval(retarget,900);

/* canvas sized ONCE via offsetWidth (unaffected by the CSS scale transform) */
function setupCanvas(cv){const d=devicePixelRatio||1,w=cv.offsetWidth,h=cv.offsetHeight;
  if(!w||!h)return false;cv.width=w*d;cv.height=h*d;const x=cv.getContext('2d');
  x.setTransform(d,0,0,d,0,0);cv._ctx=x;cv._w=w;cv._h=h;return true;}
const zoneColor=v=>v<70?'#2bff66':v<88?'#ffd11a':'#ff3b2e';

function drawNeedle(cv,v,retro){
  if(!cv._ctx||cv._w!==cv.offsetWidth||cv._h!==cv.offsetHeight){if(!setupCanvas(cv))return;}
  const x=cv._ctx,w=cv._w,h=cv._h;x.clearRect(0,0,w,h);
  // pivot low-center, arc sweeps across the TOP (traditional speedometer)
  const cx=w/2, cy=h*0.82, R=Math.min(w*0.44,h*0.62);
  const a0=Math.PI*1.20, a1=Math.PI*1.80;              // ~108° sweep across top
  // zoned dial band
  x.lineWidth=Math.max(3,R*0.15);
  for(let i=0;i<=48;i++){const t=i/48,a=a0+(a1-a0)*t;
    x.strokeStyle=t<0.70?'#15c246':t<0.88?'#c69a1e':'#cc2c1e';
    x.beginPath();x.arc(cx,cy,R,a-0.011,a+0.011);x.stroke();}
  // tick marks + numeric scale (frame of reference)
  x.strokeStyle=retro?'#a6ffbe':'#bcd3e6';x.fillStyle='#8fb0d0';
  x.font='7px "Pixelify Sans",monospace';x.textAlign='center';x.textBaseline='middle';
  for(let i=0;i<=4;i++){const t=i/4,a=a0+(a1-a0)*t,c=Math.cos(a),s=Math.sin(a);
    x.lineWidth=(i%2)?1:1.6;
    x.beginPath();x.moveTo(cx+c*(R-R*0.20),cy+s*(R-R*0.20));x.lineTo(cx+c*(R-2),cy+s*(R-2));x.stroke();
    if(i%2===0)x.fillText(String(t*100),cx+c*(R-R*0.36),cy+s*(R-R*0.36));}
  // traditional needle — solid, NO glow
  const a=a0+(a1-a0)*(v/100);
  x.shadowBlur=0;x.strokeStyle='#eef1f5';x.lineWidth=2;x.lineCap='round';
  x.beginPath();x.moveTo(cx-Math.cos(a)*R*0.14,cy-Math.sin(a)*R*0.14);
  x.lineTo(cx+Math.cos(a)*(R-3),cy+Math.sin(a)*(R-3));x.stroke();
  // hub
  x.fillStyle='#1a1d22';x.beginPath();x.arc(cx,cy,3.4,0,7);x.fill();
  x.strokeStyle='#5a6472';x.lineWidth=1;x.beginPath();x.arc(cx,cy,3.4,0,7);x.stroke();
  // digital readout below the hub
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
function drawLedbar(host,v){const segs=host._segs,on=Math.round(v/100*LN);
  host._peak=Math.max(on,host._peak-0.2);const pk=Math.round(host._peak);
  segs.forEach((s,i)=>{const idx=i+1,z=idx>LN*0.88?'r':idx>LN*0.7?'a':'g';
    s.className='seg'+(idx<=on?' on '+z:'')+(idx===pk&&idx>on?' on '+z+' peak':'');});}

const content=$('#content');
function nodeHead(n,roleTxt){const head=el('div','node-head'),hl=el('div','nh-left');
  hl.appendChild(el('span','node-name',n.name));hl.appendChild(el('span','node-use',n.use));
  head.appendChild(hl);head.appendChild(el('span','node-role',roleTxt||n.role));return head;}
function buildFull(n){
  const retro=isRetro(n);
  const col=el('div','node'+(n.hero?' hero':''));col.dataset.id=n.id;col._node=n;col._g={};
  col.appendChild(nodeHead(n));
  const meters=el('div','meters');
  ['cpu','net','ram','disk'].forEach(mk=>{
    const type=meterType(mk),g=el('div','gauge'),face=el('div','face'+(retro?' retro':''));
    if(type==='led'){const bar=el('div','ledbar');buildLedbar(bar);face.appendChild(bar);g._bar=bar;}
    else{const cv=el('canvas');face.appendChild(cv);g._cv=cv;g._retro=retro;}
    g.appendChild(face);g.appendChild(el('div','mlab',mk.toUpperCase()));
    meters.appendChild(g);col._g[mk]=g;});
  const tank=el('div','tank');tank.appendChild(el('div','tcap','24H'));
  const fill=el('div','fill');tank.appendChild(fill);meters.appendChild(tank);col._tank=fill;
  col.appendChild(meters);
  const row=el('div','ledrow');
  [['PLEX','plex'],['PM2','pm2'],['PG','pg'],['NET','net']].forEach(([lab,k])=>{
    const s=el('div','svc'),d=el('span','led');d.dataset.svc=k;
    s.appendChild(d);s.appendChild(el('span','l',lab));row.appendChild(s);});
  col.appendChild(row);
  return col;
}
function buildLite(n){
  const col=el('div','node lite'+(n.retro?' retro':''));col.dataset.id=n.id;col._node=n;
  col.appendChild(nodeHead(n,'lite'));
  const body=el('div','lite-body');
  const stat=el('div','lite-stat');const led=el('span','lite-led');stat.appendChild(led);col._led=led;
  const tx=el('div','lite-tx');const state=el('div','lite-state','—');const lat=el('div','lite-lat lcd','--');
  tx.appendChild(state);tx.appendChild(lat);stat.appendChild(tx);col._state=state;col._lat=lat;
  body.appendChild(stat);
  const face=el('div','face lite-face');const cv=el('canvas');face.appendChild(cv);body.appendChild(face);col._pingcv=cv;
  col.appendChild(body);
  col.appendChild(el('div','lite-foot','◇ '+(n.hw.AGENT||'agent-less')+' · PING'));
  return col;
}
function buildStrip(){ content.innerHTML='';
  nodes.forEach(n=>content.appendChild(n.type==='lite'?buildLite(n):buildFull(n)));
}
function renderLite(col,n){
  col._led.dataset.s=n.reachable?'up':'down';
  col._state.textContent=n.reachable?'ONLINE':'OFFLINE';
  col._state.className='lite-state '+(n.reachable?'on':'off');
  col._lat.innerHTML=n.reachable?Math.round(n.ping)+'<span class="u">MS</span>':'<span class="u">—</span>';
  drawPing(col._pingcv,n.pingHist,n.reachable);
}
function render(){
  document.querySelectorAll('.node').forEach(col=>{const n=col._node;
    if(n.type==='lite'){renderLite(col,n);return;}
    ['cpu','net','ram','disk','temp'].forEach(k=>{n.m[k]+=(n.t[k]-n.m[k])*0.11;});
    col.querySelectorAll('.svc .led').forEach(d=>d.dataset.s=n.svc[d.dataset.svc]);
    for(const mk in col._g){const g=col._g[mk],v=n.m[mk];
      if(g._bar)drawLedbar(g._bar,v);else drawNeedle(g._cv,v,g._retro);}
    col._tank.style.height=(n.traffic/n.cap*100).toFixed(1)+'%';
  });
  if(drillNode)renderDrill();
  requestAnimationFrame(render);
}
function fmtUp(s){const d=Math.floor(s/86400),h=Math.floor(s%86400/3600),m=Math.floor(s%3600/60);
  return String(d).padStart(2,'0')+'d '+String(h).padStart(2,'0')+':'+String(m).padStart(2,'0');}
setInterval(()=>{const t=new Date();
  $('#clock').textContent=[t.getHours(),t.getMinutes(),t.getSeconds()].map(x=>String(x).padStart(2,'0')).join(':');
  nodes.forEach(n=>n.up++);$('#upt').textContent=fmtUp(nodes[1].up);},1000);
function neonEgg(){ // colour by word: NEON=pink, pulse=blue, Tech=pink, shop=blue
  const words=[['NEON','#ff3df0'],['pulse','#3df0ff'],['Tech','#ff3df0'],['shop','#3df0ff']];
  let o='';words.forEach(([w,c])=>o+=`<span style="color:${c};text-shadow:0 0 6px ${c}">${w}</span>`);
  return '&nbsp;&nbsp;&nbsp;✦ '+o+' ✦&nbsp;&nbsp;&nbsp;';}
function buildTicker(){const parts=['<span class="ok">◉ FLEET NOMINAL</span>'];
  nodes.forEach(n=>{const hot=n.m.cpu>85||n.m.temp>70;
    parts.push('&nbsp;&nbsp;•&nbsp;&nbsp;'+n.name+' '+(hot?'<span class="warn">CPU/TEMP HIGH</span>':'<span class="ok">OK</span>')+' &nbsp; net '+Math.round(n.m.net)+'%');});
  parts.push('&nbsp;&nbsp;•&nbsp;&nbsp;<span class="warn">parent SB2 · '+nodes.length+' nodes streaming</span>');
  parts.push(neonEgg());
  $('#ticker').innerHTML=parts.join('')+'&nbsp;&nbsp;&nbsp;';}
setInterval(buildTicker,4200);buildTicker();

document.querySelectorAll('.pill').forEach(p=>p.addEventListener('click',()=>{
  document.querySelectorAll('.pill').forEach(q=>q.removeAttribute('data-on'));
  p.setAttribute('data-on','');forceMode=p.dataset.mode;buildStrip();}));

const drill=$('#drill'),drillPanel=$('#drillPanel');let drillNode=null;
function openDrill(n){drillNode=n;drill.hidden=false;
  const hwRows=Object.entries(n.hw).map(([k,val])=>`<div class="hwrow"><b>${k}</b><span>${val}</span></div>`).join('');
  if(n.type==='lite'){openLiteDrill(n,hwRows);return;}
  drillPanel._litecells=null;
  drillPanel.innerHTML=`
   <button class="dp-x" id="dpX">[ ✕ ]</button>
   <div class="dp-side"><div class="elbow2"></div>
     <div class="dp-name">${n.name}</div>
     <div class="dp-sub">${n.use}</div>
     <div class="dp-sub">${n.id} · ${n.role} · ▸ SB2</div>
     <div class="dp-hw">${hwRows}</div></div>
   <div class="dp-body" id="dpBody"></div>`;
  const cells=[['CPU %','cpu','needle'],['NET %','net','needle'],['RAM %','ram','bar'],['DISK %','disk','bar'],
    ['TEMP °C','temp','needle'],['TRAFFIC 24H','traffic','tank'],['NET LOAD','net','bar'],['UPTIME','up','lcd']];
  const body=drillPanel.querySelector('#dpBody');
  cells.forEach(([lab,mk,type])=>{const c=el('div','dp-cell');c.appendChild(el('div','mlab',lab));
    if(type==='lcd'){const b=el('div','big','—');c.appendChild(b);c._lcd=b;}
    else if(type==='tank'){const t=el('div','tank dtank');const f=el('div','fill');t.appendChild(f);c.appendChild(t);c._fill=f;}
    else if(type==='bar'){const face=el('div','face');const bar=el('div','ledbar');buildLedbar(bar);face.appendChild(bar);c.appendChild(face);c._bar=bar;c._mk=mk;}
    else{const face=el('div','face');const cv=el('canvas');face.appendChild(cv);c.appendChild(face);c._cv=cv;c._mk=mk;c._retro=n.retro;}
    body.appendChild(c);});
  drillPanel._cells=body.querySelectorAll('.dp-cell');
  drillPanel.querySelector('#dpX').addEventListener('click',e=>{e.stopPropagation();closeDrill();});
}
function openLiteDrill(n,hwRows){
  drillPanel.innerHTML=`
   <button class="dp-x" id="dpX">[ ✕ ]</button>
   <div class="dp-side"><div class="elbow2"></div>
     <div class="dp-name">${n.name}</div><div class="dp-sub">${n.use}</div>
     <div class="dp-sub">${n.id} · agent-less</div><div class="dp-hw">${hwRows}</div></div>
   <div class="dp-body dp-lite" id="dpBody"></div>`;
  const body=drillPanel.querySelector('#dpBody');
  const c1=el('div','dp-cell');c1.appendChild(el('div','mlab','STATUS'));const b1=el('div','big word','—');c1.appendChild(b1);c1._lstate=b1;
  const c2=el('div','dp-cell');c2.appendChild(el('div','mlab','LATENCY'));const b2=el('div','big','--');c2.appendChild(b2);c2._llat=b2;
  const c3=el('div','dp-cell wide');c3.appendChild(el('div','mlab','PING HISTORY'));
  const face=el('div','face');const cv=el('canvas');face.appendChild(cv);c3.appendChild(face);c3._lping=cv;
  body.appendChild(c1);body.appendChild(c2);body.appendChild(c3);
  drillPanel._litecells={c1,c2,c3};drillPanel._cells=null;
  drillPanel.querySelector('#dpX').addEventListener('click',e=>{e.stopPropagation();closeDrill();});
}
function renderDrill(){const n=drillNode;
  if(drillPanel._litecells){const L=drillPanel._litecells;
    L.c1._lstate.textContent=n.reachable?'ONLINE':'OFFLINE';
    L.c1._lstate.style.color=n.reachable?'var(--grn)':'var(--red)';
    L.c2._llat.innerHTML=n.reachable?Math.round(n.ping)+'<span class="u">MS</span>':'—';
    drawPing(L.c3._lping,n.pingHist,n.reachable);return;}
  drillPanel._cells.forEach(c=>{
  if(c._lcd)c._lcd.textContent=fmtUp(n.up);
  else if(c._fill)c._fill.style.height=(n.traffic/n.cap*100).toFixed(1)+'%';
  else if(c._bar)drawLedbar(c._bar,n.m[c._mk]);
  else if(c._cv)drawNeedle(c._cv,n.m[c._mk],c._retro);});}
function closeDrill(){drill.hidden=true;drillNode=null;}
drill.addEventListener('click',e=>{if(e.target===drill)closeDrill();});

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
makeSortable(drillPanel,{itemSel:'.dp-cell',pan:false}); // reorder cells inside a drill

applySavedOrder();buildStrip();requestAnimationFrame(render);
const _h=location.hash; // test hooks
if(_h.startsWith('#drill')){const id=_h.split('=')[1];
  setTimeout(()=>openDrill(id?nodes.find(n=>n.id===id)||nodes[1]:nodes[1]),300);}
else if(_h==='#lite')setTimeout(()=>openDrill(nodes.find(n=>n.type==='lite')),300);
else if(_h==='#end')setTimeout(()=>{content.scrollLeft=content.scrollWidth;},400);
})();
