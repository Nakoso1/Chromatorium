/* ============================================================
   顔料LUT プラミング: Worker結果受領 / キャッシュ / 顔料色
   ============================================================ */
function u8b64(u){ /* 大きな文字列の逐次連結を避け、チャンクを配列に貯めて一括join(結果は同一) */
 const parts=[]; for(let i=0;i<u.length;i+=8192)parts.push(String.fromCharCode.apply(null,u.subarray(i,i+8192)));
 return btoa(parts.join("")); }
function b64u8(b){ const s=atob(b); const u=new Uint8Array(s.length); for(let i=0;i<s.length;i++)u[i]=s.charCodeAt(i); return u; }
const LUTC_LIST="clab.v1.lutkeys";
function cacheLut(key,m){
 try{
  const item=JSON.stringify({n:m.n,r0:u8b64(m.r0),r1:u8b64(m.r1),km:u8b64(m.km)});
  let keys=[]; try{keys=JSON.parse(localStorage.getItem(LUTC_LIST)||"[]");}catch(e){}
  keys=keys.filter(k=>k!==key);
  keys.push(key);
  while(keys.length>2){ localStorage.removeItem("clab.v1.lutcache."+keys.shift()); }
  localStorage.setItem("clab.v1.lutcache."+key,item);
  localStorage.setItem(LUTC_LIST,JSON.stringify(keys));
 }catch(e){ /* 容量超過時はキャッシュのみ断念 */ }
}
function onLutPart(m){
 if(m.jobId!==W.lutJob){
  if(m.final){ W.lutBusy=false; if(W.lutWant)W._sendLut(); }
  return;
 }
 R.setPigLut(m.n,new Uint8Array(m.r0),new Uint8Array(m.r1),new Uint8Array(m.km));
 mark("c","blur","screen");
 if(m.final){
  W.lutBusy=false;
  status_(t("status.pigLutDone"));
  cacheLut(W._lutKey,{n:m.n,r0:new Uint8Array(m.r0),r1:new Uint8Array(m.r1),km:new Uint8Array(m.km)});
  if(W.lutWant)W._sendLut();
  updateCmpPanel();
 }
}
/* r0/r1のフィッティング方式(隙間なし配分)を変更したらここを上げる。
   これを上げないと、localStorageに残っている旧アルゴリズムのLUTキャッシュを
   そのまま読み込んでしまい、コードを直しても見た目が一切変わらない。 */
const LUT_ALGO_VER="hybrid2"; /* 合成式(ハイブリッド, W=0.9)は同じだが、ウォームスタートが局所解に誘導する
  バグを修正(毎点で複数初期値を試すように変更)したため、LUTの実際の値が変わる。旧キャッシュは無効化する。 */
