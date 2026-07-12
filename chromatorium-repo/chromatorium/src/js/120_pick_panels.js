/* ============================================================
   スポイト & 5点ヒューノード管理 (2.1 / 4.2)
   ============================================================ */
const NODE_COLORS=["#ff5d5d","#ffb84d","#5dd08a","#5da8ff","#c98aff"];
function doPick(ix,iy){
 const r=state.global.pickRadius;
 const orig=sampleOriginal(ix,iy,r);
 const edited=R.pick(ix,iy,r)||orig.slice();
 state.analysis.pick={x:ix,y:iy,orig,edited};
 /* §III-2(b): 実選択が確定した瞬間、色相環のドラッグ仮選択色プローブを解除して実選択色の表示へ戻す */
 state.analysis._wheelProbe.active=false;
 /* §VI-1: 画像上でドット選択するたび、配色生成の基準色へ即時反映する(素通りフック)。
    配色タブが非表示でも状態(state.scheme.base)を更新し、genScheme()もそのまま呼んでおく
    (DOMは隠れていても更新コスト自体は軽く、タブを開いた瞬間には既に反映済みになる)。
    手動指定・パレット由来(VI-1/VI-4)は、この関数を通るたびに無条件で上書きされる=仕様どおり。 */
 const useForScheme=isHold()?orig:edited;
 setSchemeBase(useForScheme.slice(),"pick"); /* WS-10: lchも同時に正準再導出(意図的な色の選び直しのため正当) */
 genScheme();
 renderPalCur(); renderPalList(); /* §VI-4: パレット選択枠を解除(受け入れ基準(3)) */
 /* マンセル選択の追従 */
 const use=isHold()?orig:edited;
 const hvc=K.srgb2HVC(use);
 const m=state.munsell;
 m.pick=use.slice(); m.H=hvc.H; m.V=hvc.V;
 const cm=K.cmaxHV(m.H,m.V);
 if(m.mode==="pct"){ m.pct=cm>0?clamp(hvc.C/cm*100,0,100):0; m.C=Math.min(hvc.C,cm); }
 else m.C=hvc.C;
 if(state.ui.tab==="mixing"&&$("secHue").open) addHueNode(ix,iy,orig);
 mark("overlay","panels","mixpanel");
 refreshNumeric(); refreshMunsellUI(); drawWheels(); renderM3d(); updateCmpPanel(); updateRcSwatch();
 updateMixScalePickMarker(); /* F13 */
 if(typeof syncMaskPickButtons==="function")syncMaskPickButtons(); /* Fix2(a) */
}
function nodeAfterSrgb(node){
 const lin=applyPipeCPU(K.s2l(node.srcRGB),pparams());
 return K.l2s(lin);
}
/* プローブ点の登録: フィルター適用の前後を確認するための「観測点」であり、
   旧実装のように各点ごとに移動先の色相を持つわけではない(フィルターは
   画面全体に一様にかかる単一のもの)。 */
function addHueNode(ix,iy,orig){
 const hw=state.hueWarp;
 /* 無彩色ガードは撤廃: 新モデルでは無彩色こそ光源色を最も雄弁に示す観測点。 */
 const lch=K.okLCh(K.srgb2ok(orig));
 if(hw.nodes.length>=5){
  let best=null,bd=1e18;
  for(const n of hw.nodes){ const d=(n.imgX-ix)*(n.imgX-ix)+(n.imgY-iy)*(n.imgY-iy); if(d<bd){bd=d;best=n;} }
  best.imgX=ix;best.imgY=iy;best.srcRGB=orig;best.srcOKhue=lch[2];
 }else{
  hw.nodes.push({id:hw.nextId++,imgX:ix,imgY:iy,srcRGB:orig,srcOKhue:lch[2]});
 }
 if(hw.refId===null&&hw.nodes.length) hw.refId=hw.nodes[0].id;  // 最初の点を代表点に
 hueChanged();
}
function hueChanged(){
 mark("a","b","c","blur","screen","analysis","overlay","panels","mixpanel");
 refreshHueUI(); scheduleAnalysis();
}

