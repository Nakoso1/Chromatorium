/* ============================================================
   F12/F15. カラーガマットマスク(Gurney式) — 座標系はP=r・(cos h,sin h), r=C/Cref(h),
   Cref(h)=K.cmax(0.72,h)(§F12座標系の定義)。ホイューエディタは既存のringBase("ok",size)を
   下敷きに使い、頂点ドラッグ=移動、外周付近ドラッグ=全体回転、辺/頂点ダブルクリックで
   追加/削除する(F1と同じ「ポインタ操作のみで完結」原則)。
   ============================================================ */
function wrapDeg180(d){ return ((d+180)%360+360)%360-180; }
function gamutChanged(){
 drawGamutWheel();
 updateGamutExportBtn(); /* §VII-7: 頂点数に応じてdisabled/理由を同期 */
 mark("b","c","blur","screen","analysis"); /* PassB直後への挿入なので"b"起点で十分(§F12実装接続点) */
 scheduleAnalysis();
}
/* §VII-7: マスク未成立(頂点<3)時はdisabled+理由表示。頂点追加・削除・リセットなど
   gamutChanged()を通るあらゆる変更で自動的に同期される。 */
function updateGamutExportBtn(){
 const btn=$("gmExportImg"); if(!btn)return;
 const ok=gamutActiveMasks(state.gamut).length>=1;
 btn.disabled=!ok;
 btn.title=ok?t("gamut.exportImgBtnTitle"):t("status.gamutMaskIncomplete");
}
/* §VII-6: gamutスライスのみを初期値へ戻す。他スライスには一切触れない。gamutはUNDO_KEYSに
   含まれるため、この変更自体が通常の編集としてUndo履歴に積まれ、Ctrl+Zで直前のマスクへ戻せる
   (=不可逆化する必要がなく、確認ダイアログも不要という判断根拠)。 */
function resetGamut(){
 Object.assign(state.gamut,{on:false, mode:"off", masks:[], softness:0.08, dimIn:0.35, hullIncludeOrigin:true});
 state.gamut._extractDots=null;
 _gmActiveIdx=0;
 syncGamutUI();
 mark("b","c","blur","screen","analysis");
 status_(t("status.gamutReset"));
}
function setGamutMode(mode){
 state.gamut.mode=mode; state.gamut.on=(mode!=="off");
 $("gmModeOff").classList.toggle("on",mode==="off");
 $("gmModeHl").classList.toggle("on",mode==="highlight");
 $("gmModeCr").classList.toggle("on",mode==="correct");
 updateGamutModeHint();
 gamutChanged();
}
/* §VII-3: モード直下の動的ヒントと、書き出し反映警告(#gmExportWarn)の表示を同期する。
   #gmExportWarnはHTMLに文言だけ存在しどこからも表示切替されていなかった(調査で発見した
   別件の表示漏れ)。既存の警告文言(§VII-3で「従来どおり」と指定された文)自体は変更せず、
   表示/非表示のロジックのみを補って実際に機能させる。 */
function updateGamutModeHint(){
 const mode=state.gamut.mode;
 const hintEl=$("gmModeHint");
 if(mode==="highlight"){ hintEl.textContent=t("gamut.hintHighlight"); hintEl.style.display=""; }
 else if(mode==="correct"){ hintEl.textContent=t("gamut.hintCorrect"); hintEl.style.display=""; }
 else{ hintEl.style.display="none"; }
 $("gmExportWarn").style.display=(mode!=="off")?"":"none";
}
/* WS-15: マスク一覧UI(最大3行)。種別アイコン+No.+選択(クリック/ラジオ)+×削除。
   既存の他リスト(renderPalCur等)と同じ「都度innerHTML再構築」方式を踏襲する。 */
