'use strict';
// 观看周报: reads chrome.storage.local `watchStats` (written only by the service worker) and draws the week.
const $=id=>document.getElementById(id);
const ui=globalThis.__BTR_UI__,st=globalThis.__BTR_STATS_CORE__;
const SVG='http://www.w3.org/2000/svg',WD='一二三四五六日';
let data=null,cfg=st.settings({}),offset=0,view=null;
const pad=n=>String(n).padStart(2,'0');
// "1h05m" / "38m": compact labels for bars and tiles; full sentences use st.fmt.
const short=sec=>{const m=Math.round(sec/60);return m<60?`${m}m`:`${Math.floor(m/60)}h${m%60?pad(m%60)+'m':''}`;};
const bigHTML=sec=>{const m=Math.floor(sec/60),h=Math.floor(m/60);return h?`${h}<small>小时</small>${m%60}<small>分</small>`:`${m}<small>分钟</small>`;};
const md=key=>{const[,mo,d]=key.split('-').map(Number);return `${mo}月${d}日`;};
const el=(tag,cls,text)=>{const n=document.createElement(tag);if(cls)n.className=cls;if(text!=null)n.textContent=text;return n;};
const svg=(tag,attrs={},text)=>{const n=document.createElementNS(SVG,tag);for(const[k,v]of Object.entries(attrs))n.setAttribute(k,v);if(text!=null)n.textContent=text;return n;};

async function load(){
 const [{watchStats},s]=await Promise.all([chrome.storage.local.get('watchStats'),chrome.storage.sync.get(st.defaults)]);
 data=st.normalize(watchStats,Date.now());cfg=st.settings(s);render();
}

function compute(){
 const now=Date.now(),wk=st.addDays(st.weekKey(now),7*offset),cur=offset===0,today=cur?(new Date(now).getDay()+6)%7:6;
 const prevWk=st.addDays(wk,-7),W=st.week(data,wk,today),P=st.week(data,prevWk,today),Pfull=st.week(data,prevWk,6);
 return {wk,cur,today,W,P,Pfull,cmp:st.compare(W,P,cur&&today<6)};
}

function render(){
 const v=view=compute(),{W,P,Pfull,cmp,cur,today}=v;
 $('range').textContent=`${offset===0?'本周':offset===-1?'上周':`${-offset} 周前`} · ${st.range(v.wk)}`;
 $('prev').disabled=offset<=-(st.WEEKS_KEPT-1);$('next').disabled=offset>=0;
 const empty=!W.seconds&&!Pfull.seconds;
 document.body.classList.toggle('is-empty',empty);$('empty').hidden=!empty;$('share').disabled=empty;
 if(empty){
  $('emptyTitle').textContent=cfg.statsEnabled?(cur?'这周还没有观看记录':'这一周没有观看记录'):'观看统计已关闭';
  $('emptyText').textContent=cfg.statsEnabled?'在 B 站看视频时会自动记录真实播放时长（只存在这台电脑上）。看满 1 分钟，这里就会出现你的周报。':'在设置里打开「观看统计」后，B 站上的真实播放时长会记在这台电脑上，每周一份周报。';
  return;
 }
 $('label').textContent=cur?(today<6?'本周到目前为止':'本周观看'):offset===-1?'上周观看':'这一周观看';
 $('total').innerHTML=bigHTML(W.seconds);
 $('line').textContent=cmp.text;
 const span=cur&&today<6?'上周同期':'上周';
 $('delta').textContent=P.seconds?`${cmp.mood==='flat'?'≈':cmp.delta<0?'↓':'↑'} ${Math.abs(cmp.pct)}% · ${span} ${st.fmt(P.seconds)}`:'';
 $('videos').innerHTML=`${W.videos}<small>个视频</small>`;
 $('avg').textContent=short(W.seconds/(today+1));
 const li=W.longest?W.days.findIndex(d=>d.key===W.longest.key):-1;
 $('longest').innerHTML=li>=0?`周${WD[li]}<small>${short(W.longest.seconds)}</small>`:'—';
 $('brakes').innerHTML=`${W.brakes}<small>次</small>`;
 bars(v);ups(W);hours(W);
}

