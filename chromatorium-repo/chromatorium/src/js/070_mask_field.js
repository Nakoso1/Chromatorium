/* ============================================================
   F14. 部分マスク適用 — マスク場(M∈[0,1])の生成。判定は常に「元画像」基準で行う
   (処理後の値で選択すると自己参照でマスクが不安定になるため。§F14科学的裏付け)。
   GPU用(rebuildMaskTexture, 長辺1024)・CPU用(Mirror.buildMask, 512px)の両方から
   同じ判定式(trapMask/hueTrapMask/幾何ラスタ/finishMaskField)を共用し、判定式を1箇所にする。

   §IV-1 段階キャッシュ: 判定数式は一切変更せず、段取りのみを4段に分離する。
   段1「Lab場」(L,C,hue の per-pixel 変換、現行コストの大半)は画像ごとに1回だけ計算し、
   スライダ操作(段2)では再計算しない。段3「幾何ラスタ」はrect/lasso変更時のみ再ラスタライズ
   する(参照同一性で判定。stateのgeo.rect/geo.lassoは常に新しい配列へ丸ごと置き換えられる
   実装のため、参照比較だけで十分かつ確実)。キャンバスはモジュールスコープで再利用する。
   GLSL側(uMTxxx, L1161近傍)・幾何ラスタの描画コード・trapMask/hueTrapMask/finishMaskFieldの
   中身はいずれも本改修で一切変更していない(数式不変)。

   §IV-1 GPU/CPU理論検証の結果(改修時にNode上の使い捨てスクリプトで自動比較して確認・記録):
   (a) GLSL uMTxxxの混合式 lin+(t-lin)*m と、CPU側(Mirror.maskArrを介した同一式)は同一関数を
       参照するため式として同一。CPU側の生成結果(段2/3/4)は(b)(2)の検証により改修前と一致。
   (b) 色相トラップの360°ラップアラウンド: center=350,width=40の設定でhue=5(0°跨ぎ側)は
       hueTrapMask=0.844(採用側)、対極のhue=180は0.000(除外側)であることを数値確認しPASS。
   (c) C<0.02の無彩色除外: C=0.01→mhue=0、C=0.5→mhue=1を数値確認しPASS(分岐コード自体は
       computeMaskFieldから機械的に移設しただけで変更なし)。
   (d)(e) フェザーの画像相対単位・反転をフェザー後に適用する順序は、finishMaskField自体を
       一切変更していない(旧実装のコードをそのまま流用)ため、これらの性質は構造的に維持される。
   (2)相当の検証: 4通りの代表的なマスク設定(輝度のみ/色相ラップアラウンドのみ/矩形幾何+両方/
       なげなわ幾何+両方)について、旧実装(判定を1関数にインライン)と新実装(段1〜3に分離+
       キャッシュ)の出力をランダム画素データで比較し、Uint8量子化後は全設定・全画素で
       バイト単位で完全一致(diffCount=0)することを確認した。分離前の浮動小数点計算と
       Float32Array経由の段1キャッシュとの間には最大1e-6程度の丸め誤差があるが、
       これは255倍しても0.5(丸めの境界)に遠く及ばないため量子化後は影響しない。
   ============================================================ */
function trapMask(L,lo,hi,soft){
 const s=Math.max(soft,0.001);
 const a=smooth(lo-s,lo+s,L);
 const b=1-smooth(hi-s,hi+s,L);
 return clamp(Math.min(a,b),0,1);
}
function hueTrapMask(hue,center,width,soft){
 const d=Math.abs(angDiff(center,hue));
 const half=width/2, s=Math.max(soft,0.001);
 return 1-smooth(half-s,half+s,d);
}
/* 段1: Lab場。srcRGBA: Uint8ClampedArray(w*h*4)の元画像相当データ。
   既存computeMaskFieldのper-pixel前半(K.lin2ok変換)と数式的に完全同一。 */
function computeLabField(srcRGBA,w,h){
 const total=w*h;
 const L=new Float32Array(total), C=new Float32Array(total), hue=new Float32Array(total);
 for(let i=0;i<total;i++){
  const o=i*4;
  const lin=[S2L8[srcRGBA[o]],S2L8[srcRGBA[o+1]],S2L8[srcRGBA[o+2]]];
  const lab=K.lin2ok(lin);
  L[i]=lab[0]; C[i]=Math.hypot(lab[1],lab[2]); hue[i]=mod360(Math.atan2(lab[2],lab[1])*R2D);
 }
 return {w,h,L,C,hue};
}
/* 段2: 明度・色相トラップ。段1(L,C,hue)から軽量に導出する(乗算とsmoothstepのみ)。
   既存computeMaskFieldのper-pixel後半と完全同一の計算(trapMask/hueTrapMaskをそのまま呼ぶ)。 */
