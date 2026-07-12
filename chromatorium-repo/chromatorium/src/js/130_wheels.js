/* ============================================================
   色相環 (2.2 / 4.2.2) — ベースリングはキャッシュ
   ============================================================ */
/* WS-16 S1-1(Sonnet実装): 「その環の、その角度に、実際に塗られている色」を返す唯一の関数。
   ringBase(見た目)・commonHueFromWheel/wheelAngleFromCommonHue(角度⇔色相写像)の
   3箇所が同じ代表色定義を参照することで、色相環の色とドラッグ角度計算の基準色を
   常に一致させる(単一の真実)。K内の関数は一切変更せず、既存の変換のみを組み合わせる。 */
/* マンセル色相のHueごとに sRGB ガマット上での最大彩度Value(カスプ)を求める。
   固定V=6ではなく実際のカスプを使うことで、RGB/RYB環と彩度感を揃える(WS-16 A-1)。
   マンセルHue(0..100)を0.25刻みに量子化してメモ化する(起動時1回だけ計算されれば
   以後は再利用されるため、初回のみのコストで済む=既存のringBase/diskBaseキャッシュと同じ流儀)。 */
const _munsellCuspCache=new Map();
function munsellCuspV(mh){
 const key=Math.round(mh*4);
 if(_munsellCuspCache.has(key))return _munsellCuspCache.get(key);
 let best=-1,bv=5;
 for(let V=0.6;V<=9.7;V+=0.3){ const c=K.cmaxHV(mh,V); if(c>best){best=c;bv=V;} }
 for(let V=Math.max(0.6,bv-0.25);V<=Math.min(9.7,bv+0.25);V+=0.025){ const c=K.cmaxHV(mh,V); if(c>best){best=c;bv=V;} }
 _munsellCuspCache.set(key,bv);
 return bv;
}
function wheelRepSrgb(type,angleDeg){
 const a=mod360(angleDeg);
 if(type==="rgb")return K.hsl2rgb(a,0.92,0.55);
 if(type==="ryb")return K.hsl2rgb(K.hslFromRyb(a),0.92,0.55);
 if(type==="ok"){
  const L=0.72,C=Math.min(0.13,K.cmax(L,a));
  return K.ok2srgb(K.lch2lab([L,C,a]));
 }
 /* munsell: 固定V=6をやめ、そのHueでの実際のカスプValueを使う(WS-16 A-1)。
    C係数0.95はガマット境界ちょうど(1.00)だとl2sクリップで色相がわずかに動き、
    後述の逆写像の単調性が壊れる恐れがあるための安全余裕(WS-16作業標準書 §S1-1参照)。 */
 const mh=a/3.6;
 const V=munsellCuspV(mh);
 const C=K.cmaxHV(mh,V)*0.95;
 return K.HVC2srgb(mh,V,C);
}
const _ringCache=new Map();
function ringBase(type,size){
 const key=type+"_"+size;
 if(_ringCache.has(key))return _ringCache.get(key);
 const cv=document.createElement("canvas");cv.width=size;cv.height=size;
 const cx=cv.getContext("2d");
 const c0=size/2, r1=size/2-4, r0=size*0.30;
 /* WS-04: munsellもrgb/ryb/okと同じ「角度=色相のみ、半径方向は単一バンド(NR=1)」の
    純粋なドーナツ型へ統一する(旧実装はNR=20でmunsell分岐だけ半径方向にValueを敷いており、
    ドーナツの見た目のまま実質「×バリュー」機能が残存していた点を完全に解消する)。
    WS-16 S1-1(Sonnet): 各環の色決定はwheelRepSrgb()に一本化した(旧実装は本関数内に
    type別の色式を直書きしていたが、commonHueFromWheel/wheelAngleFromCommonHueとの
    定義の食い違いを防ぐため、ここでは呼ぶだけにする。ジオメトリ(NA/NR/r0/r1/キャッシュ)は
    一切変更していない)。 */
 const NA=360, NR=1;
 for(let ai=0;ai<NA;ai++){
  const a0=ai/NA*TAU, a1=(ai+1.15)/NA*TAU;
  for(let ri=0;ri<NR;ri++){
   const rr0=r0+(r1-r0)*ri/NR, rr1=r0+(r1-r0)*(ri+1.05)/NR;
   const angDeg=mod360((ai+0.5)/NA*360);
   const col=K.hex(wheelRepSrgb(type,angDeg));
   cx.beginPath();
   cx.moveTo(c0+rr0*Math.cos(a0),c0+rr0*Math.sin(a0));
   cx.arc(c0,c0,rr1,a0,a1);
   cx.lineTo(c0+rr0*Math.cos(a1),c0+rr0*Math.sin(a1));
   cx.arc(c0,c0,rr0,a1,a0,true);
   cx.fillStyle=col; cx.fill();
  }
 }
 cx.strokeStyle="rgba(255,255,255,0.18)"; cx.lineWidth=1;
 cx.beginPath();cx.arc(c0,c0,r1,0,TAU);cx.stroke();
 cx.beginPath();cx.arc(c0,c0,r0,0,TAU);cx.stroke();
 _ringCache.set(key,cv);
 return cv;
}
/* WS-04: 旧munsellDisc()(角度=マンセル色相・半径=Value のフルディスク表示)は廃止した。
   マンセル色相環は他の環(rgb/ryb)と同じ「角度=色相のみ」のドーナツ型(ringBase)に統一し、
   「バリュームをかける」機能そのものをなくす(ユーザー要求どおり)。 */