function lutKey(){ return LUT_ALGO_VER+"|"+state.mixing.system+"|"+currentPigIds(state.mixing.ideal).join(","); }
function defsFor(ids){ return ids.map(id=>{const p=pigById(id); return {base:p.base,gs:p.gs,sg:p.sg};}); }
function requestPigLut(){
 refreshPigColors();
 const key=lutKey();
 try{
  const raw=localStorage.getItem("clab.v1.lutcache."+key);
  if(raw){
   const o=JSON.parse(raw);
   R.setPigLut(o.n,b64u8(o.r0),b64u8(o.r1),b64u8(o.km));
   mark("c","blur","screen");
   status_(t("status.pigLutFromCache",{n:o.n}));
   updateCmpPanel();
   return;
  }
 }catch(e){}
 W.requestLut(defsFor(currentPigIds(state.mixing.ideal)),key);
}
/* 顔料マスストーン色: シェーダー用テクスチャ + UIチップ */
const pigColorCache=new Map();
async function refreshPigColors(){
 const eff=currentPigIds(state.mixing.ideal);
 const shown=currentPigIds(false);
 const need=[...new Set(eff.concat(shown))].filter(id=>!pigColorCache.has(id));
 if(need.length){
  try{
   const out=await W.call("colors",{defs:defsFor(need)});
   need.forEach((id,i)=>pigColorCache.set(id,out[i]));
  }catch(e){ console.error(e); }
 }
 const bytes=new Uint8Array(64);
 eff.forEach((id,i)=>{
  const c=pigColorCache.get(id)||[0.5,0.5,0.5];
  bytes[i*4]=Math.round(clamp(c[0],0,1)*255);
  bytes[i*4+1]=Math.round(clamp(c[1],0,1)*255);
  bytes[i*4+2]=Math.round(clamp(c[2],0,1)*255);
  bytes[i*4+3]=255;
 });
 if(R.ok)R.uploadPigColors(bytes);
 mark("c","blur","screen");
 /* チップ更新 */
 document.querySelectorAll("#pigRows .pigrow").forEach(row=>{
  const ch=row.dataset.ch;
  const id=state.mixing.assign[ch];
  const c=pigColorCache.get(id);
  if(c)row.querySelector(".sw").style.background=K.hex(c);
 });
 updateMgFromAssignPreview(); /* §V-2: 系統/customCount/assign変更のいずれでもこの関数経由で呼ばれるため、都度追従する */
}
/* 付録B裁定: 「混色シミュレーションの顔料を取込」ボタンの直前に、実際に取り込まれる顔料
   (先頭3色。3色目が無ければ空欄)のミニスウォッチをプレビュー表示する(押す前に結果が見える
   =予測可能性)。色そのものは既存のpigColorCache/K.hexをそのまま使い、新しい色変換は
   一切行わない。取込元が実質空(顔料IDが1つも取得できない)場合はボタンをdisabledにし、
   理由をtitleへ出す。 */
function updateMgFromAssignPreview(){
 const btn=$("mgFromAssign");
 if(!btn)return; /* P0/P1段階でDOM未生成の呼び出し順があっても安全に空振りする */
 const ids=currentPigIds(false).slice(0,3); /* 付録B裁定: A/B/Cへコピーされる先頭3色(L7473近傍のクリック処理と一致させる) */
 const els=[$("mgPvA"),$("mgPvB"),$("mgPvC")];
 let anyColor=false;
 els.forEach((el,i)=>{
  const id=ids[i];
  const c=id?pigColorCache.get(id):null;
  if(c){ el.style.background=K.hex(c); el.style.visibility="visible"; el.title=pigById(id).name; anyColor=true; }
  else{ el.style.background="transparent"; el.style.visibility="hidden"; el.title=""; }
 });
 btn.disabled=!anyColor;
 btn.title=anyColor?t("mixscale.fromAssignTitle"):t("mixscale.fromAssignDisabled");
}

/* ============================================================
   混色パネル: 顔料行 / プリセット / 比較 / 代替ΔE / カスタム顔料 (4.1)
   ============================================================ */
