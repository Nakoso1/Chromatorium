/* ============================================================
   K: 色彩カーネル（GLSL側と同一数式。パリティ厳守）
   ============================================================ */
const K = {
 s2l1(u){ return u<=0.04045 ? u/12.92 : Math.pow((u+0.055)/1.055,2.4); },
 l2s1(u){ u=clamp(u,0,1); return u<=0.0031308 ? u*12.92 : 1.055*Math.pow(u,1/2.4)-0.055; },
 s2l(c){ return [K.s2l1(c[0]),K.s2l1(c[1]),K.s2l1(c[2])]; },
 l2s(c){ return [K.l2s1(c[0]),K.l2s1(c[1]),K.l2s1(c[2])]; },
 cbrt(x){ return Math.sign(x)*Math.pow(Math.abs(x),1/3); },
 /* linear sRGB -> Oklab (Björn Ottosson 標準係数) */
 lin2ok(c){
  const l=0.4122214708*c[0]+0.5363325363*c[1]+0.0514459929*c[2];
  const m=0.2119034982*c[0]+0.6806995451*c[1]+0.1073969566*c[2];
  const s=0.0883024619*c[0]+0.2817188376*c[1]+0.6299787005*c[2];
  const l_=K.cbrt(l),m_=K.cbrt(m),s_=K.cbrt(s);
  return [0.2104542553*l_+0.7936177850*m_-0.0040720468*s_,
          1.9779984951*l_-2.4285922050*m_+0.4505937099*s_,
          0.0259040371*l_+0.7827717662*m_-0.8086757660*s_];
 },
 ok2lin(L){
  const l_=L[0]+0.3963377774*L[1]+0.2158037573*L[2];
  const m_=L[0]-0.1055613458*L[1]-0.0638541728*L[2];
  const s_=L[0]-0.0894841775*L[1]-1.2914855480*L[2];
  const l=l_*l_*l_,m=m_*m_*m_,s=s_*s_*s_;
  return [ 4.0767416621*l-3.3077115913*m+0.2309699292*s,
          -1.2684380046*l+2.6097574011*m-0.3413193965*s,
          -0.0041960863*l-0.7034186147*m+1.7076147010*s];
 },
 okLCh(lab){ const C=Math.hypot(lab[1],lab[2]); return [lab[0],C,mod360(Math.atan2(lab[2],lab[1])*R2D)]; },
 lch2lab(l){ return [l[0], l[1]*Math.cos(l[2]*D2R), l[1]*Math.sin(l[2]*D2R)]; },
 srgb2ok(s){ return K.lin2ok(K.s2l(s)); },
 ok2srgb(lab){ return K.l2s(K.ok2lin(lab)); },
 inGamut(lab){ const c=K.ok2lin(lab); const e=1e-4;
  return c[0]>=-e&&c[0]<=1+e&&c[1]>=-e&&c[1]<=1+e&&c[2]>=-e&&c[2]<=1+e; },
 /* 固定(L,h)での sRGB 限界Chroma（二分探索） */
 cmax(L,hDeg){
  if(L<=0.0005||L>=0.9995) return 0;
  const cs=Math.cos(hDeg*D2R), sn=Math.sin(hDeg*D2R);
  let lo=0,hi=0.5;
  if(K.inGamut([L,hi*cs,hi*sn])) return hi;
  for(let i=0;i<24;i++){ const mid=(lo+hi)/2;
   if(K.inGamut([L,mid*cs,mid*sn])) lo=mid; else hi=mid; }
  return lo;
 },
 /* sRGB(0..1) -> HSL / HSV */
 rgb2hsl(c){ const [r,g,b]=c; const mx=Math.max(r,g,b),mn=Math.min(r,g,b),d=mx-mn;
  let h=0; if(d>1e-9){ if(mx===r)h=mod360(((g-b)/d)*60);
   else if(mx===g)h=mod360(((b-r)/d+2)*60); else h=mod360(((r-g)/d+4)*60); }
  const l=(mx+mn)/2; const s=d<1e-9?0:d/(1-Math.abs(2*l-1)); return [h,s,l]; },
 rgb2hsv(c){ const [r,g,b]=c; const mx=Math.max(r,g,b),mn=Math.min(r,g,b),d=mx-mn;
  let h=0; if(d>1e-9){ if(mx===r)h=mod360(((g-b)/d)*60); else if(mx===g)h=mod360(((b-r)/d+2)*60); else h=mod360(((r-g)/d+4)*60); }
  return [h, mx<1e-9?0:d/mx, mx]; },
 hsl2rgb(h,s,l){ const c=(1-Math.abs(2*l-1))*s, x=c*(1-Math.abs((h/60)%2-1)), m=l-c/2;
  let r,g,b; h=mod360(h);
  if(h<60)[r,g,b]=[c,x,0];else if(h<120)[r,g,b]=[x,c,0];else if(h<180)[r,g,b]=[0,c,x];
  else if(h<240)[r,g,b]=[0,x,c];else if(h<300)[r,g,b]=[x,0,c];else [r,g,b]=[c,0,x];
  return [r+m,g+m,b+m]; },
 /* linear sRGB -> XYZ(D65) -> CIELAB */
 lin2xyz(c){ return [
  0.4124564*c[0]+0.3575761*c[1]+0.1804375*c[2],
  0.2126729*c[0]+0.7151522*c[1]+0.0721750*c[2],
  0.0193339*c[0]+0.1191920*c[1]+0.9503041*c[2]]; },
 xyz2lab(x){ const f=t=>t>0.008856?Math.cbrt(t):(7.787*t+16/116);
  const fx=f(x[0]/0.95047),fy=f(x[1]/1),fz=f(x[2]/1.08883);
  return [116*fy-16, 500*(fx-fy), 200*(fy-fz)]; },
 srgb2lab(s){ return K.xyz2lab(K.lin2xyz(K.s2l(s))); },
 /* CIEDE2000 */
 dE00(l1,l2){
  const [L1,a1,b1]=l1,[L2,a2,b2]=l2;
  const C1=Math.hypot(a1,b1),C2=Math.hypot(a2,b2),Cb=(C1+C2)/2;
  const G=0.5*(1-Math.sqrt(Math.pow(Cb,7)/(Math.pow(Cb,7)+Math.pow(25,7))));
  const ap1=a1*(1+G),ap2=a2*(1+G);
  const Cp1=Math.hypot(ap1,b1),Cp2=Math.hypot(ap2,b2);
  const hp=(a,b)=>{ if(Math.abs(a)<1e-12&&Math.abs(b)<1e-12)return 0; let h=Math.atan2(b,a)*R2D; return h<0?h+360:h; };
  const hp1=hp(ap1,b1),hp2=hp(ap2,b2);
  const dLp=L2-L1,dCp=Cp2-Cp1;
  let dhp=0;
  if(Cp1*Cp2>1e-12){ dhp=hp2-hp1; if(dhp>180)dhp-=360; else if(dhp<-180)dhp+=360; }
  const dHp=2*Math.sqrt(Cp1*Cp2)*Math.sin(dhp*D2R/2);
  const Lbp=(L1+L2)/2,Cbp=(Cp1+Cp2)/2;
  let hbp=hp1+hp2;
  if(Cp1*Cp2>1e-12){ if(Math.abs(hp1-hp2)>180){ hbp += (hp1+hp2<360)?360:-360; } hbp/=2; } else hbp=hp1+hp2;
  const T=1-0.17*Math.cos((hbp-30)*D2R)+0.24*Math.cos(2*hbp*D2R)+0.32*Math.cos((3*hbp+6)*D2R)-0.20*Math.cos((4*hbp-63)*D2R);
  const dTh=30*Math.exp(-Math.pow((hbp-275)/25,2));
  const Rc=2*Math.sqrt(Math.pow(Cbp,7)/(Math.pow(Cbp,7)+Math.pow(25,7)));
  const Sl=1+0.015*Math.pow(Lbp-50,2)/Math.sqrt(20+Math.pow(Lbp-50,2));
  const Sc=1+0.045*Cbp, Sh=1+0.015*Cbp*T;
  const Rt=-Math.sin(2*dTh*D2R)*Rc;
  return Math.sqrt(Math.pow(dLp/Sl,2)+Math.pow(dCp/Sc,2)+Math.pow(dHp/Sh,2)+Rt*(dCp/Sc)*(dHp/Sh));
 },
 dE00srgb(s1,s2){ return K.dE00(K.srgb2lab(s1),K.srgb2lab(s2)); },
 /* 色覚多様性 (二色型, linear RGB 変換行列近似) */
 CVD:{
  protan:[0.152286,1.052583,-0.204868, 0.114503,0.786281,0.099216, -0.003882,-0.048116,1.051998],
  deutan:[0.367322,0.860646,-0.227968, 0.280085,0.672501,0.047413, -0.011820,0.042940,0.968881],
  tritan:[1.255528,-0.076749,-0.178779, -0.078411,0.930809,0.147602, 0.004733,0.691367,0.303900]
 },
 applyCVD(lin,M){ return [
  clamp(M[0]*lin[0]+M[1]*lin[1]+M[2]*lin[2],0,1),
  clamp(M[3]*lin[0]+M[4]*lin[1]+M[5]*lin[2],0,1),
  clamp(M[6]*lin[0]+M[7]*lin[1]+M[8]*lin[2],0,1)]; },
 /* ---- マンセル近似 (第4項: Oklab内部+近似表示) ---- */
 /* ASTM D1535 5次式 Y(V), Y:0..100 相対輝度 */
 Y_fromV(V){ return 1.1914*V-0.22533*V*V+0.23352*Math.pow(V,3)-0.020484*Math.pow(V,4)+0.00081939*Math.pow(V,5); },
 V_fromY(Yrel){ /* Yrel: 0..1 */
  const Y=clamp(Yrel,0,1)*100; let lo=0,hi=10;
  for(let i=0;i<30;i++){ const m=(lo+hi)/2; (K.Y_fromV(m)<Y)?lo=m:hi=m; }
  return (lo+hi)/2; },
 /* Y(相対)->中立軸Oklab L: グレー g の L = cbrt(g) */
 L_fromY(Yrel){ return Math.cbrt(clamp(Yrel,0,1)); },
 Y_fromL(L){ return clamp(L,0,1)**3; },
 /* マンセル色相(0..100, 0=10RP/0R境界起点) <-> Oklab hue角 較正テーブル(10主要色相) */
 MH_ANCH:[[0,25],[10,55],[20,100],[30,125],[40,150],[50,195],[60,230],[70,265],[80,300],[90,345],[100,385]],
 okHueFromMH(mh){ mh=((mh%100)+100)%100; const A=K.MH_ANCH;
  for(let i=0;i<A.length-1;i++){ if(mh>=A[i][0]&&mh<=A[i+1][0]){
   const t=(mh-A[i][0])/(A[i+1][0]-A[i][0]); return mod360(lerp(A[i][1],A[i+1][1],t)); } }
  return 25; },
 mhFromOkHue(h){ h=mod360(h); if(h<25)h+=360; const A=K.MH_ANCH;
  for(let i=0;i<A.length-1;i++){ if(h>=A[i][1]&&h<=A[i+1][1]){
   const t=(h-A[i][1])/(A[i+1][1]-A[i][1]); return (lerp(A[i][0],A[i+1][0],t))%100; } }
  return 0; },
 MH_NAMES:["R","YR","Y","GY","G","BG","B","PB","P","RP"],
 mhLabel(mh){ mh=((mh%100)+100)%100; const seg=Math.floor(mh/10), step=mh-seg*10;
  return fmt(step===0?10:step,1).replace(/\.0$/,"")+(step===0?K.MH_NAMES[(seg+9)%10]:K.MH_NAMES[seg]); },
 CH_SCALE:44, /* OkLCh C -> マンセルChroma 近似スケール */
 /* 選択色(sRGB)からマンセル近似HVC */
 srgb2HVC(s){ const lin=K.s2l(s); const lab=K.lin2ok(lin); const lch=K.okLCh(lab);
  const Y=K.lin2xyz(lin)[1];
  return { H:K.mhFromOkHue(lch[2]), V:K.V_fromY(Y), C:lch[1]*K.CH_SCALE, okL:lab[0], okC:lch[1], okH:lch[2] }; },
 /* HVC -> sRGB (近似, ガマット内クリップ) */
 HVC2srgb(H,V,C){ const h=K.okHueFromMH(H); const L=Math.cbrt(clamp(K.Y_fromV(V)/100,0,1));
  const cm=K.cmax(L,h); const c=Math.min(C/K.CH_SCALE,cm);
  return K.ok2srgb(K.lch2lab([L,c,h])); },
 cmaxHV(H,V){ const h=K.okHueFromMH(H); const L=Math.cbrt(clamp(K.Y_fromV(V)/100,0,1));
  return K.cmax(L,h)*K.CH_SCALE; },
 /* ---- RYB伝統色相環写像: HSL hue <-> RYB角 (区分線形・周期) ---- */
 RYB_ANCH:[[0,0],[30,60],[60,120],[120,180],[230,240],[280,300],[360,360]],
 rybFromHsl(h){ h=mod360(h); const A=K.RYB_ANCH;
  for(let i=0;i<A.length-1;i++){ if(h>=A[i][0]&&h<=A[i+1][0]){
   const t=(h-A[i][0])/(A[i+1][0]-A[i][0]); return lerp(A[i][1],A[i+1][1],t); } }
  return 0; },
 hslFromRyb(r){ r=mod360(r); const A=K.RYB_ANCH;
  for(let i=0;i<A.length-1;i++){ if(r>=A[i][1]&&r<=A[i+1][1]){
   const t=(r-A[i][1])/(A[i+1][1]-A[i][1]); return lerp(A[i][0],A[i+1][0],t); } }
  return 0; },
 hex(s){ return "#"+s.map(v=>Math.round(clamp(v,0,1)*255).toString(16).padStart(2,"0")).join(""); },
 fromHex(h){ h=h.replace("#",""); return [parseInt(h.slice(0,2),16)/255,parseInt(h.slice(2,4),16)/255,parseInt(h.slice(4,6),16)/255]; }
};