function ringAngleOf(srgb,type){
 if(type==="rgb")return K.rgb2hsl(srgb)[0];
 if(type==="ryb")return K.rybFromHsl(K.rgb2hsl(srgb)[0]);
 if(type==="munsell")return K.srgb2HVC(srgb).H*3.6;
 return K.okLCh(K.srgb2ok(srgb))[2]; /* ok */
}
function drawDot(cx,size,ang,rFrac,fill,rad,ringCol,r0Frac){
 const r0f=(r0Frac==null?0.30:r0Frac);
 const c0=size/2, rr=(size/2-4-size*r0f)*rFrac+size*r0f;
 const x=c0+rr*Math.cos(ang*D2R), y=c0+rr*Math.sin(ang*D2R);
 cx.beginPath();cx.arc(x,y,rad,0,TAU);
 cx.fillStyle=fill;cx.fill();
 cx.lineWidth=1.4;cx.strokeStyle=ringCol||"#000";cx.stroke();
 return [x,y];
}
/* ============================================================
   §III-2(b)(c): 色相環3種比較 — ドラッグ仮選択色プローブ + キャリブレーション回転。
   ============================================================ */
/* 各環の角度と「共通表現(RGB=HSL色相角)」を相互変換する。既存のringAngleOf/K内の変換関数のみを
   組み合わせて構成しており、新しい色変換数式は発明していない(§III-2b指示)。
   WS-16 S1-3(Sonnet実装): rgb/rybは解析的な逆写像を維持する(既存どおり)。munsell/okは
   wheelRepSrgb基準のLUT+二分探索で厳密な逆写像を構築する(旧実装は往復誤差が最大14.6°
   あり、単体表示のドラッグ追従にそのまま使うと指と点がずれるため、ここで解消する)。 */
function commonHueFromWheel(angleDeg,type){
 if(type==="rgb")return mod360(angleDeg);
 if(type==="ryb")return K.hslFromRyb(mod360(angleDeg));
 const srgb=wheelRepSrgb(type,angleDeg).map(v=>clamp(v,0,1));
 return K.rgb2hsl(srgb)[0];
}
/* LUT: 1°刻みでcommonHueFromWheelをサンプルし、角度→色相の増加列(un)へ展開(unwrap)する。
   360点全域でmin d=0.398(実測)と余裕を持って単調増加のため、二分探索で一意に逆引きできる。
   起動時ではなく初回参照時に1回だけ構築し、以後はモジュールスコープでキャッシュする
   (_ringCache/_diskGamutCacheと同じ「初回のみ計算・以後再利用」の流儀)。 */
const _wheelHueLUTCache=new Map();
function _buildWheelHueLUT(type){
 const N=360;
 const raw=new Float64Array(N);
 for(let a=0;a<N;a++) raw[a]=commonHueFromWheel(a,type);
 const un=new Float64Array(N+1);
 un[0]=raw[0];
 for(let a=1;a<N;a++){
  let d=raw[a]-raw[a-1]; if(d>180)d-=360; else if(d<-180)d+=360;
  un[a]=un[a-1]+d;
 }
 let dClose=(raw[0]+360)-raw[N-1]; if(dClose>180)dClose-=360; else if(dClose<-180)dClose+=360;
 un[N]=un[N-1]+dClose;
 return un;
}
function _wheelHueLUT(type){
 if(!_wheelHueLUTCache.has(type))_wheelHueLUTCache.set(type,_buildWheelHueLUT(type));
 return _wheelHueLUTCache.get(type);
}
function wheelAngleFromCommonHue(hue,type){
 if(type==="rgb")return mod360(hue);
 if(type==="ryb")return K.rybFromHsl(mod360(hue));
 const un=_wheelHueLUT(type);
 const base=un[0], h=mod360(hue);
 const target=base+mod360(h-base);
 if(target<=un[0])return 0;
 if(target>=un[360])return 360;
 let lo=0,hi=360;
 while(hi-lo>1){ const mid=(lo+hi)>>1; if(un[mid]<=target)lo=mid; else hi=mid; }
 const tt=(target-un[lo])/(un[hi]-un[lo]);
 return mod360(lo+tt);
}
/* rotOff: 各環の表示回転オフセット。一時状態でありUndo外・localStorage非永続(§III-2c指示どおり
   stateにもguidesCfgにも入れず、モジュールスコープの素の変数として持つ)。 */
let _wheelRotOff={rgb:0,ryb:0,munsell:0};
/* GamutWheelUI(既存の頂点ドラッグ実装、L4914近傍)と同型の attach(canvas) パターンを踏襲する。 */
/* WS-16 S2(Sonnet実装): attachの第2引数は値(既存の3種比較呼び出し)または関数(単体表示。
   環種別がプルダウンで動的に変わるため)のどちらでも受けられるようにする。
   state.file.hasによるガードは撤去する(このプローブは画像編集パイプラインに一切接続しない
   純粋なUI教材であり、画像が無くても色相環の教材としてドラッグできる方が正しい。§WS-16 S2-2)。 */
