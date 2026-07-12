/* ============================================================
   ファイル入出力 (0章)
   ============================================================ */
const sampleCanvas=document.createElement("canvas"); sampleCanvas.width=65; sampleCanvas.height=65;
const sampleCtx=sampleCanvas.getContext("2d",{willReadFrequently:true});
function sampleOriginal(ix,iy,r){
 if(!R.img)return [0,0,0];
 const sz=Math.min(65,2*Math.max(0,Math.round(r))+1);
 const x0=clamp(Math.round(ix)-(sz>>1),0,Math.max(0,R.img.w-sz));
 const y0=clamp(Math.round(iy)-(sz>>1),0,Math.max(0,R.img.h-sz));
 sampleCtx.clearRect(0,0,65,65);
 sampleCtx.drawImage(R.img.bitmap,x0,y0,sz,sz,0,0,sz,sz);
 const d=sampleCtx.getImageData(0,0,sz,sz).data;
 let a=0,b=0,c=0;
 for(let i=0;i<sz*sz;i++){ a+=S2L8[d[i*4]];b+=S2L8[d[i*4+1]];c+=S2L8[d[i*4+2]]; }
 const n=sz*sz;
 return K.l2s([a/n,b/n,c/n]);
}
function askSize(){
 return new Promise(res=>{
  const dlg=$("dlgSize"); dlg.classList.add("show");
  const fin=v=>{ dlg.classList.remove("show"); $("dlgShrink").onclick=null; $("dlgFull").onclick=null; res(v); };
  $("dlgShrink").onclick=()=>fin("shrink");
  $("dlgFull").onclick=()=>fin("full");
 });
}
/* F9: 8192pxを超える場合の縮小確認ダイアログ。openFileで使用する
   (既存openFileにあった処理をそのまま関数として切り出しただけ。数式・挙動は無変更)。 */
async function shrinkIfNeeded(bmp){
 if(Math.max(bmp.width,bmp.height)<=8192)return bmp;
 const c=await askSize();
 if(c!=="shrink")return bmp;
 const sc=8192/Math.max(bmp.width,bmp.height);
 const nw=Math.round(bmp.width*sc),nh=Math.round(bmp.height*sc);
 const cv=document.createElement("canvas");cv.width=nw;cv.height=nh;
 cv.getContext("2d").drawImage(bmp,0,0,nw,nh);
 bmp.close&&bmp.close();
 return await createImageBitmap(cv);
}
/* F9: RAW拡張子の一覧。対応外形式(RAW/tif/tiff)を検知して対応外メッセージを出すために
   保持している(§WS-17 A1)。RAW一覧は主要メーカーの代表的な拡張子。 */
const RAW_EXTS=new Set(["dng","cr2","cr3","crw","nef","nrw","arw","srf","sr2","raf",
 "orf","rw2","pef","srw","3fr","erf","kdc","mrw","raw","x3f","dcr"]);
async function openFile(file){
 if(!file)return;
 const ext=(file.name.split(".").pop()||"").toLowerCase();
 if(RAW_EXTS.has(ext)||ext==="tif"||ext==="tiff"){ status_(t("status.formatDisabled"),true); return; }
 status_(t("status.imageLoading"),false,true);
 try{
  let bmp;
  try{ bmp=await createImageBitmap(file); }
  catch(e){
   status_(t("status.unsupportedFormat"),true);
   return;
  }
  bmp=await shrinkIfNeeded(bmp);
  await setImage(bmp,file.name);
  status_(t("status.imageLoaded",{name:file.name,w:bmp.width,h:bmp.height}));
 }catch(e){ console.error(e); status_(t("status.loadFailed",{msg:e.message}),true); }
}
/* keepOrig: F2用。true時はR.origBitmap(原本)を書き換えず、既存の呼び出し(openFile)は
   従来どおりkeepOrig省略=falseとして「新しい原本」を確立する(挙動不変・R1)。
   origBitmapはR.setImage()内部でclose()されるthis.img.bitmapとは独立させるため、
   読込直後に複製(createImageBitmap)を1枚作って保持する(§F2 設計方針)。 */