function applyTrapStage(lab){
 const m=state.mask, total=lab.w*lab.h;
 const Mc=new Float32Array(total);
 const {L,C,hue}=lab;
 for(let i=0;i<total;i++){
  const mlum = m.lum.on ? trapMask(L[i],m.lum.lo,m.lum.hi,m.lum.soft) : 1;
  const mhue = m.hue.on ? (C[i]<0.02 ? 0 : hueTrapMask(hue[i],m.hue.center,m.hue.width,m.hue.soft)) : 1;
  Mc[i]=mlum*mhue;
 }
 return Mc;
}
/* 段3: 幾何ラスタ。既存computeMaskFieldの幾何部分と完全同一の描画コード。cacheSlotの内容と
   (on,kind,w,h,rect参照,lasso参照)が一致すればラスタライズを省略し前回のImageDataを返す。
   戻り値null=「幾何マスクなし=全域1」(乗算をスキップする合図、既存if(m.geo.on)分岐と等価)。 */
let _maskGeoCv=null,_maskGeoCx=null;
function computeGeoStage(cacheSlot,w,h,bufScale){
 const g=state.mask.geo;
 if(!g.on){ cacheSlot.on=false; cacheSlot.data=null; return null; }
 const same=cacheSlot.on===true && cacheSlot.kind===g.kind && cacheSlot.w===w && cacheSlot.h===h &&
  cacheSlot.rectRef===g.rect && cacheSlot.lassoRef===g.lasso;
 if(same)return cacheSlot.data;
 if(!_maskGeoCv){ _maskGeoCv=document.createElement("canvas"); _maskGeoCx=_maskGeoCv.getContext("2d",{willReadFrequently:true}); }
 _maskGeoCv.width=w; _maskGeoCv.height=h;
 _maskGeoCx.clearRect(0,0,w,h);
 _maskGeoCx.fillStyle="#000"; _maskGeoCx.fillRect(0,0,w,h); _maskGeoCx.fillStyle="#fff";
 _maskGeoCx.beginPath();
 if(g.kind==="rect"&&g.rect){
  const [rx,ry,rw,rh]=g.rect;
  _maskGeoCx.rect(rx*bufScale,ry*bufScale,rw*bufScale,rh*bufScale);
 }else if(g.kind==="lasso"&&g.lasso&&g.lasso.length>2){
  g.lasso.forEach(([lx,ly],i)=>{
   const x=lx*bufScale,y=ly*bufScale;
   if(i===0)_maskGeoCx.moveTo(x,y); else _maskGeoCx.lineTo(x,y);
  });
  _maskGeoCx.closePath();
 }
 _maskGeoCx.fill("evenodd");
 const data=_maskGeoCx.getImageData(0,0,w,h).data;
 cacheSlot.on=true; cacheSlot.kind=g.kind; cacheSlot.w=w; cacheSlot.h=h;
 cacheSlot.rectRef=g.rect; cacheSlot.lassoRef=g.lasso; cacheSlot.data=data;
 return data;
}
function _newMaskGeoCacheSlot(){ return {on:false,kind:null,w:0,h:0,rectRef:null,lassoRef:null,data:null}; }
/* 段1キャッシュ本体。GPU用(最大1024px)とMirror用(512px固定)は最終出力解像度が異なるため
   独立して持つ(統合すると既存のMASK_MAXSIDE/Mirror解像度のどちらかの品質が変わってしまう)。
   labDirty=trueの間は次回アクセス時に無条件で再計算する(setImage()で発火。§IV-1指示どおり
   「画像ごとに1回だけ」計算し、スライダ操作では再計算しない)。w/h不一致時も安全側で再計算する。
   WS-16 S5-2(Sonnet実装): GPU側(gpu)は単一スロットから解像度ごとのMapへ変更する。
   旧実装はlab一つだけを持ち、サイズ不一致(w!==cache.lab.w)を検知するたび全体を再計算していた。
   ドラッグ中(MASK_DRAG_MAXSIDE=256px)と確定時(MASK_MAXSIDE=1024px)を往復するたびに
   computeLabField(1024px)が毎回304ms(実測)かかっており、これが「動作が重くカクつく」の
   一因だった(WS-16 V-4、作業標準書§2.3参照)。Mapに両方の解像度を同時に保持することで、
   同一画像である限り各解像度は1回だけ計算すればよくなる。geoCacheも解像度ごとに独立させる
   (computeGeoStageのキャッシュ判定はw/hを含むため、共有すると同じ理由で往復ごとに
   ラスタ再生成が起きてしまう)。Mirror側は512px固定で解像度が変わらないため単一スロットのまま
   (変更不要)。 */