function bars({W,Pfull,cur,today}){
 const box=$('bars'),w=640,h=230,L=40,B=30,T=24,gw=(w-L)/7,bw=Math.min(24,gw*.3);
 const top=Math.max(3600,...W.days.map(d=>d.seconds),...Pfull.days.map(d=>d.seconds));
 const hrs=Math.ceil(top/3600),step=hrs>6?2:1,maxS=Math.ceil(hrs/step)*step*3600,y=s=>T+(h-T-B)*(1-s/maxS);
 const s=svg('svg',{viewBox:`0 0 ${w} ${h}`,role:'img','aria-label':`每天观看时长：${W.days.map((d,i)=>`周${WD[i]} ${st.fmt(d.seconds)}`).join('，')}`});
 const defs=svg('defs'),gr=svg('linearGradient',{id:'r-grad',x1:0,y1:0,x2:0,y2:1});gr.append(svg('stop',{offset:0,'stop-color':'#ff8cae'}),svg('stop',{offset:1,'stop-color':'#fb7299'}));defs.append(gr);s.append(defs);
 const g=svg('g',{class:'grid'});
 for(let k=0;k<=maxS/3600;k+=step){g.append(svg('line',{x1:L,x2:w,y1:y(k*3600),y2:y(k*3600)}),svg('text',{x:L-8,y:y(k*3600)+4,'text-anchor':'end'},`${k}h`));}
 s.append(g);
 // A 4px-rounded top, square at the baseline.
 const bar=(x,s0,cls)=>{const top=y(s0),bh=y(0)-top,r=Math.min(4,bh);return svg('path',{class:cls,d:`M${x},${y(0)}V${top+r}Q${x},${top} ${x+r},${top}H${x+bw-r}Q${x+bw},${top} ${x+bw},${top+r}V${y(0)}Z`});};
 W.days.forEach((d,i)=>{
  const cx=L+gw*i+gw/2,future=cur&&i>today,pd=Pfull.days[i];
  const hit=svg('rect',{class:'hit',x:L+gw*i,y:T-14,width:gw,height:h-T,tabindex:0,'aria-label':`周${WD[i]} ${md(d.key)}：本周 ${st.fmt(d.seconds)}，上周 ${st.fmt(pd.seconds)}`});
  const hl=svg('rect',{class:'hl',x:L+gw*i+4,y:T-14,width:gw-8,height:h-T-B+14,rx:10});
  s.append(hl);
  if(pd.seconds>0)s.append(bar(cx-bw-1,pd.seconds,'last'));
  if(!future&&d.seconds>0){s.append(bar(cx+1,d.seconds,'cur top'));if(d.seconds>=60)s.append(svg('text',{class:'val',x:cx+1+bw/2,y:y(d.seconds)-7,'text-anchor':'middle'},short(d.seconds)));}
  if(future)s.append(svg('rect',{class:'future',x:cx+1,y:y(0)-18,width:bw,height:18,rx:4}));
  s.append(svg('text',{class:`day${cur&&i===today?' today':''}`,x:cx,y:h-8,'text-anchor':'middle'},cur&&i===today?'今天':`周${WD[i]}`));
  s.append(hit); // On top of the bars, so the whole column is the hover target.
  const show=()=>{hl.classList.add('on');const t=$('tip'),r=box.getBoundingClientRect(),pr=box.parentElement.getBoundingClientRect(),k=r.width/w;
   t.replaceChildren(el('b',null,`周${WD[i]} · ${md(d.key)}`),el('span',null,future?'还没到':`本周 ${st.fmt(d.seconds)} · ${d.videos} 个视频`),el('br'),el('span',null,`上周 ${st.fmt(pd.seconds)}`));
   t.style.left=`${r.left-pr.left+cx*k}px`;t.style.top=`${r.top-pr.top+Math.min(y(Math.max(d.seconds,pd.seconds)),y(0)-20)*k-12}px`;t.hidden=false;};
  const hide=()=>{hl.classList.remove('on');$('tip').hidden=true;};
  hit.addEventListener('pointerenter',show);hit.addEventListener('pointerleave',hide);hit.addEventListener('focus',show);hit.addEventListener('blur',hide);
 });
 box.replaceChildren(s);
}

