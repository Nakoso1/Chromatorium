/* ============================================================
   顔料ライブラリ（反射スペクトル近似パラメータ = 簡易KM内部データ）
   R(λ)=clip( base + Σ amp·Gauss(c,w) + Σ amp·Sigmoid(c,st) )
   ============================================================ */
const PIG_LIB=[
 {id:"phthalo_blue",   name:"フタロブルー",           base:0.03,gs:[[0.42,462,26],[0.08,505,30]],sg:[]},
 {id:"peacock_blue",   name:"ピーコックブルー",        base:0.04,gs:[[0.50,478,34],[0.22,508,36]],sg:[]},
 {id:"quin_magenta",   name:"キナクリドンマゼンタ",    base:0.04,gs:[[0.30,435,30]],sg:[[0.68,608,14]]},
 {id:"primary_magenta",name:"プライマリーマゼンタ",    base:0.05,gs:[[0.38,445,32]],sg:[[0.74,592,13]]},
 {id:"cad_yellow",     name:"カドミウムイエロー",      base:0.04,gs:[],sg:[[0.85,508,10]]},
 {id:"nt_yellow",      name:"ニッケルチタンイエロー",  base:0.12,gs:[],sg:[[0.70,492,16]]},
 {id:"ivory_black",    name:"アイボリーブラック",      base:0.02,gs:[],sg:[]},
 {id:"titanium_white", name:"チタニウムホワイト",      base:0.94,gs:[],sg:[]},
 {id:"zinc_white",     name:"ジンクホワイト",          base:0.90,gs:[],sg:[]},
 {id:"pyrrole_red",    name:"ピロールレッド",          base:0.04,gs:[],sg:[[0.75,588,9]]},
 {id:"cad_red",        name:"カドミウムレッド",        base:0.04,gs:[],sg:[[0.72,602,9]]},
 {id:"phthalo_green",  name:"フタログリーン",          base:0.03,gs:[[0.45,522,24]],sg:[]},
 {id:"ultramarine",    name:"ウルトラマリンブルー",    base:0.04,gs:[[0.44,452,26]],sg:[[0.07,660,20]]},
 {id:"indanthrone",    name:"インダンスレン",          base:0.035,gs:[[0.30,452,32]],sg:[]},
 /* 印象派パレット用 (4.3) — モネが1886年以降に使ったとされる黒を含まない構成に基づく */
 {id:"vermilion",      name:"バーミリオン",            base:0.05,gs:[],sg:[[0.80,600,9]]},
 {id:"madder_red",     name:"マダーレーキ（アカネ）",  base:0.04,gs:[[0.32,505,32]],sg:[[0.58,580,11]]},
 {id:"cobalt_blue",    name:"コバルトブルー",          base:0.05,gs:[[0.40,470,28]],sg:[[0.05,650,18]]},
 {id:"emerald_green",  name:"エメラルドグリーン",      base:0.04,gs:[[0.50,530,20],[0.15,470,25]],sg:[]},
 /* 理想値モード用: 理論ブロック分光 */
 {id:"ideal_C",name:"理想シアン",   base:0.92,gs:[],sg:[[-0.90,575,8]],ideal:true},
 {id:"ideal_M",name:"理想マゼンタ", base:0.92,gs:[[-0.88,545,40]],sg:[],ideal:true},
 {id:"ideal_Y",name:"理想イエロー", base:0.02,gs:[],sg:[[0.90,500,8]],ideal:true},
 {id:"ideal_K",name:"理想ブラック", base:0.02,gs:[],sg:[],ideal:true},
 {id:"ideal_W",name:"理想ホワイト", base:0.97,gs:[],sg:[],ideal:true},
 {id:"ideal_R",name:"理想レッド",   base:0.03,gs:[],sg:[[0.92,595,8]],ideal:true},
 {id:"ideal_G",name:"理想グリーン", base:0.03,gs:[[0.90,530,30]],sg:[],ideal:true},
 {id:"ideal_B",name:"理想ブルー",   base:0.03,gs:[[0.90,455,28]],sg:[],ideal:true}
];
const CH_OF={CMYK:["C","M","Y","K","W"],RGB:["R","G","B","W"]};
/* 現在の系統でのチャンネルラベル一覧。CUSTOM(自由編成)は customCount(1〜7) に応じて可変長になる */
function chOfCurrent(){
 if(state.mixing.system==="CUSTOM"){
  const n=Math.max(1,Math.min(7,state.mixing.customCount||1));
  return Array.from({length:n},(_,i)=>"P"+(i+1));
 }
 return CH_OF[state.mixing.system];
}
const ALT_OF={C:["phthalo_blue","peacock_blue","cobalt_blue"],M:["quin_magenta","primary_magenta","madder_red"],
 Y:["cad_yellow","nt_yellow"],K:["ivory_black"],W:["titanium_white","zinc_white"],
 R:["pyrrole_red","cad_red","vermilion"],G:["phthalo_green","emerald_green"],B:["ultramarine","indanthrone","cobalt_blue"]};