const _maskStageCache={
 gpu:{labs:new Map(), labDirty:true},
 mirror:{lab:null, labDirty:true, geoCache:_newMaskGeoCacheSlot()}
};
function invalidateMaskLabCache(){
 _maskStageCache.gpu.labDirty=true;
 _maskStageCache.mirror.labDirty=true;
}
/* フェザー(ガウシアン)+反転を適用して最終マスク場を返す(Mcは書き換え可能な配列として渡す)。
   §IV-1理論検証(e): 反転はフェザーの後に適用する現行順序を維持している(変更していない)。
   WS-16 S5-1(Sonnet実装): gaussianBlur1chの直接呼び出しをblurMaskField()に差し替える。
   数式(ガウシアン)自体・フェザー閾値(0.02)・反転の順序は一切変更していない。
   blurMaskFieldは小σではgaussianBlur1chへ完全委譲するため、feather値が小さい間は
   従来と完全に同じ計算経路を通る(WS-16 V-4参照)。 */
function finishMaskField(Mc,w,h){
 const m=state.mask;
 if(m.feather>0.02) Mc=blurMaskField(Mc,w,h,m.feather*Math.max(w,h));
 if(m.invert){ for(let i=0;i<Mc.length;i++)Mc[i]=1-Mc[i]; }
 return Mc;
}
/* GPU用: 現在の作業画像(R.img.bitmap = トリミング済みなら適用後の画像。MaskDraw/hueWarp.nodesと
   同じ「現在の画像座標系」)の縮小版からマスクを生成しR.maskTexへアップロードする。
   mask.on=falseの時は一切実行しない(R1)。
   §IV-1 対話時二段解像度: maxSide省略時は従来どおりMASK_MAXSIDE(最終品質)。
   scheduleMaskRebuild()がドラッグ中のみMASK_DRAG_MAXSIDEを明示的に渡す。 */
const MASK_MAXSIDE=1024;
const MASK_DRAG_MAXSIDE=256;
let _maskCv=null,_maskCx=null;
function rebuildMaskTexture(maxSide){
 if(!state.mask.on || !R.img || !R.img.bitmap || !state.file.has)return;
 const bmp=R.img.bitmap;
 const side=maxSide||MASK_MAXSIDE;
 const sc=Math.min(1,side/Math.max(state.file.w,state.file.h));
 const w=Math.max(1,Math.round(state.file.w*sc)), h=Math.max(1,Math.round(state.file.h*sc));
 const cache=_maskStageCache.gpu;
 /* WS-16 S5-2: 画像が変わった(labDirty)ときだけ、解像度別キャッシュ全体を1回破棄する。
    以後は解像度ごとにMapへ蓄積し、256px/1024pxの往復では再計算しない。 */
 if(cache.labDirty){ cache.labs.clear(); cache.labDirty=false; }
 const key=w+"x"+h;
 let slot=cache.labs.get(key);
 if(!slot){
  if(!_maskCv){ _maskCv=document.createElement("canvas"); _maskCx=_maskCv.getContext("2d",{willReadFrequently:true}); }
  _maskCv.width=w; _maskCv.height=h;
  _maskCx.clearRect(0,0,w,h);
  _maskCx.drawImage(bmp,0,0,w,h);
  const src=_maskCx.getImageData(0,0,w,h).data;
  slot={lab:computeLabField(src,w,h), geoCache:_newMaskGeoCacheSlot()};
  cache.labs.set(key,slot);
 }
 let Mc=applyTrapStage(slot.lab);
 const geoData=computeGeoStage(slot.geoCache,w,h,sc);
 if(geoData){ for(let i=0;i<Mc.length;i++)Mc[i]*=geoData[i*4]/255; }
 Mc=finishMaskField(Mc,w,h);
 const out=new Uint8Array(w*h);
 for(let i=0;i<Mc.length;i++)out[i]=Math.round(clamp(Mc[i],0,1)*255);
 R.setMaskTex(w,h,out);
}
/* §IV-1 対話時二段解像度+イベント集約。ドラッグ中(=maskRebuild相当の呼び出しが連打される間)は
   MASK_DRAG_MAXSIDE(256px)でrAF1回に間引いて即時反映し、150ms静止したらMASK_MAXSIDE(1024px)で
   確定計算する。すべて同期的にメインスレッド上で完結するため、Worker設計で必要になる世代ID
   (非同期ジョブの追い越し対策)は不要: 確定計算(setTimeoutで150ms)は、その前に積まれた
   rAFコールバック(次フレームには必ず消化される)より確実に後に走るため、順序は構造的に保証される。
   WS-06軽量化(監督指定・方策1): 旧実装はrAF(ドラッグ中、最大60fps)のたびにMirror.buildMask()
   (Mirror解像度512pxでのLab場計算+ガウシアンブラー)とscheduleAnalysis()を同期的に呼んでおり、
   これが「動作が重すぎる」の主因だった。Mirror.buildMask()はMirror自身の解像度で計算するため、
   GPU側のMASK_DRAG_MAXSIDE(256px)二段解像度の恩恵を受けず、ドラッグ中も常に同じ重さで走って
   いた。GPUプレビュー(rebuildMaskTexture)は256pxで既にドラッグ中の視覚追従を担っているため、
   Mirror側(スポイト数値・ヒストグラム用)は静止時のみ計算すれば体感上の欠落はない。 */