/* ============================================================
   数値パネル (2.1) / ドックテーブル (4.2.3)
   ============================================================ */
function refreshNumeric(){
 const pk=state.analysis.pick;
 if(!pk){ $("numSrc").textContent=t("ui.pickClickHint"); $("numPos").textContent="";
  ["nvRGB","nvHSL","nvHSV","nvLab","nvOk"].forEach(id=>$(id).textContent="—");
  $("numSwatch").style.background="transparent"; return; }
 const useOrig=isHold();
 const c=useOrig?pk.orig:pk.edited;
 $("numSrc").textContent=useOrig?t("status.pickSrcOriginal"):t("status.pickSrcEdited");
 $("numPos").textContent=t("status.pickPosLabel",{x:Math.round(pk.x),y:Math.round(pk.y),r:state.global.pickRadius});
 $("numSwatch").style.background=K.hex(c);
 const b255=c.map(v=>Math.round(v*255));
 $("nvRGB").textContent=b255.join(", ")+"   "+K.hex(c);
 const hsl=K.rgb2hsl(c); $("nvHSL").textContent=fmt(hsl[0])+"°, "+fmt(hsl[1]*100)+"%, "+fmt(hsl[2]*100)+"%";
 const hsv=K.rgb2hsv(c); $("nvHSV").textContent=fmt(hsv[0])+"°, "+fmt(hsv[1]*100)+"%, "+fmt(hsv[2]*100)+"%";
 const lab=K.srgb2lab(c); $("nvLab").textContent="L "+fmt(lab[0])+"  a "+fmt(lab[1])+"  b "+fmt(lab[2]);
 const ok=K.okLCh(K.srgb2ok(c)); $("nvOk").textContent="L "+fmt(ok[0],3)+"  C "+fmt(ok[1],3)+"  h "+fmt(ok[2])+"°";
}
function refreshDock(){
 const hw=state.hueWarp;
 const show=state.ui.tab==="mixing"&&hw.nodes.length>0;
 $("dock").classList.toggle("show",show);
 if(!show)return;
 const isRef=hw.mode==="ref";
 const tb=$("dockBody"); tb.innerHTML="";
 hw.nodes.forEach((n,i)=>{
  const after=nodeAfterSrgb(n);
  const l0=K.okLCh(K.srgb2ok(n.srcRGB)), l1=K.okLCh(K.srgb2ok(after));
  const dh=angDiff(l0[2],l1[2]), dC=l1[1]-l0[1], dL=l1[0]-l0[0];
  const b0=n.srcRGB.map(v=>Math.round(v*255)), b1=after.map(v=>Math.round(v*255));
  const tr=document.createElement("tr");
  /* 代表列 */
  const tdRef=document.createElement("td");
  if(isRef){
   const rb=document.createElement("input");
   rb.type="radio"; rb.name="hwRef"; rb.checked=(n.id===hw.refId);
   rb.title=t("ui.setRepresentativePoint");
   rb.onclick=()=>{ hw.refId=n.id; hueChanged(); };
   tdRef.appendChild(rb);
  }
  tr.appendChild(tdRef);
  const fmtD=v=>(v>=0?"+":"")+fmt(v,3);
  const rest=document.createElement("template");
  rest.innerHTML="<td><span class='ndot' style='background:"+NODE_COLORS[i%5]+"'></span></td>"+
   "<td>"+(i+1)+"</td>"+
   "<td>"+(dh>=0?"+":"")+fmt(dh)+"°</td>"+
   "<td>"+fmtD(dC)+"</td>"+
   "<td>"+fmtD(dL)+"</td>"+
   "<td>"+b0.join(",")+"</td><td>"+b1.join(",")+"</td>";
  while(rest.content.firstChild) tr.appendChild(rest.content.firstChild);
  const tdDel=document.createElement("td");
  const btnDel=document.createElement("button");
  btnDel.className="mini"; btnDel.textContent="×"; btnDel.title=t("ui.deleteThisPoint");
  btnDel.onclick=()=>removeHueNode(n.id);
  tdDel.appendChild(btnDel);
  tr.appendChild(tdDel);
  tb.appendChild(tr);
 });
}
/* プローブ点を1つだけ削除 */
function removeHueNode(id){
 const hw=state.hueWarp;
 hw.nodes=hw.nodes.filter(n=>n.id!==id);
 if(hw.refId===id){ hw.refId=hw.nodes.length?hw.nodes[0].id:null; hw.refTarget=null; }
 hueChanged();
}
/* ============================================================
   オーバーレイSVG（書き出し経路とは物理分離 — 0.2保証）
   ============================================================ */