const WheelProbeUI={
 dragType:null, rawAngle:0,
 attach(canvas,typeOrFn){
  const T=()=>(typeof typeOrFn==="function"?typeOrFn():typeOrFn);
  const angleOf=e=>{
   const r=canvas.getBoundingClientRect();
   const x=(e.clientX-r.left)*(canvas.width/r.width)-canvas.width/2;
   const y=(e.clientY-r.top)*(canvas.height/r.height)-canvas.height/2;
   return mod360(Math.atan2(y,x)*R2D);
  };
  const startOrMove=e=>{
   const type=T();
   this.rawAngle=angleOf(e);
   /* WS-16: スウォッチは「指の下にある環」の実色(wheelRepSrgb)を使う。h_rgbは他環へ
      写すための共通表現として従来どおり保持する(3種比較でのマーカー変換に必要)。 */
   state.analysis._wheelProbe={
    h_rgb:commonHueFromWheel(this.rawAngle,type),
    srgb:wheelRepSrgb(type,this.rawAngle),
    srcType:type,
    active:true
   };
   drawWheels();
  };
  canvas.addEventListener("pointerdown",e=>{
   const type=T();
   canvas.setPointerCapture(e.pointerId);
   /* §III-2c: 掴んだ瞬間のキャリブレーション。基準色(既存プローブ、なければ現在の実選択色)の
      マーカーが3環とも同一スクリーン角度に来るよう、掴んだ環以外のrotOffを再計算する。
      掴んだ環自身はrotOff=0にして生角度で1:1追従させる(§III-2c「以後のドラッグでは、
      掴んだ環のマーカーは指に追従し」に対応)。基準となる色が無い場合はrotOffに触れない。
      単体表示(3種比較モードでない)ではrotOffの概念がそもそも無いため、対象環のみ0に
      戻して他環の再計算はスキップする(3種比較用の状態を単体操作で汚さない)。 */
   const probe=state.analysis._wheelProbe, pk=state.analysis.pick;
   let refHue=null;
   if(probe.active) refHue=probe.h_rgb;
   else if(pk) refHue=K.rgb2hsl(isHold()?pk.orig:pk.edited)[0];
   _wheelRotOff[type]=0;
   if(refHue!=null && state.analysis.compareMode){
    const targetAngle=wheelAngleFromCommonHue(refHue,type);
    ["rgb","ryb","munsell"].forEach(other=>{
     if(other===type)return;
     _wheelRotOff[other]=mod360(targetAngle-wheelAngleFromCommonHue(refHue,other));
    });
   }
   this.dragType=type;
   startOrMove(e);
  });
  canvas.addEventListener("pointermove",e=>{ if(this.dragType===T())startOrMove(e); });
  const up=()=>{ if(this.dragType===T())this.dragType=null; };
  canvas.addEventListener("pointerup",up);
  canvas.addEventListener("pointercancel",up);
 }
};
/* 解析タブの環描画: 選択色 + アクティブなヒューノード(前後) + §III-2b/cのドラッグ仮選択色プローブ */
/* WS-04: 共通アンカーティック。RGB色相環を基準とする12分割(30°刻み)の代表色相を、
   各環自身の角度写像(wheelAngleFromCommonHue)で変換した位置に短い目盛線として描く。
   目盛の色は「その代表色相の実際の色」にするため、同じ色のティックが環ごとに違う角度へ
   来ることが一目でわかる(=環同士のズレの静的な一覧)。ホイール本体の描画方式(ringBase等)は
   一切変更せず、外周への追記描画のみで完結させる。 */
function drawWheelAnchorTicks(cx,size,type,rotOff){
 const c0=size/2, r1=size/2-4, r0=size*0.30;
 for(let h=0;h<360;h+=30){
  const ang=mod360(wheelAngleFromCommonHue(h,type)+(rotOff||0))*D2R;
  const col=K.hex(K.hsl2rgb(h,0.92,0.55));
  const x0=c0+(r1+1)*Math.cos(ang), y0=c0+(r1+1)*Math.sin(ang);
  const x1=c0+(r1+7)*Math.cos(ang), y1=c0+(r1+7)*Math.sin(ang);
  cx.beginPath(); cx.moveTo(x0,y0); cx.lineTo(x1,y1);
  cx.strokeStyle=col; cx.lineWidth=Math.max(2,size/60); cx.lineCap="round"; cx.stroke();
 }
}
/* Fix1(重ね合わせ比較の見にくさ): 3環重ね合わせ専用の帯域ジオメトリ。
   旧実装はringBase()の1枚絵(r0=size*0.30, r1=size/2-4の固定ドーナツ)を環ごとに
   異なる倍率(sc)で縮小して重ねていたため、①内側の環ほど帯が薄くなる(rgb:20.8px→
   munsell:40px、実測)②隣接する帯域同士が5〜14.6px物理的に重なり、後から描く環が
   先に描いた環を覆い隠す、という2つの原因で「とても見にくい」状態になっていた
   (根本原因の分析はWS-16後続対応の作業記録を参照)。
   ここでは3本の帯域を「重ならず・同じ太さ」になるようゼロから座標設計し直す。
   ringBase()自体・単体表示・3種比較(wT0/wT1/wT2)の描画には一切触れない
   (このオブジェクトはoverlaid分岐でのみ使う)。 */
function _overlayBands(size){
 const safeR=size/2-4;
 const centerGap=size*0.0538, bandGap=size*0.0231;
 const bandW=(safeR-centerGap-bandGap*2)/3;
 const bands=[]; let r=centerGap;
 for(let i=0;i<3;i++){ bands.push([r,r+bandW]); r=r+bandW+bandGap; }
 return bands; /* [ [r0,r1]_rgb, [r0,r1]_ryb, [r0,r1]_munsell ] (重ならず・等幅) */
}
/* 指定した半径帯[r0,r1]に、その角度での実際の色(wheelRepSrgb、S1で導入した単一の真実の
   代表色関数)を360分割で塗る。ringBase()と同じ塗り方だが、キャッシュせず任意のr0/r1を
   直接受け取れるようにした専用版(重ね合わせは環ごとに帯域が異なるため、size固定の
   ringBase()キャッシュをそのまま流用できない)。 */
