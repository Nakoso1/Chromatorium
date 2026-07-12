/* ============================================================
   ステータス表示
   ============================================================ */
let _statusT=null;
function status_(msg,isErr,sticky){
 const el=$("status"); el.textContent=msg; el.className=isErr?"busy":(sticky?"busy":"");
 if(_statusT)clearTimeout(_statusT);
 if(!sticky)_statusT=setTimeout(()=>{el.textContent=t("status.ready");el.className="";},isErr?8000:3000);
}

/* ============================================================
   Mirror: CPU側 512px 解析バッファ（第2項ハイブリッド構成）
   ============================================================ */
const S2L8=new Float32Array(256); for(let i=0;i<256;i++)S2L8[i]=K.s2l1(i/255);
const Mirror={
 w:0,h:0,orig:null,out:null,
 origHist:null,hist:null,origLumArr:null,
 maskArr:null, /* F14: Mirror解像度(512px)のマスク場。state.mask.on=falseの間はnull */
 _job:0,ready:false,
 build(bitmap,iw,ih){
  const sc=Math.min(1,512/Math.max(iw,ih));
  this.w=Math.max(1,Math.round(iw*sc)); this.h=Math.max(1,Math.round(ih*sc));
  const cv=document.createElement("canvas"); cv.width=this.w; cv.height=this.h;
  const cx=cv.getContext("2d",{willReadFrequently:true});
  cx.drawImage(bitmap,0,0,this.w,this.h);
  this.orig=cx.getImageData(0,0,this.w,this.h).data;
  this.out=new Uint8ClampedArray(this.orig);
  this.origHist=this.calcHist(this.orig);
  this.hist=this.calcHist(this.out);
  this.ready=true;
  this.buildMask();
 },
 /* F14: GPU側(rebuildMaskTexture)と同じ判定式(段2/段3/finishMaskField)を、Mirror自身の
    解像度(512px)・元画像データ(this.orig)から計算する(GPU/CPUパリティ§F14受け入れ基準)。
    §IV-1: 段1(Lab場)は_maskStageCache.mirrorに独立キャッシュし、GPU側(_maskStageCache.gpu)
    とは解像度が異なるため混同しない。 */
 buildMask(){
  if(!this.ready){ this.maskArr=null; _maskArrVer++; return; }
  if(!state.mask.on){ this.maskArr=null; _maskArrVer++; return; }
  const bufScale=this.w/(state.file.w||this.w);
  const cache=_maskStageCache.mirror;
  if(cache.labDirty || !cache.lab || cache.lab.w!==this.w || cache.lab.h!==this.h){
   cache.lab=computeLabField(this.orig,this.w,this.h);
   cache.labDirty=false;
  }
  let Mc=applyTrapStage(cache.lab);
  const geoData=computeGeoStage(cache.geoCache,this.w,this.h,bufScale);
  if(geoData){ for(let i=0;i<Mc.length;i++)Mc[i]*=geoData[i*4]/255; }
  Mc=finishMaskField(Mc,this.w,this.h);
  this.maskArr=Mc;
  _maskArrVer++; /* WS-16 S4-1: マスク場が更新されるたびに版数を進め、buildMaskStamp()の
    キャッシュ判定に使う(旧実装はupdateMaskPreview()の呼び出しごとに毎回作り直していた)。 */
 },
 calcHist(buf){
  const lum=new Uint32Array(256),r=new Uint32Array(256),g=new Uint32Array(256),b=new Uint32Array(256);
  for(let i=0;i<buf.length;i+=4){
   r[buf[i]]++;g[buf[i+1]]++;b[buf[i+2]]++;
   const Y=K.l2s1(0.2126729*S2L8[buf[i]]+0.7151522*S2L8[buf[i+1]]+0.0721750*S2L8[buf[i+2]]);
   lum[Math.min(255,Math.round(Y*255))]++;
  }
  return {lum,r,g,b};
 },
 /* デバウンス済み再計算（チャンク分割・キャンセル可能） */
 recompute(done){
  if(!this.ready)return;
  const job=++this._job;
  const p=pparams(); const src=this.orig,dst=this.out;
  const total=this.w*this.h; let i=0;
  const CH=14000;
  /* F7: 明瞭度が有効な場合のみ、PassA適用後のL(原画のLではない)をMirror解像度で
     ぼかした配列を事前計算する。applyPipeCPUの第3引数(省略時undefined)に渡す。 */
  let lblurArr=null;
  if(p.clAmt){
   const Lpre=new Float32Array(total);
   for(let j=0;j<total;j++){
    const o=j*4;
    const lin=mirrorPassA([S2L8[src[o]],S2L8[src[o+1]],S2L8[src[o+2]]],p);
    Lpre[j]=K.lin2ok(lin)[0];
   }
   const sigmaPx=clarSigmaFor(p,this.w/(state.file.w||this.w));
   lblurArr=gaussianBlur1ch(Lpre,this.w,this.h,sigmaPx);
  }
  /* F14: マスクが有効ならmaskArr(this.buildMask()で事前計算済み)を第4引数として渡す */
  const maskArr=p.mskOn?this.maskArr:null;
  const step=()=>{
   if(job!==this._job)return;
   const end=Math.min(total,i+CH);
   for(;i<end;i++){
    const o=i*4;
    const lin=applyPipeCPU([S2L8[src[o]],S2L8[src[o+1]],S2L8[src[o+2]]],p,
     lblurArr?lblurArr[i]:undefined, maskArr?maskArr[i]:undefined);
    dst[o]=Math.round(K.l2s1(lin[0])*255);
    dst[o+1]=Math.round(K.l2s1(lin[1])*255);
    dst[o+2]=Math.round(K.l2s1(lin[2])*255);
    dst[o+3]=255;
   }
   if(i<total){ setTimeout(step,0); }
   else{ this.hist=this.calcHist(dst); if(done)done(); }
  };
  step();
 }
};
let _anT=null;
function scheduleAnalysis(){
 if(_anT)clearTimeout(_anT);
 _anT=setTimeout(()=>{ Mirror.recompute(()=>{ drawHist(); drawCVD(); refreshNumeric(); }); },110);
}
/* ヒストグラム描画 */
function drawHist(){
 const cv=$("histCanvas"),cx=cv.getContext("2d");
 cx.clearRect(0,0,cv.width,cv.height);
 if(!Mirror.ready)return;
 const useOrig=isHold();
 $("histSrc").textContent=useOrig?t("ui.histSourceOrig"):t("ui.histSourceEdited");
 const H=useOrig?Mirror.origHist:Mirror.hist;
 const draw=(arr,color,alpha)=>{
  let mx=1; for(let i=0;i<256;i++)mx=Math.max(mx,arr[i]);
  cx.globalAlpha=alpha; cx.fillStyle=color;
  const w=cv.width/256;
  for(let i=0;i<256;i++){
   const h=Math.pow(arr[i]/mx,0.5)*(cv.height-4);
   cx.fillRect(i*w,cv.height-h,Math.ceil(w),h);
  }
  cx.globalAlpha=1;
 };
 if(state.analysis.histMode==="lum") draw(H.lum,"#c9cdd8",1);
 else{
  /* §III-4: オフのチャンネルは非表示。オンのうち「最後にオンへ切り替えたチャンネル」(histChFront)のみ
     不透明度100%で最前面、他は従来どおり半透明のまま描く(重なり合う半透明ヒストグラムのoverplotting対策)。 */
  const ch=state.analysis.histCh, front=state.analysis.histChFront;
  const specs={r:["#e06666",H.r],g:["#7ec97e",H.g],b:["#6f9fe0",H.b]};
  Object.keys(specs).forEach(k=>{
   if(!ch[k]||k===front)return;
   draw(specs[k][1],specs[k][0],0.55);
  });
  if(front&&ch[front])draw(specs[front][1],specs[front][0],1);
 }
}
/* §III-4: R/G/Bチップのon/disabled表示をstateへ同期する。onCount===1のチップはdisabledにして
   「最後の1つはオフ不可」を強制する(ボタン自体をクリック不能にし、ハンドラ側の早期returnと二重に防御)。 */