function renderGamutMaskList(){
 const wrap=$("gmMaskList"); if(!wrap)return;
 wrap.innerHTML="";
 const gt=state.gamut;
 gt.masks.forEach((m,i)=>{
  const row=document.createElement("div");
  row.className="row"; row.style.gap="6px";
  const radio=document.createElement("input");
  radio.type="radio"; radio.name="gmMaskSel"; radio.checked=(i===_gmActiveIdx);
  radio.addEventListener("change",()=>{ _gmActiveIdx=i; syncGamutUI(); });
  const label=document.createElement("span");
  label.style.flex="1"; label.style.cursor="pointer";
  const icon=m.type==="circle"?"○":"▲";
  const statusTxt=gamutIsMaskActive(m)?"":(" "+t("gamut.maskIncomplete"));
  label.textContent=icon+" "+t("gamut.maskNo",{n:i+1})+statusTxt;
  label.addEventListener("click",()=>{ _gmActiveIdx=i; syncGamutUI(); });
  const del=document.createElement("button");
  del.type="button"; del.className="mini"; del.textContent="×";
  del.title=t("gamut.maskDelete");
  del.addEventListener("click",()=>{
   gt.masks.splice(i,1);
   if(_gmActiveIdx>=gt.masks.length)_gmActiveIdx=Math.max(0,gt.masks.length-1);
   gamutChanged(); syncGamutUI();
  });
  row.appendChild(radio); row.appendChild(label); row.appendChild(del);
  wrap.appendChild(row);
 });
 if(!gt.masks.length){
  const hint=document.createElement("div");
  hint.className="hint"; hint.textContent=t("gamut.noMasksHint");
  wrap.appendChild(hint);
 }
}
function syncGamutUI(){
 const gt=state.gamut;
 if(_gmActiveIdx>=gt.masks.length)_gmActiveIdx=Math.max(0,gt.masks.length-1);
 const sel=gt.masks[_gmActiveIdx];
 $("gmModeOff").classList.toggle("on",gt.mode==="off");
 $("gmModeHl").classList.toggle("on",gt.mode==="highlight");
 $("gmModeCr").classList.toggle("on",gt.mode==="correct");
 /* WS-15: 回転は多角形マスクにのみ意味を持つ(円は中心ドラッグで移動するため回転が無意味)。
    選択中マスクが円、または選択なしの場合は回転行を隠す。 */
 const isPoly=sel&&sel.type==="poly";
 $("gmRotRow").style.display=isPoly?"":"none";
 if(isPoly){ $("gmRot").value=sel.rot; $("vgmRot").textContent=Math.round(sel.rot)+"°"; }
 $("gmSoft").value=gt.softness; $("vgmSoft").textContent=fmt(gt.softness,3);
 $("gmDim").value=gt.dimIn; $("vgmDim").textContent=Math.round(gt.dimIn*100)+"%";
 $("gmScale").value=1; gmLastScale=1; $("vgmScale").textContent="100%";
 $("gmScale").disabled=!sel;
 /* 横展開修正: state.gamut.hullIncludeOriginが定義されているのにこれまでどこにも同期されておらず
    (抽出処理も$("gmHullOrigin").checkedをDOMから直読みしていた)、Undo/Redo/リセットが
    このチェックボックスへ反映されなかった。stateを正としてDOMを合わせる(既存の他フィールドと同じ流儀)。 */
 $("gmHullOrigin").checked=gt.hullIncludeOrigin;
 updateGamutModeHint();
 updateGamutExportBtn();
 renderGamutMaskList();
 drawGamutWheel();
}
/* §VII-1: 中心=無彩色(r=0)・外周=そのHでの最大彩度(r=1、C=K.cmax(L,h))という
   頂点座標系(r=C/Cref(h)、L850近傍コメント参照)と1:1対応する円盤背景。
   既存ringBase("ok",size)はr0=size*0.30のドーナツで、しかも輪の中では半径によらず
   単一の固定Cしか塗っていなかったため、中心寄り(低彩度域)の意味が画面から消えており、
   これが「ガマットマスクの意味が読めない」根本原因だった。ringBase自体は環境光ホイール等の
   他機能が使うため不変のまま残し、ガマット専用の新関数として追加する(§VII-1指示どおり)。 */