function ups(W){
 const ol=$('ups');ol.replaceChildren();
 if(!W.ups.length){ol.append(el('li','none','这周还没认出 UP 主。番剧、直播或页面上没有 UP 主信息时不记录。'));return;}
 const max=W.ups[0].seconds||1;
 W.ups.forEach((u,i)=>{
  const li=el('li'),a=el('a','name',u.name);a.href=`https://space.bilibili.com/${u.mid}`;a.target='_blank';a.rel='noopener';
  const bar=el('div','bar'),fill=el('i');fill.style.width=`${Math.max(4,u.seconds/max*100)}%`;fill.style.animationDelay=`${i*60}ms`;bar.append(fill);
  li.append(el('span','rank',String(i+1)),a,el('span','t',st.fmt(u.seconds)),bar);ol.append(li);
 });
}

const MOODS=[[0,6,'深夜党 🌙'],[6,12,'早起党 ☀️'],[12,18,'午后摸鱼 🐟'],[18,22,'晚饭后时光 🍜'],[22,24,'夜猫子 🦉']];
function hours(W){
 const box=$('hours'),max=Math.max(...W.hours)||1;box.replaceChildren();
 W.hours.forEach((v,h)=>{const i=el('i'),b=el('b');b.style.opacity=v?String(Math.max(.12,v/max)):'0';i.title=`${h}:00–${h+1}:00 · ${st.fmt(v)}`;i.append(b);box.append(i);});
 const p=W.peakHour;$('peak').textContent=p>=0?`最常在 ${p}:00–${p+1}:00 看 · ${MOODS.find(([a,b])=>p>=a&&p<b)[2]}`:'';
 box.setAttribute('aria-label',p>=0?`观看最多的时段：${p} 点到 ${p+1} 点`:'没有记录');
}

