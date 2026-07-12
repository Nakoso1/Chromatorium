/* ============================================================
   配線 & 初期化
   ============================================================ */
function stepsFromP(p){ return clamp(Math.round(Math.pow(2,1+5*p)),2,64); }
const STEP_MAJORS=[2,4,8,16,32,64];
const STEP_THUMB_W=12; /* input[type=range]::-webkit-slider-thumb の width と同じ値(CSS側と定数を共有) */
/* 目盛りcanvasのCSS上のx座標(0..rectWidth基準)。drawStepTicks()とクリックスナップの両方で使う共通式 */
function _stepTickCssX(N,cssW){
 const p=Math.log2(N/2)/5;
 const pad=STEP_THUMB_W/2;
 return pad+p*(cssW-2*pad);
}
function drawStepTicks(){
 const cv=$("vStepsTicks"),cx=cv.getContext("2d");
 const dpr=window.devicePixelRatio||1;
 const rect=cv.getBoundingClientRect();
 const cssW=Math.max(1,rect.width||cv.clientWidth||360);
 const W=Math.round(cssW*dpr), H=Math.round(14*dpr);
 if(cv.width!==W||cv.height!==H){ cv.width=W; cv.height=H; } /* dpr>1でのにじみ防止 */
 cx.clearRect(0,0,cv.width,cv.height);
 cx.strokeStyle="#4a4e58"; cx.fillStyle="#9a9eab"; cx.font=(9*dpr)+"px sans-serif"; cx.textAlign="center";
 [2,3,4,6,8,12,16,24,32,48,64].forEach(N=>{
  const x=_stepTickCssX(N,cssW)*dpr;
  const major=STEP_MAJORS.includes(N);
  cx.beginPath(); cx.moveTo(x,0); cx.lineTo(x,major?7*dpr:4*dpr); cx.stroke();
  if(major)cx.fillText(String(N),x,13*dpr);
 });
}
let lastKm=null;
/* ============================================================
   §III-5 主要色抽出の刷新(面積支配→知覚的主要度)。
   クラスタリング自体はWorkerの既存k-means(数式不変・コマンド不変)の結果をそのまま使い、
   ここでは後段のスコアリングと貪欲選抜のみをクライアント側で行う。
   score = s^α × (C/Cref)^β × B(L) × U
   - s=シェア、C=OkLab相対彩度、Cref=K.cmax(L,h)(ガマット機能の既存量を応用)。
   - B(L)=極端明度の減衰(既存smoothを使用した滑らかな台形)。
   - U=独自性項。既選抜色との最小OkLab距離がΔE_ok閾値未満なら強く減点し、貪欲選抜で多様性を確保する。
   ============================================================ */
let lastKmRaw=null; /* Worker生結果(面積シェア順)。バランススライダの再描画のみで再クラスタリングしない */
/* 極端明度(L<0.15またはL>0.97)を緩やかに減点する台形窓。既存smooth()を流用。 */
function saliencyB(L){ return smooth(0,0.15,L)*(1-smooth(0.97,1,L)); }
const KM_UNIQ_DE=0.06; /* 独自性の閾値(ΔE_ok近似)。これ未満は色相の重複とみなし強く減点する */
/* t(0..1: 面積重視↔鮮やかさ重視)からα,βを決める。実画像でのチューニングを経ていない
   仕様書提示の初期値をそのまま採用(§III-5根拠: α=1-0.7t, β=0.4+1.6t 程度から開始)。
   将来、実画像での見え方確認により微調整の余地がある旨をここに明記しておく。 */
function scoreSaliencyPalette(res,t){
 const alpha=1-0.7*t, beta=0.4+1.6*t;
 const items=res.map(c=>{
  const ok=K.srgb2ok(c.srgb); // [L,a,b]
  const L=ok[0],a=ok[1],b=ok[2];
  const C=Math.hypot(a,b), h=mod360(Math.atan2(b,a)*R2D);
  const cref=Math.max(K.cmax(L,h),1e-5);
  const relC=C/cref;
  const base=Math.pow(Math.max(c.share,1e-6),alpha)*Math.pow(Math.max(relC,1e-6),beta)*saliencyB(L);
  return {srgb:c.srgb,share:c.share,relC,L,a,b,base};
 });
 const pool=items.slice(), selected=[];
 while(pool.length){
  let bestIdx=0, bestScore=-1;
  pool.forEach((it,idx)=>{
   let minDE=Infinity;
   selected.forEach(s=>{ minDE=Math.min(minDE,Math.hypot(it.L-s.L,it.a-s.a,it.b-s.b)); });
   const U=(minDE<KM_UNIQ_DE)?0.12:1; /* 完全排除はせず強い減点に留める(統計的安定化) */
   const sc=it.base*U;
   if(sc>bestScore){ bestScore=sc; bestIdx=idx; }
  });
  selected.push(pool[bestIdx]);
  pool.splice(bestIdx,1);
 }
 return selected;
}
function kmBalanceLabel(bal){
 if(bal<0.15)return t("ui.kmeansBalanceArea"); if(bal>0.85)return t("ui.kmeansBalanceVivid"); return t("ui.kmeansBalanceMid");
}
/* lastKmRaw(Worker生結果)をkmBalanceで並べ替えて描画する。パレット送信用のlastKmもここで更新する。
   再クラスタリングは行わないため、スライダ操作に対して即時(体感遅延なし)に追従する。 */
function renderKmOut(){
 if(!lastKmRaw){ $("kmOut").innerHTML=""; $("kmToPal").disabled=true; return; }
 const t=+$("kmBalance").value;
 const ranked=scoreSaliencyPalette(lastKmRaw,t);
 lastKm=ranked;
 $("kmOut").innerHTML=ranked.map(r=>
  "<div class='schsw' title='シェア "+fmt(r.share*100,1)+"%　相対彩度 "+fmt(r.relC*100,0)+"%'>"+
  "<span class='sw' style='background:"+K.hex(r.srgb)+"'></span>"+
  "<span>"+K.hex(r.srgb)+"<br>"+fmt(r.share*100)+"%</span></div>").join("");
 $("kmToPal").disabled=false;
}
/* WS-09: タブ切替の共通処理。#tabsボタンのクリックハンドラ本体と同一の処理を関数化したもの
   (見た目・挙動は従来と完全に同一)。tabNameが不正/該当ボタンが無い場合は該当ボタンの
   class同期のみスキップされるが、タブページ自体はid一致で切り替わる。 */