const _diskGamutCache=new Map();
function diskBase(size){
 const key="gdisk_"+size;
 if(_diskGamutCache.has(key))return _diskGamutCache.get(key);
 const cv=document.createElement("canvas");cv.width=size;cv.height=size;
 const cx=cv.getContext("2d");
 const c0=size/2, R=size/2-4, L=0.72;
 const cmL=new Float32Array(360);
 for(let d=0;d<360;d++) cmL[d]=K.cmax(L,d);
 const id=cx.createImageData(size,size), D=id.data;
 for(let py=0;py<size;py++){
  for(let px=0;px<size;px++){
   const dx=px+0.5-c0, dy=py+0.5-c0, r=Math.hypot(dx,dy), o=(py*size+px)*4;
   if(r>R){ D[o+3]=0; continue; }
   const hue=mod360(Math.atan2(dy,dx)*R2D);
   const t=r/R;
   const C=t*cmL[Math.floor(hue)%360];
   const s=K.ok2srgb(K.lch2lab([L,C,hue]));
   D[o]=Math.round(clamp(s[0],0,1)*255);
   D[o+1]=Math.round(clamp(s[1],0,1)*255);
   D[o+2]=Math.round(clamp(s[2],0,1)*255);
   D[o+3]=255;
  }
 }
 cx.putImageData(id,0,0);
 cx.strokeStyle="rgba(255,255,255,0.18)";cx.lineWidth=1;      // 外周リング
 cx.beginPath();cx.arc(c0,c0,R,0,TAU);cx.stroke();
 cx.strokeStyle="rgba(255,255,255,0.5)";cx.lineWidth=1;       // 中心の無彩色マーカー(十字)
 cx.beginPath();cx.moveTo(c0-4,c0);cx.lineTo(c0+4,c0);cx.moveTo(c0,c0-4);cx.lineTo(c0,c0+4);cx.stroke();
 _diskGamutCache.set(key,cv);
 return cv;
}
function drawGamutWheel(){
 const cv=$("gmWheel"); if(!cv)return;
 const cx=cv.getContext("2d");
 const size=cv.width, c0=size/2, maxR=size/2-4;
 cx.clearRect(0,0,size,size);
 cx.drawImage(diskBase(size),0,0);
 /* WS-13: 画面表示用の軽量版目盛(既定OFF)。書き出し画像と同じdrawGamutTicks()を流用し、
    小さいキャンバスでも見やすいよう線・文字を控えめな不透明度にする。 */
 if($("gmShowTicks")&&$("gmShowTicks").checked){
  drawGamutTicks(cx,c0,maxR,size,{stroke:"rgba(255,255,255,.22)",strokeMain:"rgba(255,255,255,.4)",label:"rgba(255,255,255,.45)"});
 }
 const gt=state.gamut;
 if(gt._extractDots){
  gt._extractDots.forEach(d=>{
   const h=d.h*D2R, px=c0+Math.min(d.r,1.25)*maxR*Math.cos(h), py=c0+Math.min(d.r,1.25)*maxR*Math.sin(h);
   cx.beginPath(); cx.arc(px,py,Math.max(2,Math.sqrt(d.share)*22),0,TAU);
   cx.globalAlpha=0.85; cx.fillStyle=d.hex; cx.fill(); cx.globalAlpha=1;
   cx.strokeStyle="rgba(0,0,0,.6)"; cx.lineWidth=0.75; cx.stroke();
  });
 }
 /* WS-15: 全マスクを描画。選択中は白実線・非選択は白点線+低不透明度(標準書の指示どおり)。
    未成立(頂点0〜2個)の多角形マスクは、選択中の場合のみガイド文字を出す。 */
 gt.masks.forEach((m,i)=>{
  const selected=(i===_gmActiveIdx);
  cx.save();
  if(!selected){ cx.setLineDash([4,3]); cx.globalAlpha=0.55; }
  if(m.type==="circle"){
   const hh=m.h*D2R;
   const ccx=c0+m.r*maxR*Math.cos(hh), ccy=c0+m.r*maxR*Math.sin(hh);
   const crad=m.rad*maxR;
   cx.beginPath(); cx.arc(ccx,ccy,crad,0,TAU);
   cx.fillStyle="rgba(255,255,255,.14)"; cx.fill();
   cx.strokeStyle="#fff"; cx.lineWidth=selected?2:1.4; cx.stroke();
   cx.setLineDash([]); cx.globalAlpha=1;
   cx.beginPath(); cx.arc(ccx,ccy,6,0,TAU); /* 中心ハンドル */
   cx.fillStyle="#fff"; cx.fill(); cx.strokeStyle="#000"; cx.lineWidth=1; cx.stroke();
   if(selected){
    cx.beginPath(); cx.arc(ccx+crad,ccy,6,0,TAU); /* 半径ハンドル(0°方向) */
    cx.fillStyle="#ffe066"; cx.fill(); cx.strokeStyle="#000"; cx.lineWidth=1; cx.stroke();
   }
  }else if(m.verts.length>=3){
   cx.beginPath();
   m.verts.forEach((v,vi)=>{
    const h=(v.h+m.rot)*D2R, px=c0+v.r*maxR*Math.cos(h), py=c0+v.r*maxR*Math.sin(h);
    if(vi===0)cx.moveTo(px,py); else cx.lineTo(px,py);
   });
   cx.closePath();
   cx.fillStyle="rgba(255,255,255,.14)"; cx.fill();
   cx.strokeStyle="#fff"; cx.lineWidth=selected?2:1.4; cx.stroke();
   cx.setLineDash([]); cx.globalAlpha=1;
   m.verts.forEach(v=>{
    const h=(v.h+m.rot)*D2R, px=c0+v.r*maxR*Math.cos(h), py=c0+v.r*maxR*Math.sin(h);
    cx.beginPath(); cx.arc(px,py,selected?6:4,0,TAU);
    cx.fillStyle="#fff"; cx.fill(); cx.strokeStyle="#000"; cx.lineWidth=1; cx.stroke();
   });
  }else{
   cx.setLineDash([]); cx.globalAlpha=1;
   if(selected){
    /* §VII-2: 頂点0〜2個時はホイール中央にガイド文字を出す(3点で有効化)。 */
    cx.fillStyle="rgba(255,255,255,0.55)"; cx.font="12px sans-serif";
    cx.textAlign="center"; cx.textBaseline="middle";
    const remain=3-m.verts.length;
    const msg=m.verts.length===0?t("gamut.clickToAddFirst"):t("gamut.clickToAddMore",{n:remain});
    wrapCanvasText(cx,msg,c0,c0,size*0.8,14);
   }
   m.verts.forEach(v=>{
    const h=(v.h+m.rot)*D2R, px=c0+v.r*maxR*Math.cos(h), py=c0+v.r*maxR*Math.sin(h);
    cx.beginPath(); cx.arc(px,py,6,0,TAU);
    cx.fillStyle="#fff"; cx.fill(); cx.strokeStyle="#000"; cx.lineWidth=1; cx.stroke();
   });
  }
  cx.restore();
 });
 if(!gt.masks.length){
  cx.save();
  cx.fillStyle="rgba(255,255,255,0.55)"; cx.font="12px sans-serif";
  cx.textAlign="center"; cx.textBaseline="middle";
  wrapCanvasText(cx,t("gamut.noMasksHint"),c0,c0,size*0.8,14);
  cx.restore();
 }
}
/* 簡易な折返し描画(中央揃え・複数行)。ガマットホイールのガイド文字専用の軽量ヘルパ。 */
function wrapCanvasText(cx,text,cx0,cy0,maxWidth,lineH){
 const words=text.split("");  // 日本語文字単位で折返し(スペース区切りの英語にも一応耐える簡易版)
 let line="", lines=[];
 for(const ch of words){
  const test=line+ch;
  if(cx.measureText(test).width>maxWidth && line){ lines.push(line); line=ch; }
  else line=test;
 }
 if(line)lines.push(line);
 const y0=cy0-((lines.length-1)*lineH)/2;
 lines.forEach((ln,i)=>cx.fillText(ln,cx0,y0+i*lineH));
}
/* WS-15: 多角形の内外判定(ray casting)。他マスクをクリックした際の選択切替に使う。 */
function _gmPointInPoly(x,y,pts){
 let inside=false;
 for(let i=0,j=pts.length-1;i<pts.length;j=i,i++){
  const [xi,yi]=pts[i], [xj,yj]=pts[j];
  if(((yi>y)!==(yj>y)) && (x<(xj-xi)*(y-yi)/(yj-yi+1e-12)+xi))inside=!inside;
 }
 return inside;
}
const GamutWheelUI={
 dragging:null,
 attach(canvas){
  const local=e=>{
   const r=canvas.getBoundingClientRect();
   return [(e.clientX-r.left)*(canvas.width/r.width)-canvas.width/2,
           (e.clientY-r.top)*(canvas.height/r.height)-canvas.height/2];
  };
  const maxR=()=>canvas.width/2-4;
  /* 選択中マスクのハンドル(poly頂点 / circle中心・半径)にヒットしているか判定 */
  const hitSelHandle=(x,y)=>{
   const gt=state.gamut, mr=maxR(), sel=gt.masks[_gmActiveIdx];
   if(!sel)return null;
   if(sel.type==="circle"){
    const hh=sel.h*D2R, ccx=sel.r*mr*Math.cos(hh), ccy=sel.r*mr*Math.sin(hh), crad=sel.rad*mr;
    if(Math.hypot(x-ccx,y-ccy)<10)return {type:"circleCenter"};
    if(Math.hypot(x-(ccx+crad),y-ccy)<10)return {type:"circleRadius"};
    return null;
   }
   for(let i=0;i<sel.verts.length;i++){
    const v=sel.verts[i], h=(v.h+sel.rot)*D2R;
    if(Math.hypot(x-v.r*mr*Math.cos(h), y-v.r*mr*Math.sin(h))<10)return {type:"vertex",idx:i};
   }
   return null;
  };
  canvas.addEventListener("pointerdown",e=>{
   const [x,y]=local(e);
   canvas.setPointerCapture(e.pointerId);
   const gt=state.gamut, mr=maxR();
   /* 1. 選択中マスクのハンドルに触れていれば最優先でドラッグ開始 */
   const hit=hitSelHandle(x,y);
   if(hit){ this.dragging=hit; return; }
   /* WS-16 S7-3(Sonnet実装): マスクが1個も無い状態でのクリックは、既存の分岐2(頂点追加)に
      辿り着く「選択中マスク」が存在しないため、キャンバス上の案内文(gamut.noMasksHint)が
      約束する「クリックして頂点を置く」を実行できないデッドロックになっていた(WS-16 G-1)。
      円盤内のクリックに限り、空のpolyマスクを暗黙生成してから分岐2へ続ける(returnしない)。
      これにより最初のクリックで「マスク作成+1点目の頂点」が同時に完了する。
      マスクが既に1個以上ある状態での空白部クリックは、既存どおり何もしない(§VII-2の
      誤操作防止方針を維持)。 */
   if(gt.masks.length===0 && Math.hypot(x,y)<=mr*1.05){
    addGamutPolyDraft();
   }
   const sel=gt.masks[_gmActiveIdx];
   /* 2. 選択中マスクがpoly未成立(頂点0〜2個)なら、クリックで頂点追加を継続(§VII-2の挙動) */
   if(sel && sel.type==="poly" && sel.verts.length<3){
    const dist=Math.hypot(x,y);
    const newIdx=sel.verts.length;
    sel.verts.push({h:mod360(Math.atan2(y,x)*R2D-sel.rot), r:clamp(dist/mr,0,1.3)});
    const justActivated=sel.verts.length===3;
    if(justActivated && gt.mode==="off"){
     setGamutMode("highlight"); /* gamutChanged()も内部で呼ばれる */
     status_(t("status.gamutActivated"));
    }else gamutChanged();
    this.dragging={type:"vertex",idx:newIdx};
    syncGamutUI();
    return;
   }
   /* 3. 他マスク(非選択)の内側をクリックしたらそれを選択(§標準書「マスク内クリックで選択切替」) */
   for(let i=0;i<gt.masks.length;i++){
    if(i===_gmActiveIdx)continue;
    const m=gt.masks[i];
    let inside=false;
    if(m.type==="circle"){
     const hh=m.h*D2R;
     inside=Math.hypot(x-m.r*mr*Math.cos(hh), y-m.r*mr*Math.sin(hh))<m.rad*mr;
    }else if(m.verts.length>=3){
     const pts=m.verts.map(v=>{ const h=(v.h+m.rot)*D2R; return [v.r*mr*Math.cos(h), v.r*mr*Math.sin(h)]; });
     inside=_gmPointInPoly(x,y,pts);
    }
    if(inside){ _gmActiveIdx=i; syncGamutUI(); return; }
   }
   /* 4. 選択中マスクが成立済みpolyで外周付近のドラッグなら回転(円には回転がないので対象外) */
   const dist=Math.hypot(x,y);
   if(sel && sel.type==="poly" && sel.verts.length>=3 && dist>mr*0.82){
    this.dragging={type:"rotate", startAng:Math.atan2(y,x)*R2D, startRot:sel.rot};
   }
   /* §VII-2: それ以外の空白部クリックは誤操作になりやすいため何もしない */
  });
  canvas.addEventListener("pointermove",e=>{
   if(!this.dragging)return;
   const [x,y]=local(e), mr=maxR();
   const sel=state.gamut.masks[_gmActiveIdx];
   if(!sel){ this.dragging=null; return; }
   if(this.dragging.type==="vertex"){
    const v=sel.verts[this.dragging.idx];
    v.h=mod360(Math.atan2(y,x)*R2D - sel.rot);
    v.r=clamp(Math.hypot(x,y)/mr,0,1.3);
    gamutChanged();
   }else if(this.dragging.type==="rotate"){
    const ang=Math.atan2(y,x)*R2D;
    sel.rot=wrapDeg180(this.dragging.startRot+(ang-this.dragging.startAng));
    $("gmRot").value=sel.rot; $("vgmRot").textContent=Math.round(sel.rot)+"°";
    gamutChanged();
   }else if(this.dragging.type==="circleCenter"){
    sel.h=mod360(Math.atan2(y,x)*R2D);
    sel.r=clamp(Math.hypot(x,y)/mr,0,1.3);
    gamutChanged();
   }else if(this.dragging.type==="circleRadius"){
    const hh=sel.h*D2R, ccx=sel.r*mr*Math.cos(hh), ccy=sel.r*mr*Math.sin(hh);
    sel.rad=clamp(Math.hypot(x-ccx,y-ccy)/mr,0.02,1.3);
    gamutChanged();
   }
  });
  canvas.addEventListener("dblclick",e=>{
   const [x,y]=local(e), mr=maxR();
   const sel=state.gamut.masks[_gmActiveIdx];
   if(!sel || sel.type!=="poly")return; /* 円には頂点追加/削除の概念がない */
   const hit=hitSelHandle(x,y);
   if(hit && hit.type==="vertex"){
    if(sel.verts.length>3){ sel.verts.splice(hit.idx,1); gamutChanged(); }
    else status_(t("status.vertMin3"),true);
    return;
   }
   if(sel.verts.length<3)return;
   if(sel.verts.length>=12){ status_(t("status.vertMax12"),true); return; }
   const pts=sel.verts.map(v=>{ const h=(v.h+sel.rot)*D2R; return [v.r*mr*Math.cos(h),v.r*mr*Math.sin(h)]; });
   let bi=0,bd=1e18;
   for(let i=0;i<pts.length;i++){
    const j=(i+1)%pts.length, [ax,ay]=pts[i],[bx,by]=pts[j];
    const ex=bx-ax,ey=by-ay,wx=x-ax,wy=y-ay;
    const tt=clamp((wx*ex+wy*ey)/Math.max(ex*ex+ey*ey,1e-9),0,1);
    const dd=(x-(ax+ex*tt))**2+(y-(ay+ey*tt))**2;
    if(dd<bd){bd=dd;bi=j;}
   }
   sel.verts.splice(bi,0,{h:mod360(Math.atan2(y,x)*R2D-sel.rot), r:clamp(Math.hypot(x,y)/mr,0,1.3)});
   gamutChanged();
  });
  const up=()=>{ this.dragging=null; };
  canvas.addEventListener("pointerup",up);
  canvas.addEventListener("pointercancel",up);
 }
};
let gmLastScale=1;
/* WS-15: 選択中マスクのインデックス。表示設定でありUndo対象外のため、state.gamutには
   置かずmodule-scopeの素の変数として持つ(_wheelRotOff等と同じ流儀)。 */