function drawOverlay(){
 const svg=$("overlay");
 const st=$("stage");
 svg.setAttribute("viewBox","0 0 "+st.clientWidth+" "+st.clientHeight);
 let s="";
 if(state.file.has){
  const pk=state.analysis.pick;
  if(pk){
   const [sx,sy]=Input.img2scr(pk.x,pk.y);
   const rr=Math.max(3,state.global.pickRadius*state.view.zoom);
   s+="<circle cx='"+sx+"' cy='"+sy+"' r='"+rr+"' fill='none' stroke='#fff' stroke-width='1.2' opacity='0.9'/>";
   s+="<circle cx='"+sx+"' cy='"+sy+"' r='"+(rr+1.5)+"' fill='none' stroke='#000' stroke-width='1' opacity='0.5'/>";
  }
  if(state.ui.tab==="mixing"){
   state.hueWarp.nodes.forEach((n,i)=>{
    const [sx,sy]=Input.img2scr(n.imgX,n.imgY);
    const col=NODE_COLORS[i%5];
    s+="<circle cx='"+sx+"' cy='"+sy+"' r='7' fill='"+col+"' stroke='#000' stroke-width='1' opacity='0.92'/>";
    s+="<text x='"+sx+"' y='"+(sy+3.5)+"' font-size='10' text-anchor='middle' fill='#000' font-weight='bold'>"+(i+1)+"</text>";
   });
  }
 }
 /* --- F2: トリミングモードのマスク+白枠+8ハンドル(既存描画への追記のみ) --- */
 if(Crop.active){
  const r=Crop.rect;
  const [x0,y0]=Input.img2scr(r.x,r.y);
  const [x1,y1]=Input.img2scr(r.x+r.w,r.y+r.h);
  s+="<path d='M0 0H"+st.clientWidth+"V"+st.clientHeight+"H0Z M"+x0+" "+y0+"H"+x0+"V"+y1+"H"+x1+"V"+y0+"Z' fill='rgba(0,0,0,.55)' fill-rule='evenodd'/>";
  s+="<rect x='"+x0+"' y='"+y0+"' width='"+(x1-x0)+"' height='"+(y1-y0)+"' fill='none' stroke='#fff' stroke-width='1.5' vector-effect='non-scaling-stroke'/>";
  Crop.handles().forEach(hd=>{
   const [px,py]=Input.img2scr(hd.x,hd.y);
   s+="<circle cx='"+px+"' cy='"+py+"' r='5' fill='#fff' stroke='#000' stroke-width='1'/>";
  });
 }
 /* --- F14: 部分マスクの矩形/なげなわ輪郭(破線)。マスク有効時、または描画中に表示 --- */
 if(state.file.has && (MaskDraw.active || state.mask.on) && state.mask.geo.on){
  const g=state.mask.geo;
  const pts=[];
  if(MaskDraw.active && MaskDraw.kind==="lasso" && MaskDraw._pts && MaskDraw._pts.length){
   MaskDraw._pts.forEach(([ix,iy])=>pts.push(Input.img2scr(ix,iy)));
  }else if(MaskDraw.active && MaskDraw.kind==="rect" && g.rect){
   const [rx,ry,rw,rh]=g.rect;
   [[rx,ry],[rx+rw,ry],[rx+rw,ry+rh],[rx,ry+rh]].forEach(([ix,iy])=>pts.push(Input.img2scr(ix,iy)));
  }else if(g.kind==="rect" && g.rect){
   const [rx,ry,rw,rh]=g.rect;
   [[rx,ry],[rx+rw,ry],[rx+rw,ry+rh],[rx,ry+rh]].forEach(([ix,iy])=>pts.push(Input.img2scr(ix,iy)));
  }else if(g.kind==="lasso" && g.lasso){
   g.lasso.forEach(([ix,iy])=>pts.push(Input.img2scr(ix,iy)));
  }
  if(pts.length>=2){
   const d="M"+pts.map(p=>p[0]+" "+p[1]).join(" L")+" Z";
   s+="<path d='"+d+"' fill='none' stroke='#ff5d5d' stroke-width='1.5' stroke-dasharray='5,4' vector-effect='non-scaling-stroke' opacity='0.95'/>";
  }
 }
 svg.innerHTML=s;
 /* --- F3: 常設補助線(guidesCfg) / トリミング中の補助線プレビュー ---
    drawGuidePattern()はSVG<g>要素へ直接DOM追記する(既存innerHTML描画の後段に追記するだけで、
    それより前の描画には一切干渉しない)。トリミングモード中は常設補助線を隠しcrop側を優先する。 */
 if(state.file.has && Crop.active && Crop.guideType!=="none"){
  const g=document.createElementNS("http://www.w3.org/2000/svg","g");
  const r=Crop.rect;
  const [x0,y0]=Input.img2scr(r.x,r.y), [x1,y1]=Input.img2scr(r.x+r.w,r.y+r.h);
  drawGuidePattern(g,x0,y0,x1-x0,y1-y0,Crop.guideType,{color:"#ffffff",width:1,opacity:0.85,gridN:4,spiralDir:guidesCfg.spiralDir});
  svg.appendChild(g);
 }else if(state.file.has && !Crop.active && guidesCfg.on){
  const g=document.createElementNS("http://www.w3.org/2000/svg","g");
  const [gx0,gy0]=Input.img2scr(0,0), [gx1,gy1]=Input.img2scr(state.file.w,state.file.h);
  drawGuidePattern(g,gx0,gy0,gx1-gx0,gy1-gy0,guidesCfg.type,guidesCfg);
  svg.appendChild(g);
 }
}