function switchTab(tabName){
 if(tabName!=="value"&&_maskPreviewOn)setMaskPreview(false); /* WS-06: タブ移動時にマスク表示プレビューを自動OFF */
 state.ui.tab=tabName;
 document.querySelectorAll("#tabs button").forEach(x=>x.classList.toggle("on",x.dataset.tab===tabName));
 document.querySelectorAll(".tabpage").forEach(p=>p.classList.toggle("on",p.id==="tab-"+state.ui.tab));
 refreshDock(); drawOverlay(); drawWheels();
 if(state.ui.tab==="analyze"){ drawHist(); drawCVD(); refreshMunsellUI(); }
 if(state.ui.tab==="gamut"){ drawGamutWheel(); } /* F12 */
}
function wireAll(){
 /* --- タブ --- */
 /* WS-09: 元はクリックハンドラ内にインライン実装されていたタブ切替処理を関数化。
    「混色スケールのレシピ転記」時にJS側からタブを切り替える必要が生じたため、クリック
    ハンドラとJS呼び出しの両方から同じ処理を共有する(挙動はビット単位で従来と同一)。 */
 document.querySelectorAll("#tabs button").forEach(b=>{
  b.addEventListener("click",()=>{ switchTab(b.dataset.tab); });
 });
 /* --- 言語トグル(§VIII-2) --- */
 $("btnLang").addEventListener("click",()=>{
  applyLang(state.ui.lang==="ja"?"en":"ja");
 });
 /* --- ヘッダー --- */
 $("btnOpen").addEventListener("click",()=>$("fileInput").click());
 $("fileInput").addEventListener("change",e=>{ if(e.target.files[0])openFile(e.target.files[0]); e.target.value=""; });
 $("btnSave").addEventListener("click",e=>{ e.stopPropagation(); toggleSavePop(); });
 $("savePop").addEventListener("click",e=>e.stopPropagation());
 document.addEventListener("click",()=>$("savePop").classList.remove("show"));
 $("expGo").addEventListener("click",()=>exportImage());
 /* §II-5/6 */
 $("btnRotate").addEventListener("click",orientRotate);
 $("btnFlip").addEventListener("click",e=>{ e.stopPropagation(); toggleFlipPop(); });
 $("flipPop").addEventListener("click",e=>e.stopPropagation());
 document.addEventListener("click",()=>$("flipPop").classList.remove("show"));
 $("flipHBtn").addEventListener("click",()=>orientFlip("h"));
 $("flipVBtn").addEventListener("click",()=>orientFlip("v"));
 const wireSlider=(id,vid,setter,fmt_,marks,extra)=>{
  const el=$(id);
  el.addEventListener("input",()=>{
   const v=+el.value; setter(v);
   $(vid).textContent=fmt_(v);
   if(marks)mark(...marks);
   scheduleAnalysis();
   if(extra)extra(v);
  });
 };
 wireSlider("slBright","vBright",v=>state.global.brightness=v,v=>fmt(v,2),M_B);
 $("slBright").addEventListener("dblclick",()=>{ $("slBright").value=0; state.global.brightness=0; $("vBright").textContent="0"; mark(...M_B); scheduleAnalysis(); });
 wireSlider("slSat","vSat",v=>state.global.saturation=v,v=>fmt(v,2),M_B);
 $("slSat").addEventListener("dblclick",()=>{ $("slSat").value=0; state.global.saturation=0; $("vSat").textContent="0"; mark(...M_B); scheduleAnalysis(); });
 $("modePick").addEventListener("click",()=>{ state.view.mode="pick"; updateCursor(); });
 $("modeHand").addEventListener("click",()=>{ state.view.mode="hand"; updateCursor(); });
 $("slRadius").addEventListener("input",()=>{
  state.global.pickRadius=+$("slRadius").value;
  $("vRadius").textContent=$("slRadius").value;
  mark("overlay");
 });
 /* §II-1: 「元画像」はpointerdown/up押している間だけ→クリックでの固定/解除トグルへ変更。
    Qキー/\キーの momentary挙動(L3103近傍)はここでは一切触れず既存のまま残す(momentaryとlatchのOR=isHold())。 */
 $("btnHold").addEventListener("click",()=>{
  state.view.holdLatch=!state.view.holdLatch;
  $("btnHold").classList.toggle("on",state.view.holdLatch);
  mark("screen","panels"); drawHist(); refreshNumeric(); drawCVD();
  status_(state.view.holdLatch?t("status.originalLatchOn"):t("status.originalLatchOff"));
 });
 $("btnSplit").addEventListener("click",()=>{
  state.view.split=!state.view.split;
  if(!state.view.split){
   state.view.splitX=0.5; /* §II-2: オフへ切り替えた瞬間に位置を中央へリセット。オン中の操作には影響しない */
  }else if(state.file.has){
   /* WS-02: オンにした瞬間、分割線を「画面の中心」ではなく「画像の水平中心」へキャリブレーション
      する。座標系はInput.init()内のドラッグ処理(splitX=clamp(sx/cv.clientWidth,...))と同一
      (#gl要素のCSS px基準、#glは#stageにinset:0で重なるためclientWidthは共通)。img2scrと同じ
      写像 sx = ix*zoom+panX を画像の水平中心ix=state.file.w/2 に適用し、キャンバス幅で正規化する。 */
   const cv=$("gl");
   const cx=state.file.w/2*state.view.zoom+state.view.panX;
   state.view.splitX=clamp(cx/cv.clientWidth,0.02,0.98);
  }
  $("btnSplit").classList.toggle("on",state.view.split);
  mark("screen");
 });
 /* --- 解析タブ --- */
 $("nvRGBCopy").addEventListener("click",()=>{
  const pk=state.analysis.pick;
  if(!pk){ status_(t("status.pickColorFirst")); return; }
  copyHexToClipboard(K.hex(isHold()?pk.orig:pk.edited));
 });
 $("wheelSel").addEventListener("change",()=>{
  state.analysis.wheelType=$("wheelSel").value;
  /* WS-16 S2: 環の種類を切り替えたら、前の環で捕まえたプローブ色は破棄する
     (別の環に前の環の色を重ねて表示すると混乱するため)。 */
  state.analysis._wheelProbe.active=false;
  drawWheels();
 });
 /* WS-04: 表示モードを最上部の明確な2択(単体表示/3種同時比較)へ変更。
    3種同時比較モードでは常に3環が横並び同期表示され(旧「詳細展開→横並び/重ね合わせ排他選択」
    という2段階の導線を廃止)、重ね合わせは同モード内の任意サブビューとして共存する。 */
 $("wheelModeSingle").addEventListener("click",()=>{
  state.analysis.compareMode=false;
  $("wheelModeSingle").classList.add("on"); $("wheelModeCompare").classList.remove("on");
  $("wheelSingleModeWrap").style.display=""; $("wheelCompareModeWrap").style.display="none";
  drawWheels();
 });
 $("wheelModeCompare").addEventListener("click",()=>{
  state.analysis.compareMode=true;
  $("wheelModeCompare").classList.add("on"); $("wheelModeSingle").classList.remove("on");
  $("wheelSingleModeWrap").style.display="none"; $("wheelCompareModeWrap").style.display="";
  drawWheels();
 });
 $("wheelAnchorTicks").addEventListener("change",()=>{
  state.analysis.anchorTicks=$("wheelAnchorTicks").checked;
  drawWheels();
 });
 $("wheelShowOverlay").addEventListener("change",()=>{
  state.analysis.showOverlay=$("wheelShowOverlay").checked;
  $("wheelOverWrap").style.display=state.analysis.showOverlay?"":"none";
  drawWheels();
 });
 /* §III-2b/c: 3環(wT0=rgb/wT1=ryb/wT2=munsell)にドラッグ仮選択色プローブを取り付ける */
 WheelProbeUI.attach($("wT0"),"rgb");
 WheelProbeUI.attach($("wT1"),"ryb");
 WheelProbeUI.attach($("wT2"),"munsell");
 /* WS-16 S2-2: 単体表示の環にも同じプローブを取り付ける。環種別はプルダウン(wheelSel)で
    動的に変わるため、値ではなく関数を渡す(attach側でtypeOrFnとして解釈される)。 */
 WheelProbeUI.attach($("wheelSingle"), ()=>state.analysis.wheelType);
 $("wpCopyHex").addEventListener("click",()=>{
  const probe=state.analysis._wheelProbe;
  if(!probe||!probe.active||!probe.srgb)return;
  copyHexToClipboard(K.hex(probe.srgb));
 });
 $("wpCopyAll").addEventListener("click",()=>{
  const probe=state.analysis._wheelProbe;
  if(!probe||!probe.active||!probe.srgb)return;
  const srgb=probe.srgb;
  const hex=K.hex(srgb);
  const rgb255=srgb.map(v=>Math.round(clamp(v,0,1)*255));
  const hsv=K.rgb2hsv(srgb);
  const lch=K.okLCh(K.srgb2ok(srgb));
  const hvc=K.srgb2HVC(srgb);
  /* WS-16: ユーザー要求「その数値またはカラーコードはコピー可能」を満たすため、
     数値一式を1行のテキストとして copyHexToClipboard() へ渡す(同関数は任意文字列を
     コピーできる汎用実装のため、新規のコピー処理を実装しない=既存実装の再利用)。 */
  const line=hex+" / RGB("+rgb255.join(",")+") / HSV("+Math.round(hsv[0])+","+Math.round(hsv[1]*100)+"%,"+Math.round(hsv[2]*100)+"%) / OkLCh("+fmt(lch[0],2)+","+fmt(lch[1],3)+","+fmt(lch[2],0)+") / Munsell "+K.mhLabel(hvc.H)+" "+fmt(hvc.V,1)+"/"+fmt(hvc.C,1);
  copyHexToClipboard(line);
 });
 $("wheelRotReset").addEventListener("click",()=>{
  _wheelRotOff={rgb:0,ryb:0,munsell:0};
  drawWheels();
  status_(t("wheel.rotResetDone"));
 });
 $("histLum").addEventListener("click",()=>{ state.analysis.histMode="lum";
  $("histLum").classList.add("on");$("histRGB").classList.remove("on");
  $("histChRow").style.display="none"; /* §III-4: 輝度モードではチャンネルチップを隠す */
  drawHist(); });
 $("histRGB").addEventListener("click",()=>{ state.analysis.histMode="rgb";
  $("histRGB").classList.add("on");$("histLum").classList.remove("on");
  $("histChRow").style.display=""; syncHistChUI(); /* §III-4 */
  drawHist(); });
 /* §III-4: R/G/Bチップ。オフのチャンネルは非表示、最後にオンにしたチャンネルが最前面(histChFront)。
    全オフは禁止し、残り1つになったチップはdisabled表示にして誤操作を防ぐ。 */
 ["r","g","b"].forEach(chId=>{
  $("histCh"+chId.toUpperCase()).addEventListener("click",()=>{
   const cur=state.analysis.histCh;
   const onCount=(cur.r?1:0)+(cur.g?1:0)+(cur.b?1:0);
   if(cur[chId]&&onCount<=1){ status_(t("hist.channelLastOn")); return; }
   cur[chId]=!cur[chId];
   if(cur[chId]) state.analysis.histChFront=chId;
   else if(state.analysis.histChFront===chId){
    state.analysis.histChFront=["r","g","b"].find(c=>cur[c])||null;
   }
   syncHistChUI(); saveHistChCfg(); drawHist();
  });
 });
 $("cvdSel").addEventListener("change",()=>{ state.analysis.cvd=$("cvdSel").value; drawCVD(); });
 /* WS-05: HSB⇔RGB比較ウィジェット。どのスライダーを動かしても他方モデルへ即時反映する。
    state非接触の純UIのため、mark()/scheduleAnalysis()等の編集パイプラインは一切呼ばない。 */
 [["cmpH","H"],["cmpS","S"],["cmpB","B"]].forEach(([id,label])=>{
  $(id).addEventListener("input",()=>cmpUpdateAll("hsb",label));
 });
 [["cmpR","R"],["cmpG","G"],["cmpBl","B"]].forEach(([id,label])=>{
  $(id).addEventListener("input",()=>cmpUpdateAll("rgb",label));
 });
 $("cmpFromPick").addEventListener("click",()=>{
  const pk=state.analysis.pick;
  if(!pk){ status_(t("status.pickColorFirst")); return; }
  const c=isHold()?pk.orig:pk.edited;
  $("cmpR").value=Math.round(c[0]*255); $("cmpG").value=Math.round(c[1]*255); $("cmpBl").value=Math.round(c[2]*255);
  cmpUpdateAll("rgb",null);
 });
 $("kmK").addEventListener("input",()=>$("vkmK").textContent=$("kmK").value);
 $("kmBalance").addEventListener("input",()=>{
  $("vkmBalance").textContent=kmBalanceLabel(+$("kmBalance").value);
  renderKmOut(); /* §III-5: 再クラスタリングせず、既存結果の並べ替えのみ(即時) */
 });
 $("kmGo").addEventListener("click",async()=>{
  if(!Mirror.ready){ status_(t("status.loadImageFirst")); return; }
  $("kmOut").innerHTML="<span class='hint'>"+t("status.extractingColors")+"</span>";
  try{
   const buf=Mirror.out.slice().buffer;
   const res=await W.call("kmeans",{buf,w:Mirror.w,h:Mirror.h,k:+$("kmK").value},[buf]);
   lastKmRaw=res; /* Worker生結果(面積シェア順)。数式・コマンドとも無変更(§III-5) */
   renderKmOut();
  }catch(e){ $("kmOut").innerHTML="<span class='hint warn'>"+t("status.extractColorsFailed",{msg:e.message})+"</span>"; }
 });
 $("kmToPal").addEventListener("click",()=>{
  if(!lastKm)return;
  state.scheme.curPal.colors=lastKm.map(r=>K.hex(r.srgb));
  renderPalCur(); persistSoon();
  status_(t("status.extractedToCurrentPalette"));
 });
 /* --- マンセル --- */
 $("mH").addEventListener("input",()=>{ state.munsell.H=+$("mH").value; refreshMunsellUI(); renderM3d(); drawWheels(); });
 $("mV").addEventListener("input",()=>{ state.munsell.V=+$("mV").value; refreshMunsellUI(); renderM3d(); });
 $("mC").addEventListener("input",()=>{
  const m=state.munsell;
  if(m.mode==="pct")m.pct=+$("mC").value; else m.C=+$("mC").value;
  refreshMunsellUI(); renderM3d();
 });
 $("mCMode").addEventListener("click",()=>{
  const m=state.munsell;
  const cm=K.cmaxHV(m.H,m.V);
  if(m.mode==="abs"){ m.mode="pct"; m.pct=cm>0?clamp(m.C/cm*100,0,100):0; $("mCMode").textContent=t("ui.munsellModePct"); }
  else{ m.mode="abs"; m.C=cm*m.pct/100; $("mCMode").textContent=t("ui.munsellModeAbs"); }
  refreshMunsellUI(); renderM3d();
 });
 $("m3dOpen").addEventListener("click",openM3d);
 $("m3dDensity").addEventListener("input",()=>{
  state.munsell.density=+$("m3dDensity").value;
  $("vm3dDensity").textContent=fmt(state.munsell.density,2);
  renderM3d();
 });
 $("m3dReset").addEventListener("click",resetM3d);
 $("m3dPopup").addEventListener("click",toggleM3dPopup);
 $("m3dModalClose").addEventListener("click",closeM3dPopup);
 $("m3dModal").addEventListener("click",e=>{ if(e.target.id==="m3dModal")closeM3dPopup(); });
 document.addEventListener("keydown",e=>{ if(e.key==="Escape"&&_m3dPop.open)closeM3dPopup(); });
 /* --- 明度タブ --- */
 $("vGray").addEventListener("change",()=>{ state.value.gray=$("vGray").checked; $("vGrayMirror").checked=$("vGray").checked; mark(...M_B); scheduleAnalysis(); });
 wireSlider("vCmp","vvCmp",v=>state.value.cmp=v,v=>Math.round(v*100)+"%",M_B);
 wireSlider("vPivot","vvPivot",v=>state.value.pivot=v,v=>fmt(v,2),M_B);
 /* F7: 明瞭度はPassAとPassBの間に挿入されるため、既存のPassB系スライダーと同じM_Bで
    十分(runWarp自体を再実行する必要はない。§F7実装接続点参照) */
 wireSlider("clAmt","vclAmt",v=>state.clarity.amt=v,v=>fmt(v,2),M_B);
 $("clAmt").addEventListener("dblclick",()=>{ $("clAmt").value=0; state.clarity.amt=0; $("vclAmt").textContent="0.00"; mark(...M_B); scheduleAnalysis(); });
 wireSlider("clRad","vclRad",v=>state.clarity.rad=v,v=>fmt(v,2),M_B);

 /* --- F14: 部分適用マスク --- */
 const maskRebuild=scheduleMaskRebuild; /* §IV-1: 全マスクスライダの実体は同じ関数(rAF+150ms確定)を指す */
 const maskRetarget=()=>{ mark(...M_A); scheduleAnalysis(); }; /* 対象チェックのみ変更(マスク場自体は不変) */
 /* WS-16 S3-4(Sonnet実装): 要約行・クイックプリセットの点灯状態を、対応する値が変わる
    すべての操作から軽量に更新する(syncMaskUI全体を呼ぶとスライダーのDOM値を毎回
    再代入することになるため、ここでは表示専用の2関数だけを呼ぶ)。 */
 const maskUIRefreshLight=()=>{ syncMaskSummary(); syncMaskQuickUI(); };
 $("mkOn").addEventListener("change",()=>{
  state.mask.on=$("mkOn").checked; maskRebuild();
  if(!state.mask.on)setMaskPreview(false); /* WS-06: マスク無効化時はプレビュー表示も自動でOFF */
 });
 $("mkInvert").addEventListener("change",()=>{ state.mask.invert=$("mkInvert").checked; maskRebuild(); maskUIRefreshLight(); });
 $("mkFeather").addEventListener("input",()=>{
  state.mask.feather=+$("mkFeather").value; $("vmkFeather").textContent=fmt(state.mask.feather,3); maskRebuild();
 });
 $("mkLumOn").addEventListener("change",()=>{ state.mask.lum.on=$("mkLumOn").checked; maskRebuild(); maskUIRefreshLight(); });
 $("mkLumLo").addEventListener("input",()=>{
  state.mask.lum.lo=Math.min(+$("mkLumLo").value,state.mask.lum.hi-0.005);
  $("vmkLumLo").textContent=fmt(state.mask.lum.lo,2); maskRebuild(); maskUIRefreshLight();
 });
 $("mkLumHi").addEventListener("input",()=>{
  state.mask.lum.hi=Math.max(+$("mkLumHi").value,state.mask.lum.lo+0.005);
  $("vmkLumHi").textContent=fmt(state.mask.lum.hi,2); maskRebuild(); maskUIRefreshLight();
 });
 $("mkLumSoft").addEventListener("input",()=>{ state.mask.lum.soft=+$("mkLumSoft").value; $("vmkLumSoft").textContent=fmt(state.mask.lum.soft,3); maskRebuild(); });
 $("mkHueOn").addEventListener("change",()=>{ state.mask.hue.on=$("mkHueOn").checked; maskRebuild(); maskUIRefreshLight(); });
 $("mkHueCenter").addEventListener("input",()=>{ state.mask.hue.center=+$("mkHueCenter").value; $("vmkHueCenter").textContent=Math.round(state.mask.hue.center)+"°"; maskRebuild(); maskUIRefreshLight(); });
 $("mkHueWidth").addEventListener("input",()=>{ state.mask.hue.width=+$("mkHueWidth").value; $("vmkHueWidth").textContent=Math.round(state.mask.hue.width)+"°"; maskRebuild(); maskUIRefreshLight(); });
 $("mkHueSoft").addEventListener("input",()=>{ state.mask.hue.soft=+$("mkHueSoft").value; $("vmkHueSoft").textContent=Math.round(state.mask.hue.soft)+"°"; maskRebuild(); });
 $("mkLumPick").addEventListener("click",maskPickLum);
 $("mkHuePick").addEventListener("click",maskPickHue);
 /* WS-06: クイックプリセット(シャドウ/中間調/ハイライト)。「①どこに効かせるか」を1クリックで
    設定できるようにする。境界値は代表画像での目視確認を経て決定(理由はstate.mask.lum定義
    近傍のコメントを参照)。マスク自体が無効ならここで有効化する。 */
 const mkQuickLum=(lo,hi)=>{
  state.mask.on=true; $("mkOn").checked=true;
  state.mask.lum.on=true; state.mask.lum.lo=lo; state.mask.lum.hi=hi; state.mask.lum.soft=0.08;
  syncMaskUI(); maskRebuild();
 };
 $("mkQuickShadow").addEventListener("click",()=>mkQuickLum(0,0.35));
 $("mkQuickMid").addEventListener("click",()=>mkQuickLum(0.30,0.70));
 $("mkQuickHigh").addEventListener("click",()=>mkQuickLum(0.65,1.0));
 /* Fix2(c)(Sonnet実装): 「矩形で指定」1クリックで即座に描画を開始する(旧: 形状を選ぶ→
    別の「範囲を描く」ボタンを押す→キャンバス上でドラッグする、という3段階の間接操作が
    「そもそも矩形の選択ができない」という報告の原因だった)。押すたびに常に新規描画を
    開始する(既存範囲があれば上書き。旧実装の「描き直す」に相当する動作を1ボタンに統合)。 */
 $("mkShapeRect").addEventListener("click",()=>{
  if(!state.file.has){ status_(t("status.loadImageFirst")); return; }
  state.mask.geo.kind="rect";
  MaskDraw.start("rect");
 });
 $("mkShapeClear").addEventListener("click",()=>{
  MaskDraw.cancel();
  state.mask.geo.on=false; state.mask.geo.kind="none"; state.mask.geo.rect=null; state.mask.geo.lasso=null;
  syncMaskShapeUI(); maskRebuild(); maskUIRefreshLight();
  status_(t("status.maskCleared"));
 });
 ["mkTgtWarp","mkTgtNight","mkTgtBs","mkTgtCmp","mkTgtLev","mkTgtPost"].forEach(id=>{
  const key={mkTgtWarp:"warp",mkTgtNight:"night",mkTgtBs:"bs",mkTgtCmp:"cmp",mkTgtLev:"lev",mkTgtPost:"post"}[id];
  $(id).addEventListener("change",()=>{ state.mask.targets[key]=$(id).checked; maskRetarget(); });
 });
 /* WS-06: 「押している間だけ表示」(pointerdown/up)はマウスを持続的にクリックさせ続ける操作で
    不快だったため、クリックでON/OFFが切り替わるトグルへ変更する(受け入れ基準3)。
    setMaskPreview()はmkOn変更時・タブ離脱時・画像差し替え時の自動OFFからも共有で呼ぶ。 */
 $("mkShowMask").addEventListener("click",()=>setMaskPreview(!_maskPreviewOn));

 $("vPostOn").addEventListener("change",()=>{ state.value.postOn=$("vPostOn").checked; mark(...M_B); scheduleAnalysis(); });
 $("vDither").addEventListener("change",()=>{ state.value.dither=$("vDither").checked; mark(...M_B); scheduleAnalysis(); });
 /* WS-07: グレースケール確認チェックはvGrayの「ミラー」。単一の真実(state.value.gray)は
    vGray側のまま保ち、双方向に表示だけ同期する(片方を操作すればもう片方の見た目も追従する)。 */
 $("vGrayMirror").addEventListener("change",()=>{
  $("vGray").checked=$("vGrayMirror").checked;
  $("vGray").dispatchEvent(new Event("change",{bubbles:true}));
 });
 /* WS-07: ノータン(明暗の単純化)学習用プリセット。階調制限を有効化しつつ目的の段階数へ
    スナップする。グレースケール未使用時は1度だけ併用を提案する(毎回出すと煩わしいため)。 */
 let _ws07GrayHintShown=false;
 const stepsPreset=N=>{
  if(!$("vPostOn").checked){ $("vPostOn").checked=true; $("vPostOn").dispatchEvent(new Event("change",{bubbles:true})); }
  $("vSteps").value=Math.log2(N/2)/5;
  $("vSteps").dispatchEvent(new Event("input",{bubbles:true}));
  if(!state.value.gray && !_ws07GrayHintShown){ _ws07GrayHintShown=true; status_(t("status.stepsGraySuggest")); }
 };
 $("stepsPreset2").addEventListener("click",()=>stepsPreset(2));
 $("stepsPreset3").addEventListener("click",()=>stepsPreset(3));
 $("stepsPreset4").addEventListener("click",()=>stepsPreset(4));
 $("vSteps").addEventListener("input",()=>{
  const N=stepsFromP(+$("vSteps").value);
  state.value.steps=N; $("vvSteps").textContent=String(N);
  mark(...M_B); scheduleAnalysis();
 });
 /* F8: 目盛りクリックで最寄りの主要目盛り(2/4/8/16/32/64)へスナップ。
    既存のvSteps inputイベント配線をdispatchEventで発火させるだけで、他は一切変更しない。 */
 $("vStepsTicks").addEventListener("click",e=>{
  const rect=$("vStepsTicks").getBoundingClientRect();
  const cssX=e.clientX-rect.left, cssW=rect.width||360;
  let best=STEP_MAJORS[0],bd=1e9;
  STEP_MAJORS.forEach(N=>{ const d=Math.abs(cssX-_stepTickCssX(N,cssW)); if(d<bd){bd=d;best=N;} });
  $("vSteps").value=Math.log2(best/2)/5;
  $("vSteps").dispatchEvent(new Event("input",{bubbles:true}));
 });
 new ResizeObserver(()=>drawStepTicks()).observe($("vStepsWrap"));
 const wireLev=(id,vid,key)=>{
  $(id).addEventListener("input",()=>{
   let v=+$(id).value;
   const L=state.value.lev;
   if(key==="bi")v=Math.min(v,L.wi-0.02);
   if(key==="wi")v=Math.max(v,L.bi+0.02);
   L[key]=v; $(id).value=v; $(vid).textContent=fmt(v,2);
   mark(...M_B); scheduleAnalysis();
  });
 };
 wireLev("lBi","vlBi","bi"); wireLev("lWi","vlWi","wi");
 wireLev("lBo","vlBo","bo"); wireLev("lWo","vlWo","wo");
 $("diagGo").addEventListener("click",()=>{ drawDiagnostics(); status_(t("status.diagnosticsUpdated")); });
 /* --- 混色タブ 4.1 --- */
 $("mxOn").addEventListener("change",()=>{ state.mixing.on=$("mxOn").checked; mark("c","blur","screen"); });
 const setSub=(sm)=>{
  state.mixing.subMode=sm;
  $("mxModeA").classList.toggle("on",sm==="juxta");
  $("mxModeB").classList.toggle("on",sm==="layer");
  $("mxRowsA").style.display=sm==="juxta"?"":"none";
  $("mxRowsB").style.display=sm==="layer"?"":"none";
  mark("c","blur","screen");
 };
 $("mxModeA").addEventListener("click",()=>setSub("juxta"));
 $("mxModeB").addEventListener("click",()=>setSub("layer"));
 const setSys=(sys)=>{
  state.mixing.system=sys;
  $("sysCMYK").classList.toggle("on",sys==="CMYK");
  $("sysRGB").classList.toggle("on",sys==="RGB");
  $("sysCUSTOM").classList.toggle("on",sys==="CUSTOM");
  buildPigRows(); requestPigLut(); updateCmpPanel();
  mark("c","blur","screen"); persistSoon();
 };
 $("sysCMYK").addEventListener("click",()=>setSys("CMYK"));
 $("sysRGB").addEventListener("click",()=>setSys("RGB"));
 $("sysCUSTOM").addEventListener("click",()=>setSys("CUSTOM"));
 $("pigAddSlot").addEventListener("click",()=>{
  state.mixing.customCount=Math.min(7,(state.mixing.customCount||1)+1);
  buildPigRows(); requestPigLut(); updateCmpPanel(); persistSoon();
 });
 $("pigDelSlot").addEventListener("click",()=>{
  state.mixing.customCount=Math.max(1,(state.mixing.customCount||1)-1);
  buildPigRows(); requestPigLut(); updateCmpPanel(); persistSoon();
 });
 $("presetMonet").addEventListener("click",()=>{
  /* モネが1886年以降に使ったとされる黒を含まないパレット(6色)を適用 */
  Object.assign(state.mixing.assign,{
   P1:"titanium_white",P2:"cad_yellow",P3:"vermilion",P4:"madder_red",P5:"cobalt_blue",P6:"emerald_green"
  });
  state.mixing.customCount=6;
  setSys("CUSTOM");
  status_(t("status.impressionistApplied"));
 });
 $("mxIdeal").addEventListener("change",()=>{
  state.mixing.ideal=$("mxIdeal").checked;
  requestPigLut(); mark("c","blur","screen");
 });
 $("presetSave").addEventListener("click",presetSave);
 $("presetLoad").addEventListener("click",presetLoad);
 $("presetDel").addEventListener("click",presetDel);
 $("cpAdd").addEventListener("click",addCustomPigment);
 wireSlider("mxDot","vmxDot",v=>state.mixing.dotR=v,v=>fmt(v,1)+"px",["c","blur","screen"]);
 $("stDot").addEventListener("click",()=>{ state.mixing.style="dot";
  $("stDot").classList.add("on");$("stHatch").classList.remove("on"); mark("c","blur","screen"); });
 $("stHatch").addEventListener("click",()=>{ state.mixing.style="hatch";
  $("stHatch").classList.add("on");$("stDot").classList.remove("on"); mark("c","blur","screen"); });
 wireSlider("mxDist","vmxDist",v=>state.mixing.dist=v,v=>fmt(v,2),["blur","screen"]);
 $("mxKmCmp").addEventListener("change",()=>{ state.mixing.kmCmp=+$("mxKmCmp").value; mark("c","blur","screen"); });
 /* --- 混色タブ 4.2 --- */
 $("hueOn").addEventListener("change",()=>{
  state.hueWarp.enabled=$("hueOn").checked;
  mark(...M_A,"overlay","panels"); refreshHueUI(); scheduleAnalysis();
 });
 $("hueClear").addEventListener("click",()=>{
  const hw=state.hueWarp;
  hw.nodes=[]; hw.refId=null; hw.refTarget=null;
  hueChanged();
 });
 const setHwMode=m=>{
  const hw=state.hueWarp;
  if(hw.mode===m)return;
  hw.mode=m; syncModeUI();
  mark(...M_A,"overlay","panels"); refreshHueUI(); scheduleAnalysis();
 };
 $("hwModeRef").addEventListener("click",()=>setHwMode("ref"));
 $("hwModeLight").addEventListener("click",()=>setHwMode("light"));
 const lightParam=(id,idx,vid)=>{
  $(id).addEventListener("input",()=>{
   const v=+$(id).value; state.hueWarp.light[idx]=v; $(vid).textContent=fmt(v,3);
   hueActivate();
   mark(...M_A,"panels"); refreshDock(); drawWheels(); scheduleAnalysis();
  });
 };
 lightParam("lightR",0,"vlightR");
 lightParam("lightG",1,"vlightG");
 lightParam("lightB",2,"vlightB");
 $("hueAdapt").addEventListener("change",()=>{
  state.hueWarp.adapt=$("hueAdapt").checked;
  mark(...M_A,"panels"); refreshDock(); drawWheels(); scheduleAnalysis();
 });
 const hueParam=(id,vid,setter,f)=>{
  $(id).addEventListener("input",()=>{
   const v=+$(id).value; setter(v); $(vid).textContent=f(v);
   mark(...M_A,"panels"); refreshDock(); drawWheels(); scheduleAnalysis();
  });
 };
 hueParam("hueDensity","vhueDensity",v=>state.hueWarp.density=v,v=>Math.round(v*100)+"%");
 HueWheelUI.attach($("hueWheel"));
 /* --- プルキンエ現象(暗所視) --- */
 $("nightOn").addEventListener("change",()=>{
  state.night.on=$("nightOn").checked;
  mark(...M_A,"overlay","panels"); refreshDock(); drawWheels(); scheduleAnalysis();
 });
 $("nightLv").addEventListener("input",()=>{
  const v=+$("nightLv").value; state.night.level=v; $("vnightLv").textContent=Math.round(v*100)+"%";
  if(v>0&&!state.night.on){ state.night.on=true; $("nightOn").checked=true; }
  mark(...M_A,"overlay","panels"); refreshDock(); drawWheels(); scheduleAnalysis();
 });
 syncModeUI(); syncLightSliders();
 $("rcGo").addEventListener("click",runRecipe);
 /* WS-12: 顔料元の切替。「このタブで選ぶ」に切替えた瞬間、現在の連動セット(混色タブの割当)を
    初期チェックとしてコピーする(押す前に何が選ばれるか予測できるようにするため)。 */
 $("rcSrcLinked").addEventListener("click",()=>{
  if(state.scheme.recipeSrc==="linked")return;
  state.scheme.recipeSrc="linked";
  $("rcSrcLinked").classList.add("on"); $("rcSrcOwn").classList.remove("on");
  $("rcOwnPigWrap").style.display="none";
  mark("panels");
 });
 $("rcSrcOwn").addEventListener("click",()=>{
  if(state.scheme.recipeSrc!=="independent"){
   if(!state.scheme.recipePigIds.length)state.scheme.recipePigIds=currentPigIds(false).slice();
   state.scheme.recipeSrc="independent";
  }
  $("rcSrcOwn").classList.add("on"); $("rcSrcLinked").classList.remove("on");
  $("rcOwnPigWrap").style.display="";
  renderRcOwnPigList();
  mark("panels");
 });
 /* --- F13: 混色スケール練習 --- */
 $("mgA").addEventListener("change",generateMixScale);
 $("mgB").addEventListener("change",generateMixScale);
 $("mgC").addEventListener("change",generateMixScale);
 $("mgFromAssign").addEventListener("click",()=>{
  const ids=currentPigIds(false);
  if(ids[0])$("mgA").value=ids[0];
  if(ids[1])$("mgB").value=ids[1];
  $("mgC").value=ids[2]||""; /* 付録B裁定: 3色目が無い場合は明示的に「(なし)」へ戻す(見た目=結果を一致させる) */
  generateMixScale();
 });
 const mgStepBtns={5:"mgSteps5",7:"mgSteps7",9:"mgSteps9",11:"mgSteps11"};
 Object.keys(mgStepBtns).forEach(n=>{
  $(mgStepBtns[n]).addEventListener("click",()=>{
   state.mixScale.steps=+n; saveMixScaleCfg();
   Object.values(mgStepBtns).forEach(id=>$(id).classList.toggle("on",id===mgStepBtns[n]));
   generateMixScale();
  });
 });
 $("mgTint").addEventListener("change",()=>{ state.mixScale.tint=$("mgTint").checked; saveMixScaleCfg(); generateMixScale(); });
 $("mgToRecipe").addEventListener("click",mgSendToRecipe);

 /* --- F12/F15: ガマットタブ --- */
 $("gmResetAll").addEventListener("click",resetGamut); /* §VII-6 */
 $("gmModeOff").addEventListener("click",()=>setGamutMode("off"));
 $("gmModeHl").addEventListener("click",()=>setGamutMode("highlight"));
 $("gmModeCr").addEventListener("click",()=>setGamutMode("correct"));
 GamutWheelUI.attach($("gmWheel"));
 $("gmShowTicks").addEventListener("change",drawGamutWheel); /* WS-13: 目盛表示トグル(表示設定・UNDO対象外) */
 /* WS-15: 回転は選択中マスクが多角形の場合のみ意味を持つ(syncGamutUIでgmRotRow自体を隠す)。 */
 $("gmRot").addEventListener("input",()=>{
  const sel=state.gamut.masks[_gmActiveIdx]; if(!sel||sel.type!=="poly")return;
  sel.rot=+$("gmRot").value; $("vgmRot").textContent=Math.round(sel.rot)+"°"; gamutChanged();
 });
 $("gmRotM15").addEventListener("click",()=>{
  const sel=state.gamut.masks[_gmActiveIdx]; if(!sel||sel.type!=="poly")return;
  sel.rot=wrapDeg180(sel.rot-15); $("gmRot").value=sel.rot;
  $("vgmRot").textContent=Math.round(sel.rot)+"°"; gamutChanged();
 });
 $("gmRotP15").addEventListener("click",()=>{
  const sel=state.gamut.masks[_gmActiveIdx]; if(!sel||sel.type!=="poly")return;
  sel.rot=wrapDeg180(sel.rot+15); $("gmRot").value=sel.rot;
  $("vgmRot").textContent=Math.round(sel.rot)+"°"; gamutChanged();
 });
 $("gmSoft").addEventListener("input",()=>{ state.gamut.softness=+$("gmSoft").value; $("vgmSoft").textContent=fmt(state.gamut.softness,3); gamutChanged(); });
 $("gmDim").addEventListener("input",()=>{ state.gamut.dimIn=+$("gmDim").value; $("vgmDim").textContent=Math.round(state.gamut.dimIn*100)+"%"; gamutChanged(); });
 $("gmPresTriad").addEventListener("click",()=>applyGamutPreset("triad"));
 $("gmPresThin").addEventListener("click",()=>applyGamutPreset("thin"));
 $("gmPresY").addEventListener("click",()=>applyGamutPreset("y"));
 $("gmPresTrap").addEventListener("click",()=>applyGamutPreset("trap"));
 $("gmPresTetra").addEventListener("click",()=>applyGamutPreset("tetra"));
 $("gmAddCircle").addEventListener("click",addGamutCircle);
 $("gmDrawNew").addEventListener("click",addGamutPolyDraft); /* WS-16 S7-3 */
 /* WS-15: 彩度上限(gmScale)は選択中マスクへ作用する。多角形は全頂点のrを、円はradを
    同じ相対倍率(ratio)でスケールする(既存の「相対スクラブ」方式をマスク種別問わず流用)。 */
 $("gmScale").addEventListener("input",()=>{
  const sel=state.gamut.masks[_gmActiveIdx]; if(!sel)return;
  const s=+$("gmScale").value, ratio=s/gmLastScale;
  if(sel.type==="circle") sel.rad=clamp(sel.rad*ratio,0.02,1.3);
  else sel.verts.forEach(v=>{ v.r=clamp(v.r*ratio,0,1.3); });
  gmLastScale=s; $("vgmScale").textContent=Math.round(s*100)+"%";
  gamutChanged();
 });
 /* §VII-4/VII-5: 抽出済み(state.gamut._extractDotsが存在)の場合のみ、色数スライダ・
    「無彩色(中心)を含める」変更から300msデバウンスで自動再抽出する。未抽出時は副作用なし。 */
 $("gmCoverage").addEventListener("change",()=>{ scheduleGamutAutoExtract(); });
 $("gmHullOrigin").addEventListener("change",()=>{
  state.gamut.hullIncludeOrigin=$("gmHullOrigin").checked;
  scheduleGamutAutoExtract();
 });
 $("gmExtract").addEventListener("click",gamutExtractFromImage);
 $("gmToPalette").addEventListener("click",gamutSendToPalette);
 $("gmExportImg").addEventListener("click",exportGamutImage);

 /* --- 配色タブ --- */
 /* §VI-1: 「選択色を基準に」ボタンは撤去。スウォッチクリック(=隠しcolor input)で任意色を手動指定する。
    手動指定後も、次に画像上でドット選択した瞬間にdoPick側のフックで上書きされる(仕様どおり)。 */
 $("scBaseInput").addEventListener("input",()=>{
  setSchemeBase(K.fromHex($("scBaseInput").value),"manual"); /* WS-10: lchも同時に正準再導出(意図的な色の選び直しのため正当) */
  mark("panels");
  genScheme();
 });
 $("scValue").addEventListener("input",()=>{
  /* WS-10本体修正: 旧実装は毎回 K.okLCh(K.srgb2ok(state.scheme.base)) でLChを再導出していた。
     baseは常にガマット内へclamp済みのsRGBのため、既に彩度Cが本来の値より小さくなっている
     ことがある(例: バリューを下げてガマットが縮小しclampされた状態)。そこから明度だけ戻しても
     再導出されるCは既に失われた値のままで、最終的にC=0(無彩色)に収束すると色相の情報まで
     失われ、二度と元の彩度・色相へ戻せなくなっていた(ユーザー報告のバグ)。
     修正: 正準値state.scheme.lchのL成分のみを直接更新し、C・hには一切触れない。
     これによりバリューを下げてから元に戻せば、Cがガマットにより一時的にクランプ表示されて
     いても正準値としては保持され続けるため、常に元の彩度・色相へ復元できる。 */
  const lch=state.scheme.lch;
  const newL=+$("scValue").value;
  state.scheme.lch=[newL,lch[1],lch[2]];
  state.scheme.base=K.ok2srgb(K.lch2lab([newL,Math.min(lch[1],K.cmax(newL,lch[2])),lch[2]])).map(v=>clamp(v,0,1));
  state.scheme._baseSrc="manual";
  $("vscValue").textContent=fmt(newL,2);
  mark("panels");
  scheduleGenScheme();
 });
 $("scDiscFollowL").addEventListener("change",()=>{
  schemeCfg.discFollowL=$("scDiscFollowL").checked;
  saveSchemeCfg();
  drawSchemeWheel();
 });
 SchemeWheelUI.attach($("schWheel")); /* §VI-2: 剛体回転ドラッグ */
 $("scRule").addEventListener("change",()=>{ state.scheme.rule=$("scRule").value; genScheme(); });
 $("scHist").addEventListener("change",previewHist);
 $("scHistApply").addEventListener("click",()=>{
  const p=HIST_PALS[+$("scHist").value]; if(!p)return;
  state.scheme.curPal={name:p.name,colors:p.colors.slice()};
  renderPalCur(); persistSoon();
  status_(t("status.paletteLoadedNamed",{name:p.name}));
 });
 $("palAdd").addEventListener("click",()=>{
  const pk=state.analysis.pick;
  if(!pk){ status_(t("status.pickColorFirst")); return; }
  state.scheme.curPal.colors.push(K.hex(isHold()?pk.orig:pk.edited));
  renderPalCur(); persistSoon();
 });
 $("palName").addEventListener("input",()=>{ state.scheme.curPal.name=$("palName").value; });
 $("palSaveBtn").addEventListener("click",palSave);
 $("palExport").addEventListener("click",palExportJson);
 $("palImportBtn").addEventListener("click",()=>$("palImport").click());
 $("palImport").addEventListener("change",e=>{ if(e.target.files[0])palImportJson(e.target.files[0]); e.target.value=""; });
 $("selfExport").addEventListener("click",selfExport);

 /* --- F1: ショートカット一覧モーダル --- */
 $("shortcutModalClose").addEventListener("click",()=>toggleShortcutHelp(false));
 $("shortcutModal").addEventListener("click",e=>{ if(e.target.id==="shortcutModal")toggleShortcutHelp(false); });

 /* --- F2: トリミング --- */
 $("btnCrop").addEventListener("click",()=>Crop.toggle());
 $("crCommit").addEventListener("click",()=>Crop.commit());
 $("crCancel").addEventListener("click",()=>Crop.cancel());
 $("crUncrop").addEventListener("click",()=>Crop.reset());
 $("crRatio").addEventListener("change",()=>Crop.setRatio($("crRatio").value));
 $("crRW").addEventListener("input",()=>{ if($("crRatio").value==="custom")Crop.setRatio("custom"); });
 $("crRH").addEventListener("input",()=>{ if($("crRatio").value==="custom")Crop.setRatio("custom"); });
 $("crRatioFlip").addEventListener("click",()=>{
  const a=$("crRW").value; $("crRW").value=$("crRH").value; $("crRH").value=a;
  Crop.setRatio("custom");
 });
 ["crX","crY","crW","crH"].forEach(id=>$(id).addEventListener("change",()=>Crop.setFromInputs()));
 $("crGuide").addEventListener("change",()=>{ Crop.guideType=$("crGuide").value; updateSpiralDirBtns(); mark("overlay"); });
 $("crGuideDir").addEventListener("click",()=>{
  guidesCfg.spiralDir=((guidesCfg.spiralDir||0)+1)%8; saveGuidesCfg(); mark("overlay");
 });

 /* --- F3: 補助線 --- */
 $("btnGuides").addEventListener("click",()=>Guides.toggle());
 $("gdOn").addEventListener("change",()=>{
  guidesCfg.on=$("gdOn").checked; $("btnGuides").classList.toggle("on",guidesCfg.on);
  saveGuidesCfg(); mark("overlay");
 });
 $("gdType").addEventListener("change",()=>{
  guidesCfg.type=$("gdType").value;
  $("gdGridNRow").classList.toggle("show",guidesCfg.type==="grid");
  updateSpiralDirBtns();
  saveGuidesCfg(); mark("overlay");
 });
 $("gdSpiralDir").addEventListener("click",()=>{
  guidesCfg.spiralDir=((guidesCfg.spiralDir||0)+1)%8; saveGuidesCfg(); mark("overlay");
 });
 $("gdGridN").addEventListener("input",()=>{
  guidesCfg.gridN=+$("gdGridN").value; $("vgdGridN").textContent=$("gdGridN").value;
  saveGuidesCfg(); mark("overlay");
 });
 $("gdColor").addEventListener("input",()=>{ guidesCfg.color=$("gdColor").value; saveGuidesCfg(); mark("overlay"); });
 $("gdWidth").addEventListener("input",()=>{
  guidesCfg.width=+$("gdWidth").value; $("vgdWidth").textContent=fmt(guidesCfg.width,1);
  saveGuidesCfg(); mark("overlay");
 });
 $("gdOpacity").addEventListener("input",()=>{
  guidesCfg.opacity=+$("gdOpacity").value; $("vgdOpacity").textContent=Math.round(guidesCfg.opacity*100)+"%";
  saveGuidesCfg(); mark("overlay");
 });
}
/* guidesCfg(localStorage永続化)をDOMへ反映。UNDO_KEYS対象外のため_undoSyncControlsとは別系統 */
function syncGuidesUI(){
 $("gdOn").checked=guidesCfg.on;
 $("btnGuides").classList.toggle("on",guidesCfg.on);
 $("gdType").value=guidesCfg.type;
 $("gdGridNRow").classList.toggle("show",guidesCfg.type==="grid");
 $("gdGridN").value=guidesCfg.gridN; $("vgdGridN").textContent=String(guidesCfg.gridN);
 $("gdColor").value=guidesCfg.color;
 $("gdWidth").value=guidesCfg.width; $("vgdWidth").textContent=fmt(guidesCfg.width,1);
 $("gdOpacity").value=guidesCfg.opacity; $("vgdOpacity").textContent=Math.round(guidesCfg.opacity*100)+"%";
 updateSpiralDirBtns();
}
/* §III-1: 「黄金螺旋」が選択されている場合のみ、向き(8方位)を巡回するミニボタンを表示する。
   通常補助線(gdType)とトリミング内補助線(crGuide)はguidesCfg.spiralDirを共有するため、
   どちらのボタンを押しても両方の螺旋が同じ向きへそろって回転する。 */
