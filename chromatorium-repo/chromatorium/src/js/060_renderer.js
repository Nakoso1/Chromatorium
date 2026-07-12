/* ============================================================
   R: WebGL2 レンダラ
   ============================================================ */
const R={
 gl:null,canvas:null,ok:false,halfFloat:false,
 img:null, /* {bitmap,w,h} */
 origBitmap:null, /* F2: トリミング前の原本ビットマップ(常に画像全体)。setImage()のkeepOrig=falseで更新 */
 texOrig:null, pw:0,ph:0,pscale:1,
 fboA:null,fboB:null,fboC:null,fboBl1:null,fboBl2:null,blHalf:false,
 fboClar:null, /* F7: 明瞭度パス出力(clAmt!==0の時のみ遅延確保。§F7) */
 fboGamut:null, /* F12: ガマットマスクパス出力(mode!=="off"の時のみ遅延確保) */
 maskTex:null, /* F14: 部分マスクテクスチャ(R8) */
 bayerTex:null,pigTex:null,
 lut3:{n:0,t0:null,t1:null,km:null},
 progs:{},finalTex:null,finalFromMix:false,
 fbo8:null,fbo8W:0,fbo8H:0,
 dpr:1,
 init(canvas){
  this.canvas=canvas;
  const gl=canvas.getContext("webgl2",{antialias:false,alpha:false,depth:false,stencil:false,preserveDrawingBuffer:false});
  if(!gl){ status_(t("status.webglUnsupported"),true); return; }
  this.gl=gl;
  this.halfFloat=!!gl.getExtension("EXT_color_buffer_float");
  /* フルスクリーントライアングル */
  const vao=gl.createVertexArray(); gl.bindVertexArray(vao);
  const vb=gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER,vb);
  gl.bufferData(gl.ARRAY_BUFFER,new Float32Array([-1,-1,3,-1,-1,3]),gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0,2,gl.FLOAT,false,0,0);
  const mk=(src,name)=>{
   const c=(t,s)=>{ const sh=gl.createShader(t); gl.shaderSource(sh,s); gl.compileShader(sh);
    if(!gl.getShaderParameter(sh,gl.COMPILE_STATUS)) throw new Error(name+": "+gl.getShaderInfoLog(sh));
    return sh; };
   const p=gl.createProgram();
   gl.attachShader(p,c(gl.VERTEX_SHADER,VS_SRC));
   gl.attachShader(p,c(gl.FRAGMENT_SHADER,src));
   gl.linkProgram(p);
   if(!gl.getProgramParameter(p,gl.LINK_STATUS)) throw new Error(name+": "+gl.getProgramInfoLog(p));
   p._u={}; p.u=n=>{ if(!(n in p._u)) p._u[n]=gl.getUniformLocation(p,n); return p._u[n]; };
   return p;
  };
  try{
   this.progs.warp=mk(FS_WARP,"warp");
   this.progs.val=mk(FS_VAL,"val");
   this.progs.clar=mk(FS_CLAR,"clar");
   this.progs.gamut=mk(FS_GAMUT,"gamut");
   this.progs.mix=mk(FS_MIX,"mix");
   this.progs.blur=mk(FS_BLUR,"blur");
   this.progs.screen=mk(FS_SCREEN,"screen");
   this.progs.copy8=mk(FS_COPY8,"copy8");
  }catch(e){ status_(t("status.shaderCompileFailed",{msg:e.message}),true); console.error(e); return; }
  /* Bayer 8x8 */
  const BAY=[0,32,8,40,2,34,10,42,48,16,56,24,50,18,58,26,12,44,4,36,14,46,6,38,
   60,28,52,20,62,30,54,22,3,35,11,43,1,33,9,41,51,19,59,27,49,17,57,25,
   15,47,7,39,13,45,5,37,63,31,55,23,61,29,53,21];
  const bd=new Uint8Array(64); for(let i=0;i<64;i++) bd[i]=Math.round((BAY[i]+0.5)/64*255);
  this.bayerTex=this.mkTex2(8,8,gl.R8,gl.RED,gl.UNSIGNED_BYTE,bd,gl.NEAREST,gl.REPEAT);
  /* 顔料色 16x1 (sRGB bytes) */
  this.pigTex=this.mkTex2(16,1,gl.RGBA8,gl.RGBA,gl.UNSIGNED_BYTE,new Uint8Array(64),gl.NEAREST,gl.CLAMP_TO_EDGE);
  /* F14: 部分マスク用テクスチャ。既定は1x1・全域255(=マスクなしと同じ)のダミー。
     uMaskOn==0の間は参照されないが、有効な状態は常に保っておく */
  this.maskTex=this.mkTex2(1,1,gl.R8,gl.RED,gl.UNSIGNED_BYTE,new Uint8Array([255]),gl.LINEAR,gl.CLAMP_TO_EDGE);
  /* F12: Cref(h)=K.cmax(0.72,h) の256エントリLUT。ガマット関連の状態に一切依存しない定数
     テクスチャなので初回に1度だけ作る(0..0.4を8bit量子化。誤差<0.2%で§F12の許容内)。 */
  {
   const crefData=new Uint8Array(256);
   for(let i=0;i<256;i++){ const hdeg=i/256*360; crefData[i]=Math.round(clamp(K.cmax(0.72,hdeg)/0.4,0,1)*255); }
   this.crefLUT=this.mkTex2(256,1,gl.R8,gl.RED,gl.UNSIGNED_BYTE,crefData,gl.LINEAR,gl.REPEAT);
  }
  this.ok=true;
 },
 mkTex2(w,h,internal,format,type,data,filter,wrap){
  const gl=this.gl; const t=gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D,t);
  gl.pixelStorei(gl.UNPACK_ALIGNMENT,1);
  gl.texImage2D(gl.TEXTURE_2D,0,internal,w,h,0,format,type,data||null);
  gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,filter);
  gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,filter);
  gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,wrap);
  gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,wrap);
  return t;
 },
 mkFbo(w,h,byte8){
  const gl=this.gl;
  const internal=(byte8||!this.halfFloat)?gl.RGBA8:gl.RGBA16F;
  const type=(byte8||!this.halfFloat)?gl.UNSIGNED_BYTE:gl.FLOAT;
  const tex=this.mkTex2(w,h,internal,gl.RGBA,type,null,gl.LINEAR,gl.CLAMP_TO_EDGE);
  const fb=gl.createFramebuffer();
  gl.bindFramebuffer(gl.FRAMEBUFFER,fb);
  gl.framebufferTexture2D(gl.FRAMEBUFFER,gl.COLOR_ATTACHMENT0,gl.TEXTURE_2D,tex,0);
  gl.bindFramebuffer(gl.FRAMEBUFFER,null);
  return {fb,tex,w,h};
 },
 delFbo(f){ if(!f)return; this.gl.deleteFramebuffer(f.fb); this.gl.deleteTexture(f.tex); },
 /* F14: マスクテクスチャ差し替え。data: Uint8Array(w*h), R8, 白=対象内 */
 setMaskTex(w,h,data){
  const gl=this.gl;
  if(this.maskTex)gl.deleteTexture(this.maskTex);
  this.maskTex=this.mkTex2(w,h,gl.R8,gl.RED,gl.UNSIGNED_BYTE,data,gl.LINEAR,gl.CLAMP_TO_EDGE);
 },
 setImage(bitmap,w,h){
  const gl=this.gl;
  if(this.texOrig)gl.deleteTexture(this.texOrig);
  /* 旧ビットマップのネイティブメモリを明示解放(大きい画像を続けて開いた際のメモリ削減) */
  if(this.img&&this.img.bitmap&&this.img.bitmap.close)this.img.bitmap.close();
  this.img={bitmap,w,h};
  this.texOrig=gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D,this.texOrig);
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL,false);
  gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL,false);
  gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA8,gl.RGBA,gl.UNSIGNED_BYTE,bitmap);
  gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);
  this.pw=0; /* プレビュー再確保を強制 */
 },
 uploadPigColors(bytes){ /* Uint8Array(16*4) sRGB */
  const gl=this.gl;
  gl.bindTexture(gl.TEXTURE_2D,this.pigTex);
  gl.texSubImage2D(gl.TEXTURE_2D,0,0,0,16,1,gl.RGBA,gl.UNSIGNED_BYTE,bytes);
 },
 mkTex3(n,data){
  const gl=this.gl; const t=gl.createTexture();
  gl.bindTexture(gl.TEXTURE_3D,t);
  gl.pixelStorei(gl.UNPACK_ALIGNMENT,1);
  gl.texImage3D(gl.TEXTURE_3D,0,gl.RGBA8,n,n,n,0,gl.RGBA,gl.UNSIGNED_BYTE,data);
  gl.texParameteri(gl.TEXTURE_3D,gl.TEXTURE_MIN_FILTER,gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_3D,gl.TEXTURE_MAG_FILTER,gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_3D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_3D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_3D,gl.TEXTURE_WRAP_R,gl.CLAMP_TO_EDGE);
  return t;
 },
 setPigLut(n,r0,r1,km){
  if(!this.ok)return;
  const gl=this.gl;
  if(this.lut3.t0)gl.deleteTexture(this.lut3.t0);
  if(this.lut3.t1)gl.deleteTexture(this.lut3.t1);
  if(this.lut3.km)gl.deleteTexture(this.lut3.km);
  this.lut3={n,t0:this.mkTex3(n,r0),t1:this.mkTex3(n,r1),km:this.mkTex3(n,km)};
 },
 ensureCanvas(){
  const c=this.canvas; this.dpr=window.devicePixelRatio||1;
  const w=Math.max(1,Math.round(c.clientWidth*this.dpr));
  const h=Math.max(1,Math.round(c.clientHeight*this.dpr));
  if(c.width!==w||c.height!==h){ c.width=w; c.height=h; return true; }
  return false;
 },
 targetPScale(){
  if(!this.img)return 1;
  const md=Math.max(this.img.w,this.img.h);
  let ps=clamp(state.view.zoom*this.dpr, Math.min(1,512/md), 1);
  ps=Math.min(ps,4096/md,1);
  return ps;
 },
 ensurePreview(force){
  if(!this.img)return false;
  const ps=this.targetPScale();
  const w=Math.max(1,Math.round(this.img.w*ps)),h=Math.max(1,Math.round(this.img.h*ps));
  if(!force&&this.fboA&&Math.abs(w-this.pw)/Math.max(w,1)<0.1&&Math.abs(h-this.ph)/Math.max(h,1)<0.1)return false;
  this.delFbo(this.fboA);this.delFbo(this.fboB);this.delFbo(this.fboC);
  this.delFbo(this.fboBl1);this.delFbo(this.fboBl2);this.delFbo(this.fboClar);this.delFbo(this.fboGamut);
  this.pw=w;this.ph=h;this.pscale=w/this.img.w;
  this.fboA=this.mkFbo(w,h);this.fboB=this.mkFbo(w,h);this.fboC=this.mkFbo(w,h);
  this.fboBl1=null;this.fboBl2=null;this.fboClar=null;this.fboGamut=null; /* 使う時だけ遅延確保(R1) */
  return true;
 },
 ensureBlur(half){
  const w=half?Math.max(1,this.pw>>1):this.pw, h=half?Math.max(1,this.ph>>1):this.ph;
  if(this.fboBl1&&this.fboBl1.w===w&&this.fboBl1.h===h)return;
  this.delFbo(this.fboBl1);this.delFbo(this.fboBl2);
  this.fboBl1=this.mkFbo(w,h);this.fboBl2=this.mkFbo(w,h);
 },
 /* F7: 明瞭度パス出力バッファ(プレビュー用)。exportImage()側は個別にfb.clarを確保する */
 ensureClarFbo(w,h){
  if(this.fboClar&&this.fboClar.w===w&&this.fboClar.h===h)return;
  this.delFbo(this.fboClar);
  this.fboClar=this.mkFbo(w,h);
 },
 /* F12: ガマットマスクパス出力バッファ(プレビュー用)。exportImage()側は個別にfb.gamutを確保する */
 ensureGamutFbo(w,h){
  if(this.fboGamut&&this.fboGamut.w===w&&this.fboGamut.h===h)return;
  this.delFbo(this.fboGamut);
  this.fboGamut=this.mkFbo(w,h);
 },
 bindT(unit,tex,target){ const gl=this.gl; gl.activeTexture(gl.TEXTURE0+unit); gl.bindTexture(target||gl.TEXTURE_2D,tex); },
 draw(fbo,w,h){ const gl=this.gl;
  gl.bindFramebuffer(gl.FRAMEBUFFER,fbo?fbo.fb:null);
  gl.viewport(0,0,w,h);
  gl.drawArrays(gl.TRIANGLES,0,3);
 },
 /* パイプライン実行（プレビュー/書き出し共通）
    win:[ox,oy,w,h] 画像px, fb:{a,b,c,bl1,bl2}, p:パラメータ */
 runWarp(win,fb,p){
  const gl=this.gl,pr=this.progs.warp; gl.useProgram(pr);
  this.bindT(0,this.texOrig); gl.uniform1i(pr.u("uTex"),0);
  gl.uniform4f(pr.u("uWin"),win[0],win[1],win[2],win[3]);
  gl.uniform2f(pr.u("uImgSize"),this.img.w,this.img.h);
  gl.uniform3f(pr.u("uLight"),p.light[0],p.light[1],p.light[2]);
  gl.uniform1i(pr.u("uOn"),p.hueOn?1:0);
  gl.uniform1f(pr.u("uNight"),p.night||0);
  this.bindT(1,this.maskTex); gl.uniform1i(pr.u("uMaskTex"),1);
  gl.uniform1i(pr.u("uMaskOn"),p.mskOn?1:0);
  gl.uniform1f(pr.u("uMTwarp"),p.mskTgt.warp?1:0);
  gl.uniform1f(pr.u("uMTnight"),p.mskTgt.night?1:0);
  this.draw(fb.a,fb.a.w,fb.a.h);
 },
 runVal(win,fb,srcTex,p){
  const gl=this.gl,pr=this.progs.val; gl.useProgram(pr);
  this.bindT(0,srcTex); gl.uniform1i(pr.u("uTex"),0);
  this.bindT(1,this.bayerTex); gl.uniform1i(pr.u("uBayer"),1);
  gl.uniform4f(pr.u("uWin"),win[0],win[1],win[2],win[3]);
  gl.uniform2f(pr.u("uImgSize"),this.img.w,this.img.h);
  gl.uniform1f(pr.u("uBr"),p.br); gl.uniform1f(pr.u("uSat"),p.sat);
  gl.uniform1f(pr.u("uPivot"),p.pivot); gl.uniform1f(pr.u("uCmp"),p.cmp);
  gl.uniform1f(pr.u("uSteps"),p.steps);
  gl.uniform1f(pr.u("uPost"),p.post?1:0); gl.uniform1f(pr.u("uDither"),p.dither?1:0);
  gl.uniform1f(pr.u("uGray"),p.gray?1:0);
  gl.uniform4f(pr.u("uLev"),p.lev[0],p.lev[1],p.lev[2],p.lev[3]);
  this.bindT(2,this.maskTex); gl.uniform1i(pr.u("uMaskTex"),2);
  gl.uniform1i(pr.u("uMaskOn"),p.mskOn?1:0);
  gl.uniform1f(pr.u("uMTbs"),p.mskTgt.bs?1:0);
  gl.uniform1f(pr.u("uMTcmp"),p.mskTgt.cmp?1:0);
  gl.uniform1f(pr.u("uMTlev"),p.mskTgt.lev?1:0);
  gl.uniform1f(pr.u("uMTpost"),p.mskTgt.post?1:0);
  this.draw(fb.b,fb.b.w,fb.b.h);
 },
 /* F7: PassA出力(fb.a)をぼかし(既存FS_BLURを流用)、FS_CLARで元/ぼかしを合成してfb.clar(または
    this.fboClar)へ書き出す。p.clAmt===0なら呼ばれない(§F7・R1)。blur用スクラッチはPassC(mix)の
    ものと共用するため、両方が同時に有効な場合は同一フレーム内で再確保が起きうるが正当性に問題はない。 */
 runClarity(win,fb,p){
  const gl=this.gl;
  const sigFragImg=clarSigmaFor(p, fb.a.w/win[2]);
  let bl1,bl2;
  if(fb.exportSet){ bl1=fb.bl1; bl2=fb.bl2; }
  else{ this.ensureBlur(false); bl1=this.fboBl1; bl2=this.fboBl2; }
  this.runBlur({bl1,bl2}, fb.a.tex, p, Math.min(sigFragImg,32));
  if(fb.exportSet){ if(!fb.clar||fb.clar.w!==fb.a.w||fb.clar.h!==fb.a.h){ if(fb.clar)this.delFbo(fb.clar); fb.clar=this.mkFbo(fb.a.w,fb.a.h); } }
  else{ this.ensureClarFbo(fb.a.w,fb.a.h); }
  const clarFbo = fb.exportSet ? fb.clar : this.fboClar;
  const pr=this.progs.clar; gl.useProgram(pr);
  this.bindT(0,fb.a.tex); gl.uniform1i(pr.u("uTex"),0);
  this.bindT(1,bl2.tex); gl.uniform1i(pr.u("uBlur"),1);
  gl.uniform1f(pr.u("uAmt"),p.clAmt);
  this.draw(clarFbo,clarFbo.w,clarFbo.h);
  return clarFbo;
 },
 runMix(win,fb,p,srcTex){
  const gl=this.gl,pr=this.progs.mix; gl.useProgram(pr);
  this.bindT(0,srcTex); gl.uniform1i(pr.u("uSrc"),0);
  this.bindT(1,this.pigTex); gl.uniform1i(pr.u("uPig"),1);
  this.bindT(2,this.lut3.t0,gl.TEXTURE_3D); gl.uniform1i(pr.u("uL0"),2);
  this.bindT(3,this.lut3.t1,gl.TEXTURE_3D); gl.uniform1i(pr.u("uL1"),3);
  this.bindT(4,this.lut3.km,gl.TEXTURE_3D); gl.uniform1i(pr.u("uKM"),4);
  gl.uniform4f(pr.u("uWin"),win[0],win[1],win[2],win[3]);
  gl.uniform2f(pr.u("uRes"),fb.c.w,fb.c.h);
  gl.uniform1f(pr.u("uCell"),p.cellImg);
  const n=this.lut3.n;
  gl.uniform1f(pr.u("uLutScale"),(n-1)/n); gl.uniform1f(pr.u("uLutOff"),0.5/n);
  gl.uniform1i(pr.u("uNumCh"),p.numCh);
  gl.uniform1i(pr.u("uMode"),p.mixMode);
  gl.uniform1i(pr.u("uKmCmp"),p.kmCmp);
  gl.uniform3f(pr.u("uPaper"),p.paper[0],p.paper[1],p.paper[2]);
  this.draw(fb.c,fb.c.w,fb.c.h);
 },
 /* F12: PassB(fb.b)出力とCref LUTからガマット判定。無効時(gmMode===0 or 頂点<3)は
   pipeline()側の条件で一切呼ばれない(R1)。highlight/correctいずれもfb.b→独立バッファへ。 */
 runGamut(win,fb,p){
  const gamFbo = fb.exportSet
   ? (fb.gamut && fb.gamut.w===fb.b.w && fb.gamut.h===fb.b.h ? fb.gamut : (fb.gamut&&this.delFbo(fb.gamut), fb.gamut=this.mkFbo(fb.b.w,fb.b.h)))
   : (this.ensureGamutFbo(fb.b.w,fb.b.h), this.fboGamut);
  const gl=this.gl, pr=this.progs.gamut; gl.useProgram(pr);
  this.bindT(0,fb.b.tex); gl.uniform1i(pr.u("uTex"),0);
  this.bindT(1,this.crefLUT); gl.uniform1i(pr.u("uCrefLUT"),1);
  gl.uniform1i(pr.u("uMode"),p.gmMode);
  /* WS-15: マスク配列(最大3、poly|circle)をuniformへ展開する。既存のuVerts単一多角形方式を
     uMType/uMNV/uMVerts(12点×3)/uMCirc(4成分×3)へ拡張。 */
  const masks=p.gmMasks, nm=Math.min(3,masks.length);
  gl.uniform1i(pr.u("uNM"),nm);
  const mType=new Int32Array(3), mNV=new Int32Array(3);
  const flatV=new Float32Array(72), flatC=new Float32Array(12);
  for(let i=0;i<nm;i++){
   const m=masks[i];
   if(m.type==="circle"){
    mType[i]=1; mNV[i]=0;
    flatC[i*4]=m.cx; flatC[i*4+1]=m.cy; flatC[i*4+2]=m.rad; flatC[i*4+3]=0;
   }else{
    mType[i]=0;
    const nv=Math.min(12,m.pts.length); mNV[i]=nv;
    for(let j=0;j<nv;j++){ flatV[(i*12+j)*2]=m.pts[j][0]; flatV[(i*12+j)*2+1]=m.pts[j][1]; }
   }
  }
  gl.uniform1iv(pr.u("uMType"),mType);
  gl.uniform1iv(pr.u("uMNV"),mNV);
  gl.uniform2fv(pr.u("uMVerts"),flatV);
  gl.uniform4fv(pr.u("uMCirc"),flatC);
  gl.uniform1f(pr.u("uSoft"),p.gmSoft);
  gl.uniform1f(pr.u("uDim"),p.gmDim);
  this.draw(gamFbo,gamFbo.w,gamFbo.h);
  return gamFbo;
 },
 runBlur(fb,srcTex,p,sigFrag){
  const gl=this.gl,pr=this.progs.blur; gl.useProgram(pr);
  gl.uniform1f(pr.u("uSigma"),sigFrag);
  this.bindT(0,srcTex); gl.uniform1i(pr.u("uTex"),0);
  gl.uniform2f(pr.u("uStep"),1/fb.bl1.w,0);
  this.draw(fb.bl1,fb.bl1.w,fb.bl1.h);
  this.bindT(0,fb.bl1.tex);
  gl.uniform2f(pr.u("uStep"),0,1/fb.bl2.h);
  this.draw(fb.bl2,fb.bl2.w,fb.bl2.h);
 },
 pipeline(win,fb,p,fromStage){
  const order={a:0,b:1,c:2,blur:3};
  const st=order[fromStage]??0;
  if(st<=0) this.runWarp(win,fb,p);
  let valSrc=fb.a;
  if(st<=1 && p.clAmt){ valSrc=this.runClarity(win,fb,p); } /* F7: 無効時は完全に素通り(R1) */
  if(st<=1) this.runVal(win,fb,valSrc.tex,p);
  /* F12: ガマット有効時は常にmixSrcをガマット出力にする(このフレームで再計算するかは
     st<=1で判定するが、st>1でスキップする場合も前回計算済みのバッファを指し続ける必要がある) */
  let mixSrc=fb.b;
  const gmActive = p.gmMode>0 && p.gmMasks.length>=1;
  if(gmActive){
   mixSrc = (st<=1) ? this.runGamut(win,fb,p) : (fb.exportSet ? fb.gamut : this.fboGamut);
  }
  let final=mixSrc.tex, fromMix=false;
  if(p.mixOn&&this.lut3.t0){
   if(st<=2) this.runMix(win,fb,p,mixSrc.tex);
   final=fb.c.tex; fromMix=true;
   if(p.sigmaImg>0.3){
    const sigFrag0=p.sigmaImg*(fb.c.w/win[2]);
    let bl1,bl2;
    if(fb.exportSet){ bl1=fb.bl1; bl2=fb.bl2; }
    else { this.ensureBlur(sigFrag0>10); bl1=this.fboBl1; bl2=this.fboBl2; }
    const sigFrag=sigFrag0*(bl1.w/fb.c.w);
    this.runBlur({bl1,bl2},fb.c.tex,p,Math.min(sigFrag,32));
    final=bl2.tex;
   }
  }
  return {final,fromMix};
 },
 render(d){
  if(!this.ok)return;
  const gl=this.gl;
  const cResized=this.ensureCanvas();
  if(!this.img){
   gl.bindFramebuffer(gl.FRAMEBUFFER,null);
   gl.viewport(0,0,this.canvas.width,this.canvas.height);
   gl.clearColor(0.063,0.067,0.078,1); gl.clear(gl.COLOR_BUFFER_BIT);
   return;
  }
  const realloc=this.ensurePreview(false);
  let from="screen";
  if(realloc)from="a";
  else if(d&&d.has("a"))from="a";
  else if(d&&d.has("b"))from="b";
  else if(d&&(d.has("c")))from="c";
  else if(d&&d.has("blur"))from="blur";
  if(from!=="screen"){
   /* パラメータ集約はパイプライン再実行時のみ必要（パン/ズームだけのフレームでは省略） */
   const p=pparams();
   const fb={a:this.fboA,b:this.fboB,c:this.fboC};
   const r=this.pipeline([0,0,this.img.w,this.img.h],fb,p,from);
   this.finalTex=r.final; this.finalFromMix=r.fromMix;
  }
  if(!this.finalTex)this.finalTex=this.fboB.tex;
  /* 画面合成 */
  const pr=this.progs.screen; gl.useProgram(pr);
  this.bindT(0,this.finalTex); gl.uniform1i(pr.u("uEdit"),0);
  this.bindT(1,this.texOrig); gl.uniform1i(pr.u("uOrig"),1);
  gl.uniform2f(pr.u("uCanvas"),this.canvas.width,this.canvas.height);
  gl.uniform2f(pr.u("uImgSize"),this.img.w,this.img.h);
  gl.uniform2f(pr.u("uPan"),state.view.panX*this.dpr,state.view.panY*this.dpr);
  gl.uniform1f(pr.u("uZoom"),state.view.zoom*this.dpr);
  gl.uniform1f(pr.u("uSplitX"),state.view.split?state.view.splitX:-1);
  gl.uniform1i(pr.u("uHold"),isHold()?1:0);
  this.draw(null,this.canvas.width,this.canvas.height);
 },
 /* スポイト: 最終FBOから半径r(画像px)領域のみ読出し */
 pick(ix,iy,r){
  if(!this.ok||!this.img||!this.finalTex)return null;
  const gl=this.gl;
  const s=this.pscale;
  const rr=Math.max(0,Math.round(r*s));
  const sz=Math.min(2*rr+1,65);
  const cx=clamp(Math.round(ix*s),0,this.pw-1),cy=clamp(Math.round(iy*s),0,this.ph-1);
  const x0=clamp(cx-(sz>>1),0,Math.max(0,this.pw-sz)),y0=clamp(cy-(sz>>1),0,Math.max(0,this.ph-sz));
  if(!this.fbo8||this.fbo8W<sz||this.fbo8H<sz){
   this.delFbo(this.fbo8); this.fbo8=this.mkFbo(Math.max(sz,65),Math.max(sz,65),true);
   this.fbo8W=this.fbo8.w;this.fbo8H=this.fbo8.h;
  }
  const pr=this.progs.copy8; gl.useProgram(pr);
  this.bindT(0,this.finalTex); gl.uniform1i(pr.u("uTex"),0);
  gl.uniform2f(pr.u("uOff"),x0/this.pw,y0/this.ph);
  gl.uniform2f(pr.u("uScale"),sz/this.pw,sz/this.ph);
  gl.uniform1i(pr.u("uIsSrgb"),0);
  gl.bindFramebuffer(gl.FRAMEBUFFER,this.fbo8.fb);
  gl.viewport(0,0,sz,sz);
  gl.drawArrays(gl.TRIANGLES,0,3);
  const buf=new Uint8Array(sz*sz*4);
  gl.readPixels(0,0,sz,sz,gl.RGBA,gl.UNSIGNED_BYTE,buf);
  gl.bindFramebuffer(gl.FRAMEBUFFER,null);
  /* リニア平均 */
  let a=0,b=0,c=0,n=0;
  for(let i=0;i<sz*sz;i++){
   a+=K.s2l1(buf[i*4]/255); b+=K.s2l1(buf[i*4+1]/255); c+=K.s2l1(buf[i*4+2]/255); n++;
  }
  return K.l2s([a/n,b/n,c/n]);
 }
};

