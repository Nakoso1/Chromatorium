/* ============================================================
   配色タブ (5): 配色生成 / 歴史的パレット / パレット管理
   ============================================================ */
const HIST_PALS=[
 {name:"ツォルン・パレット",nameKey:"ui.presetNameZorn",colors:["#C68A3B","#D93A2B","#221F1E","#F2EEE3"]},
 /* §VI-3: 汎用フラットUI調6色から、モネ以降の実顔料マスストーン/ティントに寄せて差し替え。
    混色タブの既存「印象派(モネ)」プリセット(顔料構成)と矛盾しない色相構成。 */
 {name:"印象派",nameKey:"ui.presetNameImpressionist",colors:["#F4EFE1","#E9C64B","#D96B3B","#C46A84","#3B62A8","#4E9370","#8B8FB5"]},
 {name:"アース(大地の色)",nameKey:"ui.presetNameEarth",colors:["#6E4B2A","#A97C50","#C9A66B","#8A6642","#4A3B2A","#D9C7A7"]},
 {name:"グリザイユ",nameKey:"ui.presetNameGrisaille",colors:["#141414","#333333","#555555","#777777","#999999","#BBBBBB","#DDDDDD"]},
 {name:"浮世絵・藍",nameKey:"ui.presetNameUkiyoe",colors:["#16344E","#2D5C7F","#88A9C3","#C7472E","#E8D9B0"]},
 {name:"ポスト印象派(トロピカル)",nameKey:"ui.presetNamePostImpr",colors:["#C1440E","#E3B23C","#2E6E4E","#7C3B5E","#1F3A5F"]},
 /* §VI-3: 以下6種を追加(様式の代表的顔料・印刷・時代色に基づく初期値)。 */
 {name:"アール・ヌーヴォー",nameKey:"ui.presetNameArtNouveau",colors:["#7D8F69","#C9A227","#A26769","#5E7B8B","#8A7090","#EFE6D5"]},
 {name:"大正ロマン",nameKey:"ui.presetNameTaisho",colors:["#6E2B2F","#1C2A52","#B28FC6","#C9A02C","#8A9A5B","#F2E8D5"]},
 {name:"琳派",nameKey:"ui.presetNameRinpa",colors:["#C6A664","#2E4A9E","#3F7E5B","#B0472F","#1E1B18","#F3EDE0"]},
 {name:"ポップ・アート",nameKey:"ui.presetNamePopArt",colors:["#E4002B","#FFD400","#0057B8","#00A651","#FF69B4","#111111","#FFFFFF"]},
 {name:"Y2K",nameKey:"ui.presetNameY2K",colors:["#C7CCD6","#7FDBFF","#FF7EC7","#C77DFF","#CCFF00","#1B1F3B"]},
 {name:"シティ・ポップ",nameKey:"ui.presetNameCityPop",colors:["#0F4C81","#5F4B8B","#FF8BA0","#FFB35C","#2EC4B6","#F7F0DE"]}
];
const SCHEME_SRC_LABEL={pick:"wheel.srcPick",manual:"wheel.srcManual",palette:"wheel.srcPalette"};
/* WS-10: 「新しい色を意図的に選び直す」書込み専用ヘルパ(画像ピック/パレット選択/手動カラーピッカー)。
   この3箇所は既存の色を無視して丸ごと置き換えるのが正しい仕様のため、lchをsrgbから再導出して
   正準値を更新する。一方、バリュースライダーやホイールドラッグのような「既存の色を一部だけ
   動かす」操作はこのヘルパを使わず、lchの該当成分のみを直接更新する(下記各箇所参照)。 */