const IDEAL_OF={C:"ideal_C",M:"ideal_M",Y:"ideal_Y",K:"ideal_K",W:"ideal_W",R:"ideal_R",G:"ideal_G",B:"ideal_B"};
function pigById(id){ return PIG_LIB.find(p=>p.id===id)||state.pigments.custom.find(p=>p.id===id)||PIG_LIB[0]; }
function pigList(){ return PIG_LIB.filter(p=>!p.ideal).concat(state.pigments.custom); }
/* 現在の割当から使用顔料ID列（チャンネル順） */
function currentPigIds(ideal){
 const chs=chOfCurrent();
 return chs.map(ch=> (ideal&&IDEAL_OF[ch])?IDEAL_OF[ch]:state.mixing.assign[ch]);
}

/* ============================================================
   計算Worker (Kubelka-Munk / 分解LUT / レシピ逆算 / k-means / 立体メッシュ)
   ============================================================ */
const WORKER_SRC = `
"use strict";
var NL=36, L0=380, DL=10;
function gpw(x,mu,s1,s2){ var s=x<mu?s1:s2; var t=(x-mu)/s; return Math.exp(-0.5*t*t); }
var CMF=[],D65=[50.0,54.6,82.8,91.5,93.4,86.7,104.9,117.0,117.8,114.9,115.9,108.8,109.4,107.8,104.8,107.7,104.4,104.0,100.0,96.3,95.8,88.7,90.0,89.6,87.7,83.3,83.7,80.0,80.2,82.3,78.3,69.7,71.6,74.3,61.6,69.9];
var WXYZ=null;
(function(){
 var ky=0;
 for(var i=0;i<NL;i++){
  var l=L0+i*DL;
  var xb=1.056*gpw(l,599.8,37.9,31.0)+0.362*gpw(l,442.0,16.0,26.7)-0.065*gpw(l,501.1,20.4,26.2);
  var yb=0.821*gpw(l,568.8,46.9,40.5)+0.286*gpw(l,530.9,16.3,31.1);
  var zb=1.217*gpw(l,437.0,11.8,36.0)+0.681*gpw(l,459.0,26.0,13.8);
  CMF.push([xb,yb,zb]);
  ky+=yb*D65[i];
 }
 WXYZ=[];
 for(var i2=0;i2<NL;i2++){
  WXYZ.push([CMF[i2][0]*D65[i2]/ky, CMF[i2][1]*D65[i2]/ky, CMF[i2][2]*D65[i2]/ky]);
 }
})();
function refl2lin(R){
 var X=0,Y=0,Z=0;
 for(var i=0;i<NL;i++){ X+=R[i]*WXYZ[i][0]; Y+=R[i]*WXYZ[i][1]; Z+=R[i]*WXYZ[i][2]; }
 var r= 3.2404542*X-1.5371385*Y-0.4985314*Z;
 var g=-0.9692660*X+1.8760108*Y+0.0415560*Z;
 var b= 0.0556434*X-0.2040259*Y+1.0572252*Z;
 return [r,g,b];
}
function clamp01(v){ return v<0?0:(v>1?1:v); }
function l2s1(u){ u=clamp01(u); return u<=0.0031308?u*12.92:1.055*Math.pow(u,1/2.4)-0.055; }
function s2l1(u){ return u<=0.04045?u/12.92:Math.pow((u+0.055)/1.055,2.4); }
function cbrt(x){ return Math.sign(x)*Math.pow(Math.abs(x),1/3); }
function lin2ok(c){
 var l=0.4122214708*c[0]+0.5363325363*c[1]+0.0514459929*c[2];
 var m=0.2119034982*c[0]+0.6806995451*c[1]+0.1073969566*c[2];
 var s=0.0883024619*c[0]+0.2817188376*c[1]+0.6299787005*c[2];
 var l_=cbrt(l),m_=cbrt(m),s_=cbrt(s);
 return [0.2104542553*l_+0.7936177850*m_-0.0040720468*s_,
         1.9779984951*l_-2.4285922050*m_+0.4505937099*s_,
         0.0259040371*l_+0.7827717662*m_-0.8086757660*s_];
}
function ok2lin(L){
 var l_=L[0]+0.3963377774*L[1]+0.2158037573*L[2];
 var m_=L[0]-0.1055613458*L[1]-0.0638541728*L[2];
 var s_=L[0]-0.0894841775*L[1]-1.2914855480*L[2];
 var l=l_*l_*l_,m=m_*m_*m_,s=s_*s_*s_;
 return [ 4.0767416621*l-3.3077115913*m+0.2309699292*s,
         -1.2684380046*l+2.6097574011*m-0.3413193965*s,
         -0.0041960863*l-0.7034186147*m+1.7076147010*s];
}
/* 顔料パラメータ -> 反射率36点 -> K/S */
function pigKS(def){
 var ks=new Float64Array(NL);
 for(var i=0;i<NL;i++){
  var l=L0+i*DL, R=def.base;
  var g=def.gs||[];
  for(var j=0;j<g.length;j++){ var t=(l-g[j][1])/g[j][2]; R+=g[j][0]*Math.exp(-t*t); }
  var sg=def.sg||[];
  for(var j2=0;j2<sg.length;j2++){ R+=sg[j2][0]/(1+Math.exp(-(l-sg[j2][1])/sg[j2][2])); }
  R=Math.min(0.985,Math.max(0.015,R));
  ks[i]=(1-R)*(1-R)/(2*R);
 }
 return ks;
}
/* 単定数KM混色 -> linear sRGB */
function mixLin(conc,KS){
 var R=new Float64Array(NL);
 for(var i=0;i<NL;i++){
  var k=0;
  for(var j=0;j<conc.length;j++) k+=conc[j]*KS[j][i];
  R[i]=1+k-Math.sqrt(k*k+2*k);
 }
 return refl2lin(R);
}
function project(c){
 var s=0,n=c.length;
 for(var i=0;i<n;i++){ if(c[i]<0)c[i]=0; s+=c[i]; }
 if(s<1e-9){ for(var j=0;j<n;j++)c[j]=1/n; return c; }
 for(var k=0;k<n;k++)c[k]/=s;
 return c;
}
function objective(c,KS,tgt){
 var lin=mixLin(c,KS);
 var ok=lin2ok([clamp01(lin[0]),clamp01(lin[1]),clamp01(lin[2])]);
 var dl=ok[0]-tgt[0],da=ok[1]-tgt[1],db=ok[2]-tgt[2];
 return dl*dl*1.4+da*da+db*db;
}
function solve(tgtOk,KS,init,iters){
 var n=KS.length;
 var c=init?init.slice():new Array(n).fill(1/n);
 project(c);
 var f=objective(c,KS,tgtOk), step=0.35, g=new Array(n);
 for(var it=0;it<iters;it++){
  var eps=1e-3;
  for(var i=0;i<n;i++){
   var c2=c.slice(); c2[i]+=eps; project(c2);
   g[i]=(objective(c2,KS,tgtOk)-f)/eps;
  }
  var gn=0; for(var j=0;j<n;j++)gn+=g[j]*g[j];
  if(gn<1e-12)break;
  var tried=false;
  for(var t=0;t<6;t++){
   var cn=new Array(n);
   for(var k=0;k<n;k++)cn[k]=c[k]-step*g[k];
   project(cn);
   var fn=objective(cn,KS,tgtOk);
   if(fn<f){ c=cn; f=fn; step*=1.25; tried=true; break; }
   step*=0.5;
  }
  if(!tried&&step<1e-5)break;
 }
 return {c:c,f:f};
}
/* ============================================================
   点描/積層(隙間なく塗る配分)専用のフィッティング (4.1 改修)
   solve()/objective()/project() は「パレットで混ぜた色」(KM理想=km用)の計算なので変更しない。
   点描・積層のシェーダーは実際には「白紙の上に隙間なく色の粒/層を置いていく」計算をしているため、
   その式そのものを目的関数にして別途フィッティングし直したものを r0/r1 に保存する。
   合計100%の制約(project)は外し、各チャンネル独立に0〜100%まで(重なりを許して)取れるようにする。
   ============================================================ */
var PAPER_LIN=[s2l1(0.955),s2l1(0.945),s2l1(0.925)]; /* メインスレッド pparams() の paper と同じ値に保つこと */
function pigMasstoneSet(KS){ var a=[]; for(var i=0;i<KS.length;i++)a.push(mixLin([1],[KS[i]])); return a; }
var GLAZE_W=0.9; /* 0=不透明置換(安全・色域狭い) 1=乗算グレーズ(色域広い・黒スポットのリスクあり)。
  検証の結果、W=1.0未満なら黒スポット発生率は複数パレット・複数の暗い色すべてで0%を維持しつつ、
  W=0.9前後で乗算グレーズにかなり近い色域(暗い色の再現性)まで回復できることを確認済み。 */
function compFor(c,pigLin){
 /* ハイブリッド合成: 各チャンネルを塗るたびに「不透明置換」と「乗算グレーズ」をGLAZE_Wで混ぜる。
    加算(排他的)合成だけだと、乗算による黒スポットは防げる代わりに、暗い/彩度の高い色に
    ほとんど届かなくなり(特に黒を持たないRGB系・カスタム系で顕著)、色の再現性が大きく悪化した。
    完全な乗算合成(W=1)は色域は広いが、複数チャンネルの網点がたまたま全部重なった1点だけ
    掛け算で黒く沈み込む(黒スポット)。
    W<1だと、各段階で必ずいくらか「不透明置換」が混ざるため、何色重なってもそこで一旦
    "リセット"がかかり、黒スポットの原因である多段階の掛け算の暴走が起きない
    (実験的に、Wが1に非常に近づかない限り黒スポット発生率は0%のまま)。
    白紙の上にひと色だけ置いた場合は、従来通りそのままの発色になる。 */
 var col=[PAPER_LIN[0],PAPER_LIN[1],PAPER_LIN[2]];
 for(var i=0;i<c.length;i++){
  var ci=c[i];
  var op0=col[0]*(1-ci)+pigLin[i][0]*ci, op1=col[1]*(1-ci)+pigLin[i][1]*ci, op2=col[2]*(1-ci)+pigLin[i][2]*ci;
  var gl0=col[0]*(1-ci+ci*pigLin[i][0]), gl1=col[1]*(1-ci+ci*pigLin[i][1]), gl2=col[2]*(1-ci+ci*pigLin[i][2]);
  col[0]=op0*(1-GLAZE_W)+gl0*GLAZE_W;
  col[1]=op1*(1-GLAZE_W)+gl1*GLAZE_W;
  col[2]=op2*(1-GLAZE_W)+gl2*GLAZE_W;
 }
 return col;
}
function clampVec(c){ var o=new Array(c.length); for(var i=0;i<c.length;i++)o[i]=c[i]<0?0:(c[i]>1?1:c[i]); return o; }
function objectiveCov(c,pigLin,tgt){
 var lin=compFor(c,pigLin);
 var ok=lin2ok([clamp01(lin[0]),clamp01(lin[1]),clamp01(lin[2])]);
 var dl=ok[0]-tgt[0],da=ok[1]-tgt[1],db=ok[2]-tgt[2];
 return dl*dl*1.4+da*da+db*db;
}
function solveCov(tgtOk,pigLin,init,iters){
 var n=pigLin.length;
 var c=clampVec(init?init.slice():new Array(n).fill(0.3));
 var f=objectiveCov(c,pigLin,tgtOk), step=0.35, g=new Array(n);
 for(var it=0;it<iters;it++){
  var eps=1e-3;
  for(var i=0;i<n;i++){
   var c2=c.slice(); c2[i]=Math.min(1,c2[i]+eps);
   g[i]=(objectiveCov(c2,pigLin,tgtOk)-f)/eps;
  }
  var gn=0; for(var j=0;j<n;j++)gn+=g[j]*g[j];
  if(gn<1e-12)break;
  var tried=false;
  for(var t=0;t<6;t++){
   var cn=new Array(n);
   for(var k=0;k<n;k++)cn[k]=c[k]-step*g[k];
   cn=clampVec(cn);
   var fn=objectiveCov(cn,pigLin,tgtOk);
   if(fn<f){ c=cn; f=fn; step*=1.25; tried=true; break; }
   step*=0.5;
  }
  if(!tried&&step<1e-5)break;
 }
 return {c:c,f:f};
}
function buildKSset(defs){ var a=[]; for(var i=0;i<defs.length;i++)a.push(pigKS(defs[i])); return a; }
function lutOne(n,KS,jobId){
 var tot=n*n*n;
 var r0=new Uint8Array(tot*4), r1=new Uint8Array(tot*4), km=new Uint8Array(tot*4);
 var nc=KS.length;
 var pigLin=pigMasstoneSet(KS);
 var wInit=new Array(nc).fill(0.04); wInit[nc-1]=1;
 var wInitCov=new Array(nc).fill(0.5);
 var wInitCov2=new Array(nc).fill(0.15);
 var prev=null, prevCov=null;
 for(var z=0;z<n;z++){
  for(var y=0;y<n;y++){
   var rowInit=null, rowInitCov=null;
   for(var x=0;x<n;x++){
    var s=[x/(n-1),y/(n-1),z/(n-1)];
    var tgt=lin2ok([s2l1(s[0]),s2l1(s[1]),s2l1(s[2])]);
    /* (A) パレットで混ぜた場合の正解値 — km(KM理想比較)用。従来通り */
    var init=prev|| (rowInit? rowInit: null);
    var res=solve(tgt,KS,init, init?12:40);
    if(!init){
     var res2=solve(tgt,KS,wInit,30);
     if(res2.f<res.f)res=res2;
    }
    prev=res.c; if(x===0)rowInit=res.c;
    var lin=mixLin(res.c,KS);
    /* (B) 白紙の上に隙間なく置いた場合の配分 — r0/r1(点描/積層)用。合計100%制約なし、重なりOK
       ウォームスタート(同じ行の1つ前の点の解を初期値にする)は、行内でじわじわ悪い方向に
       ドリフトし、本来コールドスタートなら簡単に見つかる解を見逃す局所解にハマることが
       実測で確認された(例: 暖色のターゲットなのに不要なシアンを引きずり続けるケース)。
       反復回数を増やしても改善しなかった(局所解自体が原因のため)ので、毎点で追加の
       初期値も必ず試して一番良いものを採用する。速度より正確さを優先する。 */
    var initC=prevCov|| (rowInitCov? rowInitCov: null);
    var resC=solveCov(tgt,pigLin,initC, initC?14:45);
    var resCb=solveCov(tgt,pigLin,wInitCov,30);
    if(resCb.f<resC.f)resC=resCb;
    var resCc=solveCov(tgt,pigLin,wInitCov2,30);
    if(resCc.f<resC.f)resC=resCc;
    var resCd=solveCov(tgt,pigLin,null,30);
    if(resCd.f<resC.f)resC=resCd;
    prevCov=resC.c; if(x===0)rowInitCov=resC.c;
    var idx=((z*n+y)*n+x)*4;
    for(var ci=0;ci<4;ci++) r0[idx+ci]=Math.round(clamp01(ci<nc?resC.c[ci]:0)*255);
    /* r1のg,bチャンネルは元々未使用だったので、6,7色目の配分をここに格納する(最大7色対応) */
    r1[idx]  =Math.round(clamp01(nc>4?resC.c[4]:0)*255);
    r1[idx+1]=Math.round(clamp01(nc>5?resC.c[5]:0)*255);
    r1[idx+2]=Math.round(clamp01(nc>6?resC.c[6]:0)*255);
    r1[idx+3]=255;
    km[idx]=Math.round(l2s1(lin[0])*255); km[idx+1]=Math.round(l2s1(lin[1])*255);
    km[idx+2]=Math.round(l2s1(lin[2])*255); km[idx+3]=255;
   }
   prev=null; prevCov=null;
  }
  if(n>=25) postMessage({type:"progress",jobId:jobId,done:z+1,total:n});
 }
 return {r0:r0,r1:r1,km:km};
}
onmessage=function(e){
 var m=e.data;
 try{
  if(m.type==="lut"){
   var KS=buildKSset(m.defs);
   var a17=lutOne(17,KS,m.jobId);
   postMessage({type:"lutpart",jobId:m.jobId,n:17,r0:a17.r0,r1:a17.r1,km:a17.km,final:false},
    [a17.r0.buffer,a17.r1.buffer,a17.km.buffer]);
   var a33=lutOne(33,KS,m.jobId);
   postMessage({type:"lutpart",jobId:m.jobId,n:33,r0:a33.r0,r1:a33.r1,km:a33.km,final:true},
    [a33.r0.buffer,a33.r1.buffer,a33.km.buffer]);
  }else if(m.type==="colors"){
   var out=[];
   for(var i=0;i<m.defs.length;i++){
    var lin=mixLin([1],[pigKS(m.defs[i])]);
    out.push([l2s1(lin[0]),l2s1(lin[1]),l2s1(lin[2])]);
   }
   postMessage({type:"r",id:m.id,out:out});
  }else if(m.type==="mix"){
   var KS2=buildKSset(m.defs);
   var lin2=mixLin(m.conc,KS2);
   postMessage({type:"r",id:m.id,out:[l2s1(lin2[0]),l2s1(lin2[1]),l2s1(lin2[2])]});
  }else if(m.type==="recipe"){
   var KS3=buildKSset(m.defs);
   var tgt=lin2ok([s2l1(m.target[0]),s2l1(m.target[1]),s2l1(m.target[2])]);
   var n3=KS3.length;
   var best=null, inits=[null];
   var w=new Array(n3).fill(0.05); w[n3-1]=1; inits.push(w);
   for(var st=0;st<inits.length;st++){
    var r=solve(tgt,KS3,inits[st],90);
    if(!best||r.f<best.f)best=r;
   }
   var lin3=mixLin(best.c,KS3);
   postMessage({type:"r",id:m.id,out:{conc:best.c,srgb:[l2s1(lin3[0]),l2s1(lin3[1]),l2s1(lin3[2])]}});
  }else if(m.type==="fitpig"){
   var basis=[
    {base:1,gs:[],sg:[]},
    {base:0,gs:[],sg:[[1,590,10]]},
    {base:0,gs:[[1,530,30]],sg:[]},
    {base:0,gs:[[1,455,28]],sg:[]}
   ];
   var BR=[];
   for(var bi=0;bi<4;bi++){
    var arr=new Float64Array(NL);
    for(var li=0;li<NL;li++){
     var l=L0+li*DL, R=basis[bi].base;
     if(basis[bi].sg.length)R+=1/(1+Math.exp(-(l-590)/10));
     if(basis[bi].gs.length){ var t=(l-basis[bi].gs[0][1])/basis[bi].gs[0][2]; R+=Math.exp(-t*t); }
     arr[li]=R;
    }
    BR.push(arr);
   }
   var tlin=[s2l1(m.target[0]),s2l1(m.target[1]),s2l1(m.target[2])];
   var wgt=[0.2,0.2,0.2,0.2];
   var evalR=function(wv){
    var R=new Float64Array(NL);
    for(var i=0;i<NL;i++){
     var v=0; for(var j=0;j<4;j++)v+=wv[j]*BR[j][i];
     R[i]=Math.min(0.985,Math.max(0.015,v));
    }
    return R;
   };
   var obj=function(wv){
    var lin=refl2lin(evalR(wv));
    var d0=lin[0]-tlin[0],d1=lin[1]-tlin[1],d2=lin[2]-tlin[2];
    return d0*d0+d1*d1+d2*d2;
   };
   var f=obj(wgt),stp=0.2;
   for(var it2=0;it2<300;it2++){
    var g2=[0,0,0,0];
    for(var i3=0;i3<4;i3++){ var w2=wgt.slice(); w2[i3]+=1e-4; g2[i3]=(obj(w2)-f)/1e-4; }
    var ok2=false;
    for(var t2=0;t2<6;t2++){
     var wn=wgt.map(function(v,i4){ return Math.max(0,Math.min(1.2,v-stp*g2[i4])); });
     var fn=obj(wn);
     if(fn<f){ wgt=wn; f=fn; stp*=1.2; ok2=true; break; }
     stp*=0.5;
    }
    if(!ok2&&stp<1e-6)break;
   }
   var Rfit=evalR(wgt);
   /* 近似カーブをパラメータ化して返す(基底の線形結合) */
   var def={base:wgt[0],gs:[[wgt[2],530,30],[wgt[3],455,28]],sg:[[wgt[1],590,10]]};
   var linF=refl2lin(Rfit);
   postMessage({type:"r",id:m.id,out:{def:def,srgb:[l2s1(clamp01(linF[0])),l2s1(clamp01(linF[1])),l2s1(clamp01(linF[2]))]}});
  }else if(m.type==="kmeans"){
   var d=new Uint8ClampedArray(m.buf), w4=m.w,h4=m.h,kk=m.k;
   var stride=Math.max(1,Math.floor(w4*h4/20000));
   var pts=[];
   for(var pi=0;pi<w4*h4;pi+=stride){
    var o=pi*4;
    pts.push(lin2ok([s2l1(d[o]/255),s2l1(d[o+1]/255),s2l1(d[o+2]/255)]));
   }
   var cent=[];
   for(var ci2=0;ci2<kk;ci2++)cent.push(pts[Math.floor(pts.length*(ci2+0.5)/kk)].slice());
   var asn=new Int32Array(pts.length);
   for(var it3=0;it3<24;it3++){
    for(var p2=0;p2<pts.length;p2++){
     var bd=1e9,bj=0;
     for(var j3=0;j3<kk;j3++){
      var dl=pts[p2][0]-cent[j3][0],da=pts[p2][1]-cent[j3][1],db=pts[p2][2]-cent[j3][2];
      var dd=dl*dl+da*da+db*db;
      if(dd<bd){bd=dd;bj=j3;}
     }
     asn[p2]=bj;
    }
    var acc=[],cnt=[];
    for(var j4=0;j4<kk;j4++){acc.push([0,0,0]);cnt.push(0);}
    for(var p3=0;p3<pts.length;p3++){
     var a2=asn[p3];
     acc[a2][0]+=pts[p3][0];acc[a2][1]+=pts[p3][1];acc[a2][2]+=pts[p3][2];cnt[a2]++;
    }
    for(var j5=0;j5<kk;j5++){
     if(cnt[j5]>0){cent[j5]=[acc[j5][0]/cnt[j5],acc[j5][1]/cnt[j5],acc[j5][2]/cnt[j5]];}
    }
   }
   var res2=[];
   for(var j6=0;j6<kk;j6++){
    var lin4=ok2lin(cent[j6]);
    var c4=0; for(var p4=0;p4<pts.length;p4++)if(asn[p4]===j6)c4++;
    res2.push({srgb:[l2s1(clamp01(lin4[0])),l2s1(clamp01(lin4[1])),l2s1(clamp01(lin4[2]))],share:c4/pts.length});
   }
   res2.sort(function(a3,b3){return b3.share-a3.share;});
   postMessage({type:"r",id:m.id,out:res2});
  }else if(m.type==="gamutSectors"){
   /* WS-14: 実効ガマット抽出を「k-meansクラスタ重心の凸包」から「色相24セクタ別・彩度の
      P分位点」の凸包へ置き換える。重心(平均)は必ず彩度を内側へ引き込むため、旧実装は
      系統的に実際の画素分布より小さい凸包になり、結果としてハイライトモードで画像の
      大部分がマスク外(=減光対象)になってしまっていた。分位点方式は「外れ値を除いた
      実質的な最大彩度」を色相ごとに直接測るため、この系統誤差が生じない。 */
   var d5=new Uint8ClampedArray(m.buf), w5=m.w,h5=m.h,cover5=m.cover;
   var inG5=function(lab){ var c=ok2lin(lab),e=1e-4; return c[0]>=-e&&c[0]<=1+e&&c[1]>=-e&&c[1]<=1+e&&c[2]>=-e&&c[2]<=1+e; };
   var cmax5=function(L,hh){
    if(L<=0.0005||L>=0.9995)return 0;
    var cs=Math.cos(hh*Math.PI/180),sn=Math.sin(hh*Math.PI/180),lo=0,hi=0.5;
    if(inG5([L,hi*cs,hi*sn]))return hi;
    for(var ii=0;ii<24;ii++){var mid=(lo+hi)/2; if(inG5([L,mid*cs,mid*sn]))lo=mid;else hi=mid;}
    return lo;
   };
   var polarOf=function(o5){
    var lab5=lin2ok([s2l1(d5[o5]/255),s2l1(d5[o5+1]/255),s2l1(d5[o5+2]/255)]);
    var C5=Math.hypot(lab5[1],lab5[2]);
    var hdeg5=((Math.atan2(lab5[2],lab5[1])*180/Math.PI)%360+360)%360;
    var cr5=Math.max(cmax5(0.72,hdeg5),1e-5);
    return {h:hdeg5, r:Math.min(C5/cr5,1.25)};
   };
   var stride5=Math.max(1,Math.floor(w5*h5/40000));
   var NSECT=24;
   var buckets=[]; for(var bi5=0;bi5<NSECT;bi5++)buckets.push([]);
   var total5=0;
   for(var pi5=0;pi5<w5*h5;pi5+=stride5){ var pr=polarOf(pi5*4); buckets[Math.floor(pr.h/(360/NSECT))%NSECT].push(pr.r); total5++; }
   var minCount=Math.max(1,Math.floor(total5*0.002)); /* 総数の0.2%未満のセクタはノイズとして除外 */
   var cand=[];
   for(var s5=0;s5<NSECT;s5++){
    var arr5=buckets[s5];
    if(arr5.length<minCount)continue;
    arr5.sort(function(a,b){return a-b;});
    var idx5=Math.min(arr5.length-1,Math.floor(arr5.length*cover5));
    cand.push({h:(s5+0.5)*(360/NSECT), r:arr5[idx5], n:arr5.length});
   }
   var chPts=cand.map(function(c){var rad=c.h*Math.PI/180; return [c.r*Math.cos(rad), c.r*Math.sin(rad), c.h, c.r];});
   if(m.origin)chPts.push([0,0,0,0]); /* hullIncludeOrigin: 無彩色点を候補に混ぜて凸包を再構成(旧仕様と同じ意味論) */
   function cross5(o,a,b){ return (a[0]-o[0])*(b[1]-o[1])-(a[1]-o[1])*(b[0]-o[0]); }
   var hullVerts;
   if(chPts.length<3){ hullVerts=chPts; }
   else{
    var srt=chPts.slice().sort(function(a,b){return a[0]-b[0]||a[1]-b[1];});
    var lower5=[]; for(var i5=0;i5<srt.length;i5++){ var p5=srt[i5]; while(lower5.length>=2&&cross5(lower5[lower5.length-2],lower5[lower5.length-1],p5)<=0)lower5.pop(); lower5.push(p5); }
    var upper5=[]; for(var i6=srt.length-1;i6>=0;i6--){ var p6=srt[i6]; while(upper5.length>=2&&cross5(upper5[upper5.length-2],upper5[upper5.length-1],p6)<=0)upper5.pop(); upper5.push(p6); }
    lower5.pop(); upper5.pop();
    hullVerts=lower5.concat(upper5);
   }
   /* 実測カバー率: 全サンプル画素のうち、確定した凸包の内側に入る割合をここで直接測る。
      ユーザーの想定する実効ガマットとの相違を数値でフィードバックするため(標準書の要求)。 */
   var polyXY=hullVerts.map(function(p){return [p[0],p[1]];});
   function pip(x,y,poly){
    var inside=false;
    for(var i7=0,j7=poly.length-1;i7<poly.length;j7=i7++){
     var xi=poly[i7][0], yi=poly[i7][1], xj=poly[j7][0], yj=poly[j7][1];
     if(((yi>y)!==(yj>y)) && (x < (xj-xi)*(y-yi)/(yj-yi+1e-12)+xi))inside=!inside;
    }
    return inside;
   }
   var covered=0;
   if(polyXY.length>=3){
    for(var pi6=0;pi6<w5*h5;pi6+=stride5){
     var pr2=polarOf(pi6*4);
     var x6=pr2.r*Math.cos(pr2.h*Math.PI/180), y6=pr2.r*Math.sin(pr2.h*Math.PI/180);
     if(pip(x6,y6,polyXY))covered++;
    }
   }
   var verts5=hullVerts.map(function(p){return {h:p[2],r:p[3]};});
   var dots5=cand.map(function(c){
    var rad2=c.h*Math.PI/180, CC=c.r*Math.max(cmax5(0.72,c.h),1e-5);
    var lin7=ok2lin([0.72, CC*Math.cos(rad2), CC*Math.sin(rad2)]);
    return {srgb:[l2s1(clamp01(lin7[0])),l2s1(clamp01(lin7[1])),l2s1(clamp01(lin7[2]))], share:c.n/total5, h:c.h, r:c.r};
   });
   postMessage({type:"r",id:m.id,out:{verts:verts5, coverage: total5?covered/total5:0, dots:dots5}});
  }else if(m.type==="mesh"){
   var MH=[[0,25],[10,55],[20,100],[30,125],[40,150],[50,195],[60,230],[70,265],[80,300],[90,345],[100,385]];
   var okh=function(mh){
    mh=((mh%100)+100)%100;
    for(var i=0;i<MH.length-1;i++){
     if(mh>=MH[i][0]&&mh<=MH[i+1][0]){
      var t=(mh-MH[i][0])/(MH[i+1][0]-MH[i][0]);
      return (MH[i][1]+(MH[i+1][1]-MH[i][1])*t)%360;
     }
    }
    return 25;
   };
   var YfromV=function(V){ return 1.1914*V-0.22533*V*V+0.23352*Math.pow(V,3)-0.020484*Math.pow(V,4)+0.00081939*Math.pow(V,5); };
   var inG=function(lab){
    var c=ok2lin(lab),e=1e-4;
    return c[0]>=-e&&c[0]<=1+e&&c[1]>=-e&&c[1]<=1+e&&c[2]>=-e&&c[2]<=1+e;
   };
   var cmax=function(L,h){
    if(L<=0.0005||L>=0.9995)return 0;
    var cs=Math.cos(h*Math.PI/180),sn=Math.sin(h*Math.PI/180),lo=0,hi=0.5;
    if(inG([L,hi*cs,hi*sn]))return hi;
    for(var i=0;i<24;i++){var mid=(lo+hi)/2; if(inG([L,mid*cs,mid*sn]))lo=mid;else hi=mid;}
    return lo;
   };
   var NH=40,NV=9;
   var pos=new Float32Array(NH*NV*3),col=new Float32Array(NH*NV*3);
   for(var vi=0;vi<NV;vi++){
    var V=vi+1, L=Math.cbrt(Math.min(1,Math.max(0,YfromV(V)/100)));
    for(var hi2=0;hi2<NH;hi2++){
     var mh2=hi2*2.5, h2=okh(mh2), C=cmax(L,h2);
     var idx2=(vi*NH+hi2)*3;
     var hr=h2*Math.PI/180;
     pos[idx2]=C*2.2*Math.cos(hr); pos[idx2+1]=(L-0.55)*2.4; pos[idx2+2]=C*2.2*Math.sin(hr);
     var lin5=ok2lin([L,C*Math.cos(hr),C*Math.sin(hr)]);
     col[idx2]=l2s1(clamp01(lin5[0]));col[idx2+1]=l2s1(clamp01(lin5[1]));col[idx2+2]=l2s1(clamp01(lin5[2]));
    }
   }
   var idxA=[];
   for(var v2=0;v2<NV-1;v2++){
    for(var h3=0;h3<NH;h3++){
     var a4=v2*NH+h3, b4=v2*NH+(h3+1)%NH, c5=(v2+1)*NH+h3, d5=(v2+1)*NH+(h3+1)%NH;
     idxA.push(a4,b4,c5, b4,d5,c5);
    }
   }
   var idx3=new Uint16Array(idxA);
   postMessage({type:"r",id:m.id,out:{pos:pos,col:col,idx:idx3,nh:NH,nv:NV}},[pos.buffer,col.buffer,idx3.buffer]);
  }else if(m.type==="swapdiff"){
   var KSa=buildKSset(m.defsA), KSb=buildKSset(m.defsB);
   var la=mixLin(m.conc,KSa), lb=mixLin(m.conc,KSb);
   postMessage({type:"r",id:m.id,out:{a:[l2s1(clamp01(la[0])),l2s1(clamp01(la[1])),l2s1(clamp01(la[2]))],
                                      b:[l2s1(clamp01(lb[0])),l2s1(clamp01(lb[1])),l2s1(clamp01(lb[2]))]}});
  }else if(m.type==="mixScale"){
   /* F13: 混色スケール練習。既存のKM混合式(mixLin)をそのまま複数段に適用するだけ
      (独自の混合則は実装しない。§F13実装接続点)。 */
   var KSc=buildKSset(m.pigDefs);
   var outs=[];
   for(var wi=0;wi<m.weightsList.length;wi++){
    var linW=mixLin(m.weightsList[wi],KSc);
    outs.push([l2s1(clamp01(linW[0])),l2s1(clamp01(linW[1])),l2s1(clamp01(linW[2]))]);
   }
   postMessage({type:"r",id:m.id,out:outs});
  }
 }catch(err){ postMessage({type:"err",id:m.id,jobId:m.jobId,msg:String(err&&err.message||err)}); }
};
`;
/* Worker通信レイヤ */
const W={
 w:null,seq:1,cbs:new Map(),
 lutBusy:false,lutWant:null,lutJob:0,
 init(){
  const blob=new Blob([WORKER_SRC],{type:"text/javascript"});
  this.w=new Worker(URL.createObjectURL(blob));
  this.w.onmessage=e=>{
   const m=e.data;
   if(m.type==="r"){ const cb=this.cbs.get(m.id); if(cb){this.cbs.delete(m.id);cb.res(m.out);} }
   else if(m.type==="err"){ const cb=this.cbs.get(m.id); if(cb){this.cbs.delete(m.id);cb.rej(new Error(m.msg));}
    else status_(t("status.workerError",{msg:m.msg}),true); }
   else if(m.type==="progress"){ if(m.jobId===this.lutJob) status_(t("status.pigLutGeneratingPct",{pct:Math.round(m.done/m.total*100)}),false,true); }
   else if(m.type==="lutpart"){ onLutPart(m); }
  };
 },
 call(type,payload,transfer){
  return new Promise((res,rej)=>{
   const id=this.seq++;
   this.cbs.set(id,{res,rej});
   this.w.postMessage(Object.assign({type,id},payload),transfer||[]);
  });
 },
 requestLut(defs,key){
  this.lutWant={defs,key};
  if(this.lutBusy)return;
  this._sendLut();
 },
 _sendLut(){
  const want=this.lutWant; if(!want)return;
  this.lutWant=null; this.lutBusy=true;
  this.lutJob++;
  this._lutKey=want.key;
  status_(t("status.pigLutGenerating"),false,true);
  this.w.postMessage({type:"lut",jobId:this.lutJob,defs:want.defs});
 }
};

