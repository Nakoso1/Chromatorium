/* ============================================================
   入力系: パン/ズーム/スポイト/分割線/ショートカット (1.3, 1.4, 第6項)
   ============================================================ */
const Input={
 dragging:null,
 effMode(){ return (state.view.tempPan||state.view.mode==="hand")?"hand":"pick"; },
 img2scr(ix,iy){ return [ix*state.view.zoom+state.view.panX, iy*state.view.zoom+state.view.panY]; },
 scr2img(sx,sy){ return [(sx-state.view.panX)/state.view.zoom,(sy-state.view.panY)/state.view.zoom]; },
 init(){
  const cv=$("gl"),st=$("stage");
  const pos=e=>{ const r=cv.getBoundingClientRect(); return [e.clientX-r.left,e.clientY-r.top]; };
  cv.addEventListener("pointerdown",e=>{
   if(!state.file.has)return;
   const [sx,sy]=pos(e);
   cv.setPointerCapture(e.pointerId);
   if(Crop.active){ Crop.pointerDown(sx,sy); return; } /* F2: トリミングモード中は専用ハンドラへ委譲 */
   if(MaskDraw.active){ MaskDraw.pointerDown(sx,sy); return; } /* F14: マスク範囲描画中は専用ハンドラへ委譲 */
   if(state.view.split){
    const lineX=state.view.splitX*cv.clientWidth;
    if(Math.abs(sx-lineX)<7){ this.dragging={type:"split"}; return; }
   }
   if(this.effMode()==="hand"){
    this.dragging={type:"pan",sx,sy,px:state.view.panX,py:state.view.panY};
    cv.classList.add("handing");
   }else{
    const [ix,iy]=this.scr2img(sx,sy);
    if(ix>=0&&iy>=0&&ix<state.file.w&&iy<state.file.h) doPick(ix,iy);
   }
  });
  cv.addEventListener("pointermove",e=>{
   const [sx,sy]=pos(e);
   if(Crop.active){ Crop.pointerMove(sx,sy); return; } /* F2 */
   if(MaskDraw.active){ MaskDraw.pointerMove(sx,sy); return; } /* F14 */
   if(this.dragging){
    if(this.dragging.type==="pan"){
     state.view.panX=this.dragging.px+(sx-this.dragging.sx);
     state.view.panY=this.dragging.py+(sy-this.dragging.sy);
     mark("screen","overlay");
    }else if(this.dragging.type==="split"){
     state.view.splitX=clamp(sx/cv.clientWidth,0.02,0.98);
     mark("screen");
    }
   }else if(state.view.split){
    const lineX=state.view.splitX*cv.clientWidth;
    cv.style.cursor=Math.abs(sx-lineX)<7?"ew-resize":"";
   }
  });
  const up=e=>{ if(Crop.active){ Crop.pointerUp(); return; } if(MaskDraw.active){ MaskDraw.pointerUp(); return; } this.dragging=null; cv.classList.remove("handing"); cv.style.cursor=""; };
  cv.addEventListener("pointerup",up); cv.addEventListener("pointercancel",up);
  cv.addEventListener("wheel",e=>{
   if(!state.file.has)return;
   e.preventDefault();
   const [sx,sy]=pos(e);
   const oz=state.view.zoom;
   const nz=clamp(oz*Math.exp(-e.deltaY*0.0013),0.02,64);
   state.view.panX=sx-(sx-state.view.panX)*nz/oz;
   state.view.panY=sy-(sy-state.view.panY)*nz/oz;
   state.view.zoom=nz;
   mark("screen","overlay");
   /* 旧実装(セルサイズがズーム依存)の名残だった mark("c","blur") は撤廃。
      現在は網点セルが画像px絶対値のためMixパス出力はズームに依存せず、
      プレビュー解像度変更時の再実行は settle() → mark("a") が担う */
   this.settle();
  },{passive:false});
  this._settleT=null;
  /* キーボード (第6項: Space=一時パン, Q or \ = オリジナル比較) */
  window.addEventListener("keydown",e=>{
   const tag=(e.target.tagName||"").toLowerCase();
   if(tag==="input"||tag==="select"||tag==="textarea")return;
   if(e.code==="Space"){ e.preventDefault();
    if(!state.view.tempPan){ state.view.tempPan=true; updateCursor(); } }
   else if(e.code==="KeyQ"||e.code==="Backslash"||e.key==="\\"){ e.preventDefault();
    if(!state.view.hold){ state.view.hold=true; mark("screen","panels"); drawHist(); refreshNumeric(); drawCVD(); } }
  });
  window.addEventListener("keyup",e=>{
   if(e.code==="Space"){ state.view.tempPan=false; updateCursor(); }
   else if(e.code==="KeyQ"||e.code==="Backslash"||e.key==="\\"){
    state.view.hold=false; mark("screen","panels"); drawHist(); refreshNumeric(); drawCVD(); }
  });
  window.addEventListener("blur",()=>{
   state.view.tempPan=false;
   /* バグ修正: Qホールド中にフォーカスを失った場合も keyup と同様にパネル類を
      「編集後」表示へ戻す(従来はヒストグラム等が「オリジナル」表記のまま残っていた) */
   if(state.view.hold){ state.view.hold=false; mark("panels"); drawHist(); refreshNumeric(); drawCVD(); }
   updateCursor(); mark("screen");
  });
  /* D&D */
  st.addEventListener("dragover",e=>{ e.preventDefault(); $("dropglow").classList.add("show"); });
  st.addEventListener("dragleave",e=>{ $("dropglow").classList.remove("show"); });
  st.addEventListener("drop",e=>{
   e.preventDefault(); $("dropglow").classList.remove("show");
   const f=e.dataTransfer.files&&e.dataTransfer.files[0];
   if(f)openFile(f);
  });
  new ResizeObserver(()=>{ mark("screen","overlay"); }).observe(st);
 },
 settle(){
  if(this._settleT)clearTimeout(this._settleT);
  this._settleT=setTimeout(()=>{
   if(R.ensurePreview(false))mark("a");
  },220);
 }
};
function updateCursor(){
 const cv=$("gl");
 const m=Input.effMode();
 cv.classList.toggle("pick",m==="pick");
 cv.classList.toggle("hand",m==="hand");
 $("modePick").classList.toggle("on",state.view.mode==="pick");
 $("modeHand").classList.toggle("on",state.view.mode==="hand");
 $("radiusWrap").style.display=state.view.mode==="pick"?"":"none";
}