function buildPigRows(){
 const wrap=$("pigRows"); wrap.innerHTML="";
 const chs=chOfCurrent();
 chs.forEach(ch=>{
  const row=document.createElement("div"); row.className="pigrow"; row.dataset.ch=ch;
  const chip=document.createElement("span"); chip.className="sw swS";
  const mid=document.createElement("div");
  mid.style.display="flex"; mid.style.gap="4px"; mid.style.alignItems="center";
  const lb=document.createElement("span"); lb.className="chn"; lb.textContent=ch;
  const sel=document.createElement("select"); sel.style.flex="1";
  const alts=ALT_OF[ch]||[];
  alts.forEach(id=>{
   const p=pigById(id); const o=document.createElement("option");
   o.value=id; o.textContent=p.name+(id===alts[0]?t("ui.mixPigStandard"):t("ui.mixPigAlternate"));
   sel.appendChild(o);
  });
  pigList().filter(p=>!alts.includes(p.id)).forEach(p=>{
   const o=document.createElement("option"); o.value=p.id; o.textContent=p.name; sel.appendChild(o);
  });
  sel.value=state.mixing.assign[ch]||alts[0]||(pigList()[0]&&pigList()[0].id);
  sel.onchange=()=>{
   state.mixing.assign[ch]=sel.value;
   persistSoon(); requestPigLut(); updateCmpPanel();
  };
  mid.append(lb,sel);
  const btn=document.createElement("button"); btn.className="mini"; btn.textContent=t("ui.mixAltDE");
  btn.title=t("ui.mixAltDETitle");
  btn.onclick=()=>swapDiffFor(ch);
  row.append(chip,mid,btn);
  wrap.appendChild(row);
 });
 $("pigRowsCustomCtl").style.display=state.mixing.system==="CUSTOM"?"":"none";
 if(state.mixing.system==="CUSTOM"){
  $("pigAddSlot").disabled=chs.length>=7;
  $("pigDelSlot").disabled=chs.length<=1;
  $("pigSlotCount").textContent=t("ui.mixSlotCountUnit",{n:chs.length});
 }
 refreshPigColors();
}
async function swapDiffFor(ch){
 const pk=state.analysis.pick;
 if(!pk){ status_(t("status.pickColorFirst")); return; }
 const cur=state.mixing.assign[ch];
 let alt=(ALT_OF[ch]||[]).find(id=>id!==cur);
 if(!alt){ const c2=pigList().find(p=>p.id!==cur); alt=c2&&c2.id; }
 if(!alt){ status_(t("status.noAltPigment")); return; }
 const tgt=isHold()?pk.orig:pk.edited;
 $("swapOut").textContent=t("ui.mixSwapCalculating");
 try{
  const chs=chOfCurrent();
  const idsA=currentPigIds(false);
  const idsB=idsA.map((id,i)=>chs[i]===ch?alt:id);
  const rp=await W.call("recipe",{target:tgt,defs:defsFor(idsA)});
  const out=await W.call("swapdiff",{conc:rp.conc,defsA:defsFor(idsA),defsB:defsFor(idsB)});
  const de=K.dE00(K.srgb2lab(out.a),K.srgb2lab(out.b));
  $("swapOut").innerHTML="<span class='sw swS' style='background:"+K.hex(out.a)+"'></span> "+pigById(cur).name+
   t("ui.mixSwapResult")+"<span class='sw swS' style='background:"+K.hex(out.b)+"'></span> "+pigById(alt).name+
   t("ui.mixSwapRatioLabel")+"<b>"+fmt(de,2)+"</b>";
 }catch(e){ $("swapOut").textContent=t("ui.mixSwapFailed",{msg:e.message}); }
}
/* 実顔料 vs 理想値の常時比較 (4.1.4) */
let _cmpTok=0;
async function updateCmpPanel(){
 const el=$("cmpPanel");
 const pk=state.analysis.pick;
 if(!pk){ el.textContent=t("ui.mixCmpPanelDefault"); return; }
 const tgt=isHold()?pk.orig:pk.edited;
 const tok=++_cmpTok;
 try{
  const [rp,ri]=await Promise.all([
   W.call("recipe",{target:tgt,defs:defsFor(currentPigIds(false))}),
   W.call("recipe",{target:tgt,defs:defsFor(currentPigIds(true))})
  ]);
  if(tok!==_cmpTok)return;
  const labT=K.srgb2lab(tgt);
  const deP=K.dE00(labT,K.srgb2lab(rp.srgb));
  const deI=K.dE00(labT,K.srgb2lab(ri.srgb));
  const dePI=K.dE00(K.srgb2lab(rp.srgb),K.srgb2lab(ri.srgb));
  const hP=K.srgb2HVC(rp.srgb), hI=K.srgb2HVC(ri.srgb);
  const chs=chOfCurrent();
  const concStr=c=>chs.map((ch,i)=>ch+" "+Math.round(c[i]*100)+"%").join("  ");
  el.innerHTML=
   "<div class='row'><span class='sw swS' style='background:"+K.hex(tgt)+"'></span><span>"+t("ui.mixCmpTarget")+"</span></div>"+
   "<div class='row'><span class='sw swS' style='background:"+K.hex(rp.srgb)+"'></span><span style='flex:1'>"+t("ui.mixCmpReal")+"</span><span>ΔE00 "+fmt(deP,2)+"</span></div>"+
   "<div class='hint'>"+concStr(rp.conc)+"</div>"+
   "<div class='row'><span class='sw swS' style='background:"+K.hex(ri.srgb)+"'></span><span style='flex:1'>"+t("ui.mixCmpIdeal")+"</span><span>ΔE00 "+fmt(deI,2)+"</span></div>"+
   "<div class='hint'>"+t("ui.mixCmpRealVsIdeal",{de:fmt(dePI,2),dv:fmt(hP.V-hI.V,2),dc:fmt(hP.C-hI.C,1)})+"</div>";
 }catch(e){ if(tok===_cmpTok)el.textContent=t("ui.mixCmpFailed",{msg:e.message}); }
}
/* プリセット (4.1.3) */
function rebuildPresetSel(){
 const sel=$("presetSel"); sel.innerHTML="";
 state.pigments.presets.forEach((p,i)=>{
  const o=document.createElement("option"); o.value=i; o.textContent=p.name+"（"+p.system+"）";
  sel.appendChild(o);
 });
}
function presetSave(){
 const name=($("presetName").value||"").trim();
 if(!name){ status_(t("status.enterPresetName")); return; }
 const item={name,system:state.mixing.system,assign:Object.assign({},state.mixing.assign),customCount:state.mixing.customCount};
 const i=state.pigments.presets.findIndex(p=>p.name===name);
 if(i>=0)state.pigments.presets[i]=item; else state.pigments.presets.push(item);
 rebuildPresetSel(); persistSoon();
 status_(t("status.presetSaved",{name}));
}
function presetLoad(){
 const i=+$("presetSel").value;
 const p=state.pigments.presets[i]; if(!p)return;
 state.mixing.system=p.system;
 if(p.customCount)state.mixing.customCount=p.customCount;
 Object.assign(state.mixing.assign,p.assign);
 $("sysCMYK").classList.toggle("on",p.system==="CMYK");
 $("sysRGB").classList.toggle("on",p.system==="RGB");
 $("sysCUSTOM").classList.toggle("on",p.system==="CUSTOM");
 buildPigRows(); requestPigLut(); updateCmpPanel();
 mark("c","blur","screen");
 status_(t("status.presetLoaded",{name:p.name}));
}
function presetDel(){
 const i=+$("presetSel").value;
 if(state.pigments.presets[i]){
  status_(t("status.presetDeleted",{name:state.pigments.presets[i].name}));
  state.pigments.presets.splice(i,1);
  rebuildPresetSel(); persistSoon();
 }
}
/* カスタム顔料追加 (4.1.3 拡張性) */
async function addCustomPigment(){
 const name=($("cpName").value||"").trim();
 if(!name){ status_(t("status.enterPigmentName")); return; }
 const tgt=K.fromHex($("cpColor").value);
 status_(t("status.fittingSpectrum"),false,true);
 try{
  const out=await W.call("fitpig",{target:tgt});
  const def=out.def;
  const pig={id:"custom_"+Date.now(),name,base:def.base,gs:def.gs,sg:def.sg};
  state.pigments.custom.push(pig);
  pigColorCache.set(pig.id,out.srgb);
  persistSoon(); buildPigRows();
  if(state.scheme.recipeSrc==="independent")renderRcOwnPigList(); /* WS-12: 新顔料を一覧に反映 */
  $("cpName").value="";
  status_(t("status.pigmentAdded",{name,hex:K.hex(out.srgb)}));
 }catch(e){ status_(t("status.fittingFailed",{msg:e.message}),true); }
}
/* ============================================================
   レシピ逆算 (4.3)
   ============================================================ */