function syncHistChUI(){
 const cur=state.analysis.histCh;
 const onCount=(cur.r?1:0)+(cur.g?1:0)+(cur.b?1:0);
 ["r","g","b"].forEach(k=>{
  const btn=$("histCh"+k.toUpperCase());
  btn.classList.toggle("on",cur[k]);
  btn.disabled=cur[k]&&onCount<=1;
 });
}
/* §III-4/§I-2: ヒストグラムのチャンネル表示は「表示設定」のためUNDO_KEYSに入れず、
   localStorage(clab.v1.histch)にのみ永続化する(guidesCfg/mixScaleと同じ扱い)。 */
const LSK_HISTCH="clab.v1.histch";
function loadHistChCfg(){
 try{
  const raw=localStorage.getItem(LSK_HISTCH);
  if(raw){
   const o=JSON.parse(raw);
   if(typeof o.r==="boolean")state.analysis.histCh.r=o.r;
   if(typeof o.g==="boolean")state.analysis.histCh.g=o.g;
   if(typeof o.b==="boolean")state.analysis.histCh.b=o.b;
   if(o.front==="r"||o.front==="g"||o.front==="b")state.analysis.histChFront=o.front;
  }
 }catch(e){}
 /* 破損データ等で全オフになっていた場合の救済(仕様上あってはならない状態) */
 if(!state.analysis.histCh.r&&!state.analysis.histCh.g&&!state.analysis.histCh.b){
  state.analysis.histCh.b=true; state.analysis.histChFront="b";
 }
}
function saveHistChCfg(){
 try{
  localStorage.setItem(LSK_HISTCH,JSON.stringify({r:state.analysis.histCh.r,g:state.analysis.histCh.g,b:state.analysis.histCh.b,front:state.analysis.histChFront}));
 }catch(e){}
}
/* 色覚多様性プレビュー */
function drawCVD(){
 const sel=state.analysis.cvd;
 const cv=$("cvdCanvas");
 if(!Mirror.ready){cv.width=1;cv.height=1;return;}
 cv.width=Mirror.w; cv.height=Mirror.h;
 const cx=cv.getContext("2d");
 const src=isHold()?Mirror.orig:Mirror.out;
 const id=cx.createImageData(Mirror.w,Mirror.h);
 const M=sel==="none"?null:K.CVD[sel==="protan"?"protan":sel==="deutan"?"deutan":"tritan"];
 for(let i=0;i<src.length;i+=4){
  if(!M){ id.data[i]=src[i];id.data[i+1]=src[i+1];id.data[i+2]=src[i+2]; }
  else{
   const lin=K.applyCVD([S2L8[src[i]],S2L8[src[i+1]],S2L8[src[i+2]]],M);
   id.data[i]=Math.round(K.l2s1(lin[0])*255);
   id.data[i+1]=Math.round(K.l2s1(lin[1])*255);
   id.data[i+2]=Math.round(K.l2s1(lin[2])*255);
  }
  id.data[i+3]=255;
 }
 cx.putImageData(id,0,0);
}
/* 診断 (3.5): グリザイユ + 局所コントラスト */
function drawDiagnostics(){
 if(!Mirror.ready)return;
 const w=Mirror.w,h=Mirror.h;
 const lum=new Float32Array(w*h);
 for(let i=0;i<w*h;i++){
  const o=i*4;
  lum[i]=0.2126729*S2L8[Mirror.out[o]]+0.7151522*S2L8[Mirror.out[o+1]]+0.0721750*S2L8[Mirror.out[o+2]];
 }
 const g=$("diagGris"); g.width=w;g.height=h;
 const gx=g.getContext("2d"); const gid=gx.createImageData(w,h);
 for(let i=0;i<w*h;i++){
  const v=Math.round(K.l2s1(lum[i])*255);
  gid.data[i*4]=v;gid.data[i*4+1]=v;gid.data[i*4+2]=v;gid.data[i*4+3]=255;
 }
 gx.putImageData(gid,0,0);
 const c=$("diagCtr"); c.width=w;c.height=h;
 const cx2=c.getContext("2d"); const cid=cx2.createImageData(w,h);
 const R5=4;
 for(let y=0;y<h;y++)for(let x=0;x<w;x++){
  let mn=1,mx=0;
  for(let dy=-R5;dy<=R5;dy+=2)for(let dx=-R5;dx<=R5;dx+=2){
   const yy=clamp(y+dy,0,h-1),xx=clamp(x+dx,0,w-1);
   const v=lum[yy*w+xx]; if(v<mn)mn=v; if(v>mx)mx=v;
  }
  const ct=Math.pow(clamp(mx-mn,0,1),0.6);
  const i2=(y*w+x)*4;
  cid.data[i2]=Math.round(255*Math.min(1,ct*1.8));
  cid.data[i2+1]=Math.round(255*Math.min(1,ct*1.1));
  cid.data[i2+2]=Math.round(255*Math.max(0,0.9-ct*1.2)*0.5);
  cid.data[i2+3]=255;
 }
 cx2.putImageData(cid,0,0);
}