/* ============================================================
   環境光シミュレーション (4.2 改訂: 光源色シミュレーション)
   ------------------------------------------------------------
   理論(物理ベース): 目に届く光 = 照明スペクトル × 物体反射率。
   これをRGB3成分の第一次近似で表すと「線形sRGBでの成分ごとの積」
   になる。画像を白色光下の反射率とみなし、環境光ゲイン E(線形RGB)
   を各ピクセルに乗算する:
     lin_out = clamp(lin_in ⊙ E_final, 0, 1)
   - 一様な色相回転では再現できない。照明の補色に近い物体ほど
     反射できる成分が乏しく、彩度・明度が同時に崩壊して無彩色軸へ
     落ちる(青色光下の黄が黄色みを失う等)。乗算はこれを自然に表す。
   - 明度(L)は保持しない(乗算では明度も必然的に変わる)。ただし
     カメラの自動露出や目の順応に相当する「露出補正(adapt)」を
     設け、光源輝度で割り戻して全体を持ち上げられる(既定ON)。
   - E は max成分=1に正規化(白色光に色ゲルを重ねるモデル。光は
     減らすことしかできない)。density で恒等⇔全効果を線形補間。
   操作は2モード: A=代表点の移動先(円盤上のa,b)から E を逆算 /
   B=光源RGBを直接操作。両者とも各プローブの前後を矢印で可視化。
   既知の限界: RGB乗算は分光計算の近似でメタメリズムは再現しない
   (絵画教育ツールとしては十分)。
   ============================================================ */