function setSchemeBase(srgb,src){
 state.scheme.base=srgb.map(v=>clamp(v,0,1));
 state.scheme.lch=K.okLCh(K.srgb2ok(state.scheme.base));
 state.scheme._baseSrc=src;
}
function genScheme(){
 const b=state.scheme.base;
 $("scBase").style.background=K.hex(b);
 $("scBaseSrc").textContent=SCHEME_SRC_LABEL[state.scheme._baseSrc]?t(SCHEME_SRC_LABEL[state.scheme._baseSrc]):"";
 /* WS-10: baseから再導出せず、正準値state.scheme.lchをそのまま読む(旧実装のbase→lch再導出は
    baseが既にガマットclamp後の値であるため、その時点で情報が失われている可能性があった)。 */
 const lch=state.scheme.lch;
 /* §VI-2: バリューバーをstateの実値へ同期(ドラッグ操作中の要素は上書きしない=既存refresh系と同じ流儀) */
 if(document.activeElement!==$("scValue")){ $("scValue").value=clamp(lch[0],0,1); $("vscValue").textContent=fmt(lch[0],2); }
 const rule=state.scheme.rule;
 const dhs=rule==="comp"?[0,180]:rule==="split"?[0,150,210]:[0,120,240];
 const cols=dhs.map(dh=>{
  const h=mod360(lch[2]+dh);
  const C=Math.min(lch[1],K.cmax(lch[0],h));
  return K.ok2srgb(K.lch2lab([lch[0],C,h]));
 });
 const names=rule==="comp"?[t("ui.schemeRuleBase"),t("ui.schemeRuleOpposite")]:rule==="split"?[t("ui.schemeRuleBase"),t("ui.schemeRuleSplit1"),t("ui.schemeRuleSplit2")]:[t("ui.schemeRuleBase"),t("ui.schemeRuleTriad1"),t("ui.schemeRuleTriad2")];
 $("scOut").innerHTML="";
 cols.forEach((c,i)=>{
  const d=document.createElement("div"); d.className="schsw";
  d.innerHTML="<span class='sw swL' style='background:"+K.hex(c)+"'></span><span>"+names[i]+"<br>"+K.hex(c)+"</span>";
  const bt=document.createElement("button"); bt.className="mini"; bt.textContent=t("ui.schemePigmentBtn");
  bt.title=t("ui.schemePigmentBtnTitle");
  bt.onclick=()=>schemeRecipe(c,names[i]);
  d.appendChild(bt);
  const bt2=document.createElement("button"); bt2.className="mini"; bt2.textContent=t("ui.schemePalBtn");
  bt2.onclick=()=>{ state.scheme.curPal.colors.push(K.hex(c)); renderPalCur(); persistSoon(); };
  d.appendChild(bt2);
  $("scOut").appendChild(d);
 });
 drawSchemeWheel();
}
/* §VI-2: genScheme()(DOM再構築を含みやや重い)をドラッグ中に毎pointermoveで直接呼ばず、
   rAFへ集約する。mark("panels")自体は既存の_rafQ機構で軽量に間引かれるためそのまま毎回呼んでよい。 */
let _schemeGenRaf=false;
function scheduleGenScheme(){
 if(_schemeGenRaf)return;
 _schemeGenRaf=true;
 requestAnimationFrame(()=>{ _schemeGenRaf=false; genScheme(); });
}
/* 配色関係の可視化: 環境光と同じ無彩色中心の円盤上に、基準色+生成色を配置。
   反対色=中心を挟む直線 / スプリット=V字 / トライアド=三角形 として関係を描く。
   §VI-2: 基準点(i===0)は二重リングで区別し、schemeCfg.discFollowL時は円盤自体を
   基準色の現在L(0.05刻みに量子化)で再レンダリングする。 */