/* ============================================================
   F3. 補助線 (常時表示) — 描画関数はF2のトリミング補助線と共用。
   guidesCfgは「表示設定」であり編集ではないため UNDO_KEYS には入れず、
   localStorage(clab.v1.guides)にのみ永続化する(§F3 / R3)。
   ============================================================ */
let guidesCfg={on:false,type:"thirds",color:"#ffffff",width:1,opacity:0.8,gridN:4,spiralDir:0};
function loadGuidesCfg(){
 try{ const raw=localStorage.getItem("clab.v1.guides"); if(raw)Object.assign(guidesCfg,JSON.parse(raw)); }catch(e){}
}
function saveGuidesCfg(){
 try{ localStorage.setItem("clab.v1.guides",JSON.stringify(guidesCfg)); }catch(e){}
}
/* §VI-2: 配色ホイールの円盤を基準色の現在Lで再レンダリングするかどうかは「表示設定」であり
   編集ではないためUNDO_KEYSには入れず、localStorage(clab.v1.scheme)にのみ永続化する(guidesCfgと同型)。 */
let schemeCfg={discFollowL:false};
function loadSchemeCfg(){
 try{ const raw=localStorage.getItem("clab.v1.scheme"); if(raw)Object.assign(schemeCfg,JSON.parse(raw)); }catch(e){}
}
function saveSchemeCfg(){
 try{ localStorage.setItem("clab.v1.scheme",JSON.stringify(schemeCfg)); }catch(e){}
}
const Guides={
 toggle(){
  if(!state.file.has)return;
  guidesCfg.on=!guidesCfg.on;
  $("btnGuides").classList.toggle("on",guidesCfg.on);
  $("gdOn").checked=guidesCfg.on;
  saveGuidesCfg(); mark("overlay");
 }
};
/* ============================================================
   §III-1 黄金螺旋: 正準黄金矩形(幅φ・高さ1)で厳密に構成し、対象枠(任意アスペクト比)へ
   非等方(アニソトロピック)写像する。旧実装は対象枠(rx,ry,rw,rh)そのものの中で毎回
   正方形切り出しを行っていたため、(a) corner===2分岐がrw/rhを縮小し忘れて同じ弧を
   無限に再描画し、(b) 対象枠が厳密な黄金比でない限り辺長が黄金比数列にならず段差が出る、
   という2つの不具合があった。正準座標(=厳密に黄金比)で1度だけ構成すれば(a)(b)とも
   構造的に発生しない。写像後は円弧が楕円弧になるが、密なサンプリング点列で折れ線として
   描くため、8方位(4回転×鏡映)いずれの組み合わせでもSVG楕円弧コマンドのsweep-flag符号を
   個別検証する必要がなく、実装リスクが小さい(見た目は滑らかな曲線として十分な密度)。 */