function updateSpiralDirBtns(){
 $("gdSpiralDir").style.display=guidesCfg.type==="goldenSpiral"?"":"none";
 $("crGuideDir").style.display=Crop.guideType==="goldenSpiral"?"":"none";
}
/* Store購読: レンダリング（第6項 単一Store購読） */
sub(["lut","a","b","c","blur","screen"],d=>R.render(d));
sub(["overlay"],()=>drawOverlay());
/* WS-16 S4-3(Sonnet実装): マスクプレビュー(#mkPreviewCv)を画面変化に連動させる。
   pan・ホイールズーム・zoomAt・ResizeObserver(stage)・トリミング適用・画像差し替えは
   いずれもmark("screen"または"overlay")を発火する(既存コード全数確認済み)ため、
   この1行だけで全経路を捕まえられる(WS-16 V-3の直接修正。個別に呼び出しを
   追加する方式は必ず経路が漏れるため採らない=WS-16作業標準書§S4-3の指示どおり)。
   _maskPreviewOn=falseの間はupdateMaskPreview内部で早期returnするため無駄なコストはない。 */
sub(["screen","overlay"],()=>{ if(_maskPreviewOn)updateMaskPreview(true); });

/* ============================================================
   元に戻す/やり直し (Undo/Redo)
   既存のStore(state/mark/sub)・描画パイプライン・Workerは一切変更しない。
   既に公開されている sub() 購読APIで「編集が起きた」ことだけを検知し、
   対象スライスをJSONスナップショットとして保存。復元時はDOM(スライダー等)へ
   値を書き戻してから、既存の mark()/refresh系関数へ処理を委譲するだけ。

   [F6] 履歴エントリは「スライス単位の文字列参照の束」{key:"<json文字列>",…} として
   持つ。直前エントリと同一内容のスライスは同じ文字列参照を使い回すことで、JSエンジンの
   参照共有によりメモリ増加を「実際に変化したスライスの文字列サイズ」だけに抑える
   (永続データ構造の構造共有と同じ原理。1回の編集で変わるスライスは通常1つ)。
   スナップショット方式そのもの・400msデバウンス・_undoApplyingガードは変更しない。
   ============================================================ */