function drawSchemeWheel(){
 const cv=$("schWheel"); if(!cv)return;
 const size=cv.width, cx=cv.getContext("2d"), c0=size/2;
 cx.clearRect(0,0,size,size);
 const rule=state.scheme.rule;
 const lch=state.scheme.lch; /* WS-10: baseからの再導出をやめ、正準値を直接読む */
 const discL=schemeCfg.discFollowL?Math.round(clamp(lch[0],0,1)/0.05)*0.05:undefined;
 cx.drawImage(discBase(size,discL),0,0);
 const dhs=rule==="comp"?[0,180]:rule==="split"?[0,150,210]:[0,120,240];
 const pts=dhs.map(dh=>{ const h=mod360(lch[2]+dh);
  const C=Math.min(lch[1],K.cmax(lch[0],h));
  const lab=K.lch2lab([lch[0],C,h]);
  return {srgb:K.ok2srgb(lab),xy:abPos(size,lab[1],lab[2])};
 });
 cx.strokeStyle="rgba(255,255,255,0.32)";cx.lineWidth=1;      // 中心からのスポーク
 pts.forEach(p=>{ cx.beginPath();cx.moveTo(c0,c0);cx.lineTo(p.xy[0],p.xy[1]);cx.stroke(); });
 if(pts.length>=2){                                            // 外周点を結ぶ関係線(直線/V字/三角形)
  cx.strokeStyle="rgba(255,255,255,0.55)";cx.lineWidth=1.3;cx.beginPath();
  pts.forEach((p,i)=> i?cx.lineTo(p.xy[0],p.xy[1]):cx.moveTo(p.xy[0],p.xy[1]));
  if(pts.length>=3)cx.closePath();
  cx.stroke();
 }
 pts.forEach((p,i)=>{                                          // 色ドット(基準を大きく強調)
  cx.beginPath();cx.arc(p.xy[0],p.xy[1],i===0?7:5.5,0,TAU);
  cx.fillStyle=K.hex(p.srgb);cx.fill();
  cx.lineWidth=1.6;cx.strokeStyle=i===0?"#fff":"rgba(255,255,255,0.85)";cx.stroke();
  if(i===0){ cx.beginPath();cx.arc(p.xy[0],p.xy[1],10,0,TAU);cx.lineWidth=1.2;cx.strokeStyle="rgba(255,255,255,0.9)";cx.stroke(); } /* 基準点=二重リング */
 });
}
/* §VI-2: 配色ホイールの剛体回転ドラッグ。GamutWheelUI(L4914近傍)と同型のattach(canvas)パターンを踏襲する。
   掴んだ点が基準か生成色かに関わらず、配色ルールの相対角(dhs)は固定のまま全点を一体回転させる
   (=基準色の色相を回す操作と等価)。半径ドラッグは基準点(idx===0)を掴んだ時のみ彩度Cへ反映し、
   生成点では角度のみ反映する(仕様の複雑化を避けるための明示的な制限)。
   ドラッグ中はstate.scheme.baseを直接更新してmark("panels")するだけで、既存の
   sub([...],()=>_undoPush())が400msデバウンスで自動的に1段のUndoへ積む(ドラッグ1回=Undo1段、
   §I-2の既存Undo機構をそのまま利用し、専用のcommit経路を新設しない)。 */