/* ============================================================
   パイプラインパラメータ集約（GPU/CPUミラー共通の単一ソース）
   ============================================================ */
function pparams(){
 const s=state,mo=s.mixing;
 const numCh=chOfCurrent().length;
 const cellImg=Math.max(1.0, 2*mo.dotR); /* 画像px絶対値。以前は /s.view.zoom していたため、
  プレビューのズーム率や書き出し時のズーム状態によって網点サイズが変わってしまっていた */
 /* 点描(juxta)の合成を乗算(透明グレーズ)から加算(排他的)に変更したため、
    複数チャンネルの網点が重なっても黒スポットが原理的に発生しなくなった。
    そのため強制的な最低ぼかしは不要(むしろ点描サイズを変えてもぼやけるだけで
    網点の輪郭が全く見えなくなる副作用があったため撤廃)。
    鑑賞距離=0では網点をそのままクッキリ表示し、スライダーで初めてぼかしがかかる。 */
 const sigmaImg=(mo.subMode==="juxta"&&mo.dist>0)
  ? mo.dist*(2*cellImg+0.006*(s.file.w||1000))
  : 0;
 return {
  hueOn:s.hueWarp.enabled&&s.hueWarp.density>0,
  light:effectiveLight(s.hueWarp),   // E_final(density・順応・正規化 合成済み)
  night:s.night.on?s.night.level:0,  // プルキンエ現象(暗所視)の強さ 0..1

  br:s.global.brightness,sat:s.global.saturation,
  pivot:s.value.pivot,cmp:s.value.cmp,
  post:s.value.postOn,steps:s.value.steps,dither:s.value.dither,
  lev:[s.value.lev.bi,s.value.lev.wi,s.value.lev.bo,s.value.lev.wo],
  gray:s.value.gray,
  /* F7: 明瞭度。clAmt===0の時は下流のGPU/CPUどちらの経路も一切分岐に入らない(R1) */
  clAmt:s.clarity.amt,
  clSigmaImg:lerp(0.004,0.04,s.clarity.rad)*Math.max(s.file.w||1,s.file.h||1),
  /* F14: 部分マスク。mskOn===falseの時は下流のGPU/CPUどちらの経路も分岐に入らない(R1) */
  mskOn:s.mask.on,
  mskTgt:s.mask.targets,
  /* F12/WS-15: ガマットマスク。gmMode===0(モード=オフ、または有効マスク0個)の時は下流の
     GPU/CPUどちらの経路も分岐に入らない(R1)。有効マスクは既にP空間座標へ解決済みで渡す
     (resolveGamutMask()、GPU/CPU/書き出しの3経路が同じ関数を共有=パリティ崩れ防止)。 */
  gmMode: (s.gamut.mode!=="off" && gamutActiveMasks(s.gamut).length>=1) ? (s.gamut.mode==="correct"?2:1) : 0,
  gmMasks: (s.gamut.mode!=="off") ? gamutMasksResolved(s.gamut) : [],
  gmSoft: s.gamut.softness,
  gmDim: s.gamut.dimIn,
  mixOn:mo.on,
  mixMode:mo.subMode==="layer"?2:(mo.style==="hatch"?1:0),
  cellImg,sigmaImg,
  numCh,
  kmCmp:mo.subMode==="layer"?mo.kmCmp:0,
  paper:[K.s2l1(0.955),K.s2l1(0.945),K.s2l1(0.925)]
 };
}
/* F7: σを「画像px基準の1つの値(p.clSigmaImg)」から各バッファ解像度へ換算する共通関数。
   GPU(プレビュー縮小/書き出しタイル)・CPU(512px Mirror)の3系統がこれ1箇所だけを使う。
   bufScale = 対象バッファの px数 / 画像px数 (例: プレビューはthis.pscale、書き出しは1、
   Mirrorは Mirror.w/state.file.w)。 */