let _gmActiveIdx=0;
/* F15: プリセット定義。押し直しで形だけ差し替え、現在のrotは保持する(§F15 UI仕様) */
const GAMUT_PRESETS={
 triad:  [{h:0,r:1.0},{h:120,r:1.0},{h:240,r:1.0}],
 thin:   [{h:0,r:1.0},{h:170,r:0.85},{h:190,r:0.85}],
 y:      [{h:0,r:1.0},{h:60,r:0.15},{h:130,r:0.9},{h:230,r:0.9},{h:300,r:0.15}],
 trap:   [{h:-25,r:1.0},{h:25,r:1.0},{h:155,r:0.8},{h:205,r:0.8}],
 tetra:  [{h:0,r:1.0},{h:90,r:1.0},{h:180,r:1.0},{h:270,r:1.0}]
};
function applyGamutPreset(name){
 const preset=GAMUT_PRESETS[name]; if(!preset)return;
 const gt=state.gamut;
 /* WS-15: マスクが3個未満なら新規マスクとして追加して選択、3個ある場合は選択中マスクを
    置き換える(標準書「プリセットを3回叩いてもエラーにならず3個表示される」を満たす)。
    置換時、元が多角形マスクだった場合のみ現在の回転(rot)を保持する(§F15の意味論を踏襲)。 */
 if(gt.masks.length<3){
  gt.masks.push({type:"poly", verts:preset.map(v=>({h:v.h,r:v.r})), rot:0});
  _gmActiveIdx=gt.masks.length-1;
 }else{
  const old=gt.masks[_gmActiveIdx];
  const rot=(old&&old.type==="poly")?old.rot:0;
  gt.masks[_gmActiveIdx]={type:"poly", verts:preset.map(v=>({h:v.h,r:v.r})), rot};
 }
 gt._extractDots=null;
 gmLastScale=1; $("gmScale").value=1; $("vgmScale").textContent="100%";
 if(gt.mode==="off") setGamutMode("highlight"); else gamutChanged();
 syncGamutUI();
 status_(t("status.presetApplied"));
}
/* WS-15: 円形マスクの追加。マスクが3個未満なら新規追加して選択、3個ある場合は選択中を置換する
   (プリセットと同じ「置く場所がなければ選択中を置き換える」規約)。 */