/* §VI-1/VI-4: レシピ逆算の目標色は「画像選択」または「手動指定/パレット選択で固定された基準色」の
   いずれか。state.scheme._baseSrcが両者の切替を一元管理する(scheme.baseと同じ由来トラッキング)。 */
function currentRecipeTarget(){
 if(state.scheme._baseSrc==="pick"){
  const pk=state.analysis.pick;
  return pk?(isHold()?pk.orig:pk.edited):null;
 }
 return state.scheme.base;
}
function updateRcSwatch(){
 const tgt=currentRecipeTarget();
 $("rcSwatch").style.background=tgt?K.hex(tgt):"transparent";
 $("scBase").style.background=K.hex(state.scheme.base);
 const srcLabel=state.scheme._baseSrc==="pick"?t("ui.recipeSrcImage"):state.scheme._baseSrc==="palette"?t("ui.recipeSrcPalette"):t("ui.recipeSrcManual");
 $("rcTargetSrc").textContent=tgt?t("ui.recipeTargetWithSrc",{src:srcLabel}):t("ui.recipeTargetNone");
}
/* WS-12: レシピ逆算(runRecipe/schemeRecipe双方)が共通で呼ぶ顔料ID解決関数。
   "linked"(既定)は従来どおりcurrentPigIds(false)をそのまま返す(退行なし)。
   "independent"はstate.scheme.recipePigIdsを返すが、カスタム顔料削除等で存在しなくなった
   IDが混じっていても安全なようpigById()経由の存在チェックはrunRecipe/schemeRecipe側の
   defsFor()に委ねず、ここでは選択リストの整合性(2色以上)のみを保証する。 */