const SchemeWheelUI={
 dragging:null,
 attach(canvas){
  const local=e=>{
   const r=canvas.getBoundingClientRect();
   return [(e.clientX-r.left)*(canvas.width/r.width)-canvas.width/2,
           (e.clientY-r.top)*(canvas.height/r.height)-canvas.height/2];
  };
  const scaleS=()=>{ const R=canvas.width/2-4; return R/DISC_MAX_C; };
  const currentDhs=()=>{ const rule=state.scheme.rule; return rule==="comp"?[0,180]:rule==="split"?[0,150,210]:[0,120,240]; };
  const currentLocalPts=()=>{
   const lch=state.scheme.lch; /* WS-10: baseからの再導出をやめ、正準値を直接読む */
   return currentDhs().map(dh=>{
    const h=mod360(lch[2]+dh);
    const C=Math.min(lch[1],K.cmax(lch[0],h));
    const lab=K.lch2lab([lch[0],C,h]);
    const xy=abPos(canvas.width,lab[1],lab[2]);
    return [xy[0]-canvas.width/2, xy[1]-canvas.height/2];
   });
  };
  const hitPoint=(x,y)=>{
   const pts=currentLocalPts();
   for(let i=0;i<pts.length;i++){ if(Math.hypot(x-pts[i][0],y-pts[i][1])<12)return i; }
   return -1;
  };
  canvas.addEventListener("pointerdown",e=>{
   const [x,y]=local(e);
   const idx=hitPoint(x,y);
   if(idx<0)return; /* 空白部クリックは無反応(誤操作防止) */
   canvas.setPointerCapture(e.pointerId);
   this.dragging={idx,dh:currentDhs()[idx]};
  });
  canvas.addEventListener("pointermove",e=>{
   if(!this.dragging)return;
   const [x,y]=local(e);
   const ang=mod360(Math.atan2(y,x)*R2D);
   const lch=state.scheme.lch; /* WS-10: baseからの再導出をやめ、正準値を直接読み・直接書く */
   const newHue=mod360(ang-this.dragging.dh);
   let newC=lch[1];
   if(this.dragging.idx===0){ /* 基準点のみ半径ドラッグで彩度を変更(§VI-2) */
    newC=clamp(Math.hypot(x,y)/scaleS(),0,DISC_MAX_C);
    /* WS-10: 旧実装はここでK.cmax()によりnewCをその場でclampして正準値へ書き戻していたため、
       (基準色ではない色相へ)ドラッグしてから戻すと最大彩度で頭打ちになった情報が失われ、
       彩度が復元不能になる一因だった。ここではclampせず生の値を正準値(lch)として保持し、
       表示用のbase/各生成色のみをgenScheme()側でMath.min(lch[1],K.cmax(...))により
       都度クランプする(正準値と表示値を分離)。 */
   }
   state.scheme.lch=[lch[0],newC,newHue];
   state.scheme.base=K.ok2srgb(K.lch2lab([lch[0],Math.min(newC,K.cmax(lch[0],newHue)),newHue])).map(v=>clamp(v,0,1));
   state.scheme._baseSrc="manual";
   mark("panels");
   scheduleGenScheme();
  });
  const up=()=>{ this.dragging=null; };
  canvas.addEventListener("pointerup",up);
  canvas.addEventListener("pointercancel",up);
 }
};
async function schemeRecipe(srgb,label){
 const ids=recipePigIds();
 if(ids.length<2){ $("scRecipeOut").textContent=t("ui.rcNeedTwoPigments"); return; } /* WS-12: 独立モードで選択不足の場合のガード */
 $("scRecipeOut").textContent=t("ui.schemeRecipeCalculating",{label});
 try{
  const rp=await W.call("recipe",{target:srgb,defs:defsFor(ids)});
  const de=K.dE00(K.srgb2lab(srgb),K.srgb2lab(rp.srgb));
  const recipeStr=ids.map((id,i)=>({n:pigById(id).name,v:rp.conc[i]}))
   .filter(x=>x.v>0.005).sort((a,b)=>b.v-a.v)
   .map(x=>x.n+" "+fmt(x.v*100,1)+"%").join("　");
  $("scRecipeOut").innerHTML="<b>"+label+"</b>: "+recipeStr+
   "　<span class='sw swS' style='background:"+K.hex(rp.srgb)+";vertical-align:middle'></span> ΔE00 "+fmt(de,2);
 }catch(e){ $("scRecipeOut").textContent=t("ui.schemeRecipeFailed",{msg:e.message}); }
}
function rebuildHistSel(){
 const sel=$("scHist"); sel.innerHTML="";
 HIST_PALS.forEach((p,i)=>{ const o=document.createElement("option"); o.value=i; o.textContent=t(p.nameKey); sel.appendChild(o); });
 previewHist();
}
/* WS-11: 従来は色を並べて表示するだけで何もできなかった。既存のパレット管理(renderPalCur)と
   同じ操作モデル(クリック=基準色に設定してselectPaletteColorへ連動、⧉=カラーコードコピー)へ
   揃える。削除ボタンは付けない(プリセットは読み取り専用の参照パレットであり、ユーザーの
   保存パレットとは異なり編集対象ではないため)。新しいUIパターンは発明せず、既存のクラス
   (.palSwWrap/.sw/.palSwCopy)をそのまま再利用する。 */
function previewHist(){
 const p=HIST_PALS[+$("scHist").value]; if(!p)return;
 const w=$("scHistOut"); w.innerHTML="";
 p.colors.forEach(h=>{
  const wrap=document.createElement("span");
  wrap.className="palSwWrap"+(_isSelectedHex(h)?" selected":"");
  const s=document.createElement("span");
  s.className="sw"; s.style.background=h; s.title=h+t("ui.palSwatchTitle");
  s.style.cursor="pointer";
  s.onclick=()=>selectPaletteColor(h);
  wrap.appendChild(s);
  const cp=document.createElement("button");
  cp.type="button"; cp.className="palSwCopy"; cp.textContent="⧉";
  cp.title=t("ui.palCopyHexTitle"); cp.setAttribute("aria-label",t("ui.palCopyHexAria"));
  cp.onclick=e=>{ e.stopPropagation(); copyHexToClipboard(h); };
  wrap.appendChild(cp);
  w.appendChild(wrap);
 });
}
/* §VI-4: パレットスウォッチのクリックを「基準色/レシピ目標に設定」へ転用し、
   削除は明示的な×バッジ専用にする(選択という高頻度操作と削除という低頻度・不可逆操作を
   同一ジェスチャに割り当てない、エラー防止の原則§VI-4根拠)。 */