/* ============================================================
   F2. トリミング機能
   非破壊クロップをレンダラ座標系(uWin等)へ注入する方式は接触面が広すぎるため採らず、
   「原本ビットマップ(R.origBitmap)から矩形を焼き直して差し替える」ベイク方式を採る。
   state.cropは常に「原本座標系」での矩形を保持し、Undo/Redoで値が変わるたびに
   _undoSyncControls()の末尾(下記)が再ベイクを検知・実行する。
   ============================================================ */
/* §II-5/6: 90°刻みの厳密な整数変換行列[a,b,c,d](e,fは呼び出し側で別途translateする)。
   ctx.rotate(θ)はMath.cos/sin(θ)の丸め誤差により90°ちょうどにならない場合があり
   (例: Math.cos(Math.PI/2)≈6.1e-17)、実装によっては軸整列と認識されずアンチエイリアス
   (再標本化)が走る恐れがあるため、rotate()を使わずこの厳密値を直接ctx.transform()へ渡す。 */
const ORIENT_MATRIX={0:[1,0,0,1],90:[0,1,-1,0],180:[-1,0,0,-1],270:[0,-1,1,0]};
/* §II-5/6 座標写像: 原本(R.origBitmap, ow0×oh0)上の点→orient適用後の点。applyGeometry()の
   キャンバス合成と同一の構成(center基準+厳密整数行列+flipは回転後キャンバス自身の軸に対して)。 */
function orientForwardMap(px,py,ow0,oh0,orient){
 const {rot,flipH,flipV}=orient;
 const ow=(rot===90||rot===270)?oh0:ow0, oh=(rot===90||rot===270)?ow0:oh0;
 const xc=px-ow0/2, yc=py-oh0/2;
 const M=ORIENT_MATRIX[rot]||ORIENT_MATRIX[0];
 let x2=M[0]*xc+M[2]*yc, y2=M[1]*xc+M[3]*yc;
 x2+=ow/2; y2+=oh/2;
 if(flipH)x2=ow-x2;
 if(flipV)y2=oh-y2;
 return [x2,y2];
}
/* 逆写像。行列は直交(回転+符号反転のみ)のため逆行列=転置行列で厳密に求まる
   (Node上のラウンドトリップ検証: forward→inverseが全16状態で誤差0で元へ戻ることを確認済み)。 */
function orientInverseMap(px,py,ow0,oh0,orient){
 const {rot,flipH,flipV}=orient;
 const ow=(rot===90||rot===270)?oh0:ow0, oh=(rot===90||rot===270)?ow0:oh0;
 let x2=px,y2=py;
 if(flipH)x2=ow-x2;
 if(flipV)y2=oh-y2;
 const xc=x2-ow/2, yc=y2-oh/2;
 const M=ORIENT_MATRIX[rot]||ORIENT_MATRIX[0];
 const x=M[0]*xc+M[1]*yc, y=M[2]*xc+M[3]*yc;
 return [x+ow0/2, y+oh0/2];
}
/* §II-5/6: hueWarpノード・マスク幾何(rect/lasso)・state.cropを、oldOrient→newOrientの
   回転/反転に追従させる。「今回のクリックが何か」ではなく「原本(不変の基準点)を経由した
   旧オリエント→新オリエントの差分」として計算するため、クリックの順序に関わらず常に
   applyGeometry()の(固定順序=回転→反転)ベイクと整合する(Node検証で確認済み: 素朴な
   「現在の作業画像内で今回の操作だけを変換する」方式は flip→rotate のようなクリック順序で
   ずれることが判明したため、この原本往復方式を採用した)。 */