function recipePigIds(){
 if(state.scheme.recipeSrc==="independent"){
  const validIds=new Set(pigList().map(p=>p.id));
  return state.scheme.recipePigIds.filter(id=>validIds.has(id));
 }
 return currentPigIds(false);
}
/* WS-12: 独立モードのチェックボックス一覧を描画する。既定チェックは「連動→独立」切替時点の
   混色シミュレーション割当をコピーする(呼び出し元のrcSrcOwnクリックハンドラ側で実施)。 */
function renderRcOwnPigList(){
 const wrap=$("rcOwnPigList"); if(!wrap)return;
 wrap.innerHTML="";
 const selected=new Set(state.scheme.recipePigIds);
 pigList().forEach(p=>{
  const label=document.createElement("label");
  const cb=document.createElement("input");
  cb.type="checkbox"; cb.checked=selected.has(p.id);
  cb.addEventListener("change",()=>{
   const cur=new Set(state.scheme.recipePigIds);
   if(cb.checked)cur.add(p.id); else cur.delete(p.id);
   state.scheme.recipePigIds=pigList().map(x=>x.id).filter(id=>cur.has(id)); /* pigList順に正規化 */
   mark("panels");
  });
  label.appendChild(cb);
  label.appendChild(document.createTextNode(" "+p.name));
  wrap.appendChild(label);
 });
}
async function runRecipe(){
 const tgt=currentRecipeTarget();
 if(!tgt){ $("rcOut").textContent=t("ui.recipePickFirst"); return; }
 const ids=recipePigIds();
 if(ids.length<2){ $("rcOut").textContent=t("ui.rcNeedTwoPigments"); return; } /* WS-12: 独立モードで選択不足の場合のガード */
 $("rcOut").textContent=t("ui.recipeCalculating");
 try{
  const rp=await W.call("recipe",{target:tgt,defs:defsFor(ids)});
  const de=K.dE00(K.srgb2lab(tgt),K.srgb2lab(rp.srgb));
  const lines=ids.map((id,i)=>({name:pigById(id).name,v:rp.conc[i]}))
   .filter(x=>x.v>0.005)
   .sort((a,b)=>b.v-a.v)
   .map(x=>"<div class='row'><span style='flex:1'>"+x.name+"</span><b>"+fmt(x.v*100,1)+"%</b></div>").join("");
  $("rcOut").innerHTML=lines+
   "<div class='row'><span class='sw swS' style='background:"+K.hex(rp.srgb)+"'></span><span style='flex:1'>"+t("ui.recipeMixResult")+"</span><span>ΔE00 "+fmt(de,2)+"</span></div>"+
   (de>3?"<div class='hint warn'>"+t("ui.recipeOutOfGamut")+"</div>":"");
 }catch(e){ $("rcOut").textContent=t("ui.recipeFailed",{msg:e.message}); }
}

/* ============================================================
   F13. 混色グラデーション練習ビュー — masstone→混合→tintの段階帯。
   既存WorkerのKM評価(mixLin)をそのまま複数段に呼ぶだけで、独自の混合則は実装しない
   (§F13実装接続点)。生成トリガは選択変更時に自動(Worker呼び出しは数十点で軽量)。
   ============================================================ */