const PHI=1.6180339887498949;
/* 正準座標(0..φ, 0..1)で8段の1/4円弧を構成する。corner 0=左を正方形として切出し/1=上/2=右/3=下、
   を周期4で回転させる。各弧は{cx,cy,r,a0,a1}(中心・半径・開始角・終了角、円弧点=cx+r·cosθ,cy+r·sinθ)。
   隣接弧の終点=次弧の始点(連続性)、および各段の半径比が厳密に1/φになることを数値シミュレーションで
   確認済みの構成(§III-1実装ノート)。 */
const _goldenSpiralCache=(()=>{
 const segs=[];
 let rx=0, ry=0, rw=PHI, rh=1;
 for(let i=0;i<8;i++){
  const sq=Math.min(rw,rh);
  const corner=i%4;
  let cx,cy,a0,a1;
  if(corner===0){ cx=rx+sq; cy=ry+sq; a0=Math.PI; a1=Math.PI*1.5; rx+=sq; rw-=sq; }
  else if(corner===1){ cx=rx; cy=ry+sq; a0=Math.PI*1.5; a1=Math.PI*2; ry+=sq; rh-=sq; }
  else if(corner===2){ cx=rx+rw-sq; cy=ry; a0=0; a1=Math.PI*0.5; rw-=sq; }
  else{ cx=rx+sq; cy=ry+rh-sq; a0=Math.PI*0.5; a1=Math.PI; rh-=sq; }
  segs.push({cx,cy,r:sq,a0,a1});
 }
 return segs;
})();
/* 正準点(px,py)を単位正方形(0..1,0..1)へ正規化し、dir(0..7)に応じて反転+90°回転を合成した後、
   対象枠(x,y,w,h)へ引き伸ばして返す。dirのビット分解: bit0=軸swap(90°系列)、bit1=U反転、bit2=V反転。
   点ごとに変換するため、swap/flipの組み合わせによる楕円弧のsweep-flag符号を個別に扱う必要がない。 */