const UNDO_KEYS=["global","hueWarp","night","value","mixing","munsell","scheme","pigments","crop","orient","clarity","mask","gamut"];
const UNDO_MAX=500;
const UNDO_BUDGET=32*1024*1024; /* 32MB: ユニーク文字列長合計×2 (UTF-16近似) のバイト予算 */
let _undoHist=[], _undoIdx=-1, _undoApplying=false, _undoT=null;
function _undoSnap(){
 const prev=_undoHist[_undoIdx];
 const o={};
 UNDO_KEYS.forEach(k=>{
  const s=JSON.stringify(state[k]);
  o[k]=(prev&&prev[k]===s)?prev[k]:s; /* 内容が同一なら直前エントリと同じ文字列参照を再利用 */
 });
 return o;
}
function _snapEqual(a,b){ for(const k of UNDO_KEYS){ if(a[k]!==b[k])return false; } return true; }
/* ユニーク文字列(参照)の合計サイズ。同じ参照を指す複数エントリは1回だけ数える */
function _undoUniqueBytes(){
 const seen=new Set(); let n=0;
 for(const snap of _undoHist){ for(const k of UNDO_KEYS){ const s=snap[k]; if(!seen.has(s)){ seen.add(s); n+=s.length*2; } } }
 return n;
}
function _undoButtons(){
 $("btnUndo").disabled=_undoIdx<=0;
 $("btnRedo").disabled=_undoIdx<0||_undoIdx>=_undoHist.length-1;
}
function _undoCommit(){
 if(_undoApplying)return;
 const snap=_undoSnap();
 if(_undoIdx>=0 && _snapEqual(_undoHist[_undoIdx],snap)){ _undoButtons(); return; }
 _undoHist=_undoHist.slice(0,_undoIdx+1);
 _undoHist.push(snap);
 _undoIdx++;
 while(_undoHist.length>1 && (_undoHist.length>UNDO_MAX || _undoUniqueBytes()>UNDO_BUDGET)){
  _undoHist.shift(); _undoIdx--;
 }
 _undoIdx=Math.min(_undoIdx,_undoHist.length-1);
 _undoButtons();
}
function _undoPush(){ if(_undoApplying)return; if(_undoT)clearTimeout(_undoT); _undoT=setTimeout(_undoCommit,400); }
function _undoInit(){ _undoHist=[_undoSnap()]; _undoIdx=0; _bakedCropKey=_undoHist[0].crop; _bakedOrientKey=_undoHist[0].orient; _undoButtons(); }
/* スライダー/セレクト/チェックボックス等のDOM表示を、既に開発済みの refresh 系関数と
   同じ「stateを正として読み直す」流儀で書き戻す。既存関数の中身には手を入れず、
   カバーされていない項目だけをここで個別に同期する。 */