let _maskRafPending=false, _maskSettleT=null;
function scheduleMaskRebuild(){
 if(!_maskRafPending){
  _maskRafPending=true;
  requestAnimationFrame(()=>{
   _maskRafPending=false;
   rebuildMaskTexture(MASK_DRAG_MAXSIDE);
   mark(...M_A);
  });
 }
 if(_maskSettleT)clearTimeout(_maskSettleT);
 _maskSettleT=setTimeout(()=>{
  _maskSettleT=null;
  rebuildMaskTexture(MASK_MAXSIDE); /* 確定計算(最終品質) */
  Mirror.buildMask(); /* WS-06: 静止時にのみ実行(旧: 毎rAFフレーム実行) */
  mark(...M_A); scheduleAnalysis();
  if(_maskPreviewOn)updateMaskPreview(true); /* WS-06: 表示トグルON中は最新maskArrで再描画 */
 },150);
}
/* DOM(スライダー等)をstate.maskから書き戻す。_undoSyncControls()と、通常のUI初期化の両方から呼ぶ */
/* WS-16 S3-4(Sonnet実装): クイックプリセット(シャドウ/中間調/ハイライト)の現在状態を可視化する。
   押しても点灯しない=何が起きたか分からない、を解消する(WS-16 V-2)。 */
function syncMaskQuickUI(){
 const lum=state.mask.lum;
 const near=(a,b)=>Math.abs(a-b)<1e-6;
 const isPreset=(lo,hi)=>lum.on&&near(lum.lo,lo)&&near(lum.hi,hi);
 $("mkQuickShadow").classList.toggle("on",isPreset(0,0.35));
 $("mkQuickMid").classList.toggle("on",isPreset(0.30,0.70));
 $("mkQuickHigh").classList.toggle("on",isPreset(0.65,1.0));
}
/* WS-16 S3-4: 現在のマスク条件を1行で要約表示する。条件が1つも無ければ画像全体に
   適用される旨を警告色で示す(WS-16作業標準書 §S3-4)。 */