function clarSigmaFor(p,bufScale){ return p.clSigmaImg*bufScale; }
/* WS-15: state.gamut.masksは{type:"poly",verts:[{h,r}],rot}または{type:"circle",h,r,rad}の配列。
   resolveGamutMask()はGPU(uMVerts/uMCirc)・CPU(sdGamutMasksNP)・書き出し(exportGamutImage)の
   3経路すべてが共通で使うP空間座標への変換(§F12座標系)。ここを1箇所にまとめることで
   3経路の食い違い(GPU/CPUパリティ崩れ)を構造的に防ぐ。 */
function resolveGamutMask(m){
 if(m.type==="circle"){
  const hh=m.h*D2R;
  return {type:"circle", cx:m.r*Math.cos(hh), cy:m.r*Math.sin(hh), rad:m.rad};
 }
 return {type:"poly", pts: m.verts.map(v=>{ const hh=(v.h+m.rot)*D2R; return [v.r*Math.cos(hh), v.r*Math.sin(hh)]; })};
}
/* 「有効マスク」の定義: polyは頂点3個以上、circleは半径>0。標準書の「3頂点ルールの一般化」。 */
function gamutIsMaskActive(m){ return m.type==="circle" ? m.rad>1e-4 : m.verts.length>=3; }
function gamutActiveMasks(gt){ return gt.masks.filter(gamutIsMaskActive); }
function gamutMasksResolved(gt){ return gamutActiveMasks(gt).map(resolveGamutMask); }
/* 符号付き距離(内側=負)+最近点。GLSLのsdPolyNPと同一アルゴリズム(Inigo Quilez型)。
   verts: [[x,y],...] (3点以上を前提。呼び出し側でガードする) */