function addGamutCircle(){
 const gt=state.gamut;
 const newMask={type:"circle", h:0, r:0.5, rad:0.25};
 if(gt.masks.length<3){ gt.masks.push(newMask); _gmActiveIdx=gt.masks.length-1; }
 else gt.masks[_gmActiveIdx]=newMask;
 if(gt.mode==="off") setGamutMode("highlight"); else gamutChanged();
 syncGamutUI();
 status_(t("status.gamutCircleAdded"));
}
/* WS-16 S7-3(Sonnet実装): 空(頂点0個)のpolyマスクを新規作成して選択する。
   既存のapplyGamutPreset/addGamutCircleと全く同じ「3個未満なら追加、3個なら選択中を置換」の
   規約に従う。作成直後はverts.length===0のため、既存のGamutWheelUI pointerdown内の
   分岐2(§VII-2)がそのまま効き、クリックで頂点を追加できる状態になる。
   モードの自動有効化は行わない(頂点3個が揃った時点で既存コードが自動的に行う=
   justActivated分岐、GamutWheelUI.pointerdown参照)。 */
function addGamutPolyDraft(){
 const gt=state.gamut;
 const newMask={type:"poly", verts:[], rot:0};
 if(gt.masks.length<3){ gt.masks.push(newMask); _gmActiveIdx=gt.masks.length-1; }
 else gt.masks[_gmActiveIdx]=newMask;
 syncGamutUI();
 status_(t("status.gamutDrawStart"));
}
/* Andrewのmonotone chain (O(n log n))。points:[[x,y],...] → 反時計回りの凸包頂点配列 */
function convexHull(points){
 const pts=points.slice().sort((a,b)=>a[0]-b[0]||a[1]-b[1]);
 if(pts.length<3)return pts;
 const cross=(o,a,b)=>(a[0]-o[0])*(b[1]-o[1])-(a[1]-o[1])*(b[0]-o[0]);
 const lower=[];
 for(const p of pts){ while(lower.length>=2&&cross(lower[lower.length-2],lower[lower.length-1],p)<=0)lower.pop(); lower.push(p); }
 const upper=[];
 for(let i=pts.length-1;i>=0;i--){ const p=pts[i]; while(upper.length>=2&&cross(upper[upper.length-2],upper[upper.length-1],p)<=0)upper.pop(); upper.push(p); }
 lower.pop(); upper.pop();
 return lower.concat(upper);
}
function _gmVertXY(v){ const h=v.h*D2R; return [v.r*Math.cos(h), v.r*Math.sin(h)]; }
function _gmTriArea(verts,i){
 const n=verts.length, a=_gmVertXY(verts[(i-1+n)%n]), b=_gmVertXY(verts[i]), c=_gmVertXY(verts[(i+1)%n]);
 return Math.abs((b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0]))/2;
}
/* 12頂点超なら面積寄与(隣接三角形の面積)の小さい頂点から間引く(§F15) */
function simplifyGamutVerts(verts,maxN){
 verts=verts.slice();
 while(verts.length>maxN){
  let bi=0,bv=Infinity;
  for(let i=0;i<verts.length;i++){ const a=_gmTriArea(verts,i); if(a<bv){bv=a;bi=i;} }
  verts.splice(bi,1);
 }
 return verts;
}
/* §VII-4/VII-5: 色数スライダ・原点トグルの変更を300msデバウンスして再抽出する。
   未抽出(_extractDotsがnull)なら何もしない=副作用なし(受け入れ基準どおり)。 */