function _undoSyncControls(){
 const g=state.global;
 $("slBright").value=g.brightness; $("vBright").textContent=fmt(g.brightness,2);
 $("slSat").value=g.saturation; $("vSat").textContent=fmt(g.saturation,2);
 $("slRadius").value=g.pickRadius; $("vRadius").textContent=String(g.pickRadius);

 const v=state.value;
 $("vGray").checked=v.gray; $("vGrayMirror").checked=v.gray; /* WS-07: ミラーも同期 */
 $("vCmp").value=v.cmp; $("vvCmp").textContent=Math.round(v.cmp*100)+"%";
 $("vPivot").value=v.pivot; $("vvPivot").textContent=fmt(v.pivot,2);
 $("vPostOn").checked=v.postOn;
 $("vDither").checked=v.dither;
 $("vSteps").value=clamp((Math.log2(v.steps)-1)/5,0,1); $("vvSteps").textContent=String(v.steps);
 $("lBi").value=v.lev.bi; $("vlBi").textContent=fmt(v.lev.bi,2);
 $("lWi").value=v.lev.wi; $("vlWi").textContent=fmt(v.lev.wi,2);
 $("lBo").value=v.lev.bo; $("vlBo").textContent=fmt(v.lev.bo,2);
 $("lWo").value=v.lev.wo; $("vlWo").textContent=fmt(v.lev.wo,2);

 const cl=state.clarity; /* F7 */
 $("clAmt").value=cl.amt; $("vclAmt").textContent=fmt(cl.amt,2);
 $("clRad").value=cl.rad; $("vclRad").textContent=fmt(cl.rad,2);

 syncMaskUI(); /* F14 */
 syncGamutUI(); /* F12/F15 */

 const mx=state.mixing;
 $("mxOn").checked=mx.on;
 $("mxModeA").classList.toggle("on",mx.subMode==="juxta");
 $("mxModeB").classList.toggle("on",mx.subMode==="layer");
 $("mxRowsA").style.display=mx.subMode==="juxta"?"":"none";
 $("mxRowsB").style.display=mx.subMode==="layer"?"":"none";
 $("sysCMYK").classList.toggle("on",mx.system==="CMYK");
 $("sysRGB").classList.toggle("on",mx.system==="RGB");
 $("sysCUSTOM").classList.toggle("on",mx.system==="CUSTOM");
 $("mxIdeal").checked=mx.ideal;
 $("mxDot").value=mx.dotR; $("vmxDot").textContent=fmt(mx.dotR,1)+"px";
 $("stDot").classList.toggle("on",mx.style==="dot");
 $("stHatch").classList.toggle("on",mx.style==="hatch");
 $("mxDist").value=mx.dist; $("vmxDist").textContent=fmt(mx.dist,2);
 $("mxKmCmp").value=mx.kmCmp;
 buildPigRows(); requestPigLut(); updateCmpPanel();

 const hw=state.hueWarp;
 $("hueOn").checked=hw.enabled;
 $("hueAdapt").checked=hw.adapt;
 syncLightSliders();
 syncModeUI();
 $("hueDensity").value=hw.density; $("vhueDensity").textContent=Math.round(hw.density*100)+"%";

 const ni=state.night;
 $("nightOn").checked=ni.on;
 $("nightLv").value=ni.level; $("vnightLv").textContent=Math.round(ni.level*100)+"%";

 refreshMunsellUI(); refreshHueUI();
 $("scRule").value=state.scheme.rule; /* 横展開修正: 従来ここが未同期だった(genScheme自体はstateを正しく読むため実害は表示のみ) */
 genScheme();
 /* WS-12: レシピ顔料元(連動/独立)のトグル・チェックボックス一覧をUndo/Redo後も正しい状態へ */
 const rcIndep=state.scheme.recipeSrc==="independent";
 $("rcSrcLinked").classList.toggle("on",!rcIndep);
 $("rcSrcOwn").classList.toggle("on",rcIndep);
 $("rcOwnPigWrap").style.display=rcIndep?"":"none";
 if(rcIndep)renderRcOwnPigList();
 $("mCMode").textContent=state.munsell.mode==="pct"?t("ui.munsellModePct"):t("ui.munsellModeAbs");
 renderPalCur(); renderPalList();
 drawWheels(); drawStepTicks(); drawHist(); drawCVD();

 /* [F2]/[II-5,6] state.crop・state.orientがUndo/Redoで変わったら現在ベイク済みの画像と
    不一致になるので再ベイクする。非同期だが、applyGeometry()自身はcrop/orient以外の
    UNDO_KEYSスライスを変更しないため、rAF後に_undoApplyingが先にfalseへ戻っても、
    rebake完了時に発火する_undoPush→_undoCommitは「直前エントリと完全一致」として
    _snapEqual()に弾かれ、余計な履歴は積まれない(安全)。 */
 const curCropKey=JSON.stringify(state.crop), curOrientKey=JSON.stringify(state.orient);
 if(!Crop.active && (curCropKey!==_bakedCropKey || curOrientKey!==_bakedOrientKey)){ Crop.applyGeometry(); }
 /* [F14] マスクパラメータもUndo/Redo/リセットで変わりうるため、GPU/CPU双方のマスク場を
    再生成する。両関数とも state.mask.on===false の時は内部で即return/nullにするだけで
    軽量なため、無条件に呼んでよい。 */
 rebuildMaskTexture(); Mirror.buildMask();
}
function _undoApply(snap){
 _undoApplying=true;
 UNDO_KEYS.forEach(k=>{
  if(k==="munsell"){
   /* 3D立体の視点(回転/仰角/距離/拡大/濃さ)は「表示」であり編集対象ではないため復元しない */
   const keepView={rot:state.munsell.rot,el:state.munsell.el,dist:state.munsell.dist,
                   scale:state.munsell.scale,density:state.munsell.density};
   state.munsell=JSON.parse(snap.munsell);
   Object.assign(state.munsell,keepView);
  }else{
   state[k]=JSON.parse(snap[k]);
  }
 });
 _undoSyncControls();
 mark("lut","a","b","c","blur","screen","analysis","overlay","panels","mixpanel");
 renderM3d();
 requestAnimationFrame(()=>{ _undoApplying=false; });
}
function undo(){
 if(_undoIdx<=0)return;
 _undoIdx--; _undoApply(_undoHist[_undoIdx]); _undoButtons();
 status_(t("status.undoDone",{idx:_undoIdx,total:_undoHist.length-1}));
}
function redo(){
 if(_undoIdx<0||_undoIdx>=_undoHist.length-1)return;
 _undoIdx++; _undoApply(_undoHist[_undoIdx]); _undoButtons();
 status_(t("status.redoDone",{idx:_undoIdx,total:_undoHist.length-1}));
}
sub(["lut","a","b","c","blur","screen","analysis","overlay","panels","mixpanel"],()=>_undoPush());
$("btnUndo").addEventListener("click",undo);
$("btnRedo").addEventListener("click",redo);
document.addEventListener("keydown",e=>{
 if(!(e.ctrlKey||e.metaKey))return;
 const ae=document.activeElement, tag=ae&&ae.tagName, typ=ae&&ae.type;
 const isTextEntry=tag==="TEXTAREA"||tag==="SELECT"||(tag==="INPUT"&&!["range","checkbox","radio","button"].includes(typ));
 if(isTextEntry)return; /* テキスト入力中はブラウザ標準のUndoを優先 */
 const k=e.key.toLowerCase();
 if(k==="z"&&!e.shiftKey){ e.preventDefault(); undo(); }
 else if(k==="y"||(k==="z"&&e.shiftKey)){ e.preventDefault(); redo(); }
});

