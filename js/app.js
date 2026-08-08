/* LCARS_strip mockup — fake-data engine + meter rendering + touch drill-down.
   Real build will replace makeFake()/tick data with Netdata API polls. */
(() => {
'use strict';
const $ = s => document.querySelector(s);
const el = (t,c,txt) => { const e=document.createElement(t); if(c)e.className=c; if(txt!=null)e.textContent=txt; return e; };

/* ---- scale the 1424x280 strip to fit the test display (5:4 now, LCD later) ---- */
const strip = $('#strip');
function fit(){ const s=Math.min(innerWidth/1424, innerHeight/280);
  strip.style.transform=`scale(${s})`; strip.style.transformOrigin='center'; }
addEventListener('resize',fit); fit();

/* ---- fleet model (mock). style: led | needle | retro ---- */
const rnd=(a,b)=>a+Math.random()*(b-a);
function mkNode(id,name,style,hero){return{
  id,name,style,hero:!!hero,
  m:{cpu:rnd(5,40),net:rnd(5,30),ram:rnd(30,60),disk:rnd(10,50),temp:rnd(38,52)},
  t:{cpu:0,net:0,ram:0,disk:0,temp:0},           // targets
  svc:{plex:'up',pm2:'up',pg:'up',net:'up'},
  traffic:rnd(20,120), cap:512, up:rnd(1,40)*86400+rnd(0,80000),
};}
// order = SB1 (led) | SB2 (needle hero, centered) | CyberTower (retro)
const nodes=[
  mkNode('starbase1','STARBASE1','led'),
  mkNode('starbase2','STARBASE2','needle',true),
  mkNode('pop-os','CYBERTOWER','retro'),
];
let forceMode='mix';
const styleOf=n=> forceMode==='mix'?n.style:forceMode;

/* ---- fake data walk ---- */
function retarget(){ nodes.forEach(n=>{
  n.t.cpu=Math.min(100,Math.max(2,n.m.cpu+rnd(-25,28)));
  n.t.net=Math.random()<0.25?rnd(60,98):Math.min(100,Math.max(2,n.m.net+rnd(-30,30)));
  n.t.ram=Math.min(95,Math.max(20,n.m.ram+rnd(-6,6)));
  n.t.disk=Math.min(96,Math.max(8,n.m.disk+rnd(-1.5,1.6)));
  n.t.temp=Math.min(78,Math.max(34,n.m.temp+rnd(-3,3)));
  n.traffic=Math.min(n.cap, n.traffic + n.m.net/100*rnd(.2,1.4)); // reservoir fills
  if(n.traffic>=n.cap) n.traffic=rnd(5,20);                       // ...and resets
  // occasional service blips
  const k=['plex','pm2','pg','net'][Math.floor(rnd(0,4))];
  n.svc[k]= Math.random()<0.06?'warn':'up';
}); }
setInterval(retarget,900);

/* ---- meter drawing ---- */
function dpr(cv){const r=cv.getBoundingClientRect(),d=devicePixelRatio||1;
  cv.width=Math.max(1,r.width*d);cv.height=Math.max(1,r.height*d);const x=cv.getContext('2d');x.scale(d,d);return[x,r.width,r.height];}
function zoneColor(v){return v<70?'#2bff66':v<88?'#ffd11a':'#ff3b2e';}

function drawNeedle(cv,v,retro){
  const[x,w,h]=dpr(cv); x.clearRect(0,0,w,h);
  const cx=w/2, cy=h*0.92, R=Math.min(w*0.46,h*0.82);
  // arc scale
  const a0=Math.PI*0.82, a1=Math.PI*0.18;
  x.lineWidth=Math.max(2,R*0.09);
  for(let i=0;i<=40;i++){const t=i/40,a=a0+(a1-a0)*t;
    x.strokeStyle = t<0.7?'#0e9a34':t<0.88?'#a6802a':'#7a201a';
    x.beginPath();x.arc(cx,cy,R,a-0.006,a+0.006);x.stroke();}
  // ticks
  x.strokeStyle=retro?'#a6ffbe':'#cfe';x.lineWidth=1;
  for(let i=0;i<=5;i++){const a=a0+(a1-a0)*(i/5);
    x.beginPath();x.moveTo(cx+Math.cos(a)*(R-6),cy+Math.sin(a)*(R-6));
    x.lineTo(cx+Math.cos(a)*(R+1),cy+Math.sin(a)*(R+1));x.stroke();}
  // needle
  const a=a0+(a1-a0)*(v/100);
  x.strokeStyle=zoneColor(v);x.lineWidth=2;x.shadowBlur=retro?10:5;x.shadowColor=zoneColor(v);
  x.beginPath();x.moveTo(cx,cy);x.lineTo(cx+Math.cos(a)*(R-3),cy+Math.sin(a)*(R-3));x.stroke();
  x.shadowBlur=0;x.fillStyle='#cfe';x.beginPath();x.arc(cx,cy,2.5,0,7);x.fill();
}
function buildLedbar(host){host.innerHTML='';const N=16;const segs=[];
  for(let i=0;i<N;i++){const s=el('div','seg');host.appendChild(s);segs.push(s);}host._segs=segs;host._peak=0;}
function drawLedbar(host,v){const segs=host._segs,N=segs.length,on=Math.round(v/100*N);
  host._peak=Math.max(on,host._peak-0.25);const pk=Math.round(host._peak);
  segs.forEach((s,i)=>{const idx=N-i; // bottom-up
    const zoneCls=idx> N*0.88?'r':idx>N*0.7?'a':'g';
    s.className='seg'+((idx<=on)?' on '+zoneCls:'')+((idx===pk&&idx>on)?' on '+zoneCls+' peak':'');});}

/* ---- build strip DOM ---- */
const content=$('#content');
function buildStrip(){ content.innerHTML='';
  nodes.forEach(n=>{
    const st=styleOf(n);
    const col=el('div','node'+(n.hero?' hero':'')+(st==='retro'?' retro':''));
    col.dataset.id=n.id;
    const head=el('div','node-head');
    head.appendChild(el('div','node-name',n.name));
    const leds=el('div','leds');
    [['PX','plex'],['PM','pm2'],['PG','pg'],['NE','net']].forEach(([lab,k])=>{
      leds.appendChild(el('span','led-lab',lab));
      const d=el('span','led');d.dataset.svc=k;leds.appendChild(d);});
    head.appendChild(leds);col.appendChild(head);

    const meters=el('div','meters');
    // 4 metric meters in this node's style + reservoir tank
    ['cpu','net','ram','disk'].forEach(mk=>{
      const g=el('div','gauge');
      if(st==='led'){const bar=el('div','ledbar');buildLedbar(bar);g.appendChild(bar);g._bar=bar;}
      else{const cv=el('canvas');g.appendChild(cv);g._cv=cv;g._retro=(st==='retro');}
      g.appendChild(el('div','mlab',mk.toUpperCase()));
      g.dataset.mk=mk;meters.appendChild(g);col._g=col._g||{};col._g[mk]=g;
    });
    const tank=el('div','tank');const fill=el('div','fill');const tv=el('div','tval');
    tank.appendChild(fill);tank.appendChild(tv);tank.title='24h traffic';
    meters.appendChild(tank);col._tank={fill,tv};
    col.appendChild(meters);
    col.addEventListener('click',()=>openDrill(n));
    content.appendChild(col);col._node=n;
  });
}

/* ---- per-frame render ---- */
function render(){
  document.querySelectorAll('.node').forEach(col=>{
    const n=col._node;
    ['cpu','net','ram','disk','temp'].forEach(k=>{n.m[k]+=(n.t[k]-n.m[k])*0.12;});
    // leds
    col.querySelectorAll('.led').forEach(d=>d.dataset.s=n.svc[d.dataset.svc]);
    // meters
    for(const mk in col._g){const g=col._g[mk],v=n.m[mk];
      if(g._bar)drawLedbar(g._bar,v); else drawNeedle(g._cv,v,g._retro);}
    // reservoir
    const pct=n.traffic/n.cap*100;col._tank.fill.style.height=pct.toFixed(1)+'%';
    col._tank.tv.textContent=Math.round(n.traffic)+'G';
  });
  if(drillNode)renderDrill();
  requestAnimationFrame(render);
}

/* ---- clock / uptime / ticker ---- */
function fmtUp(s){const d=Math.floor(s/86400),h=Math.floor(s%86400/3600),m=Math.floor(s%3600/60);
  return String(d).padStart(2,'0')+'d '+String(h).padStart(2,'0')+':'+String(m).padStart(2,'0');}
setInterval(()=>{const t=new Date();
  $('#clock').textContent=[t.getHours(),t.getMinutes(),t.getSeconds()].map(x=>String(x).padStart(2,'0')).join(':');
  nodes.forEach(n=>n.up++);
  $('#upt').textContent=fmtUp(nodes[1].up);
},1000);
function buildTicker(){const parts=[];
  parts.push('<span class="ok">◉ FLEET NOMINAL</span>');
  nodes.forEach(n=>{const hot=n.m.cpu>85||n.m.temp>70;
    parts.push('&nbsp;&nbsp;•&nbsp;&nbsp;'+n.name+' '+(hot?'<span class="warn">CPU/TEMP HIGH</span>':'<span class="ok">OK</span>')
      +' &nbsp; net '+Math.round(n.m.net)+'%');});
  parts.push('&nbsp;&nbsp;•&nbsp;&nbsp;<span class="warn">parent SB2 · '+nodes.length+' nodes streaming</span>');
  $('#ticker').innerHTML=parts.join('')+'&nbsp;&nbsp;&nbsp;&nbsp;';}
setInterval(buildTicker,4000);buildTicker();

/* ---- mode pills ---- */
document.querySelectorAll('.pill').forEach(p=>p.addEventListener('click',()=>{
  document.querySelectorAll('.pill').forEach(q=>q.removeAttribute('data-on'));
  p.setAttribute('data-on','');forceMode=p.dataset.mode;buildStrip();}));

/* ---- drill-down (touch) ---- */
const drill=$('#drill'),drillPanel=$('#drillPanel');let drillNode=null;
function openDrill(n){drillNode=n;drill.hidden=false;
  drillPanel.innerHTML=`
   <div class="dp-side">
     <div class="elbow2"></div>
     <div class="dp-name">${n.name}</div>
     <div class="dp-sub">${n.id} · ${n.hero?'PARENT':'child'}</div>
     <div class="dp-sub">stream ▸ SB2</div>
     <button class="dp-close" id="dpClose">◀ CLOSE</button>
   </div>
   <div class="dp-body" id="dpBody"></div>`;
  const cells=[['CPU %','cpu','needle'],['NET %','net','needle'],['RAM %','ram','bar'],['DISK %','disk','bar'],
    ['TEMP °C','temp','needle'],['TRAFFIC 24H','traffic','tank'],['NET IN','net','bar'],['UPTIME','up','lcd']];
  const body=drillPanel.querySelector('#dpBody');
  cells.forEach(([lab,mk,type])=>{const c=el('div','dp-cell');c.appendChild(el('div','mlab',lab));
    if(type==='lcd'){const b=el('div','big','—');c.appendChild(b);c._lcd=b;c._mk=mk;}
    else if(type==='tank'){const t=el('div','tank');const f=el('div','fill');t.appendChild(f);
      t.style.width='34px';t.style.alignSelf='center';t.style.flex='1';c.appendChild(t);c._fill=f;}
    else if(type==='bar'){const bar=el('div','ledbar');buildLedbar(bar);c.appendChild(bar);c._bar=bar;c._mk=mk;}
    else{const cv=el('canvas');c.appendChild(cv);c._cv=cv;c._mk=mk;c._retro=(n.style==='retro');}
    body.appendChild(c);});
  drillPanel._cells=body.querySelectorAll('.dp-cell');
  $('#dpClose').addEventListener('click',e=>{e.stopPropagation();closeDrill();});
}
function renderDrill(){const n=drillNode;drillPanel._cells.forEach(c=>{
  if(c._lcd){c._lcd.textContent=fmtUp(n.up);}
  else if(c._fill){c._fill.style.height=(n.traffic/n.cap*100).toFixed(1)+'%';}
  else if(c._bar){drawLedbar(c._bar,n.m[c._mk]);}
  else if(c._cv){drawNeedle(c._cv,n.m[c._mk],c._retro);}});}
function closeDrill(){drill.hidden=true;drillNode=null;}
drill.addEventListener('click',e=>{if(e.target===drill)closeDrill();}); // tap backdrop

/* ---- go ---- */
buildStrip();requestAnimationFrame(render);
})();