let _gmAutoExtractT=null;
function scheduleGamutAutoExtract(){
 if(!state.gamut._extractDots)return;
 if(_gmAutoExtractT)clearTimeout(_gmAutoExtractT);
 _gmAutoExtractT=setTimeout(()=>{ _gmAutoExtractT=null; gamutExtractFromImage(); },300);
}
async function gamutExtractFromImage(){
 if(!Mirror.ready){ status_(t("status.loadImageFirst"),true); return; }
 status_(t("status.extractingGamut"),false,true);
 try{
  const buf=Mirror.out.buffer.slice(0);
  const cover=+$("gmCoverage").value; /* WS-14: 「抽出の主要色数」から「カバー率」セレクタへ置換(下記) */
  const res=await W.call("gamutSectors",{buf,w:Mirror.w,h:Mirror.h,cover,origin:state.gamut.hullIncludeOrigin},[buf]);
  let verts=res.verts.map(v=>({h:v.h, r:v.r})); /* WS-15: 新規マスクとしてrot=0で作るため、抽出角度は絶対値のまま格納する */
  if(verts.length<3){ status_(t("status.hullFailed"),true); return; }
  if(verts.length>12) verts=simplifyGamutVerts(verts,12);
  const gt=state.gamut;
  /* WS-15: 抽出結果は選択中マスクへ置換する。マスクが1つも無ければ新規追加する(標準書の指示)。 */
  const newMask={type:"poly", verts, rot:0};
  if(gt.masks.length===0){ gt.masks.push(newMask); _gmActiveIdx=0; }
  else gt.masks[_gmActiveIdx]=newMask;
  gt._extractDots=res.dots.map(d=>({...d, hex:K.hex(d.srgb)})); /* WS-14: 描画側が読むhexフィールドをここで付与(srgb→hexの変換は既存K.hexをそのまま使用) */
  if(gt.mode==="off") setGamutMode("highlight"); else gamutChanged();
  syncGamutUI();
  status_(t("status.gamutExtractedCoverage",{n:verts.length,pct:Math.round(res.coverage*100)}));
 }catch(e){ status_(t("status.extractFailed",{msg:e.message}),true); }
}
function gamutSendToPalette(){
 const gt=state.gamut;
 const active=gamutActiveMasks(gt);
 if(!active.length){ status_(t("status.noVertices"),true); return; }
 /* WS-15: 全マスクの頂点色(poly)+中心色(circle)をまとめてパレットへ追加する */
 active.forEach(m=>{
  const pushColor=(hdeg,rr)=>{
   const cr=Math.max(K.cmax(0.72,mod360(hdeg)),1e-5);
   const C=rr*cr, h=mod360(hdeg)*D2R;
   const srgb=K.ok2srgb([0.72,C*Math.cos(h),C*Math.sin(h)]).map(x=>clamp(x,0,1));
   state.scheme.curPal.colors.push(K.hex(srgb));
  };
  if(m.type==="circle")pushColor(m.h,m.r);
  else m.verts.forEach(v=>pushColor(v.h+m.rot,v.r));
 });
 renderPalCur(); persistSoon();
 status_(t("status.vertsToPalette"));
}
/* 単語(空白)単位の折返し描画。凡例のHex一覧のように短いトークンを並べる用途向け
   (drawGamutWheelのガイド文字用wrapCanvasTextは文字単位で別用途)。戻り値は次に描画すべきy座標。 */