/* ---------- share card: 1080 × 1440 PNG ---------- */
function drawCard(cv,hide){
 const {W,P,Pfull,cmp,cur,today,wk}=view,c=cv.getContext('2d'),w=1080,h=1440,F=ui.FONT;
 const font=(wt,px)=>{c.font=`${wt} ${px}px ${F}`;};
 const rr=(x,y,ww,hh,r)=>{c.beginPath();c.roundRect(x,y,ww,hh,r);};
 c.clearRect(0,0,w,h);c.letterSpacing='0px';c.textAlign='left';c.textBaseline='alphabetic';
 const g=c.createLinearGradient(0,0,w*.6,h);g.addColorStop(0,'#ff9dbb');g.addColorStop(.42,'#fb7299');g.addColorStop(1,'#b54a84');c.fillStyle=g;c.fillRect(0,0,w,h);
 c.fillStyle='rgba(255,255,255,.1)';for(const[x,y,r]of[[960,90,250],[60,1400,190],[1040,1250,90]]){c.beginPath();c.arc(x,y,r,0,Math.PI*2);c.fill();}
 c.fillStyle='#ffe3ec';font(800,26);c.letterSpacing='5px';c.fillText('BILITHROTTLE · 哔哩节流阀',90,126);c.letterSpacing='0px';
 c.fillStyle='#fff';font(800,74);c.fillText('我的 B 站观看周报',86,222);
 c.fillStyle='rgba(255,255,255,.9)';font(500,34);c.fillText(`${st.range(wk)}${cur&&today<6?' · 截至今天':''}`,90,282);
 // White card
 c.save();c.shadowColor='rgba(110,30,70,.28)';c.shadowBlur=60;c.shadowOffsetY=24;c.fillStyle='#fff';rr(60,336,960,994,48);c.fill();c.restore();
 const X=120,R=960;
 c.fillStyle='#9499a0';font(600,32);c.fillText(cur?(today<6?'本周到目前为止':'本周看了'):'这一周看了',X,430);
 // Big total, numbers dark, units pink
 const m=Math.floor(W.seconds/60),parts=m>=60?[[String(Math.floor(m/60)),1],['小时',0],[String(m%60),1],['分',0]]:[[String(m),1],['分钟',0]];
 let x=X-6;for(const[t,num]of parts){c.fillStyle=num?'#18191c':'#fb7299';font(num?800:700,num?176:56);c.fillText(t,x,602);x+=c.measureText(t).width+(num?6:22);}
 // Delta pill
 if(P.seconds){
  const t=`${cmp.mood==='flat'?'≈':cmp.delta<0?'↓':'↑'} ${Math.abs(cmp.pct)}%   ${cur&&today<6?'上周同期':'上周'} ${st.fmt(P.seconds)}`;
  font(700,30);const tw=c.measureText(t).width;c.fillStyle='rgba(251,114,153,.13)';rr(X,640,tw+48,58,29);c.fill();c.fillStyle='#e8618a';c.fillText(t,X+24,680);
 }
 // One-liner, shrunk to fit
 let px=44;font(800,px);while(c.measureText(cmp.text).width>R-X&&px>28){px-=2;font(800,px);}
 c.fillStyle='#18191c';c.fillText(cmp.text,X,786);
 // Mini bar chart: this week (pink) next to last week (grey)
 const top=Math.max(1,...W.days.map(d=>d.seconds),...Pfull.days.map(d=>d.seconds)),bt=850,bb=1040,gw=(R-X)/7,bw=34;
 c.strokeStyle='#eceef0';c.lineWidth=2;c.beginPath();c.moveTo(X,bb+1);c.lineTo(R,bb+1);c.stroke();
 W.days.forEach((d,i)=>{
  const cx=X+gw*i+gw/2,pd=Pfull.days[i],hb=s=>Math.max(s>0?8:0,(bb-bt)*s/top);
  if(pd.seconds){c.fillStyle='#e9ebee';const hh=hb(pd.seconds);rr(cx-bw-3,bb-hh,bw,hh,[8,8,0,0]);c.fill();}
  if(d.seconds&&!(cur&&i>today)){const gg=c.createLinearGradient(0,bb-hb(d.seconds),0,bb);gg.addColorStop(0,'#ff8cae');gg.addColorStop(1,'#fb7299');c.fillStyle=gg;const hh=hb(d.seconds);rr(cx+3,bb-hh,bw,hh,[8,8,0,0]);c.fill();}
  c.fillStyle=cur&&i===today?'#fb7299':'#61666d';font(cur&&i===today?800:500,28);c.textAlign='center';c.fillText(cur&&i===today?'今天':WD[i],cx,1088);c.textAlign='left';
 });
 font(500,22);c.fillStyle='#9499a0';c.textAlign='right';c.fillText('上周',R,bt-14);let lx=R-c.measureText('上周').width-30;c.fillStyle='#e9ebee';rr(lx,bt-32,18,18,4);c.fill();
 c.fillStyle='#9499a0';c.fillText('本周',lx-14,bt-14);lx-=14+c.measureText('本周').width+28;c.fillStyle='#fb7299';rr(lx,bt-32,18,18,4);c.fill();c.textAlign='left';
 // Stats row
 c.fillStyle='#eceef0';c.fillRect(X,1124,R-X,2);
 const li=W.longest?W.days.findIndex(d=>d.key===W.longest.key):-1;
 const cells=[[`${W.videos}`,' 个','看了视频'],[li>=0?`周${WD[li]}`:'—','',li>=0?`最长一天 · ${short(W.longest.seconds)}`:'最长一天'],[`${W.brakes}`,' 次','踩刹车']];
 cells.forEach(([v,u,l],i)=>{const cx=X+(R-X)/3*i;c.fillStyle='#18191c';font(800,52);c.fillText(v,cx,1200);const vw=c.measureText(v).width;c.fillStyle='#61666d';font(600,28);c.fillText(u,cx+vw,1200);c.fillStyle='#9499a0';font(500,24);c.fillText(l,cx,1240);});
 // Top UP
 const up=W.ups[0];c.fillStyle='#fff4f8';rr(X-4,1262,R-X+8,48,24);c.fill();
 font(600,26);c.fillStyle='#e8618a';const lead='最常看的 UP';c.fillText(lead,X+18,1295);const lw=c.measureText(lead).width;
 c.fillStyle='#18191c';font(700,26);let name=hide?'已隐藏 🙈':up?up.name:'暂无';
 const tail=!hide&&up?`  ·  ${st.fmt(up.seconds)}`:'',room=R-X-lw-60;while(c.measureText(name+tail).width>room&&name.length>1)name=name.slice(0,-2)+'…';
 c.fillText(name+tail,X+lw+42,1295);
 // Footer
 c.fillStyle='rgba(255,255,255,.92)';font(600,26);c.textAlign='center';c.fillText('哔哩节流阀 BiliThrottle · github.com/ooooooomygosh/Better-Bilibili',w/2,1396);c.textAlign='left';
}
const blob=cv=>new Promise((res,rej)=>cv.toBlob(b=>b?res(b):rej(new Error('生成图片失败')),'image/png'));
const shareSay=(t,k)=>ui.flash($('shareMsg'),t,k);
let before=null;
function openShare(){before=document.activeElement;$('shareBack').hidden=false;$('shareMsg').textContent='';drawCard($('card'),$('hideUps').checked);document.querySelector('main').inert=true;$('download').focus();
 ui.animate($('shareBack').firstElementChild,[{opacity:0,transform:'translateY(10px) scale(.98)'},{opacity:1,transform:'none'}],{duration:ui.MOTION.mid});}