/* ============================================================
   [F5] 「変更をリセット」の不可逆化: Undo履歴そのものを先頭スナップショットのみに
   切り詰める。これにより「リセット後にやっぱり戻る」はできなくなる代わりに、
   F6で確保した履歴メモリ予算を最大限空けられる(仕様指示による不可逆化)。
   ============================================================ */
function openResetConfirm(){ $("resetConfirm").classList.add("show"); }
function closeResetConfirm(){ $("resetConfirm").classList.remove("show"); }
function resetAllEdits(){
 if(!_undoHist.length)return;
 _undoApply(_undoHist[0]);
 _undoApplying=false; /* 履歴を単一化して即座に確定させるため、rAFを待たず解除する */
 _undoHist=[_undoHist[0]]; _undoIdx=0;
 _undoButtons();
 closeResetConfirm();
 status_(t("status.resetAllDone"));
}
$("btnResetAll").addEventListener("click",openResetConfirm);
$("resetCancel").addEventListener("click",closeResetConfirm);
$("resetGo").addEventListener("click",resetAllEdits);
$("resetConfirm").addEventListener("click",e=>{ if(e.target.id==="resetConfirm")closeResetConfirm(); });
document.addEventListener("keydown",e=>{ if(e.key==="Escape"&&$("resetConfirm").classList.contains("show"))closeResetConfirm(); });