function _drawOverlayBand(cx,c0,r0,r1,type){
 const NA=360;
 for(let ai=0;ai<NA;ai++){
  const a0=ai/NA*TAU, a1=(ai+1.15)/NA*TAU;
  const angDeg=mod360((ai+0.5)/NA*360);
  cx.beginPath();
  cx.moveTo(c0+r0*Math.cos(a0),c0+r0*Math.sin(a0));
  cx.arc(c0,c0,r1,a0,a1);
  cx.lineTo(c0+r0*Math.cos(a1),c0+r0*Math.sin(a1));
  cx.arc(c0,c0,r0,a1,a0,true);
  cx.fillStyle=K.hex(wheelRepSrgb(type,angDeg)); cx.fill();
 }
 cx.strokeStyle="rgba(255,255,255,0.35)"; cx.lineWidth=1;
 cx.beginPath(); cx.arc(c0,c0,r1,0,TAU); cx.stroke();
 cx.beginPath(); cx.arc(c0,c0,r0,0,TAU); cx.stroke();
}
function drawAnalysisWheel(canvas,type,overlaid){
 const size=canvas.width;
 const cx=canvas.getContext("2d");
 cx.clearRect(0,0,size,size);
 const showTicks=state.analysis.anchorTicks;
 /* WS-16 S2: _wheelRotOff(3種比較のキャリブレーション回転)は単体表示には無関係の概念。
    overlaid(重ね合わせビュー)はcompareMode内でのみ存在するため常に本来のrotOffを使うが、
    非overlaidの単体呼び出し(drawWheels()のcompareMode===false分岐)では0として扱う。
    これにより「3種比較で回転させた後に単体表示へ戻ると位置がずれる」汚染を防ぐ。 */
 const rotOff = state.analysis.compareMode ? (_wheelRotOff[type]||0) : 0;
 const OVERLAY_TYPES=["rgb","ryb","munsell"];
 if(overlaid){
  /* Fix1: 3環を「重ならない等幅の帯域」として描く(旧: 縮小コピーを重ねて隣接帯域が
     5〜14.6px重複していた)。ティック(共通アンカーティック)は狭い帯域内で隣の帯域へ
     食い込み色が衝突する原因の一つだったため、重ね合わせビューでは表示しない
     (wT0/wT1/wT2の個別ホイールでは従来どおり表示されるため、機能自体は失われない)。 */
  const c0=size/2, bands=_overlayBands(size);
  OVERLAY_TYPES.forEach((tp,i)=>{ _drawOverlayBand(cx,c0,bands[i][0],bands[i][1],tp); });
 }else{
  cx.drawImage(ringBase(type,size),0,0);
  if(showTicks)drawWheelAnchorTicks(cx,size,type,rotOff);
 }
 const plot=(srgb,rad,ringCol)=>{
  if(overlaid){
   const c0=size/2, bands=_overlayBands(size);
   OVERLAY_TYPES.forEach((tp,i)=>{
    /* §III-2c: 重ね合わせ表示にもキャリブレーション回転オフセットを適用する(仕様指示どおり) */
    const ang=mod360(ringAngleOf(srgb,tp)+_wheelRotOff[tp])*D2R;
    const midR=(bands[i][0]+bands[i][1])/2;
    const x=c0+midR*Math.cos(ang), y=c0+midR*Math.sin(ang);
    cx.beginPath(); cx.arc(x,y,rad,0,TAU);
    cx.fillStyle=K.hex(srgb); cx.fill();
    cx.lineWidth=1.4; cx.strokeStyle=ringCol||"#000"; cx.stroke();
   });
  }else{
   /* WS-04: 旧実装はmunsellのみV→半径の特殊分岐だったが、×バリュー廃止に伴い
      全タイプ共通(rFrac=0.5固定・r0f=0.30固定)のドーナツ上プロットに統一する。 */
   drawDot(cx,size,mod360(ringAngleOf(srgb,type)+rotOff),0.5,K.hex(srgb),rad,ringCol,0.30);
  }
 };
 const pk=state.analysis.pick;
 if(pk)plot(isHold()?pk.orig:pk.edited,6,"#fff");
 if(state.hueWarp.enabled&&state.hueWarp.nodes.length){
  state.hueWarp.nodes.forEach((n,i)=>{
   plot(nodeAfterSrgb(n),4,NODE_COLORS[i%5]);
  });
 }
 /* §III-2b/c: ドラッグ仮選択色プローブ。state.analysis.pick・数値パネル・マンセルHVC・配色・
    マスク等へは一切書き込まず、このホイール描画だけに一時的に重ねる(素通りフック)。
    ドラッグ中の当該ホイール自身は生角度(WheelProbeUI.rawAngle)で1:1追従させ、他ホイールは
    共通色相角+rotOffで描く(自環の丸め誤差による追従ズレを避けるため)。
    WS-16 S2-2(3): スウォッチ色は「指の下にある環(probe.srcType)」の実色(probe.srgb)を使う。
    旧実装はh_rgbからRGB環の代表色を再構成しており、マンセル環をドラッグしていても
    常にRGB環の色が出る不整合があった(科学的にもUX的にも誤り)。probe.srgbが無い
    (旧state等の防御的フォールバック)場合のみ、従来のRGB環代表色で近似する。 */
 const probe=state.analysis._wheelProbe;
 if(probe&&probe.active){
  const swatch=K.hex(probe.srgb||K.hsl2rgb(mod360(probe.h_rgb),0.92,0.55));
  if(overlaid){
   const c0=size/2, bands=_overlayBands(size);
   OVERLAY_TYPES.forEach((tp,i)=>{
    const ang=((WheelProbeUI.dragType===tp)?WheelProbeUI.rawAngle:mod360(wheelAngleFromCommonHue(probe.h_rgb,tp)+_wheelRotOff[tp]))*D2R;
    const midR=(bands[i][0]+bands[i][1])/2;
    const x=c0+midR*Math.cos(ang), y=c0+midR*Math.sin(ang);
    cx.beginPath(); cx.arc(x,y,5,0,TAU);
    cx.fillStyle=swatch; cx.fill();
    cx.lineWidth=1.4; cx.strokeStyle="#ffe066"; cx.stroke();
   });
  }else if(type==="rgb"||type==="ryb"||type==="munsell"){
   const ang=(WheelProbeUI.dragType===type)?WheelProbeUI.rawAngle:mod360(wheelAngleFromCommonHue(probe.h_rgb,type)+rotOff);
   drawDot(cx,size,ang,0.5,swatch,5,"#ffe066",0.30);
  }
 }
}
/* WS-04: 3種比較モードの角度+Δ数値表示。「現在の代表色」= ドラッグ仮選択プローブがあれば
   それを最優先、なければ実選択色(state.analysis.pick)、どちらも無ければ「—」を表示する
   (drawAnalysisWheelのプロット優先順位とは独立の、この読み出し専用の判断基準)。
   数値検証(WS-04)で判明した点: wheelAngleFromCommonHue→commonHueFromWheelの往復はmunsellで
   最大約16°の誤差があり完全な逆写像ではない。そのため実測ピックの角度は、実際にドットが
   描かれる式と全く同じ式(ringAngleOf(srgb,type)、既存のplot()と同一)で計算し、プローブの
   角度もドラッグ描画と同じ式(wheelAngleFromCommonHue+rotOff、既存のプローブ描画分岐と同一)
   で計算する。こうすることで、表示される数値は常に画面上のドットの実位置と一致する
   (「見えている位置」と「読み上げられる数値」が食い違わないことを最優先する)。
   RGB環の角度を基準(Δ+0°固定)とし、他2環はRGB角度との符号付き最短差分(angDiff)を表示する。 */