function wrapTextWords(cx,text,x,y,maxWidth,lineH){
 const words=text.split(" ");
 let line="", ly=y;
 words.forEach(w=>{
  const test=line?line+"  "+w:w;
  if(cx.measureText(test).width>maxWidth && line){ cx.fillText(line,x,ly); ly+=lineH; line=w; }
  else line=test;
 });
 if(line){ cx.fillText(line,x,ly); ly+=lineH; }
 return ly;
}
/* §VII-7: 既存の画像書き出し経路(expGo/exportImage)には一切触れない独立関数。
   オフスクリーンcanvas(既定2048×2048・白背景)にVII-1の円盤を高解像度で再計算して描き、
   マスク多角形の外側だけを白α≈0.85で覆う(evenodd: 外周矩形−内側多角形の差分のみ塗る)。
   印刷用途のため境界のフェザーは適用せず、細いグレーの輪郭線で明示する。
   ダウンロードは既存書き出しと同じ<a download>イディオムを流用するのみで、経路自体は共有しない。 */
/* WS-13: ガマットの色相環は画像としての書き出しも想定しているため、12分割の色相スポークと
   彩度の同心円(25/50/75/100%)を追加して見やすくする。書き出し画像(2048px)・画面表示(252px)の
   両方から共通で呼べるよう、線幅・フォントサイズをsize比例のパラメータとして受け取る。
   円盤は「L≈0.72固定・半径=相対彩度(§F12座標系)」の色相×彩度平面であり、ユーザー要望の
   「輝度の線」はこの構造上「彩度の同心円」として実装する(円盤自体の明度は固定のため)。 */