function syncMaskSummary(){
 const el=$("mkSummary"); if(!el)return;
 const m=state.mask;
 const parts=[];
 if(m.lum.on)parts.push(t("ui.maskSummaryLum",{lo:fmt(m.lum.lo,2),hi:fmt(m.lum.hi,2)}));
 if(m.hue.on)parts.push(t("ui.maskSummaryHue",{center:Math.round(m.hue.center),half:Math.round(m.hue.width/2)}));
 if(m.geo.on)parts.push(t("ui.maskSummaryShapeRect"));
 if(m.invert)parts.push(t("ui.maskSummaryInvert"));
 if(!parts.length){
  el.textContent=t("ui.maskSummaryNone");
  el.classList.add("warn");
 }else{
  el.textContent=parts.join(" ／ ");
  el.classList.remove("warn");
 }
}
function syncMaskUI(){
 const m=state.mask;
 $("mkOn").checked=m.on;
 $("mkInvert").checked=m.invert;
 $("mkFeather").value=m.feather; $("vmkFeather").textContent=fmt(m.feather,3);
 $("mkLumOn").checked=m.lum.on;
 $("mkLumLo").value=m.lum.lo; $("vmkLumLo").textContent=fmt(m.lum.lo,2);
 $("mkLumHi").value=m.lum.hi; $("vmkLumHi").textContent=fmt(m.lum.hi,2);
 $("mkLumSoft").value=m.lum.soft; $("vmkLumSoft").textContent=fmt(m.lum.soft,3);
 $("mkHueOn").checked=m.hue.on;
 $("mkHueCenter").value=m.hue.center; $("vmkHueCenter").textContent=Math.round(m.hue.center)+"°";
 $("mkHueWidth").value=m.hue.width; $("vmkHueWidth").textContent=Math.round(m.hue.width)+"°";
 $("mkHueSoft").value=m.hue.soft; $("vmkHueSoft").textContent=Math.round(m.hue.soft)+"°";
 $("mkTgtWarp").checked=m.targets.warp;
 $("mkTgtNight").checked=m.targets.night;
 $("mkTgtBs").checked=m.targets.bs;
 $("mkTgtCmp").checked=m.targets.cmp;
 $("mkTgtLev").checked=m.targets.lev;
 $("mkTgtPost").checked=m.targets.post;
 syncMaskShapeUI();
 syncMaskQuickUI();
 syncMaskPickButtons();
 syncMaskSummary();
}
/* Fix2(c)(Sonnet実装): 形状UIを「なし/矩形/なげなわの3択+別ボタンの描く」から
   「矩形で指定/範囲を解除」の2ボタンへ統合する。矩形ボタンは、既に確定済みの矩形が
   あるかどうかを.on表示で示す(押すと常に新規描画を開始するため、旧実装のような
   「描く/描き直す」の文言切り替えは不要になった)。「範囲を解除」は消せるものが
   無い間はdisabledにする(押しても何も起きないボタンを晒さない=WS-16 V-2の思想を踏襲)。
   なげなわ関連のUI要素(#mkShapeLasso等)はHTMLから撤去済みのため、ここでは一切参照しない
   (computeGeoStage等の共有処理は無変更のまま温存されている=低リスク)。 */
function syncMaskShapeUI(){
 const g=state.mask.geo;
 const hasRect=g.on && g.kind==="rect" && g.rect;
 $("mkShapeRect").classList.toggle("on",!!hasRect);
 $("mkShapeClear").disabled=!hasRect;
}
/* Fix2(a)(Sonnet実装): 「選択色から設定」ボタンは、事前に画像上で色を選択していない
   (state.analysis.pickが無い)と機能しない。旧実装はこの前提条件がボタンから一切読み取れず、
   押しても短いステータスメッセージが一瞬出るだけで「クリックしても選択できない」という
   報告に直結していた。ここでは前提が満たされるまでボタン自体をdisabled+説明titleにし、
   さらに常時表示のヒント文(ui.maskPickHint)をHTML側に静的に追加した。 */
function syncMaskPickButtons(){
 const has=!!state.analysis.pick;
 const lum=$("mkLumPick"), hue=$("mkHuePick");
 if(lum){ lum.disabled=!has; lum.title=has?"":t("status.pickColorFirst"); }
 if(hue){ hue.disabled=!has; hue.title=has?"":t("status.pickColorFirst"); }
}
/* F14: 「マスク表示」ボタン押下中のみ、Mirror解像度のmaskArrを赤半透明で#mkPreviewCvへ描画する
   (Photoshopのクイックマスク相当)。書き出しには一切影響しない(別canvas・別経路)。 */
/* WS-06: マスク表示のトグル状態(揮発UI、state非接触)。setMaskPreview()を唯一の書込み口とし、
   ボタンの.on表示・実際のプレビュー描画(updateMaskPreview)を常に一致させる。
   マスク無効化・画像差し替え・タブ離脱時にもこの関数経由でOFFへ戻す(受け入れ基準)。 */