function transformPointsForOrient(newOrient){
 if(!R.origBitmap)return;
 const ow0=R.origBitmap.width, oh0=R.origBitmap.height;
 const oldOrient={...state.orient};
 const toOrig=(px,py)=>orientInverseMap(px,py,ow0,oh0,oldOrient);
 const toNew=(px,py)=>orientForwardMap(px,py,ow0,oh0,newOrient);
 /* state.crop(「オリエント後・クロップ前」座標系)を変換。矩形は回転で軸が入れ替わるため
    4隅を変換してから外接矩形を取り直す(transformMaskGeoForCropの単純平行移動では済まない)。 */
 let oldCropXY=[0,0];
 if(state.crop){
  oldCropXY=[state.crop.x,state.crop.y];
  const {x,y,w,h}=state.crop;
  const corners=[[x,y],[x+w,y],[x,y+h],[x+w,y+h]].map(([px,py])=>toNew(...toOrig(px,py)));
  const xs=corners.map(c=>c[0]), ys=corners.map(c=>c[1]);
  const nx=Math.min(...xs), ny=Math.min(...ys);
  state.crop={x:nx,y:ny,w:Math.max(...xs)-nx,h:Math.max(...ys)-ny};
 }
 /* hueWarpノード・マスク幾何は現在「最終作業画像(旧オリエント後さらに旧クロップ後)」座標系にある。
    旧クロップ原点を足して「旧オリエント後・クロップ前」座標へ戻し、原本を経由して「新オリエント後・
    クロップ前」座標へ写す。ここでは新クロップ原点はまだ引かない(=このあとCrop.applyGeometry()が
    自前のtransformHueNodesForCrop/transformMaskGeoForCropで新クロップ分をちょうど1回だけ引く。
    ここで先に引いてしまうと二重に引かれて座標が壊れるバグになる — 数値検証で発見・修正した箇所)。 */
 const tf=(px,py)=>{
  const [ox,oy]=toOrig(px+oldCropXY[0], py+oldCropXY[1]);
  return toNew(ox,oy);
 };
 state.hueWarp.nodes.forEach(n=>{ const [nx,ny]=tf(n.imgX,n.imgY); n.imgX=nx; n.imgY=ny; });
 const g=state.mask.geo;
 if(g.rect){
  const [rx,ry,rw,rh]=g.rect;
  const corners=[[rx,ry],[rx+rw,ry],[rx,ry+rh],[rx+rw,ry+rh]].map(([px,py])=>tf(px,py));
  const xs=corners.map(c=>c[0]), ys=corners.map(c=>c[1]);
  const nx=Math.min(...xs), ny=Math.min(...ys);
  g.rect=[nx,ny,Math.max(...xs)-nx,Math.max(...ys)-ny];
 }
 if(g.lasso) g.lasso=g.lasso.map(([lx,ly])=>tf(lx,ly));
 /* 選択ピクセルは座標の意味が変わるためリセットする(既存crop時挙動と同じ、§II-5/6指示) */
 state.analysis.pick=null;
 if(state.analysis._wheelProbe)state.analysis._wheelProbe.active=false;
 if(typeof syncMaskPickButtons==="function")syncMaskPickButtons(); /* Fix2(a) */
}
/* §II-5: 時計回りに90°回転。完全可逆・Undo可能なため確認なしで即時実行する。 */
async function orientRotate(){
 if(!state.file.has||Crop.active)return;
 const newOrient={...state.orient, rot:(state.orient.rot+90)%360};
 transformPointsForOrient(newOrient);
 state.orient=newOrient;
 await Crop.applyGeometry();
 mark("panels");
 status_(t("status.rotated"));
}
/* §II-6: 横/縦反転。axis: "h"|"v"。 */
async function orientFlip(axis){
 if(!state.file.has||Crop.active)return;
 const newOrient={...state.orient};
 if(axis==="h")newOrient.flipH=!newOrient.flipH; else newOrient.flipV=!newOrient.flipV;
 transformPointsForOrient(newOrient);
 state.orient=newOrient;
 toggleFlipPop(false);
 await Crop.applyGeometry();
 mark("panels");
 status_(axis==="h"?t("status.flippedH"):t("status.flippedV"));
}
/* savePopと同型・同スタイルの小ポップオーバー。位置はbtnFlipの実際のbounding rectから動的に設定する
   (savePopはツールバー先頭固定オフセットだが、btnFlipはそれより右にあるため流用できない)。 */