function selectPaletteColor(hex){
 setSchemeBase(K.fromHex(hex),"palette"); /* WS-10: lchも同時に正準再導出(意図的な色の選び直しのため正当) */
 mark("panels");
 genScheme();
 updateRcSwatch();
 renderPalCur(); renderPalList(); /* 選択枠の再描画 */
 previewHist(); /* WS-11: パレットプリセット側の選択枠も同期する */
}
/* クリップボードコピー。非対応/権限拒否環境ではテキストエリア経由のレガシー方式へフォールバックする。 */
async function copyHexToClipboard(hex){
 try{
  if(!navigator.clipboard||!navigator.clipboard.writeText)throw new Error("no Clipboard API");
  await navigator.clipboard.writeText(hex);
  status_(t("status.hexCopied",{hex}));
 }catch(e){
  try{
   const ta=document.createElement("textarea");
   ta.value=hex; ta.style.position="fixed"; ta.style.opacity="0"; ta.style.pointerEvents="none";
   document.body.appendChild(ta); ta.focus(); ta.select();
   const ok=document.execCommand("copy");
   document.body.removeChild(ta);
   if(!ok)throw new Error("execCommand failed");
   status_(t("status.hexCopied",{hex}));
  }catch(e2){
   status_(t("status.copyFailed",{hex}),true);
  }
 }
}
function _isSelectedHex(h){
 return state.scheme._baseSrc==="palette" && h.toLowerCase()===K.hex(state.scheme.base).toLowerCase();
}
/* パレット管理 */
function renderPalCur(){
 const cur=state.scheme.curPal;
 if(document.activeElement!==$("palName"))$("palName").value=cur.name||"";
 const w=$("palCur"); w.innerHTML="";
 cur.colors.forEach((h,i)=>{
  const wrap=document.createElement("span");
  wrap.className="palSwWrap"+(_isSelectedHex(h)?" selected":"");
  const s=document.createElement("span");
  s.className="sw"; s.style.background=h; s.title=h+t("ui.palSwatchTitle");
  s.style.cursor="pointer";
  s.onclick=()=>selectPaletteColor(h);
  wrap.appendChild(s);
  const cp=document.createElement("button");
  cp.type="button"; cp.className="palSwCopy"; cp.textContent="⧉";
  cp.title=t("ui.palCopyHexTitle"); cp.setAttribute("aria-label",t("ui.palCopyHexAria"));
  cp.onclick=e=>{ e.stopPropagation(); copyHexToClipboard(h); };
  wrap.appendChild(cp);
  const del=document.createElement("button");
  del.type="button"; del.className="palSwDel"; del.textContent="×";
  del.title=t("ui.palDeleteTitle"); del.setAttribute("aria-label",t("ui.palDeleteAria"));
  del.onclick=e=>{ e.stopPropagation(); cur.colors.splice(i,1); renderPalCur(); persistSoon(); status_(t("status.colorDeleted")); };
  wrap.appendChild(del);
  w.appendChild(wrap);
 });
 if(!cur.colors.length)w.innerHTML="<span class='hint'>"+t("ui.palEmptyHint")+"</span>";
}
function renderPalList(){
 const w=$("palList"); w.innerHTML="";
 state.scheme.palettes.forEach((p,i)=>{
  const d=document.createElement("div"); d.className="palitem";
  const nameSpan=document.createElement("span");
  nameSpan.className="nm"; nameSpan.textContent=p.name;
  nameSpan.title=t("ui.palRenameTitle"); nameSpan.style.cursor="text";
  nameSpan.onclick=()=>startRenamePalette(nameSpan,i);
  d.appendChild(nameSpan);
  p.colors.slice(0,8).forEach(h=>{
   const sw=document.createElement("span");
   sw.className="sw swS"+(_isSelectedHex(h)?" selected":"");
   sw.style.background=h; sw.style.cursor="pointer"; sw.title=h+t("ui.palSwatchTitle");
   sw.onclick=()=>selectPaletteColor(h);
   d.appendChild(sw);
  });
  const bl=document.createElement("button"); bl.className="mini"; bl.textContent=t("ui.presetLoadBtn");
  bl.onclick=()=>{ state.scheme.curPal={name:p.name,colors:p.colors.slice()}; renderPalCur(); persistSoon(); };
  const bd=document.createElement("button"); bd.className="mini"; bd.textContent=t("ui.palDeleteBtn");
  bd.onclick=()=>openPalDelConfirm(i); /* §VI-4: 全体削除は確認ダイアログ経由 */
  d.append(bl,bd);
  w.appendChild(d);
 });
}
/* §VI-4: パレット名のインライン改名。クリックで<input>に切替、Enter/フォーカス喪失で確定、
   Escで取消。空名は確定不可(元の名前に戻す)。 */