function updateWheelAngleReadouts(){
 const els={rgb:$("wT0Angle"),ryb:$("wT1Angle"),munsell:$("wT2Angle")};
 if(!els.rgb)return;
 const probe=state.analysis._wheelProbe;
 const pk=state.analysis.pick;
 let angs=null;
 if(probe&&probe.active){
  angs={};
  ["rgb","ryb","munsell"].forEach(tp=>{
   angs[tp]=(WheelProbeUI.dragType===tp)?WheelProbeUI.rawAngle:mod360(wheelAngleFromCommonHue(probe.h_rgb,tp)+_wheelRotOff[tp]);
  });
 }else if(pk){
  const srgb=isHold()?pk.orig:pk.edited;
  angs={};
  ["rgb","ryb","munsell"].forEach(tp=>{ angs[tp]=mod360(ringAngleOf(srgb,tp)+_wheelRotOff[tp]); });
 }
 if(!angs){ Object.values(els).forEach(el=>el.textContent="—"); return; }
 els.rgb.textContent=fmt(angs.rgb,0)+"°";
 ["ryb","munsell"].forEach(tp=>{
  const d=angDiff(angs.rgb,angs[tp]);
  els[tp].textContent=fmt(angs[tp],0)+"° (Δ"+(d>=0?"+":"")+fmt(d,0)+"°)";
 });
}
/* WS-16 S2-3(Sonnet実装): 単体表示でドラッグしたときの数値パネル。表示するのは
   「色相環上の代表色」であり「画像から拾った色」ではないため、混同を防ぐ注記(wheel.probeHint)を
   必ず添える。画像上のクリックでdoPick()がprobe.active=falseに戻すため、このパネルは自動的に
   消える(既存挙動をそのまま利用)。 */
function updateWheelProbeOut(){
 const wrap=$("wheelProbeOut"); if(!wrap)return;
 const probe=state.analysis._wheelProbe;
 if(!probe||!probe.active||!probe.srgb){ wrap.style.display="none"; return; }
 wrap.style.display="";
 const srgb=probe.srgb;
 const hex=K.hex(srgb);
 const rgb255=srgb.map(v=>Math.round(clamp(v,0,1)*255));
 const hsv=K.rgb2hsv(srgb);
 const lch=K.okLCh(K.srgb2ok(srgb));
 const hvc=K.srgb2HVC(srgb);
 $("wpSwatch").style.background=hex;
 const typeLabel={rgb:"RGB",ryb:"RYB",munsell:t("ui.wheelOptMunsellShort")}[probe.srcType]||"";
 /* 単体表示ではrotOffは常に0(drawAnalysisWheelと同じ扱い)。ドラッグ中の当該環は
    生角度(WheelProbeUI.rawAngle)、それ以外は逆写像(round-trip誤差<1°保証)を用いる。 */
 const ang=(WheelProbeUI.dragType===probe.srcType)?WheelProbeUI.rawAngle:wheelAngleFromCommonHue(probe.h_rgb,probe.srcType);
 $("wpAngle").textContent=typeLabel+"  θ="+fmt(mod360(ang),0)+"°";
 $("wpMunsell").textContent=t("ui.munsellApproxLabel",{h:K.mhLabel(hvc.H),v:fmt(hvc.V,1),c:fmt(hvc.C,1)});
 $("wpHex").textContent=hex;
 $("wpRGB").textContent=rgb255.join(", ");
 $("wpHSV").textContent=Math.round(hsv[0])+"°, "+Math.round(hsv[1]*100)+"%, "+Math.round(hsv[2]*100)+"%";
 $("wpOk").textContent="L "+fmt(lch[0],2)+"  C "+fmt(lch[1],3)+"  h "+fmt(lch[2],0)+"°";
}
function drawWheels(){
 if(state.ui.tab==="analyze"){
  if(!state.analysis.compareMode){
   drawAnalysisWheel($("wheelSingle"),state.analysis.wheelType,false);
   updateWheelProbeOut(); /* WS-16 S2 */
  }else{
   drawAnalysisWheel($("wT0"),"rgb",false);
   drawAnalysisWheel($("wT1"),"ryb",false);
   drawAnalysisWheel($("wT2"),"munsell",false);
   updateWheelAngleReadouts();
   if(state.analysis.showOverlay)drawAnalysisWheel($("wOver"),null,true);
  }
 }
 if(state.ui.tab==="mixing")drawHueWheel();
 if(state.ui.tab==="scheme")drawSchemeWheel();
}
/* ============================================================
   WS-05: HSB ⇔ RGB 比較(新規、教育目的の純UIウィジェット)
   画像編集パイプライン(state.*)には一切接続しない。すべて揮発UIで完結する。
   ============================================================ */