/* §VI-4: 保存パレット全体の削除確認(不可逆・複数色の削除のため三大原則3により確認を必須化)。
   resetConfirmと同じ.confirmModalパターン。_palDelPendingIdxで削除対象のインデックスを一時保持する。 */
let _palDelPendingIdx=-1;
function openPalDelConfirm(idx){
 _palDelPendingIdx=idx;
 const p=state.scheme.palettes[idx]; if(!p)return;
 $("palDelConfirmTitle").textContent=t("status.paletteDeleteConfirmNamed",{name:p.name});
 $("palDelConfirm").classList.add("show");
}
function closePalDelConfirm(){ _palDelPendingIdx=-1; $("palDelConfirm").classList.remove("show"); }
function palDelConfirmed(){
 if(_palDelPendingIdx<0)return;
 const p=state.scheme.palettes[_palDelPendingIdx];
 state.scheme.palettes.splice(_palDelPendingIdx,1);
 closePalDelConfirm();
 renderPalList(); persistSoon();
 status_(p?t("status.paletteDeletedNamed",{name:p.name}):t("status.colorDeleted"));
}
$("palDelCancel").addEventListener("click",closePalDelConfirm);
$("palDelGo").addEventListener("click",palDelConfirmed);
$("palDelConfirm").addEventListener("click",e=>{ if(e.target.id==="palDelConfirm")closePalDelConfirm(); });
document.addEventListener("keydown",e=>{ if(e.key==="Escape"&&$("palDelConfirm").classList.contains("show"))closePalDelConfirm(); });