function startRenamePalette(nameSpan,idx){
 const p=state.scheme.palettes[idx]; if(!p)return;
 const input=document.createElement("input");
 input.type="text"; input.value=p.name; input.className="palNameEdit";
 input.style.width=Math.max(60,nameSpan.offsetWidth+20)+"px";
 let done=false;
 const commit=()=>{
  if(done)return; done=true;
  const v=input.value.trim();
  if(v)p.name=v; /* 空名は確定不可: 元の名前のまま */
  renderPalList(); persistSoon();
 };
 const cancel=()=>{ if(done)return; done=true; renderPalList(); };
 input.addEventListener("keydown",e=>{
  if(e.key==="Enter"){ e.preventDefault(); commit(); }
  else if(e.key==="Escape"){ e.preventDefault(); cancel(); }
 });
 input.addEventListener("blur",commit);
 nameSpan.replaceWith(input);
 input.focus(); input.select();
}
function palSave(){
 const cur=state.scheme.curPal;
 cur.name=($("palName").value||t("ui.palDefaultName")).trim();
 const i=state.scheme.palettes.findIndex(p=>p.name===cur.name);
 const copy={name:cur.name,colors:cur.colors.slice()};
 if(i>=0)state.scheme.palettes[i]=copy; else state.scheme.palettes.push(copy);
 renderPalList(); persistSoon();
 status_(t("status.paletteSaved",{name:cur.name}));
}
function palExportJson(){
 const data={app:"ColorLab",version:1,exported:new Date().toISOString(),
  current:state.scheme.curPal, palettes:state.scheme.palettes};
 const blob=new Blob([JSON.stringify(data,null,1)],{type:"application/json"});
 const a=document.createElement("a");
 a.href=URL.createObjectURL(blob); a.download="colorlab_palettes.json"; a.click();
 setTimeout(()=>URL.revokeObjectURL(a.href),4000);
}
function palImportJson(file){
 const rd=new FileReader();
 rd.onload=()=>{
  try{
   const o=JSON.parse(rd.result);
   const list=Array.isArray(o)?o:(o.palettes||(o.colors?[o]:[]));
   let n=0;
   list.forEach(p=>{
    if(!p||!Array.isArray(p.colors))return;
    const item={name:String(p.name||t("ui.palImportDefaultName")),colors:p.colors.map(String)};
    const i=state.scheme.palettes.findIndex(x=>x.name===item.name);
    if(i>=0)state.scheme.palettes[i]=item; else state.scheme.palettes.push(item);
    n++;
   });
   renderPalList(); persistSoon();
   status_(t("status.paletteJsonLoaded",{n}));
  }catch(e){ status_(t("status.jsonLoadFailed",{msg:e.message}),true); }
 };
 rd.readAsText(file);
}

/* ============================================================
   永続化 (localStorage) + HTML自己書き出し (第5項)
   ============================================================ */