/* K.rgb2hsv(既存)の逆変換。Kオブジェクト自体は基幹の一部として変更せず、
   この節専用のローカル関数として追加する(標準書の指示どおり)。h:0-360, s,v:0-1。
   構造はK.hsl2rgbと同じ書式(既存の色変換コードの流儀を踏襲、新しい数式は発明していない
   — 標準的なHSV→RGB変換式そのもの)。 */
function hsv2rgbLocal(h,s,v){
 h=mod360(h);
 const c=v*s, x=c*(1-Math.abs((h/60)%2-1)), m=v-c;
 let r,g,b;
 if(h<60)[r,g,b]=[c,x,0];else if(h<120)[r,g,b]=[x,c,0];else if(h<180)[r,g,b]=[0,c,x];
 else if(h<240)[r,g,b]=[0,x,c];else if(h<300)[r,g,b]=[x,0,c];else [r,g,b]=[c,0,x];
 return [r+m,g+m,b+m];
}
/* 各スライダーのトラック背景を「他成分固定・当該成分だけ掃引」のグラデーションにする。
   sweepFn(t)はt(0..1)に対する[r,g,b](0..1)を返す関数。CSS変数--gtrackへセットするだけで、
   対応するinputのCSS(.gradTrack::-webkit-slider-runnable-track)がそのまま反映する。 */
function _cmpSetGradient(el,sweepFn,steps){
 const stops=[]; for(let i=0;i<=steps;i++)stops.push(K.hex(sweepFn(i/steps)));
 el.style.setProperty("--gtrack","linear-gradient(to right,"+stops.join(",")+")");
}
/* 直近の値を保持し、次回入力時に「何が変化したか」の言語化ヒントに使う。
   揮発的なモジュールスコープ変数(state非接触)。 */
let _cmpPrev=null;
function cmpUpdateAll(sourceGroup,movedLabel){
 const hEl=$("cmpH"),sEl=$("cmpS"),bEl=$("cmpB"),rEl=$("cmpR"),gEl=$("cmpG"),blEl=$("cmpBl");
 if(!hEl)return; /* DOM未生成の呼び出し順に対する安全弁(他ウィジェットと同じ流儀) */
 let h=+hEl.value,s=+sEl.value/100,v=+bEl.value/100;
 let r=+rEl.value,g=+gEl.value,bl=+blEl.value;
 const prevOther=_cmpPrev?(sourceGroup==="hsb"?{r:_cmpPrev.r,g:_cmpPrev.g,bl:_cmpPrev.bl}:{h:_cmpPrev.h,s:_cmpPrev.s,v:_cmpPrev.v}):null;
 if(sourceGroup==="hsb"){
  const rgb=hsv2rgbLocal(h,s,v).map(x=>clamp(x,0,1));
  r=Math.round(rgb[0]*255); g=Math.round(rgb[1]*255); bl=Math.round(rgb[2]*255);
  rEl.value=r; gEl.value=g; blEl.value=bl;
 }else{
  const hsv=K.rgb2hsv([r/255,g/255,bl/255]);
  h=Math.round(hsv[0]); s=hsv[1]; v=hsv[2];
  hEl.value=h; sEl.value=Math.round(s*100); bEl.value=Math.round(v*100);
 }
 $("vCmpH").textContent=Math.round(h)+"°"; $("vCmpS").textContent=Math.round(s*100)+"%"; $("vCmpB").textContent=Math.round(v*100)+"%";
 $("vCmpR").textContent=r; $("vCmpG").textContent=g; $("vCmpBl").textContent=bl;
 const hex=K.hex([r/255,g/255,bl/255]);
 $("cmpSwatch").style.background=hex; $("cmpHex").textContent=hex;
 /* 6本すべてのトラックを「現在の他2値を固定し当該成分だけ掃引」で再生成 */
 _cmpSetGradient(hEl,t=>hsv2rgbLocal(t*360,s,v),12);
 _cmpSetGradient(sEl,t=>hsv2rgbLocal(h,t,v),8);
 _cmpSetGradient(bEl,t=>hsv2rgbLocal(h,s,t),8);
 _cmpSetGradient(rEl,t=>[t,g/255,bl/255],2);
 _cmpSetGradient(gEl,t=>[r/255,t,bl/255],2);
 _cmpSetGradient(blEl,t=>[r/255,g/255,t],2);
 /* 変化ヒント: 動かした成分名と、それによって「他方モデル」で変化した成分を言語化する。
    比較対象は「直前にこの関数を通った時点の他方モデル値」(=このスライダー操作の前の状態)。 */
 if(movedLabel&&prevOther){
  const changed=[];
  if(sourceGroup==="hsb"){
   if(Math.abs(prevOther.r-r)>=1)changed.push("R");
   if(Math.abs(prevOther.g-g)>=1)changed.push("G");
   if(Math.abs(prevOther.bl-bl)>=1)changed.push("B");
  }else{
   if(Math.abs(angDiff(prevOther.h,h))>=1)changed.push("H");
   if(Math.abs(prevOther.s-s)>=0.005)changed.push("S");
   if(Math.abs(prevOther.v-v)>=0.005)changed.push("B");
  }
  $("cmpChangeHint").textContent=changed.length?t("ui.cmpChangeHint",{moved:movedLabel,changed:changed.join("/")}):t("ui.cmpChangeHintNone",{moved:movedLabel});
 }
 _cmpPrev={h,s,v,r,g,bl};
}
function initCmpWidget(){
 if(!$("cmpH"))return;
 const pk=state.analysis.pick;
 if(pk){
  const c=isHold()?pk.orig:pk.edited;
  $("cmpR").value=Math.round(c[0]*255); $("cmpG").value=Math.round(c[1]*255); $("cmpBl").value=Math.round(c[2]*255);
  cmpUpdateAll("rgb",null);
 }else cmpUpdateAll("hsb",null);
}