function sdPolygonNP(px,py,verts){
 const n=verts.length;
 let d=(px-verts[0][0])**2+(py-verts[0][1])**2;
 let nearest=verts[0];
 let s=1;
 for(let i=0,j=n-1;i<n;j=i,i++){
  const vi=verts[i], vj=verts[j];
  const ex=vj[0]-vi[0], ey=vj[1]-vi[1];
  const wx=px-vi[0], wy=py-vi[1];
  const el2=Math.max(ex*ex+ey*ey,1e-9);
  const t=clamp((wx*ex+wy*ey)/el2,0,1);
  const bx=wx-ex*t, by=wy-ey*t;
  const dd=bx*bx+by*by;
  if(dd<d){ d=dd; nearest=[vi[0]+ex*t, vi[1]+ey*t]; }
  const c1=py>=vi[1], c2=py<vj[1], c3=(ex*wy)>(ey*wx);
  if((c1&&c2&&c3)||(!c1&&!c2&&!c3)) s=-s;
 }
 return {d:s*Math.sqrt(d), nearest};
}
/* WS-15: 円形マスクのSDF(内側=負)。GLSL側sdCircleAtと同一の式。 */
function sdCircleNP(px,py,cx,cy,rad){
 const dx=px-cx, dy=py-cy, len=Math.hypot(dx,dy);
 const nearest = len>1e-6 ? [cx+dx/len*rad, cy+dy/len*rad] : [cx+rad,cy];
 return {d: len-rad, nearest};
}
/* WS-15: 複数マスクの和集合(=各マスクの符号付き距離のうち最小のもの)。masksは
   resolveGamutMask()済みの配列({type:"poly",pts}|{type:"circle",cx,cy,rad})。
   空配列(有効マスク0個)の場合はp.gmMode自体が0になり呼び出されない(既存のR1ガード)ため、
   ここでは「1個以上ある」前提で単純にmin判定するだけでよい。 */