async function setImage(bmp,name,keepOrig){
 state.file={name,w:bmp.width,h:bmp.height,has:true};
 if(typeof setMaskPreview==="function")setMaskPreview(false); /* WS-06: 画像差し替え時はマスク表示プレビューを自動OFF */
 if(!keepOrig){
  if(R.origBitmap && R.origBitmap.close) R.origBitmap.close();
  state.crop=null;
  /* §II-1: 新規画像読込時は「元画像」固定表示を解除する。keepOrig=true(ベイク系の再読込)では触れない。 */
  state.view.holdLatch=false;
  const btnHoldEl=$("btnHold"); if(btnHoldEl)btnHoldEl.classList.remove("on");
  try{ R.origBitmap=await createImageBitmap(bmp); }catch(e){ R.origBitmap=null; }
 }
 R.setImage(bmp,bmp.width,bmp.height);
 R.finalTex=null;
 /* §IV-1: Mirror.build()は内部でthis.buildMask()を即座に呼ぶため、無効化はMirror.build()より
    前に行う必要がある(後ろだと、新旧画像でw/hがたまたま同じ場合にthis.origだけ新しくなり
    段1キャッシュが古いままになる)。 */
 invalidateMaskLabCache();
 Mirror.build(bmp,bmp.width,bmp.height);
 rebuildMaskTexture(); /* F14: 現在の作業画像が変わるたびGPU側マスクテクスチャも作り直す(内部でmask.on判定) */
 fitView();
 $("drophint").classList.add("hidden");
 $("btnSave").disabled=false;
 $("fname").textContent=name;
 const base=name.replace(/\.[^.]+$/,"");
 $("expName").value=base+"_edited";
 state.analysis.pick=null;
 if(typeof syncMaskPickButtons==="function")syncMaskPickButtons(); /* Fix2(a) */
 mark("lut","a","b","c","blur","screen","analysis","overlay","panels","mixpanel");
 scheduleAnalysis();
}
function fitView(){
 const st=$("stage");
 const cw=st.clientWidth,ch=st.clientHeight;
 if(!state.file.has)return;
 const z=Math.min(cw/state.file.w,ch/state.file.h)*0.98;
 state.view.zoom=z;
 state.view.panX=(cw-state.file.w*z)/2;
 state.view.panY=(ch-state.file.h*z)/2;
 /* WS-01: 旧実装はここで R.ensurePreview(true) を強制実行していたが、これは render() 冒頭の
    ensurePreview(false) による「realloc検知→パイプライン再実行」より先にFBOを空で再確保して
    しまい、render() 側は再確保済みと判定して from="screen" のまま素通りする(=finalTexが
    削除済みテクスチャを指したまま画面合成される)。これがCrop.enter()やCtrl+0で発生していた
    全面黒画面バグの直接原因。R.render()側のensurePreview(false)は寸法差10%超で自動的に
    再確保しfrom="a"へ昇格するため、ここでの強制呼び出しは不要かつ有害。fitView()の直接呼び出し元
    (setImage/Crop.enter/Ctrl+0)はいずれも呼び出し直後にmark("screen"または"lut"等)で再描画を
    発火させる作りになっており(orientRotate/orientFlipはCrop.applyGeometry()→setImage()経由で
    間接的にfitView()を呼ぶため同様)、その前提はこの変更後も変わらない。 */
}
/* ---- フル解像度タイル書き出し ---- */
async function exportImage(){
 if(!R.ok||!R.img)return;
 const fmtSel=$("expFmt").value;
 const name=($("expName").value||"edited")+(fmtSel==="png"?".png":".jpg");
 $("savePop").classList.remove("show");
 status_(t("status.exportingFullRes"),false,true);
 await new Promise(r=>setTimeout(r,30));
 const gl=R.gl,W0=R.img.w,H0=R.img.h;
 const p=Object.assign({},pparams());
 if(p.kmCmp===2)p.kmCmp=0; /* 分割比較は画面専用。書き出しは積層合成側 */
 let margin=2;
 /* WS-16 S6 副作用検証(Sonnet実装): mkDotの最大pxを50→100へ引き上げるにあたり、
    作業標準書で指示された「exportImage()のmargin上限で足りるか」の確認を行った結果、
    2点の問題を発見したため修正する。
    (1) 実際に適用されるsigmaImgぼかし半径は、書き出し時のGPUパスでmin(sigFrag,32)へ
        クランプされている(pipeline()内 this.runBlur(...,Math.min(sigFrag,32)) 参照。
        書き出し中はfb.c.w===win[2]かつbl1.w===fb.c.wのため1:1でsigFrag===sigmaImg)。
        にもかかわらずmargin計算は クランプ前のsigmaImgをそのまま3倍していたため、
        実際には使われない過大な余白を無駄に予約する一方で、cellImg側の余白が
        不足する組み合わせを覆い隠していた。min(p.sigmaImg,32)へ修正し、実際に
        適用される値と整合させる。
    (2) この修正後、dotR=100(cellImg=200)の最悪ケースで必要な余白は
        200*2.5+32*3+8=604px(実測算出、dotR 0.75〜100の全域で最大)。旧上限512では
        不足するため、上限を620px(安全余裕込み)へ引き上げる。
        メモリ影響: 書き出し用FBO(RGBA16F, 8bytes/px)5枚の合計は
        旧(margin=512→bw=2048): 2048²×8×5≈167.8MB
        新(margin=620→bw=2264): 2264²×8×5≈205.2MB (+37.4MB、許容範囲)。
        なお、この余白不足は旧dotR上限50(cellImg=100)でも大きなdist値と組み合わせると
        既に512キャップに達する潜在バグだったため(旧式で計算すると930px相当が必要になる
        組み合わせが存在した)、今回の修正はdotR拡張とは独立に正しい。 */
 if(p.mixOn) margin=Math.min(620,Math.ceil(p.cellImg*2.5+Math.min(p.sigmaImg,32)*3+8));
 if(p.clAmt) margin+=Math.ceil(3*clarSigmaFor(p,1)); /* F7: 明瞭度のぼかし半径ぶんの余白(既存margin式への加算のみ) */
 const TILE=1024;
 const tw0=Math.min(TILE,W0),th0=Math.min(TILE,H0);
 const bw=tw0+2*margin,bh=th0+2*margin;
 const fb={a:R.mkFbo(bw,bh),b:R.mkFbo(bw,bh),c:R.mkFbo(bw,bh),
  bl1:R.mkFbo(bw,bh),bl2:R.mkFbo(bw,bh),exportSet:true};
 const fbOut=R.mkFbo(tw0,th0,true);
 const outCv=document.createElement("canvas");outCv.width=W0;outCv.height=H0;
 const outCx=outCv.getContext("2d");
 const rowBuf=new Uint8Array(tw0*th0*4);
 const nx=Math.ceil(W0/tw0),ny=Math.ceil(H0/th0);
 try{
  for(let ty=0;ty<ny;ty++){
   for(let tx=0;tx<nx;tx++){
    const ox=tx*tw0,oy=ty*th0;
    const tw=Math.min(tw0,W0-ox),th=Math.min(th0,H0-oy);
    const win=[ox-margin,oy-margin,tw0+2*margin,th0+2*margin];
    const r=R.pipeline(win,fb,p,"a");
    /* interior 抽出 → 8bit化 → 読出し */
    const pr=R.progs.copy8; gl.useProgram(pr);
    R.bindT(0,r.final); gl.uniform1i(pr.u("uTex"),0);
    gl.uniform2f(pr.u("uOff"),margin/win[2],margin/win[3]);
    gl.uniform2f(pr.u("uScale"),tw0/win[2],th0/win[3]);
    gl.uniform1i(pr.u("uIsSrgb"),0);
    gl.bindFramebuffer(gl.FRAMEBUFFER,fbOut.fb);
    gl.viewport(0,0,tw0,th0);
    gl.drawArrays(gl.TRIANGLES,0,3);
    gl.readPixels(0,0,tw,th,gl.RGBA,gl.UNSIGNED_BYTE,rowBuf);
    gl.bindFramebuffer(gl.FRAMEBUFFER,null);
    const id=new ImageData(new Uint8ClampedArray(rowBuf.buffer,0,tw*th*4).slice(),tw,th);
    outCx.putImageData(id,ox,oy);
    status_(t("status.exportingProgress",{pct:Math.round(((ty*nx+tx+1)/(nx*ny))*100)}),false,true);
    await new Promise(rs=>setTimeout(rs,0));
   }
  }
  const blob=await new Promise(rs=>outCv.toBlob(rs,fmtSel==="png"?"image/png":"image/jpeg",0.92));
  const a=document.createElement("a");
  a.href=URL.createObjectURL(blob); a.download=name; a.click();
  setTimeout(()=>URL.revokeObjectURL(a.href),4000);
  status_(t("status.exported",{name}));
 }catch(e){ console.error(e); status_(t("status.exportFailed",{msg:e.message}),true); }
 finally{
  R.delFbo(fb.a);R.delFbo(fb.b);R.delFbo(fb.c);R.delFbo(fb.bl1);R.delFbo(fb.bl2);
  if(fb.clar)R.delFbo(fb.clar); /* F7: 明瞭度が有効な時だけrunClarity()内で遅延確保される */
  if(fb.gamut)R.delFbo(fb.gamut); /* F12: ガマットが有効な時だけrunGamut()内で遅延確保される */
  R.delFbo(fbOut);
  mark("a"); /* プレビューを復帰再描画 */
 }
}