let _maskPreviewOn=false;
function setMaskPreview(on){
 _maskPreviewOn=on;
 const btn=$("mkShowMask");
 if(btn)btn.classList.toggle("on",on);
 updateMaskPreview(on);
}
/* WS-16 S4-1(Sonnet実装): マスクの「スタンプ」(Mirror解像度の赤半透明ImageData)をキャッシュする。
   旧実装はupdateMaskPreview()が呼ばれるたび(=pan/zoom/resizeのたびに呼ぶ想定のS4-3実装後は
   毎フレーム相当)、mw*mhピクセル全部を走査してcreateImageDataから作り直しており、無駄が大きい
   うえ、そもそもpan/zoom/resizeのどのイベントにも購読されておらず画像と連動しなかった
   (WS-16 V-3)。ここではMirror.buildMask()が実際にmaskArrを更新した回数(_maskArrVer)を見て、
   スタンプがその最新版と一致していれば再生成をスキップする。 */
let _maskArrVer=0;
const _maskStamp={cv:null,cx:null,w:0,h:0,ver:-1};
function buildMaskStamp(){
 if(!Mirror.ready||!Mirror.maskArr)return false;
 if(_maskStamp.ver===_maskArrVer && _maskStamp.w===Mirror.w && _maskStamp.h===Mirror.h)return true;
 const mw=Mirror.w,mh=Mirror.h,arr=Mirror.maskArr;
 if(!_maskStamp.cv){ _maskStamp.cv=document.createElement("canvas"); _maskStamp.cx=_maskStamp.cv.getContext("2d"); }
 if(_maskStamp.cv.width!==mw||_maskStamp.cv.height!==mh){ _maskStamp.cv.width=mw; _maskStamp.cv.height=mh; }
 const id=_maskStamp.cx.createImageData(mw,mh);
 for(let i=0;i<mw*mh;i++){
  const v=arr[i];
  id.data[i*4]=255; id.data[i*4+1]=40; id.data[i*4+2]=40; id.data[i*4+3]=Math.round(v*220);
 }
 _maskStamp.cx.putImageData(id,0,0);
 _maskStamp.w=mw; _maskStamp.h=mh; _maskStamp.ver=_maskArrVer;
 return true;
}
/* WS-16 S4-2(Sonnet実装): 描画本体は「スタンプを画面座標へ変換して貼るだけ」にする。
   スタンプの生成(重い)とスクリーンへの変換(軽い)を分離したことで、pan/zoom/resizeの
   たびに呼んでも実質1回のdrawImageで済む(S4-3で全ビュー変化イベントから呼ぶ)。 */
function updateMaskPreview(show){
 const cv=$("mkPreviewCv");
 cv.classList.toggle("show",show);
 if(!show)return;
 if(!buildMaskStamp()){ cv.classList.remove("show"); return; }
 const st=$("stage");
 /* サイズが変わるときだけwidth/heightを代入する(毎回代入するとcanvasが不要に再確保・
    クリアされる。WS-16作業標準書 §S4-2参照)。 */
 if(cv.width!==st.clientWidth||cv.height!==st.clientHeight){ cv.width=st.clientWidth; cv.height=st.clientHeight; }
 const cx=cv.getContext("2d");
 cx.clearRect(0,0,cv.width,cv.height);
 const [x0,y0]=Input.img2scr(0,0), [x1,y1]=Input.img2scr(state.file.w,state.file.h);
 cx.imageSmoothingEnabled=true;
 cx.drawImage(_maskStamp.cv,x0,y0,x1-x0,y1-y0);
}
/* F14: 選択色から明度/色相範囲の初期値を設定するミニボタン(スポイト連携) */
function maskPickLum(){
 const pk=state.analysis.pick; if(!pk){ status_(t("status.pickColorFirst")); return; }
 const c=isHold()?pk.orig:pk.edited;
 const lab=K.srgb2ok(c);
 const L=lab[0];
 state.mask.lum.lo=clamp(L-0.1,0,1); state.mask.lum.hi=clamp(L+0.1,0,1); state.mask.lum.on=true;
 syncMaskUI(); rebuildMaskTexture(); Mirror.buildMask(); mark("screen");
}
function maskPickHue(){
 const pk=state.analysis.pick; if(!pk){ status_(t("status.pickColorFirst")); return; }
 const c=isHold()?pk.orig:pk.edited;
 const lch=K.okLCh(K.srgb2ok(c));
 state.mask.hue.center=mod360(lch[2]); state.mask.hue.width=60; state.mask.hue.on=true;
 syncMaskUI(); rebuildMaskTexture(); Mirror.buildMask(); mark("screen");
}