function toggleFlipPop(show){
 const el=$("flipPop");
 if(show===undefined) el.classList.toggle("show"); else el.classList.toggle("show",show);
 if(el.classList.contains("show")){
  const r=$("btnFlip").getBoundingClientRect();
  el.style.left=Math.round(r.left)+"px";
 }
}
const Crop={
 active:false, rect:null, ratio:null, prevTab:"analyze", guideType:"none", _drag:null,
 toggle(){ if(this.active) this.commit(); else this.enter(); },
 enter(){
  if(!state.file.has||this.active)return;
  this.active=true;
  this.prevTab=state.ui.tab;
  this.rect={x:0,y:0,w:state.file.w,h:state.file.h};
  this.ratio=null; this.guideType="none";
  /* §II-4: トリミング中は比較分割を強制オフにする。splitXはII-2のリセット方針に合わせ中央へ戻す
     (トリミング終了時に分割状態を復元することはしない=常にオフから再開)。 */
  state.view.split=false; state.view.splitX=0.5;
  $("btnSplit").classList.remove("on"); $("btnSplit").disabled=true;
  $("btnRotate").disabled=true; $("btnFlip").disabled=true; toggleFlipPop(false); /* §II-5/6 */
  document.querySelectorAll("#tabs button").forEach(b=>b.disabled=true);
  document.querySelectorAll(".tabpage").forEach(p=>p.classList.remove("on"));
  $("tab-crop").classList.add("on");
  $("crRatio").value="free"; $("crGuide").value="none";
  updateSpiralDirBtns(); /* §III-1: crGuideを"none"へ戻したのでミニボタンも隠す */
  $("crUncropRow").style.display=state.crop?"":"none";
  $("btnCrop").classList.add("on");
  fitView();
  this.syncInputs();
  /* §II-3 根本原因: fitView()はstate.view.zoom/panX/panYを書き換えるだけでmark()を一切呼ばない。
     R.render()(GL側の実画像描画)は"screen"フラグにのみ購読しており(L5903近傍のsub()参照)、
     "overlay"だけをmarkしてもオーバーレイ(トリミング枠)は新しいズーム/パンで正しく再描画される
     一方、画像そのものは旧ズーム/パンのまま取り残される。これが「縮小表示中に開始すると枠が
     画像に合わない」の実体であり、単純なタイミング競合ではない。"screen"も併せてmarkすることで
     R.render()が再実行され(ensurePreview内のtargetPScale()がstate.view.zoomを見るため、
     必要なら軽量な再合成のみが走り、フルパイプライン再計算にはならない=低コスト)、画像と枠が
     常に同じズーム/パンを参照するようになる。
     [WS-01追記] かつてfitView()内部でensurePreview(true)を強制呼び出ししていたため、この
     mark("screen")到達時には既にFBOが空で再確保済みとなりrender()側のrealloc検知が働かず、
     全面黒画面になるバグがあった。fitView()から強制再確保を除去したことで、このmark()経由の
     ensurePreview(false)によるrealloc検知が正しく機能するようになっている。 */
  mark("screen","overlay");
  status_(t("status.cropHint"),false,true);
 },
 exit(){
  if(!this.active)return;
  this.active=false; this._drag=null;
  document.querySelectorAll("#tabs button").forEach(b=>b.disabled=false);
  document.querySelectorAll(".tabpage").forEach(p=>p.classList.toggle("on",p.id==="tab-"+this.prevTab));
  $("tab-crop").classList.remove("on");
  $("btnCrop").classList.remove("on");
  /* §II-4: 分割ボタンを再操作可能に戻す。分割状態そのものの復元はしない(II-2のリセット方針と整合)。 */
  $("btnSplit").disabled=false;
  $("btnRotate").disabled=false; $("btnFlip").disabled=false; /* §II-5/6 */
  $("gl").style.cursor="";
  mark("overlay");
 },
 cancel(){ if(!this.active)return; this.exit(); status_(t("status.cropCancelled")); },
 async commit(){
  if(!this.active)return;
  let {x,y,w,h}=this.rect;
  x=Math.round(clamp(x,0,state.file.w-16)); y=Math.round(clamp(y,0,state.file.h-16));
  w=Math.round(clamp(w,16,state.file.w-x)); h=Math.round(clamp(h,16,state.file.h-y));
  const base=state.crop; /* 既に一段トリミング済みなら、その原本オフセットへ合成する */
  state.crop={x:(base?base.x:0)+x, y:(base?base.y:0)+y, w, h};
  this.exit();
  await this.applyGeometry();
  status_(t("status.cropped",{w,h}));
 },
 async applyGeometry(){
  if(!R.origBitmap)return;
  const ob=R.origBitmap;
  const o=state.orient;
  /* §II-5/6: 回転90/270では原本の幅高が入れ替わった「オリエント後」座標系になる */
  const ow=(o.rot===90||o.rot===270)?ob.height:ob.width;
  const oh=(o.rot===90||o.rot===270)?ob.width:ob.height;
  const c=state.crop;
  let x=0,y=0,w=ow,h=oh;
  if(c){
   x=clamp(Math.round(c.x),0,ow-16); y=clamp(Math.round(c.y),0,oh-16);
   w=clamp(Math.round(c.w),16,ow-x); h=clamp(Math.round(c.h),16,oh-y);
  }
  transformHueNodesForCrop(x,y,w,h);
  transformMaskGeoForCrop(x,y,w,h);
  const cv=document.createElement("canvas"); cv.width=w; cv.height=h;
  const cx=cv.getContext("2d");
  cx.save();
  /* ②切出し: オリエント後座標系でのクロップ原点(x,y)を、最終canvasの(0,0)に合わせる。
     最初(=最後に適用)に置くことで、下の①をそのままにクロップ窓だけを動かせる。 */
  cx.translate(-x,-y);
  /* ①orient適用。回転はMath.cos/sin(θ)の浮動小数点誤差(例: cos(π/2)は正確な0にならない)を
     避けるため、90°刻みの厳密な整数行列を直接ctx.transform()へ渡す(§II-5/6「画質劣化ゼロ」
     の要件に対応。ctx.rotate()は使わない)。反転はorient後(=回転済み)のキャンバス自身の
     水平/垂直軸に対して行う(=現在表示されている見た目のまま反転する、直感に合う仕様)。 */
  if(o.flipH){ cx.translate(ow,0); cx.scale(-1,1); }
  if(o.flipV){ cx.translate(0,oh); cx.scale(1,-1); }
  cx.translate(ow/2,oh/2);
  const M=ORIENT_MATRIX[o.rot]||ORIENT_MATRIX[0];
  cx.transform(M[0],M[1],M[2],M[3],0,0);
  cx.drawImage(ob,-ob.width/2,-ob.height/2,ob.width,ob.height);
  cx.restore();
  const baked=await createImageBitmap(cv);
  await setImage(baked, state.file.name||"image", true);
  _bakedCropKey=JSON.stringify(state.crop);
  _bakedOrientKey=JSON.stringify(state.orient);
 },
 reset(){
  if(!state.file.has)return;
  state.crop=null;
  this.applyGeometry().then(()=>status_(t("status.cropReset")));
  if(this.active)this.exit();
 },
 syncInputs(){
  const r=this.rect;
  $("crX").value=Math.round(r.x); $("crY").value=Math.round(r.y);
  $("crW").value=Math.round(r.w); $("crH").value=Math.round(r.h);
 },
 setRatio(v){
  if(v==="free"){ this.ratio=null; $("crRW").style.display="none"; $("crRH").style.display="none"; $("crRatioFlip").style.display="none"; return; }
  if(v==="custom"){ $("crRW").style.display=""; $("crRH").style.display=""; $("crRatioFlip").style.display="";
   this.ratio=(+$("crRW").value||1)/(+$("crRH").value||1); this.applyRatio(); return; }
  $("crRW").style.display="none"; $("crRH").style.display="none"; $("crRatioFlip").style.display="none";
  this.ratio = v==="orig" ? state.file.w/state.file.h : (()=>{ const [a,b]=v.split(":").map(Number); return a/b; })();
  this.applyRatio();
 },
 applyRatio(){
  if(this.ratio==null)return;
  const r=this.rect;
  const cx=r.x+r.w/2, cy=r.y+r.h/2;
  let w=Math.min(r.w,state.file.w), h=w/this.ratio;
  if(h>state.file.h){ h=state.file.h; w=h*this.ratio; }
  r.w=w; r.h=h;
  r.x=clamp(cx-w/2,0,Math.max(0,state.file.w-w)); r.y=clamp(cy-h/2,0,Math.max(0,state.file.h-h));
  this.syncInputs(); mark("overlay");
 },
 setFromInputs(){
  const r=this.rect;
  r.x=clamp(+$("crX").value||0,0,state.file.w-16);
  r.y=clamp(+$("crY").value||0,0,state.file.h-16);
  r.w=clamp(+$("crW").value||16,16,state.file.w-r.x);
  r.h=clamp(+$("crH").value||16,16,state.file.h-r.y);
  if(this.ratio!=null){ r.h=r.w/this.ratio; }
  this.syncInputs(); mark("overlay");
 },
 handles(){
  const r=this.rect;
  return [
   {id:"nw",x:r.x,y:r.y},{id:"n",x:r.x+r.w/2,y:r.y},{id:"ne",x:r.x+r.w,y:r.y},
   {id:"e",x:r.x+r.w,y:r.y+r.h/2},{id:"se",x:r.x+r.w,y:r.y+r.h},{id:"s",x:r.x+r.w/2,y:r.y+r.h},
   {id:"sw",x:r.x,y:r.y+r.h},{id:"w",x:r.x,y:r.y+r.h/2}
  ];
 },
 hitTest(sx,sy){
  const HR=10; /* Fittsの法則: 見た目(半径5)より大きい当たり判定にする */
  for(const hd of this.handles()){
   const [px,py]=Input.img2scr(hd.x,hd.y);
   if(Math.hypot(sx-px,sy-py)<=HR)return hd.id;
  }
  const [x0,y0]=Input.img2scr(this.rect.x,this.rect.y);
  const [x1,y1]=Input.img2scr(this.rect.x+this.rect.w,this.rect.y+this.rect.h);
  if(sx>=x0&&sx<=x1&&sy>=y0&&sy<=y1)return "move";
  return null;
 },
 pointerDown(sx,sy){
  const hit=this.hitTest(sx,sy);
  if(!hit)return;
  this._drag={type:hit,sx,sy,rect:Object.assign({},this.rect)};
 },
 pointerMove(sx,sy){
  const CUR={nw:"nwse-resize",se:"nwse-resize",ne:"nesw-resize",sw:"nesw-resize",
   n:"ns-resize",s:"ns-resize",e:"ew-resize",w:"ew-resize",move:"move"};
  if(!this._drag){
   const hit=this.hitTest(sx,sy);
   $("gl").style.cursor=hit?(CUR[hit]||"default"):"";
   return;
  }
  const z=state.view.zoom;
  const dx=(sx-this._drag.sx)/z, dy=(sy-this._drag.sy)/z;
  const r0=this._drag.rect, r=this.rect, W=state.file.w, H=state.file.h, t=this._drag.type;
  if(t==="move"){
   r.x=clamp(r0.x+dx,0,W-r0.w); r.y=clamp(r0.y+dy,0,H-r0.h);
  }else{
   let x0=r0.x,y0=r0.y,x1=r0.x+r0.w,y1=r0.y+r0.h;
   if(t.includes("w"))x0=clamp(r0.x+dx,0,x1-16);
   if(t.includes("e"))x1=clamp(r0.x+r0.w+dx,x0+16,W);
   if(t.includes("n"))y0=clamp(r0.y+dy,0,y1-16);
   if(t.includes("s"))y1=clamp(r0.y+r0.h+dy,y0+16,H);
   if(this.ratio!=null){
    if(t==="e"||t==="w"){ y1=Math.min(H,y0+(x1-x0)/this.ratio); }
    else if(t==="n"||t==="s"){ x1=Math.min(W,x0+(y1-y0)*this.ratio); }
    else{ const w=x1-x0,h=w/this.ratio; if(t.includes("n"))y0=y1-h; else y1=y0+h; }
   }
   r.x=x0;r.y=y0;r.w=x1-x0;r.h=y1-y0;
  }
  this.syncInputs(); mark("overlay");
 },
 pointerUp(){ this._drag=null; }
};
/* トリミング確定時、矩形外のヒューノードは破棄・矩形内は平行移動(§F2 エッジケース) */
function transformHueNodesForCrop(offX,offY,w,h){
 const hw=state.hueWarp;
 hw.nodes=hw.nodes.filter(n=>n.imgX>=offX&&n.imgY>=offY&&n.imgX<offX+w&&n.imgY<offY+h)
  .map(n=>Object.assign({},n,{imgX:n.imgX-offX,imgY:n.imgY-offY}));
 if(hw.refId!==null&&!hw.nodes.some(n=>n.id===hw.refId)) hw.refId=hw.nodes.length?hw.nodes[0].id:null;
}
/* F14: マスクのジオメトリ(矩形/なげなわ)もトリミング後の新しい画像座標系へ平行移動する。
   F2のpick座標変換と同じ考え方(§F14エッジケース)。範囲チェックはせず単純平行移動のみ
   (矩形が全くはみ出す場合はマスク結果が空に近くなるだけで、壊れることはない)。 */