function drawGamutTicks(cx,c0,maxR,size,opts){
 const o=Object.assign({stroke:"rgba(0,0,0,.35)",strokeMain:"rgba(0,0,0,.55)",label:"rgba(0,0,0,.6)",lw:Math.max(1,size/700),font:Math.max(9,Math.round(size*0.028))+"px sans-serif"},opts);
 cx.save();
 cx.font=o.font; cx.textAlign="center"; cx.textBaseline="middle"; cx.fillStyle=o.label;
 /* 12分割スポーク(30°刻み)。0/90/180/270°をやや強調 */
 for(let deg=0;deg<360;deg+=30){
  const rad=deg*D2R, isMain=deg%90===0;
  cx.beginPath();
  cx.moveTo(c0,c0);
  cx.lineTo(c0+maxR*Math.cos(rad),c0+maxR*Math.sin(rad));
  cx.strokeStyle=isMain?o.strokeMain:o.stroke;
  cx.lineWidth=isMain?o.lw*1.6:o.lw;
  cx.stroke();
  const lx=c0+(maxR+size*0.045)*Math.cos(rad), ly=c0+(maxR+size*0.045)*Math.sin(rad);
  cx.fillText(deg+"°",lx,ly);
 }
 /* 彩度の同心円(25/50/75/100%)。右横に%ラベル(スポークと重ならないよう15°方向へ配置) */
 cx.textAlign="left";
 [0.25,0.5,0.75,1.0].forEach(frac=>{
  cx.beginPath(); cx.arc(c0,c0,maxR*frac,0,TAU);
  cx.strokeStyle=o.stroke; cx.lineWidth=o.lw; cx.stroke();
  const rad=15*D2R;
  const lx=c0+maxR*frac*Math.cos(rad)+size*0.01, ly=c0+maxR*frac*Math.sin(rad);
  cx.fillText("C "+Math.round(frac*100)+"%",lx,ly);
 });
 cx.restore();
}
async function exportGamutImage(){
 const gt=state.gamut;
 const active=gamutActiveMasks(gt);
 if(!active.length){ status_(t("status.gamutMaskIncomplete"),true); return; }
 const btn=$("gmExportImg");
 btn.disabled=true;
 status_(t("status.gamutImgGenerating"),false,true);
 await new Promise(r=>setTimeout(r,30)); /* status_の描画を1フレーム先に反映させてから重い処理へ */
 try{
  const SIZE=2048;
  const cv=document.createElement("canvas"); cv.width=SIZE; cv.height=SIZE;
  const cx=cv.getContext("2d");
  cx.fillStyle="#ffffff"; cx.fillRect(0,0,SIZE,SIZE);
  const disc=diskBase(SIZE); /* 252px版の拡大ではなく2048px用に再計算(§VII-7指示どおり) */
  cx.drawImage(disc,0,0);
  const c0=SIZE/2, maxR=SIZE/2-4; /* diskBase内部のRと同一の式(§VII-1) */
  drawGamutTicks(cx,c0,maxR,SIZE); /* WS-13: 12分割スポーク+彩度同心円(円盤の直後・マスク塗りの前) */
  /* WS-15: 全マスクをスクリーン座標へ解決する(円は中心+半径、多角形は頂点配列)。 */
  const shapes=active.map(m=>{
   if(m.type==="circle"){
    const hh=m.h*D2R;
    return {type:"circle", cx:c0+m.r*maxR*Math.cos(hh), cy:c0+m.r*maxR*Math.sin(hh), rad:m.rad*maxR};
   }
   return {type:"poly", pts:m.verts.map(v=>{ const h=(v.h+m.rot)*D2R; return [c0+v.r*maxR*Math.cos(h), c0+v.r*maxR*Math.sin(h)]; })};
  });
  const traceShape=(ctx,s)=>{
   ctx.beginPath();
   if(s.type==="circle")ctx.arc(s.cx,s.cy,s.rad,0,TAU);
   else s.pts.forEach(([px,py],i)=>{ if(i===0)ctx.moveTo(px,py); else ctx.lineTo(px,py); });
   if(s.type!=="circle")ctx.closePath();
  };
  /* WS-15/Fix3(Sonnet実装): 複数マスク(重なりうる)の外側だけを白で覆う。
     旧実装はメインキャンバス上でdestination-outを直接使っており、円盤の色そのものを
     含めてアルファ0まで完全消去していたため、書き出したPNGのマスク内側(本来最も見せたい
     「範囲内なので薄くならない」部分)が透明になり、多くの閲覧環境で黒く表示される
     バグがあった(2Dキャンバスは単一のフラットなピクセルバッファで「奥のレイヤー」という
     概念が無いため、destination-outは「下から透けて見せる」のではなく「そのピクセルを
     問答無用で消す」動作になる。Porter-Duffの数式で検証済み: dst_a*(1-src_a)=1*(1-1)=0)。
     正しくは、別の透明なオフスクリーンキャンバス上で「白で塗る→destination-outで穴を
     開ける」を完結させ、その「穴の空いた白い被膜」だけを通常合成(source-over)で
     メインキャンバスへ重ねる。穴の部分はアルファ0のまま何も上書きしないため、
     メインキャンバスの円盤の色(=マスク内側の本来の彩度)がそのまま残る。 */
  const dimCv=document.createElement("canvas"); dimCv.width=SIZE; dimCv.height=SIZE;
  const dimCx=dimCv.getContext("2d");
  dimCx.fillStyle="rgba(255,255,255,0.85)";
  dimCx.fillRect(0,0,SIZE,SIZE);
  dimCx.globalCompositeOperation="destination-out";
  shapes.forEach(s=>{ traceShape(dimCx,s); dimCx.fillStyle="#fff"; dimCx.fill(); });
  cx.drawImage(dimCv,0,0);
  shapes.forEach(s=>{ traceShape(cx,s); cx.strokeStyle="rgba(90,90,90,0.9)"; cx.lineWidth=Math.max(2,SIZE/500); cx.stroke(); });
  const vr=Math.max(6,SIZE/140);
  const vertHexes=[];
  active.forEach((m,mi)=>{
   const s=shapes[mi];
   const pushHex=(hdeg,rr)=>{
    const cr=Math.max(K.cmax(0.72,mod360(hdeg)),1e-5);
    const C=rr*cr, hr=mod360(hdeg)*D2R;
    vertHexes.push(K.hex(K.ok2srgb([0.72,C*Math.cos(hr),C*Math.sin(hr)]).map(x=>clamp(x,0,1))));
   };
   if(m.type==="circle"){
    pushHex(m.h,m.r);
    cx.beginPath(); cx.arc(s.cx,s.cy,vr,0,TAU);
    cx.fillStyle="#fff"; cx.fill(); cx.strokeStyle="#000"; cx.lineWidth=Math.max(1.5,SIZE/900); cx.stroke();
   }else{
    m.verts.forEach(v=>pushHex(v.h+m.rot,v.r));
    s.pts.forEach(([px,py])=>{
     cx.beginPath(); cx.arc(px,py,vr,0,TAU);
     cx.fillStyle="#fff"; cx.fill(); cx.strokeStyle="#000"; cx.lineWidth=Math.max(1.5,SIZE/900); cx.stroke();
    });
   }
  });
  /* 上端の凡例: 画像名・日付・頂点Hex一覧(i18n対象) */
  const pad=Math.round(SIZE*0.022);
  cx.textAlign="left"; cx.textBaseline="top"; cx.fillStyle="#222";
  cx.font=Math.round(SIZE*0.017)+"px sans-serif";
  const title=(state.file.name||t("gamut.exportUntitled"))+"  —  "+new Date().toLocaleString();
  cx.fillText(title,pad,pad);
  cx.font=Math.round(SIZE*0.012)+"px sans-serif";
  const vertsY=wrapTextWords(cx,t("gamut.exportVerts")+": "+vertHexes.join(" "),pad,pad+Math.round(SIZE*0.03),SIZE-pad*2,Math.round(SIZE*0.017));
  cx.fillStyle="#555";
  wrapTextWords(cx,t("gamut.exportReadingHint"),pad,vertsY+Math.round(SIZE*0.006),SIZE-pad*2,Math.round(SIZE*0.015));
  const blob=await new Promise(rs=>cv.toBlob(rs,"image/png"));
  const baseName=(state.file.name||"gamut").replace(/\.[^.]+$/,"");
  const a=document.createElement("a");
  a.href=URL.createObjectURL(blob); a.download=baseName+"_gamut.png"; a.click();
  setTimeout(()=>URL.revokeObjectURL(a.href),4000);
  status_(t("status.exported",{name:baseName+"_gamut.png"}));
 }catch(e){ console.error(e); status_(t("status.gamutImgExportFailed",{msg:e.message}),true); }
 finally{ btn.disabled=(gamutActiveMasks(state.gamut).length<1); }
}