function closeShare(){$('shareBack').hidden=true;document.querySelector('main').inert=false;before?.focus?.();}
$('share').onclick=openShare;$('closeShare').onclick=closeShare;
$('shareBack').addEventListener('click',e=>{if(e.target===$('shareBack'))closeShare();});
document.addEventListener('keydown',e=>{if(e.key==='Escape'&&!$('shareBack').hidden)closeShare();});
$('hideUps').onchange=()=>{try{localStorage.setItem('btr-report-hide',$('hideUps').checked?'1':'');}catch(_){}drawCard($('card'),$('hideUps').checked);};
try{$('hideUps').checked=localStorage.getItem('btr-report-hide')==='1';}catch(_){}
$('download').onclick=async()=>{try{const b=await blob($('card')),a=document.createElement('a');a.href=URL.createObjectURL(b);a.download=`哔哩节流阀-观看周报-${view.wk}.png`;a.click();setTimeout(()=>URL.revokeObjectURL(a.href),4000);shareSay('已开始下载。','ok');}catch(e){shareSay(e.message,'error');}};
$('copy').onclick=async()=>{
 try{if(!navigator.clipboard?.write||typeof ClipboardItem!=='function')throw new Error('unsupported');await navigator.clipboard.write([new ClipboardItem({'image/png':blob($('card'))})]);shareSay('已复制，去粘贴吧 ✨','ok');}
 catch(_){shareSay('浏览器没允许复制图片，请用「下载」保存后再发。','error');}
};
$('prev').onclick=()=>{offset--;render();};$('next').onclick=()=>{offset++;render();};
chrome.storage.onChanged.addListener((c,area)=>{if((area==='local'&&c.watchStats)||(area==='sync'&&c.statsEnabled))load().catch(()=>{});});
// Re-render on resize so the tooltip math and the hover layer stay aligned.
addEventListener('resize',()=>{$('tip').hidden=true;});
load().catch(e=>{document.body.classList.add('is-empty');$('empty').hidden=false;$('emptyText').textContent=`读取统计失败：${e.message}`;});