function _goldenSpiralPoint(px,py,dir,x,y,w,h){
 let u=px/PHI, v=py;
 if(dir&1){ const t=u; u=v; v=t; }
 if(dir&2) u=1-u;
 if(dir&4) v=1-v;
 return [x+u*w, y+v*h];
}
function drawGoldenSpiralGuide(group,x,y,w,h,dir,color,width,opacity){
 const NS="http://www.w3.org/2000/svg";
 const SAMPLES=14; /* 1/4弧あたりのサンプル数。目視で滑らかな曲線に見える密度(§III-1実装ノート) */
 let d="";
 _goldenSpiralCache.forEach((seg,segIdx)=>{
  for(let k=0;k<=SAMPLES;k++){
   const th=seg.a0+(seg.a1-seg.a0)*(k/SAMPLES);
   const px=seg.cx+seg.r*Math.cos(th), py=seg.cy+seg.r*Math.sin(th);
   const [sx,sy]=_goldenSpiralPoint(px,py,dir,x,y,w,h);
   d+=(segIdx===0&&k===0?"M":"L")+sx.toFixed(2)+" "+sy.toFixed(2)+" ";
  }
 });
 const path=document.createElementNS(NS,"path");
 path.setAttribute("d",d.trim());
 path.setAttribute("fill","none"); path.setAttribute("stroke",color);
 path.setAttribute("stroke-width",width); path.setAttribute("opacity",opacity);
 path.setAttribute("vector-effect","non-scaling-stroke");
 path.setAttribute("stroke-linecap","round"); path.setAttribute("stroke-linejoin","round");
 group.appendChild(path);
}
/* group: SVGの<g>要素 / x,y,w,h: スクリーンpx / type: thirds|golden|goldenSpiral|diag|center|grid
   opts: {color,width,opacity,gridN,spiralDir} — 画素には一切影響しない純粋な表示関数(R6)。 */
function drawGuidePattern(group,x,y,w,h,type,opts){
 opts=opts||{};
 const color=opts.color||"#ffffff", width=opts.width||1,
       opacity=(opts.opacity==null)?0.8:opts.opacity, gridN=opts.gridN||4;
 const NS="http://www.w3.org/2000/svg";
 const line=(x1,y1,x2,y2)=>{
  const el=document.createElementNS(NS,"line");
  el.setAttribute("x1",x1);el.setAttribute("y1",y1);el.setAttribute("x2",x2);el.setAttribute("y2",y2);
  el.setAttribute("stroke",color); el.setAttribute("stroke-width",width);
  el.setAttribute("opacity",opacity); el.setAttribute("vector-effect","non-scaling-stroke");
  group.appendChild(el);
 };
 const PHI_INV=1/1.6180339887;
 if(type==="thirds"){
  [1/3,2/3].forEach(t=>{ line(x+w*t,y,x+w*t,y+h); line(x,y+h*t,x+w,y+h*t); });
 }else if(type==="golden"){
  [PHI_INV,1-PHI_INV].forEach(t=>{ line(x+w*t,y,x+w*t,y+h); line(x,y+h*t,x+w,y+h*t); });
 }else if(type==="diag"){
  line(x,y,x+w,y+h); line(x+w,y,x,y+h);
 }else if(type==="center"){
  line(x+w/2,y,x+w/2,y+h); line(x,y+h/2,x+w,y+h/2);
 }else if(type==="grid"){
  for(let i=1;i<gridN;i++){ line(x+w*i/gridN,y,x+w*i/gridN,y+h); line(x,y+h*i/gridN,x+w,y+h*i/gridN); }
 }else if(type==="goldenSpiral"){
  /* §III-1: 正準黄金矩形で構成した弧列(_goldenSpiralCache)を対象枠へ非等方写像する。
     旧実装は対象枠内で毎回正方形切り出しを行っており、corner===2でrw/rhの縮小漏れがあった
     ため同じ弧が無限に再描画され、かつ対象枠が厳密な黄金比でない限り辺長比が崩れていた。 */
  const dir=((opts.spiralDir||0)%8+8)%8;
  drawGoldenSpiralGuide(group,x,y,w,h,dir,color,width,opacity);
 }
}