/* ---- 環境光ホイール: 無彩色中心を含む円盤(ディスク)。中心=無彩色、
   外周=最大彩度。角度=色相、半径=彩度(a,b)。ドーナツ型からの変更点。 ---- */
const DISC_MAX_C=0.35;
const _discCache=new Map();
/* 円盤の下地(ImageDataで全ピクセル走査)。既定L=0.72固定。自前キャッシュ。
   §VI-2: 第2引数Lで明度を上書きできるよう拡張(既定値省略時は従来と完全に同一の0.72固定・
   同一キャッシュ内容になるため、環境光ホイール(HueWheelUI)等の既存呼び出し元は無変更)。
   配色ホイールの「円盤の明るさも連動」時のみLを渡す(§VI-2、0.05刻みに量子化してキャッシュ)。 */
function discBase(size,L){
 const Ldisc=(L==null)?0.72:L;
 const key="disc_"+size+"_"+Ldisc;
 if(_discCache.has(key))return _discCache.get(key);
 const cv=document.createElement("canvas");cv.width=size;cv.height=size;
 const cx=cv.getContext("2d");
 const c0=size/2, R=size/2-4;
 const cmL=new Float32Array(360);               // cmax LUT(整数度)
 for(let d=0;d<360;d++) cmL[d]=K.cmax(Ldisc,d);
 const id=cx.createImageData(size,size), D=id.data;
 for(let py=0;py<size;py++){
  for(let px=0;px<size;px++){
   const dx=px+0.5-c0, dy=py+0.5-c0, r=Math.hypot(dx,dy), o=(py*size+px)*4;
   if(r>R){ D[o+3]=0; continue; }
   const hue=mod360(Math.atan2(dy,dx)*R2D);
   let C=r/R*DISC_MAX_C; const cm=cmL[Math.floor(hue)%360]; if(C>cm)C=cm;
   const s=K.ok2srgb(K.lch2lab([Ldisc,C,hue]));
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
 _discCache.set(key,cv);
 return cv;
}
/* Oklab(a,b) → 円盤上のキャンバス座標。ガマット外は縁へクランプ。 */
function abPos(size,a,b){
 const R=size/2-4, s=R/DISC_MAX_C;
 let A=a,B=b; const h=Math.hypot(a,b);
 if(h>DISC_MAX_C){ const k=DISC_MAX_C/h; A=a*k; B=b*k; }
 return [size/2+A*s, size/2+B*s];
}
/* 元→後を結ぶ矢印(線+先端三角)。距離が近すぎる時は省略。 */
function drawArrow(cx,x0,y0,x1,y1,col){
 const dx=x1-x0, dy=y1-y0, len=Math.hypot(dx,dy);
 if(len<2) return;
 const ux=dx/len, uy=dy/len, tipPad=7, ah=6, aw=3.2;
 const tx=x1-ux*tipPad, ty=y1-uy*tipPad;      // dst丸の手前で止める
 cx.save();
 cx.strokeStyle=col; cx.fillStyle=col; cx.globalAlpha=0.85; cx.lineWidth=1.4;
 cx.beginPath();cx.moveTo(x0+ux*6,y0+uy*6);cx.lineTo(tx,ty);cx.stroke();  // src丸の外から
 const bx=tx-ux*ah, by=ty-uy*ah;
 cx.beginPath();cx.moveTo(tx,ty);cx.lineTo(bx-uy*aw,by+ux*aw);cx.lineTo(bx+uy*aw,by-ux*aw);
 cx.closePath();cx.fill();
 cx.restore();
}
const HueWheelUI={
 dragging:false,
 attach(canvas){
  const getAngChroma=e=>{
   const r=canvas.getBoundingClientRect();
   const x=(e.clientX-r.left)*(canvas.width/r.width)-canvas.width/2;
   const y=(e.clientY-r.top)*(canvas.height/r.height)-canvas.height/2;
   const ang=mod360(Math.atan2(y,x)*R2D);
   const dist=Math.hypot(x,y);
   const frac=clamp(dist/(canvas.width/2-4),0,1);   // 円盤: 中心0〜外周1
   return {ang,chroma:frac*DISC_MAX_C};
  };
  canvas.addEventListener("pointerdown",e=>{
   this.dragging=true; canvas.setPointerCapture(e.pointerId);
   const {ang,chroma}=getAngChroma(e); wheelInput(ang,chroma);
  });
  canvas.addEventListener("pointermove",e=>{
   if(this.dragging){ const {ang,chroma}=getAngChroma(e); wheelInput(ang,chroma); }
  });
  const up=()=>{ this.dragging=false; };
  canvas.addEventListener("pointerup",up);
  canvas.addEventListener("pointercancel",up);
 }
};
/* RGBスライダー表示を state.hueWarp.light に同期 */
function syncLightSliders(){
 const L=state.hueWarp.light;
 $("lightR").value=L[0]; $("vlightR").textContent=fmt(L[0],3);
 $("lightG").value=L[1]; $("vlightG").textContent=fmt(L[1],3);
 $("lightB").value=L[2]; $("vlightB").textContent=fmt(L[2],3);
}
/* モード切替に伴うトグルon・行の表示・hint文言の同期 */
function syncModeUI(){
 const hw=state.hueWarp;
 $("hwModeRef").classList.toggle("on",hw.mode==="ref");
 $("hwModeLight").classList.toggle("on",hw.mode==="light");
 $("hwRowsRef").style.display=hw.mode==="ref"?"":"none";
 $("hwRowsLight").style.display=hw.mode==="light"?"":"none";
 $("hueHint").textContent = hw.mode==="ref"
  ? "代表点1つの移動先をホイール上でドラッグ指定すると、環境光を逆算して画像全体に適用します。他のプローブは結果を観測します"
  : "画像上をクリックで最大5点のプローブを登録。光のRGBバランスを操作すると、全プローブの色が円盤上で 元→後 の矢印として表示されます";
}
/* 環境光効果は density>0 で初めて画像へ反映される(pparams: enabled&&density>0)。
   ユーザーが光源色/代表点を操作した瞬間、density が 0 のままなら自動で 100% に
   引き上げて効果を可視化する。density を明示的に 0 超へ設定済みならその値を尊重する。
   ※従来モードA(代表点)のホイール操作にのみ入っていた同処理を関数化し、
     モードB(光源RGB直接操作)のスライダー/ホイール操作にも共通適用する。 */
function hueActivate(){
 const hw=state.hueWarp;
 if(hw.density===0){ hw.density=1.0; $("hueDensity").value=1; $("vhueDensity").textContent="100%"; }
}
/* ホイール入力(モード分岐)。単一情報源は state.hueWarp.light / refTarget */
function wheelInput(ang,chroma){
 const hw=state.hueWarp;
 if(hw.mode==="light"){
  hw.light=lightFromWheel(ang,chroma);
  syncLightSliders();
  hueActivate();
 }else{
  const ref=hw.nodes.find(n=>n.id===hw.refId);
  if(!ref){ status_(t("status.registerProbeFirst")); return; }
  hw.refTarget=[chroma*Math.cos(ang*D2R), chroma*Math.sin(ang*D2R)];
  hueActivate();
 }
 hueChanged(); persistSoon();
}
function drawHueWheel(){
 const hw=state.hueWarp;
 const canvas=$("hueWheel");
 const size=canvas.width;
 const cx=canvas.getContext("2d");
 const big=size>200;
 cx.clearRect(0,0,size,size);
 cx.drawImage(discBase(size),0,0);
 /* 光源マーカー(正規化E, 順応・density適用前)。E=[1,1,1]なら中心。 */
 const E=normLight(hw);
 const Elab=K.lin2ok(E);
 const [lx,ly]=abPos(size,Elab[1],Elab[2]);
 cx.beginPath();cx.arc(lx,ly,big?7:5,0,TAU);
 cx.fillStyle=K.hex(K.l2s(E.map(v=>clamp(v,0,1))));cx.fill();
 cx.lineWidth=2;cx.strokeStyle="#fff";cx.stroke();
 /* モードA: 目標ゴーストマーカー(点線円) */
 if(hw.mode==="ref"&&hw.refTarget){
  const [gx,gy]=abPos(size,hw.refTarget[0],hw.refTarget[1]);
  cx.save();cx.setLineDash([3,3]);
  cx.beginPath();cx.arc(gx,gy,big?9:7,0,TAU);
  cx.strokeStyle="rgba(255,255,255,0.85)";cx.lineWidth=1.5;cx.stroke();cx.restore();
 }
 /* 各プローブ: 元色(中空丸)→適用後色(実体丸)を矢印で結ぶ */
 hw.nodes.forEach((n,i)=>{
  const col=NODE_COLORS[i%5];
  const src=K.srgb2ok(n.srcRGB), after=nodeAfterSrgb(n), dst=K.srgb2ok(after);
  const [x0,y0]=abPos(size,src[1],src[2]);
  const [x1,y1]=abPos(size,dst[1],dst[2]);
  drawArrow(cx,x0,y0,x1,y1,col);
  cx.beginPath();cx.arc(x0,y0,5,0,TAU);           // 元色: 中空
  cx.fillStyle="rgba(0,0,0,0)";cx.fill();cx.lineWidth=1.4;cx.strokeStyle=col;cx.stroke();
  cx.beginPath();cx.arc(x1,y1,big?7:5,0,TAU);      // 後色: 実体
  cx.fillStyle=K.hex(after);cx.fill();cx.lineWidth=1.4;cx.strokeStyle=col;cx.stroke();
  if(hw.mode==="ref"&&n.id===hw.refId){            // 代表点強調(二重リング)
   cx.beginPath();cx.arc(x0,y0,9,0,TAU);cx.strokeStyle=col;cx.lineWidth=2;cx.stroke();
  }
  cx.fillStyle=col;cx.font="bold 10px sans-serif";cx.textAlign="center";
  cx.fillText(String(i+1),x1,y1-(big?12:9)-2);
 });
}
function refreshHueUI(){
 const hw=state.hueWarp;
 if(hw.mode==="ref"){
  const ref=hw.nodes.find(n=>n.id===hw.refId);
  $("refInfo").textContent = ref
   ? t("ui.refInfoSet",{n:hw.nodes.indexOf(ref)+1})
   : t("ui.refInfoUnset");
  if(ref&&hw.refTarget){ const E=normLight(hw);
   $("refLightOut").textContent=t("ui.refLightOut",{r:fmt(E[0],2),g:fmt(E[1],2),b:fmt(E[2],2)}); }
  else $("refLightOut").textContent="";
 }
 refreshDock(); drawHueWheel(); drawOverlay();
}