function transformMaskGeoForCrop(offX,offY,w,h){
 const g=state.mask.geo;
 if(g.rect){ g.rect=[g.rect[0]-offX,g.rect[1]-offY,g.rect[2],g.rect[3]]; }
 if(g.lasso){ g.lasso=g.lasso.map(([lx,ly])=>[lx-offX,ly-offY]); }
}
let _bakedCropKey="null";
let _bakedOrientKey='{"rot":0,"flipH":false,"flipV":false}';

/* ============================================================
   F14. 部分マスク適用 — インタラクティブなジオメトリ編集(矩形/なげなわ)。
   Cropと同じ設計(pointerイベントはInput.init()から委譲される専用ハンドラ側で処理し、
   overlayは毎フレームdrawOverlay()が再描画する)。座標は画像px単位で保持する。
   ============================================================ */
const MaskDraw={
 active:false, kind:"rect", _pts:null, _dragStart:null,
 start(kind){
  if(!state.file.has)return;
  this.active=true; this.kind=kind;
  this._pts=[]; this._dragStart=null;
  $("gl").style.cursor="crosshair";
  status_(t("status.maskDrawHint"),false,true);
  mark("overlay");
 },
 cancel(){
  if(!this.active)return;
  this.active=false; $("gl").style.cursor=""; mark("overlay");
 },
 pointerDown(sx,sy){
  const [ix,iy]=Input.scr2img(sx,sy);
  if(this.kind==="rect"){ this._dragStart=[ix,iy]; }
  else{ this._pts=[[ix,iy]]; }
 },
 pointerMove(sx,sy){
  if(!this._dragStart&&!this._pts)return;
  const [ix,iy]=Input.scr2img(sx,sy);
  if(this.kind==="rect"&&this._dragStart){
   const [x0,y0]=this._dragStart;
   state.mask.geo.rect=[Math.min(x0,ix),Math.min(y0,iy),Math.abs(ix-x0),Math.abs(iy-y0)];
   mark("overlay");
  }else if(this.kind==="lasso"&&this._pts){
   this._pts.push([ix,iy]);
   mark("overlay");
  }
 },
 pointerUp(){
  if(this.kind==="rect"&&this._dragStart&&state.mask.geo.rect){
   const [,,w,h]=state.mask.geo.rect;
   if(w>=4&&h>=4){ state.mask.geo.on=true; state.mask.geo.kind="rect"; this._finish(); }
  }else if(this.kind==="lasso"&&this._pts&&this._pts.length>=3){
   state.mask.geo.lasso=this._pts.slice();
   state.mask.geo.on=true; state.mask.geo.kind="lasso";
   this._finish();
  }
  this._dragStart=null; this._pts=null;
 },
 _finish(){
  this.active=false; $("gl").style.cursor="";
  state.mask.on=true; $("mkOn").checked=true;
  syncMaskShapeUI();
  if(typeof syncMaskSummary==="function")syncMaskSummary(); /* WS-16 S3-4 */
  rebuildMaskTexture(); Mirror.buildMask();
  mark("screen","overlay");
  status_(t("status.maskRangeSet"));
 }
};