function sdGamutMasksNP(px,py,masks){
 let best=null;
 for(const m of masks){
  const r = m.type==="circle" ? sdCircleNP(px,py,m.cx,m.cy,m.rad) : sdPolygonNP(px,py,m.pts);
  if(!best || r.d<best.d) best=r;
 }
 return best;
}
/* CPUミラー用: PassA+PassB と同一数式を1画素に適用 (GLSLパリティ厳守) */
/* F7: 第3引数lblur(省略可)。省略時(undefined)は既存と完全に同一のコードパス(if文の追加のみ)。
   渡された場合のみ、PassA直後・PassBのL演算直前にGLSL FS_CLARと同一式でLを補正する。
   F14: 第4引数m(空間マスク値0..1、省略時1.0=マスク無し)。p.mskOnがfalseの時は各ブロックとも
   元の代入式をそのまま実行する分岐を通るため、マスク無効時はビット単位で従来と同一(R1)。 */
function applyPipeCPU(lin,p,lblur,m){
 const mskOn=!!p.mskOn;
 const mv=(m===undefined)?1:m;
 let out=lin;
 if(p.hueOn){
  const t=[clamp(out[0]*p.light[0],0,1),clamp(out[1]*p.light[1],0,1),clamp(out[2]*p.light[2],0,1)];
  if(mskOn){
   const mw=p.mskTgt.warp?mv:1;
   out=[out[0]+(t[0]-out[0])*mw,out[1]+(t[1]-out[1])*mw,out[2]+(t[2]-out[2])*mw];
  }else out=t;
 }
 if(p.night>0.001){                    // プルキンエ現象(FS_WARP purkinje()と同一数式)
  const s=p.night, wRod=smooth(0.10,0.90,s);
  const ys=0.03*out[0]+0.58*out[1]+0.39*out[2];
  const rod=[ys*0.82,ys*0.96,ys*1.30], dim=1-0.72*s;
  const t=[clamp((out[0]+(rod[0]-out[0])*wRod)*dim,0,1),
           clamp((out[1]+(rod[1]-out[1])*wRod)*dim,0,1),
           clamp((out[2]+(rod[2]-out[2])*wRod)*dim,0,1)];
  if(mskOn){
   const mn=p.mskTgt.night?mv:1;
   out=[out[0]+(t[0]-out[0])*mn,out[1]+(t[1]-out[1])*mn,out[2]+(t[2]-out[2])*mn];
  }else out=t;
 }
 const lab=K.lin2ok(out);
 if(lblur!==undefined){                // F7 明瞭度(FS_CLARと同一式。マスク対象外)
  let d=lab[0]-lblur;
  const t=0.25;
  d=t*Math.tanh(d/t);
  lab[0]=clamp(lab[0]+p.clAmt*1.2*d,0,1);
 }
 let L=lab[0]; let C=Math.hypot(lab[1],lab[2]); const h=Math.atan2(lab[2],lab[1]);
 {
  const L1=L+p.br*0.5, C1=C*Math.max(1+p.sat,0);
  if(mskOn){ const mbs=p.mskTgt.bs?mv:1; L=L+(L1-L)*mbs; C=C+(C1-C)*mbs; }
  else{ L=L1; C=C1; }
 }
 {
  const L1=p.pivot+(L-p.pivot)*(1-p.cmp);
  if(mskOn){ const mcmp=p.mskTgt.cmp?mv:1; L=L+(L1-L)*mcmp; }
  else L=L1;
 }
 {
  const L1=clamp((L-p.lev[0])/Math.max(p.lev[1]-p.lev[0],1e-4),0,1)*(p.lev[3]-p.lev[2])+p.lev[2];
  if(mskOn){ const mlev=p.mskTgt.lev?mv:1; L=L+(L1-L)*mlev; }
  else L=L1;
 }
 if(p.post){
  const N=p.steps;
  const q=Math.floor(clamp(L,0,0.99999)*N+0.5)/N; /* ミラーはディザ無しの代表値 */
  const L1=N>1.5?clamp(q*N/(N-1),0,1):q;
  if(mskOn){ const mpost=p.mskTgt.post?mv:1; L=L+(L1-L)*mpost; }
  else L=L1;
 }
 if(p.gray)C=0;
 /* F12: ガマットマスク(PassB末尾=GLSL FS_GAMUTの挿入位置と同一)。gmMode===0の時は
    元の代入式(最終return)をそのまま実行する分岐を通るため、無効時はビット単位で従来と
    同一(R1)。Cref(h)はLUTを介さずK.cmax(0.72,h)を直接呼ぶ(誤差はGPU/CPUパリティの
    許容差≤2/255に含める。§F12実装接続点)。 */
 if(p.gmMode>0){
  const hdeg=mod360(h*R2D);
  const cr=Math.max(K.cmax(0.72,hdeg),1e-5);
  const r=Math.min(C/cr,1.25);
  const Px=r*Math.cos(h), Py=r*Math.sin(h);
  const {d,nearest}=sdGamutMasksNP(Px,Py,p.gmMasks);
  const w=smooth(0,Math.max(p.gmSoft,1e-4),d);
  const linOrig=K.ok2lin([L,C*Math.cos(h),C*Math.sin(h)]).map(v=>clamp(v,0,1));
  if(p.gmMode===1){
   /* §VII-3 修正: GLSL側(FS_GAMUT)と同時修正。wは内側=0・外側=1のため、
      「内側=不変・外側=減光」にはlinOrig+(grey-linOrig)*w (=mix(linOrig,grey,w))が正しい。
      旧実装はgrey+(linOrig-grey)*w (=mix(grey,linOrig,w))で内外が反転していた。 */
   const grey=K.ok2lin([L,0,0]).map(v=>clamp(v,0,1)*(1-p.gmDim));
   return [0,1,2].map(k=>clamp(linOrig[k]+(grey[k]-linOrig[k])*w,0,1));
  }else{
   const Pc=(d>0)?nearest:[Px,Py];
   const rC=Math.hypot(Pc[0],Pc[1]), hC=Math.atan2(Pc[1],Pc[0]);
   const crC=Math.max(K.cmax(0.72,mod360(hC*R2D)),1e-5);
   const Cn=rC*crC;
   const linC=K.ok2lin([L,Cn*Math.cos(hC),Cn*Math.sin(hC)]).map(v=>clamp(v,0,1));
   return [0,1,2].map(k=>clamp(linOrig[k]+(linC[k]-linOrig[k])*w,0,1));
  }
 }
 return K.ok2lin([L,C*Math.cos(h),C*Math.sin(h)]).map(v=>clamp(v,0,1));
}
/* F7 Mirror専用: PassA相当(環境光ゲイン乗算+プルキンエ)のみを複製した小関数。
   applyPipeCPU冒頭の2ブロックと同一式(パリティテストで中間値の一致を検証すること)。
   lblurArr事前計算で「PassA適用後のL」を得るために必要(原画そのもののLではない点に注意)。 */