const LSK={pig:"clab.v1.pigments",pre:"clab.v1.presets",pal:"clab.v1.palettes"};
let _perT=null;
function persistSoon(){ if(_perT)clearTimeout(_perT); _perT=setTimeout(savePersist,400); }
function savePersist(){
 const ts=Date.now();
 try{
  localStorage.setItem(LSK.pig,JSON.stringify({t:ts,v:state.pigments.custom}));
  localStorage.setItem(LSK.pre,JSON.stringify({t:ts,v:state.pigments.presets}));
  localStorage.setItem(LSK.pal,JSON.stringify({t:ts,v:{list:state.scheme.palettes,cur:state.scheme.curPal}}));
 }catch(e){ status_(t("status.storageQuotaFailed"),true); }
}
function loadPersist(){
 let emb=null;
 try{ emb=JSON.parse($("clab-userdata").textContent); }catch(e){}
 const pick=(lsKey,embVal)=>{
  let ls=null;
  try{ ls=JSON.parse(localStorage.getItem(lsKey)); }catch(e){}
  if(ls&&embVal)return (ls.t>=embVal.t)?ls.v:embVal.v;
  if(ls)return ls.v;
  if(embVal)return embVal.v;
  return null;
 };
 state.pigments.custom = pick(LSK.pig,emb&&emb.pigments)||[];
 state.pigments.presets= pick(LSK.pre,emb&&emb.presets)||[];
 const pal=pick(LSK.pal,emb&&emb.palettes);
 if(pal){ state.scheme.palettes=pal.list||[]; if(pal.cur)state.scheme.curPal=pal.cur; }
 savePersist(); /* マージ結果をlocalStorageへ同期 */
}
function selfExport(){
 const ts=Date.now();
 const data={
  pigments:{t:ts,v:state.pigments.custom},
  presets:{t:ts,v:state.pigments.presets},
  palettes:{t:ts,v:{list:state.scheme.palettes,cur:state.scheme.curPal}}
 };
 let html=PRISTINE;
 /* 過去の埋め込みデータブロックを全て除去（肥大化防止のクリーンアップ） */
 const re=new RegExp('<script type="application/json" id="clab-userdata">[\\s\\S]*?<'+'/script>',"g");
 html=html.replace(re,"");
 const json=JSON.stringify(data).replace(/</g,"\\u003c");
 const block='<script type="application/json" id="clab-userdata">'+json+'<'+'/script>';
 const bodyEnd="</bo"+"dy>";
 const idx=html.lastIndexOf(bodyEnd);
 if(idx>=0) html=html.slice(0,idx)+block+"\n"+html.slice(idx);
 else html+=block;
 const blob=new Blob([html],{type:"text/html"});
 const a=document.createElement("a");
 a.href=URL.createObjectURL(blob);
 a.download="ColorLab_backup.html";
 a.click();
 setTimeout(()=>URL.revokeObjectURL(a.href),4000);
 status_(t("status.selfExportDone"));
}

/* ============================================================
   F4. ヘルプマーク — 「想起より再認」原則によるジャストインタイム・ヘルプ。
   1箇所の辞書 HELP と1回限りの injectHelp() で、data-help属性の付いた
   既存要素へ「?」アイコンを機械的に追加する。既存HTML構造は data-help
   属性の追加のみで、DOM構造そのものは変更しない。
   ============================================================ */
/* §VIII-2/P5: HELP辞書はI18N.ja.help/I18N.en.helpへ完全移設した(旧const HELPは削除)。 */
/* §VIII-2/P5: I18N[lang].help[key]をenフォールバック付きで解決する(t()と同じフォールバック規約)。 */
function getHelp(key){
 const cur=(state.ui&&state.ui.lang)||"ja";
 return _i18nLookup(I18N[cur],"help."+key) || _i18nLookup(I18N.ja,"help."+key) || null;
}
function injectHelp(){
 document.querySelectorAll("[data-help]").forEach(el=>{
  const key=el.dataset.help;
  if(!getHelp(key)){ console.warn("HELP entry missing: "+key); return; }
  const btn=document.createElement("button");
  btn.type="button"; btn.className="hpMark"; btn.setAttribute("aria-label",t("helpUI.ariaLabel")); btn.textContent="?";
  /* 要素の子として追加する(summaryの直後=兄弟に置くと<details>折りたたみ時に
     一緒に隠れてしまうため、常に見えるsummary/.row自身の内部に置く) */
  btn.addEventListener("click",e=>{ e.stopPropagation(); e.preventDefault(); openHelp(key,btn); });
  el.appendChild(btn);
 });
}
function openHelp(key,anchorEl){
 const h=getHelp(key); if(!h)return;
 const pop=$("hpPop");
 pop.innerHTML="<div class='hpT'>"+h.t+"</div>"+
  "<div class='hpS'>"+t("helpUI.opTitle")+"</div><div>"+h.how+"</div>"+
  "<div class='hpS'>"+t("helpUI.whatTitle")+"</div><div>"+h.what+"</div>"+
  "<div class='hpS'>"+t("helpUI.howTitle2")+"</div><div>"+h.why+"</div>";
 pop.classList.add("show");
 const r=anchorEl.getBoundingClientRect(), pw=266;
 let left=r.left; if(left+pw>window.innerWidth-8) left=window.innerWidth-8-pw;
 pop.style.left=Math.max(8,left)+"px";
 let top=r.bottom+4; if(top+140>window.innerHeight) top=Math.max(8,r.top-4-140);
 pop.style.top=top+"px";
}
function closeHelp(){ $("hpPop").classList.remove("show"); }
document.addEventListener("click",e=>{
 const pop=$("hpPop");
 if(!pop.classList.contains("show"))return;
 if(pop.contains(e.target)||e.target.classList.contains("hpMark"))return;
 closeHelp();
});