/* ============================================================
   F1. ショートカット機能 — 中央集権テーブル+単一ディスパッチャ。
   既存の Ctrl+Z/Y(Undo側)・Space/Q(Input側)のリスナーはそのまま残し、
   このテーブルには登録しない(二重発火防止)。
   ============================================================ */
function isTextEntry(e){
 const ae=document.activeElement, tag=ae&&ae.tagName, typ=ae&&ae.type;
 return tag==="TEXTAREA"||tag==="SELECT"||(tag==="INPUT"&&!["range","checkbox","radio","button"].includes(typ));
}
function toggleSavePop(show){
 const el=$("savePop");
 if(show===undefined) el.classList.toggle("show"); else el.classList.toggle("show",show);
 $("expGamutWarn").style.display=(state.gamut.mode!=="off")?"":"none"; /* F12 */
}
function zoomAt(sx,sy,nz){
 if(!state.file.has)return;
 const oz=state.view.zoom;
 nz=clamp(nz,0.02,64);
 state.view.panX=sx-(sx-state.view.panX)*nz/oz;
 state.view.panY=sy-(sy-state.view.panY)*nz/oz;
 state.view.zoom=nz;
 mark("screen","overlay");
 Input.settle();
}
function zoomStep(d){
 const st=$("stage");
 zoomAt(st.clientWidth/2, st.clientHeight/2, state.view.zoom*Math.exp(d*0.25));
}
function zoomTo(z){
 const st=$("stage");
 zoomAt(st.clientWidth/2, st.clientHeight/2, z);
}
function setMode(m){
 if(m!=="pick"&&m!=="hand")return;
 state.view.mode=m; updateCursor();
}
function escTop(){
 if($("shortcutModal").classList.contains("show")){ toggleShortcutHelp(false); return; }
 if($("m3dModal").classList.contains("show")){ closeM3dPopup(); return; }
 if($("resetConfirm").classList.contains("show")){ closeResetConfirm(); return; }
 if($("hpPop").classList.contains("show")){ closeHelp(); return; }
 if($("savePop").classList.contains("show")){ toggleSavePop(false); return; }
 if(Crop.active){ Crop.cancel(); return; }
 if(MaskDraw.active){ MaskDraw.cancel(); return; }
 if(_maskPreviewOn){ setMaskPreview(false); return; } /* WS-06: マスク表示プレビューの解除(受け入れ基準「再クリック/Escで解除」) */
}
const SHORTCUTS=[
 // key: e.code / mod: "ctrl"|"shift"|"none" / when: 実行可能条件 / run: 実行
 // Undo(Ctrl+Z/Y)・Space(一時パン)・Q,\(元画像ホールド)は既存リスナー管轄のためここには登録しない
 // WS-03: descは直書き日本語からi18nキー参照(descKey)へ変更。表示側(injectShortcutList)でt()経由に解決する。
 {code:"KeyO",mod:"ctrl", descKey:"ui.shortcutOpenImage",              run:()=>$("fileInput").click()},
 {code:"KeyS",mod:"ctrl", descKey:"ui.shortcutOpenExport",     when:()=>state.file.has, run:()=>toggleSavePop(true)},
 {code:"KeyC",mod:"none", descKey:"ui.shortcutCropToggle",      when:()=>state.file.has, run:()=>Crop.toggle()},
 {code:"Enter",mod:"none",descKey:"ui.shortcutCropCommit",          when:()=>Crop.active, run:()=>Crop.commit()},
 {code:"Escape",mod:"none",descKey:"ui.shortcutEscape", run:()=>escTop()},
 {code:"KeyG",mod:"none", descKey:"ui.shortcutGuidesToggle",       when:()=>state.file.has, run:()=>Guides.toggle()},
 {code:"KeyH",mod:"none", descKey:"ui.shortcutHandMode",       run:()=>setMode("hand")},
 {code:"KeyI",mod:"none", descKey:"ui.shortcutPickMode",   run:()=>setMode("pick")}, // Adobe: I（GIMPのOと衝突する場合はAdobe側を優先）
 {code:"Equal",mod:"none",descKey:"ui.shortcutZoomIn",              when:()=>state.file.has, run:()=>zoomStep(+1)},
 {code:"Minus",mod:"none",descKey:"ui.shortcutZoomOut",            when:()=>state.file.has, run:()=>zoomStep(-1)},
 {code:"Digit0",mod:"ctrl",descKey:"ui.shortcutFitView",      when:()=>state.file.has, run:()=>{ fitView(); mark("screen","overlay"); }},
 {code:"Digit1",mod:"ctrl",descKey:"ui.shortcutZoom100",               when:()=>state.file.has, run:()=>zoomTo(1)},
 {code:"Slash",mod:"shift",descKey:"ui.shortcutListOpen",      run:()=>toggleShortcutHelp()}, // "?"
];
function _matchMod(mod,e){
 const ctrl=e.ctrlKey||e.metaKey;
 if(mod==="ctrl")return ctrl;
 if(mod==="shift")return e.shiftKey&&!ctrl;
 return !ctrl&&!e.shiftKey;
}
window.addEventListener("keydown",e=>{
 if(isTextEntry(e))return;
 for(const s of SHORTCUTS){
  if(s.code!==e.code)continue;
  if(!_matchMod(s.mod,e))continue;
  if(s.when&&!s.when())continue;
  e.preventDefault();
  s.run();
  return;
 }
});
function _keyLabel(code){
 const M={KeyO:"O",KeyS:"S",KeyC:"C",Enter:"Enter",Escape:"Esc",KeyG:"G",KeyH:"H",KeyI:"I",
  Equal:"+",Minus:"-",Digit0:"0",Digit1:"1",Slash:"/"};
 return M[code]||code;
}
function _modLabel(mod){ return mod==="ctrl"?"Ctrl+":(mod==="shift"?"Shift+":""); }
function injectShortcutList(){
 let rows=SHORTCUTS.map(s=>"<tr><td><kbd>"+_modLabel(s.mod)+_keyLabel(s.code)+"</kbd></td><td>"+t(s.descKey)+"</td></tr>").join("");
 rows+="<tr><td><kbd>Space</kbd></td><td>"+t("ui.shortcutSpacePan")+"</td></tr>"+
  "<tr><td><kbd>Q</kbd> / <kbd>\\</kbd></td><td>"+t("ui.shortcutQOriginal")+"</td></tr>"+
  "<tr><td><kbd>Ctrl+Z</kbd></td><td>"+t("ui.shortcutUndo")+"</td></tr>"+
  "<tr><td><kbd>Ctrl+Y</kbd> / <kbd>Ctrl+Shift+Z</kbd></td><td>"+t("ui.shortcutRedo")+"</td></tr>";
 $("shortcutModalBody").innerHTML="<table>"+rows+"</table>";
}
function toggleShortcutHelp(show){
 const el=$("shortcutModal");
 const willShow = show===undefined ? !el.classList.contains("show") : show;
 if(willShow && !el.dataset.built){ injectShortcutList(); el.dataset.built="1"; }
 el.classList.toggle("show",willShow);
}