const ADAPT_MAX=8.0;
function lumaLin(v){ return 0.2126729*v[0]+0.7151522*v[1]+0.0721750*v[2]; }
/* ホイール(色相ang・彩度chroma) → 正規化された光源ゲイン E_norm(max=1) */
function lightFromWheel(hueDeg,chroma){
 const L=0.70;
 const c=Math.min(chroma,K.cmax(L,hueDeg));         // ガマット内へクランプ
 let lin=K.ok2lin(K.lch2lab([L,c,hueDeg])).map(v=>Math.max(v,0.005));
 const m=Math.max(...lin);
 return lin.map(v=>clamp(v/m,0.005,1));             // max成分=1へ正規化
}
/* 代表点の元色 srcLin(白色光下=反射率) と 目標色度 targetAB([a,b] Oklab)
   から、成分ごとの除算で E_norm を一意に逆算(max=1正規化+下限) */
function lightFromRef(srcLin,targetAB){
 const L0=K.lin2ok(srcLin)[0];                      // 元のLを流用して目標色を実体化
 let tgt=K.ok2lin([L0,targetAB[0],targetAB[1]]).map(v=>Math.max(v,1e-4));
 const src=srcLin.map(v=>Math.max(v,0.005));        // ゼロ割り防止
 let E=[tgt[0]/src[0],tgt[1]/src[1],tgt[2]/src[2]];
 const m=Math.max(...E);
 return E.map(v=>clamp(v/m,0.005,1));
}
/* 正規化E(順応・density適用前)。モード分岐込み。UIマーカー/逆算表示に使う */
function normLight(hw){
 if(hw.mode==="ref"){
  const ref=hw.nodes.find(n=>n.id===hw.refId);
  return (ref&&hw.refTarget)? lightFromRef(K.s2l(ref.srcRGB),hw.refTarget) : [1,1,1];
 }
 return hw.light.slice();
}
/* state から最終ゲイン E_final を合成(順応→density) */
function effectiveLight(hw){
 let E=normLight(hw);
 if(hw.adapt){ const y=Math.max(lumaLin(E),1e-4);
  E=E.map(v=>clamp(v/y,0.005,ADAPT_MAX)); }
 const d=hw.density;
 return E.map(v=>1+(v-1)*d);
}