function mirrorPassA(lin,p){
 let out=lin;
 if(p.hueOn){
  out=[clamp(out[0]*p.light[0],0,1),clamp(out[1]*p.light[1],0,1),clamp(out[2]*p.light[2],0,1)];
 }
 if(p.night>0.001){
  const s=p.night, wRod=smooth(0.10,0.90,s);
  const ys=0.03*out[0]+0.58*out[1]+0.39*out[2];
  const rod=[ys*0.82,ys*0.96,ys*1.30], dim=1-0.72*s;
  out=[clamp((out[0]+(rod[0]-out[0])*wRod)*dim,0,1),
       clamp((out[1]+(rod[1]-out[1])*wRod)*dim,0,1),
       clamp((out[2]+(rod[2]-out[2])*wRod)*dim,0,1)];
 }
 return out;
}
/* F7: 1チャンネルFloat32Array用の分離ガウシアンぼかし(Mirror解像度でのlblurArr生成用) */
function gaussianBlur1ch(src,w,h,sigma){
 if(sigma<=0.05)return src.slice();
 const r=Math.max(1,Math.ceil(sigma*3));
 const k=new Float32Array(2*r+1); let ksum=0;
 for(let i=-r;i<=r;i++){ const v=Math.exp(-(i*i)/(2*sigma*sigma)); k[i+r]=v; ksum+=v; }
 for(let i=0;i<k.length;i++)k[i]/=ksum;
 const tmp=new Float32Array(w*h), dst=new Float32Array(w*h);
 for(let y=0;y<h;y++){ const row=y*w;
  for(let x=0;x<w;x++){
   let sum=0;
   for(let i=-r;i<=r;i++){ sum+=src[row+clamp(x+i,0,w-1)]*k[i+r]; }
   tmp[row+x]=sum;
  }
 }
 for(let x=0;x<w;x++){
  for(let y=0;y<h;y++){
   let sum=0;
   for(let i=-r;i<=r;i++){ sum+=tmp[clamp(y+i,0,h-1)*w+x]*k[i+r]; }
   dst[y*w+x]=sum;
  }
 }
 return dst;
}
/* WS-16 S5-1(Sonnet実装): マスク専用のぼかしラッパ。gaussianBlur1ch自体は明瞭度(clarity)も
   使う基幹関数のため中身は一切変更しない(WS-16原則2)。
   gaussianBlur1chの計算量はO(N・σ)(カーネル半径r=ceil(3σ)がσに比例して伸びるため)であり、
   1024px・feather既定0.05(σ≈51px)で1.7秒、feather最大0.30(σ≈307px)で12.6秒かかる実測が
   あった(WS-16作業標準書 §2.2)。これが「マスクの動作が重くカクつく」の主因(WS-16 V-4)。
   方式:「面積平均で間引く→縮小版にgaussianBlur1chをそのまま適用→バイリニアで戻す」。
   標準偏差σのガウシアンは~1/σより高い周波数成分を実質持たないため、間引き率s<=σ/CAPで
   間引いても失われる情報は無い(帯域制限された信号のナイキスト再標本化)。σが大きいほど
   結果はもともと滑らかであり、粗く計算してよいというのが数学的根拠。
   間引き率s=round(σ/CAP)とし、s<=1(=σがCAPの1.5倍未満)ではgaussianBlur1chへ直接委譲する
   (結果は完全一致)。CAP=5に調整した根拠: mkFeatherスライダーは0.02以下でそもそも
   finishMaskField側がぼかしを呼ばない(m.feather>0.02の条件)ため、実際に到達しうるσの下限は
   1024px換算で約20.5px。CAP=5なら到達可能な全範囲で確実に間引き経路(s>=2)を通り、
   floor()を使った初期案で発生していた「CAP境界直後だけ間引き不足で遅い」個体(実測で
   1024px・σ≈10pxのとき95ms)を回避できる。
   実測(1024px, Node単精度, 到達可能な feather=0.025〜0.30 の全域): 最悪ケースでも40ms
   (旧gaussianBlur1ch直呼びは同条件で最大12.6秒)、誤差は最大6.8 LSB・RMS 0.83 LSB以下
   (WS-16作業標準書 §2.2/付録B参照、しきい値: 最大<=8LSB・RMS<=1.5LSB)。 */