/* 初期化 */
function init(){
 R.init($("gl"));
 W.init();
 Input.init();
 applyLang(detectInitialLang()); /* §VIII-2: 既定言語判定。data-i18n要素はまだ少数だが安全に適用できる */
 loadPersist();
 loadGuidesCfg(); /* F3: 補助線設定はlocalStorage独自キー(UNDO_KEYS対象外) */
 loadMixScaleCfg(); /* F13: 同上 */
 loadHistChCfg(); /* §III-4: 同上 */
 loadSchemeCfg(); /* §VI-2: 同上 */
 buildPigRows(); rebuildPresetSel(); rebuildHistSel();
 renderPalCur(); renderPalList();
 wireAll();
 syncGuidesUI();
 syncHistChUI(); /* §III-4: 読み込んだhistCh/histChFrontの状態をチップへ反映(非表示中でも整合させておく) */
 $("scDiscFollowL").checked=schemeCfg.discFollowL; /* §VI-2 */
 syncMaskUI(); /* F14: 初期値(全OFF)をDOMへ反映 */
 syncGamutUI(); /* F12/F15: 初期値(モード=オフ)をDOMへ反映 */
 rebuildMixScaleSelects(); /* F13 */
 ["mgSteps5","mgSteps7","mgSteps9","mgSteps11"].forEach(id=>$(id).classList.toggle("on",id==="mgSteps"+state.mixScale.steps));
 $("mgTint").checked=state.mixScale.tint;
 generateMixScale();
 injectHelp(); /* F4: data-help属性の付いた要素へ「?」マークを一括注入 */
 drawStepTicks(); updateCursor();
 refreshMunsellUI(); refreshHueUI(); genScheme(); drawWheels();
 initCmpWidget(); /* WS-05: HSB⇔RGB比較ウィジェットの初期表示 */
 requestPigLut(); /* バックグラウンドで顔料LUTを先行生成 (17³→33³ 段階細分化) */
 mark("screen");
}
init();
/* init()完了後(loadPersist等で永続化データの反映が終わった後)にUndo履歴の基準点を設定。
   init()自体は変更せず、外側からタイミングだけ合わせている。 */
setTimeout(_undoInit,0);