const LSK_MIXSCALE="clab.v1.mixscale";
function loadMixScaleCfg(){
 try{
  const raw=localStorage.getItem(LSK_MIXSCALE);
  if(raw)Object.assign(state.mixScale,JSON.parse(raw));
 }catch(e){}
}
function saveMixScaleCfg(){
 try{ localStorage.setItem(LSK_MIXSCALE,JSON.stringify(state.mixScale)); }catch(e){}
}
function rebuildMixScaleSelects(){
 const list=pigList();
 const optHtml=list.map(p=>"<option value='"+p.id+"'>"+p.name+"</option>").join("");
 ["mgA","mgB"].forEach(id=>{
  const sel=$(id), cur=sel.value||state.mixScale[id.slice(-1).toLowerCase()];
  sel.innerHTML=optHtml;
  if(cur&&list.some(p=>p.id===cur))sel.value=cur; else if(list[0])sel.value=list[0].id;
 });
 const selC=$("mgC"), curC=selC.value||state.mixScale.c;
 selC.innerHTML="<option value=''>"+t("ui.mgPigNone")+"</option>"+optHtml;
 if(curC&&list.some(p=>p.id===curC))selC.value=curC;
}
let mgState=null, mgBestPick=null;
function mgLinspace(N){ return Array.from({length:N},(_,i)=>i/(N-1)); }
async function generateMixScale(){
 if(!R.ok||!W.w)return;
 rebuildMixScaleSelects();
 const a=$("mgA").value, b=$("mgB").value, c=$("mgC").value;
 state.mixScale.a=a; state.mixScale.b=b; state.mixScale.c=c; saveMixScaleCfg();
 if(!a||!b){ $("mgBands").innerHTML=""; mgState=null; return; }
 const N=state.mixScale.steps;
 const ts=mgLinspace(N);
 const rowsDef=c?[["A → B",a,b],["B → C",b,c],["A → C",a,c]]:[["A → B",a,b]];
 const wDef=pigById(state.mixing.assign.W||"titanium_white");
 $("mgBands").innerHTML="<div class='hint'>"+t("ui.mgGenerating")+"</div>";
 try{
  const rows=[];
  for(const [label,idA,idB] of rowsDef){
   const weightsList=ts.map(t=>[1-t,t]);
   const defs=defsFor([idA,idB]);
   const srgbs=await W.call("mixScale",{pigDefs:defs,weightsList});
   const row={label,idA,idB,srgb:srgbs};
   if(state.mixScale.tint){
    const tintWeights=ts.map(t=>[(1-t)*0.5,t*0.5,0.5]);
    const tintDefs=defsFor([idA,idB,wDef.id]);
    row.tintSrgb=await W.call("mixScale",{pigDefs:tintDefs,weightsList:tintWeights});
   }
   rows.push(row);
  }
  mgState={rows,ts};
  renderMixScaleBands();
  updateMixScalePickMarker();
 }catch(e){ $("mgBands").innerHTML="<div class='hint'>"+t("ui.mgGenerateFailed",{msg:e.message})+"</div>"; }
}
function renderMixScaleBands(){
 if(!mgState){ $("mgBands").innerHTML=""; return; }
 let html="";
 mgState.rows.forEach((row,ri)=>{
  html+="<div class='hint' style='margin-top:6px'>"+row.label+"</div><div class='mgRow' data-ri='"+ri+"' data-tint='0'>";
  row.srgb.forEach((c,i)=>{ const hex=K.hex(c); html+="<div class='mgSw' data-ri='"+ri+"' data-i='"+i+"' data-tint='0' title='"+hex+"' style='background:"+hex+"'></div>"; });
  html+="</div>";
  if(row.tintSrgb){
   html+="<div class='mgRow' data-ri='"+ri+"' data-tint='1'>";
   row.tintSrgb.forEach((c,i)=>{ const hex=K.hex(c); html+="<div class='mgSw' data-ri='"+ri+"' data-i='"+i+"' data-tint='1' title='"+hex+"' style='background:"+hex+"'></div>"; });
   html+="</div>";
  }
 });
 $("mgBands").innerHTML=html;
 $("mgBands").querySelectorAll(".mgSw").forEach(el=>{
  el.addEventListener("click",()=>{
   const hex=el.getAttribute("title");
   navigator.clipboard&&navigator.clipboard.writeText(hex).catch(()=>{});
   status_(t("status.hexCopied",{hex}));
  });
 });
 markBestSwatch();
}
function markBestSwatch(){
 $("mgBands").querySelectorAll(".mgSw.best").forEach(el=>el.classList.remove("best"));
 if(!mgBestPick)return;
 const sel="[data-ri='"+mgBestPick.ri+"'][data-i='"+mgBestPick.i+"'][data-tint='"+(mgBestPick.tint?1:0)+"']";
 const el=$("mgBands").querySelector(sel);
 if(el)el.classList.add("best");
}
/* 現在の選択色とスケール上の各段とのΔE00を計算し、最小の段にマーキングする(§F13受け入れ基準) */
function updateMixScalePickMarker(){
 const info=$("mgPickInfo");
 const pk=state.analysis.pick;
 mgBestPick=null;
 if(!mgState||!pk){ info.textContent=""; $("mgToRecipe").disabled=true; markBestSwatch(); return; }
 const tgtLab=K.srgb2lab(isHold()?pk.orig:pk.edited);
 let best=null,bd=1e18;
 mgState.rows.forEach((row,ri)=>{
  row.srgb.forEach((c,i)=>{
   const de=K.dE00(tgtLab,K.srgb2lab(c));
   if(de<bd){ bd=de; best={ri,i,tint:false,de,row}; }
  });
  if(row.tintSrgb)row.tintSrgb.forEach((c,i)=>{
   const de=K.dE00(tgtLab,K.srgb2lab(c));
   if(de<bd){ bd=de; best={ri,i,tint:true,de,row}; }
  });
 });
 if(!best){ info.textContent=""; $("mgToRecipe").disabled=true; markBestSwatch(); return; }
 mgBestPick=best;
 const N=state.mixScale.steps, ratio=mgState.ts[best.i];
 const [nameA,nameB]=best.row.label.split(" → ");
 let txt=nameA+" "+fmt((1-ratio)*100,0)+"% : "+nameB+" "+fmt(ratio*100,0)+"%"+(best.tint?t("ui.mgPlusTintSuffix"):"");
 txt += (best.de>10) ? t("ui.mgUnreachable",{de:fmt(best.de,1)})
                      : " / ΔE00 "+fmt(best.de,1);
 info.textContent=txt;
 $("mgToRecipe").disabled=false;
 markBestSwatch();
}
function mgSendToRecipe(){
 if(!mgBestPick)return;
 const {row,i,tint,de}=mgBestPick;
 const ratio=mgState.ts[i];
 const [nameA,nameB]=row.label.split(" → ");
 let html="<div class='row'><span style='flex:1'>"+nameA+"</span><b>"+fmt((1-ratio)*100,1)+"%</b></div>"+
  "<div class='row'><span style='flex:1'>"+nameB+"</span><b>"+fmt(ratio*100,1)+"%</b></div>";
 if(tint)html+="<div class='row'><span style='flex:1'>"+t("ui.mgTintLabel")+"</span><b>50.0%</b></div>";
 const c=tint?row.tintSrgb[i]:row.srgb[i];
 html+="<div class='row'><span class='sw swS' style='background:"+K.hex(c)+"'></span><span style='flex:1'>"+t("ui.mgFromScale")+"</span><span>ΔE00 "+fmt(de,2)+"</span></div>";
 $("rcOut").innerHTML=html;
 /* WS-09: 転記先が「配色タブのレシピ欄」であることが混色タブ上では一切見えず、押しても
    何も起きていないように見える問題への対応。(a)配色タブへ自動遷移、(b)レシピ欄の<details>
    を開く、(c)#rcOutを視界内へスクロール、(d)一時ハイライトの3点で「今ここが変わった」を
    明示する。データフロー自体(rcOutへのHTML書込み)は変更していない。 */
 switchTab("scheme");
 const sec=$("secRecipe");
 if(sec)sec.open=true;
 const target=$("rcOut");
 if(target){
  target.scrollIntoView({block:"nearest",behavior:"smooth"});
  target.classList.remove("ws09-flash");
  void target.offsetWidth; /* リフロー強制: 同じクラスの再付与でもアニメーションを確実に再生させる */
  target.classList.add("ws09-flash");
 }
 status_(t("status.recipeTranscribed"));
}