function blurMaskField(src,w,h,sigma){
 const CAP=5;
 const s=Math.max(1,Math.round(sigma/CAP));
 if(s<=1)return gaussianBlur1ch(src,w,h,sigma); /* ← 既存関数をそのまま呼ぶ(数式不変) */
 const dw=Math.max(1,Math.ceil(w/s)), dh=Math.max(1,Math.ceil(h/s));
 const small=new Float32Array(dw*dh);
 for(let y=0;y<dh;y++){
  for(let x=0;x<dw;x++){
   let sum=0,cnt=0;
   for(let j=0;j<s;j++){
    const sy=Math.min(h-1,y*s+j);
    for(let i=0;i<s;i++){ const sx=Math.min(w-1,x*s+i); sum+=src[sy*w+sx]; cnt++; }
   }
   small[y*dw+x]=sum/cnt;
  }
 }
 const bs=gaussianBlur1ch(small,dw,dh,sigma/s); /* ← 既存関数をそのまま呼ぶ(数式不変) */
 const dst=new Float32Array(w*h);
 for(let y=0;y<h;y++){
  const fy=(y+0.5)/s-0.5, y0=Math.floor(fy), ty=fy-y0;
  const ya=clamp(y0,0,dh-1), yb=clamp(y0+1,0,dh-1);
  for(let x=0;x<w;x++){
   const fx=(x+0.5)/s-0.5, x0=Math.floor(fx), tx=fx-x0;
   const xa=clamp(x0,0,dw-1), xb=clamp(x0+1,0,dw-1);
   dst[y*w+x]=bs[ya*dw+xa]*(1-tx)*(1-ty)+bs[ya*dw+xb]*tx*(1-ty)+bs[yb*dw+xa]*(1-tx)*ty+bs[yb*dw+xb]*tx*ty;
  }
 }
 return dst;
}

