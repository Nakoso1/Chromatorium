/* ============================================================
   GLSL シェーダー (ES 3.00) — 全パス共通の窓ユニフォーム:
   uWin = (原点x,原点y,幅,高さ) 画像px / プレビュー時は画像全域
   ============================================================ */
const VS_SRC=`#version 300 es
layout(location=0) in vec2 p; out vec2 v_uv;
void main(){ v_uv=p*0.5+0.5; gl_Position=vec4(p,0.,1.); }`;

const FRAG_LIB=`#version 300 es
precision highp float;
precision highp sampler3D;
in vec2 v_uv; out vec4 o;
vec3 s2l(vec3 c){ return mix(c/12.92, pow((c+0.055)/1.055, vec3(2.4)), step(0.04045,c)); }
vec3 l2s(vec3 c){ c=clamp(c,0.0,1.0);
 return mix(c*12.92, 1.055*pow(c,vec3(1.0/2.4))-0.055, step(0.0031308,c)); }
float cbrt1(float x){ return sign(x)*pow(abs(x),1.0/3.0); }
vec3 l2ok(vec3 c){
 float l=0.4122214708*c.r+0.5363325363*c.g+0.0514459929*c.b;
 float m=0.2119034982*c.r+0.6806995451*c.g+0.1073969566*c.b;
 float s=0.0883024619*c.r+0.2817188376*c.g+0.6299787005*c.b;
 float l_=cbrt1(l),m_=cbrt1(m),s_=cbrt1(s);
 return vec3(0.2104542553*l_+0.7936177850*m_-0.0040720468*s_,
             1.9779984951*l_-2.4285922050*m_+0.4505937099*s_,
             0.0259040371*l_+0.7827717662*m_-0.8086757660*s_);
}
vec3 ok2l(vec3 L){
 float l_=L.x+0.3963377774*L.y+0.2158037573*L.z;
 float m_=L.x-0.1055613458*L.y-0.0638541728*L.z;
 float s_=L.x-0.0894841775*L.y-1.2914855480*L.z;
 float l=l_*l_*l_, m=m_*m_*m_, s=s_*s_*s_;
 return vec3( 4.0767416621*l-3.3077115913*m+0.2309699292*s,
             -1.2684380046*l+2.6097574011*m-0.3413193965*s,
             -0.0041960863*l-0.7034186147*m+1.7076147010*s);
}
`;

/* PassA: 環境光シミュレーション。線形sRGBで環境光ゲイン uLight を成分ごとに
   乗算する(lin_out = clamp(lin ⊙ uLight, 0, 1))。density・順応・正規化の
   合成はJS側(effectiveLight)で1回だけ行い、最終ゲインのみを渡す。 */
const FS_WARP = FRAG_LIB + `
uniform sampler2D uTex;
uniform vec4 uWin; uniform vec2 uImgSize;
uniform vec3 uLight; uniform int uOn;
uniform float uNight;
/* F14: 部分マスク適用(§1.1で明示的に許可された唯一の基幹接触)。
   uMaskOn==0の分岐は元の代入式をそのまま実行するため、マスク無効時はビット単位で
   従来と同一(R1)。有効時のみ対象効果ごとに mix(元, 適用後, M) で合成する。 */
uniform sampler2D uMaskTex; uniform int uMaskOn; uniform float uMTwarp,uMTnight;
/* Purkinje (scotopic / mesopic) model:
   In dim light the L/M cones (red/green) stop responding and vision is carried by
   rods, whose spectral peak is shifted to ~507nm (blue-green). Consequences reproduced:
   (1) rod "luminance" weights red ~0, green high, blue high -> reds go dark, blues stay bright;
   (2) the rod signal is achromatic but perceived as a cool blue-grey (rodTint) -> blue cast;
   (3) cone color fades in as the scene dims (wRod) and overall luminance drops (dim).
   WS-08検証(監督によるNode数値シミュレーション、6原色×s=0,0.25,0.5,0.75,1.0で実施):
   s≥0.5では常に赤の相対輝度Yが全色中最小となり(桿体信号ys=dot(lin,[0.03,0.58,0.39])への
   赤チャンネルの寄与係数0.03が最小のため)、s=1での彩度Cも赤が全色中最小(≈0.010、他色は
   0.024〜0.033)であることを確認した。すなわち実装は「赤が最後まで色として残る」のではなく
   「赤が最も早く・最も大きく暗く沈み無彩化する」よう正しく機能している(ユーザーからの懸念
   「最後まで視認できるのが赤で良いのか」とは逆の結果であり、式は科学的に妥当と判断し
   変更していない。ユーザーが視覚的に感じた「赤みの残留」は、桿体信号rodベクトル自体が
   R成分0.82・G成分0.96・B成分1.30で厳密な等量無彩色ではなく、わずかに暖色寄りである点に
   起因する可能性がある — ただしその残留はシアン等むしろ他の色相の方が大きい)。 */
vec3 purkinje(vec3 lin, float s){
 float wRod=smoothstep(0.10,0.90,s);                 // rod takeover across the mesopic band
 float ys=dot(lin, vec3(0.03,0.58,0.39));            // scotopic luminance (peak blue-green, red~0)
 vec3 rod=ys*vec3(0.82,0.96,1.30);                   // rod signal perceived as cool blue-grey
 vec3 col=mix(lin,rod,wRod);                         // cones fade out, rods take over
 return clamp(col*(1.0-0.72*s),0.0,1.0);             // "just lowering the light" darkens overall
}
void main(){
 vec2 uv0=(uWin.xy+v_uv*uWin.zw)/uImgSize;
 vec3 lin=s2l(texture(uTex,clamp(uv0,0.0,1.0)).rgb);
 float M=(uMaskOn==1)?texture(uMaskTex,clamp(uv0,0.0,1.0)).r:1.0;
 if(uOn==1){
  vec3 t=clamp(lin*uLight,0.0,1.0);
  if(uMaskOn==1){ float m=mix(1.0,M,uMTwarp); lin=lin+(t-lin)*m; } else { lin=t; }
 }
 if(uNight>0.001){
  vec3 t=purkinje(lin,uNight);
  if(uMaskOn==1){ float m=mix(1.0,M,uMTnight); lin=lin+(t-lin)*m; } else { lin=t; }
 }
 o=vec4(lin,1.0);
}`;

/* PassB: グローバル明度/彩度 → 圧縮 → レベル → 階調制限(ディザ) → グレー化
   （シェーダ内適用順は仕様の内部順序として固定） */
const FS_VAL = FRAG_LIB + `
uniform sampler2D uTex; uniform sampler2D uBayer;
uniform vec4 uWin; uniform vec2 uImgSize;
uniform float uBr,uSat,uPivot,uCmp,uSteps,uPost,uDither,uGray;
uniform vec4 uLev;
uniform sampler2D uMaskTex; uniform int uMaskOn; uniform float uMTbs,uMTcmp,uMTlev,uMTpost;
void main(){
 vec3 lin=texture(uTex,v_uv).rgb;
 vec3 lab=l2ok(lin);
 float L=lab.x; float C=length(lab.yz); float h=atan(lab.z,lab.y);
 float M=(uMaskOn==1)?texture(uMaskTex,clamp((uWin.xy+v_uv*uWin.zw)/uImgSize,0.0,1.0)).r:1.0;
 {
  float L1=L+uBr*0.5, C1=C*max(1.0+uSat,0.0);
  if(uMaskOn==1){ float m=mix(1.0,M,uMTbs); L=L+(L1-L)*m; C=C+(C1-C)*m; } else { L=L1; C=C1; }
 }
 {
  float L1=uPivot+(L-uPivot)*(1.0-uCmp);
  if(uMaskOn==1){ float m=mix(1.0,M,uMTcmp); L=L+(L1-L)*m; } else { L=L1; }
 }
 {
  float L1=clamp((L-uLev.x)/max(uLev.y-uLev.x,1e-4),0.0,1.0)*(uLev.w-uLev.z)+uLev.z;
  if(uMaskOn==1){ float m=mix(1.0,M,uMTlev); L=L+(L1-L)*m; } else { L=L1; }
 }
 if(uPost>0.5){
  vec2 bpx=(uWin.xy+v_uv*uWin.zw)/8.0;
  float d=uDither>0.5?texture(uBayer,bpx).r:0.5;
  float N=uSteps;
  float q=floor(clamp(L,0.0,0.99999)*N+d)/N;
  float L1=(N>1.5)?clamp(q*N/(N-1.0),0.0,1.0):q;
  if(uMaskOn==1){ float m=mix(1.0,M,uMTpost); L=L+(L1-L)*m; } else { L=L1; }
 }
 if(uGray>0.5)C=0.0;
 o=vec4(clamp(ok2l(vec3(L,C*cos(h),C*sin(h))),0.0,1.0),1.0);
}`;

/* F7: 明瞭度(局所コントラスト) — PassAとPassBの間に条件挿入(§F7)。
   OKLabのLチャンネルのみに大半径アンシャープマスクを掛ける: L' = L + amt*1.2*softlimit(L-blur(L))。
   ソフトリミッタ(tanh)でハロー(ヒトのコントラスト感度が中間空間周波数で最大になることを
   利用した強調のしすぎによる縁取り)を抑える。CPU側(applyPipeCPUの第3引数lblur)と同一数式。 */
const FS_CLAR = FRAG_LIB + `
uniform sampler2D uTex; uniform sampler2D uBlur; uniform float uAmt;
void main(){
 vec3 lin=texture(uTex,v_uv).rgb;
 vec3 linB=texture(uBlur,v_uv).rgb;
 vec3 lab=l2ok(lin);
 float labBx=l2ok(linB).x;
 float d=lab.x-labBx;
 float t=0.25;
 d=t*tanh(d/t);
 lab.x=clamp(lab.x+uAmt*1.2*d,0.0,1.0);
 o=vec4(clamp(ok2l(lab),0.0,1.0),1.0);
}`;

/* F12: カラーガマットマスク(Gurney式)。PassBの直後(mixの前)に条件挿入(uMode!=0の時のみ)。
   座標系: P=r・(cos h,sin h), r=C/Cref(h), Cref(h)=K.cmax(0.72,h)をJS側で256エントリの
   1D LUT(0..0.4を8bit量子化)として渡す。多角形への符号付き距離+最近点は同一ループ内で
   まとめて計算する(Inigo Quilezのsdpolygon型アルゴリズム。§F12)。 */
const FS_GAMUT = FRAG_LIB + `
uniform sampler2D uTex; uniform sampler2D uCrefLUT;
uniform int uMode; uniform int uNM; uniform int uMType[3]; uniform int uMNV[3];
uniform vec2 uMVerts[36]; uniform vec4 uMCirc[3];
uniform float uSoft, uDim;
float crefAt(float hdeg){ return texture(uCrefLUT, vec2(hdeg/360.0, 0.5)).r * 0.4; }
/* WS-15: 符号付き距離(内側=負)+最近点。maskIdx番目のマスク(多角形)専用に頂点配列を
   uMVerts[maskIdx*12 .. +11]から読む(WebGL2/GLSL ES 300は一様変数の動的添字indexingを許容)。
   アルゴリズム自体は旧sdPolyNPと同一(Inigo Quilez型)。 */
float sdPolyAt(vec2 p, int maskIdx, int n, out vec2 nearest){
 int base = maskIdx*12;
 vec2 v0 = uMVerts[base];
 float d = dot(p-v0, p-v0);
 nearest = v0;
 float s = 1.0;
 for(int i=0, j=11; i<12; j=i, i++){
  if(i>=n) break;
  if(j>=n) j=n-1;
  vec2 vi = uMVerts[base+i], vj = uMVerts[base+j];
  vec2 e = vj-vi;
  vec2 w = p-vi;
  float el2 = max(dot(e,e), 1e-9);
  float t = clamp(dot(w,e)/el2, 0.0, 1.0);
  vec2 b = w - e*t;
  float dd = dot(b,b);
  if(dd<d){ d=dd; nearest=vi+e*t; }
  bvec3 cond = bvec3(p.y>=vi.y, p.y<vj.y, e.x*w.y>e.y*w.x);
  if(all(cond) || all(not(cond))) s*=-1.0;
 }
 return s*sqrt(d);
}
/* WS-15: 円形マスクのSDF(内側=負)。中心・半径ともP空間座標系(§F12)。 */
float sdCircleAt(vec2 p, int maskIdx, out vec2 nearest){
 vec4 c = uMCirc[maskIdx];
 vec2 dir = p - c.xy;
 float len = length(dir);
 nearest = (len>1e-6) ? c.xy + dir/len*c.z : c.xy + vec2(c.z, 0.0);
 return len - c.z;
}
void main(){
 vec3 lin=texture(uTex,v_uv).rgb;
 if(uMode==0 || uNM<1){ o=vec4(lin,1.0); return; }
 vec3 lab=l2ok(lin);
 float L=lab.x, C=length(lab.yz), h=atan(lab.z,lab.y);
 float hdeg=mod(degrees(h)+360.0,360.0);
 float cr=max(crefAt(hdeg),1e-5);
 float r=min(C/cr,1.25);
 vec2 P=r*vec2(cos(h),sin(h));
 /* WS-15: 複数マスクの和集合=各マスクの符号付き距離のうち最小のものを採用する
    (SDFのmin合成=集合の和集合、標準的な性質)。 */
 float d=1e9; vec2 nearest=P;
 for(int mi=0; mi<3; mi++){
  if(mi>=uNM) break;
  vec2 nb; float db;
  if(uMType[mi]==1) db=sdCircleAt(P,mi,nb); else db=sdPolyAt(P,mi,uMNV[mi],nb);
  if(db<d){ d=db; nearest=nb; }
 }
 float w=smoothstep(0.0,max(uSoft,1e-4),d);
 if(uMode==1){
  /* §VII-3 修正: GLSL側(FS_GAMUT)と同時修正。wは内側=0・外側=1のため、
     「内側=不変・外側=減光」を満たすにはmix(lin,grey,w)でなければならない。旧実装はmix(grey,lin,w)で引数が逆転しており、
     内側(w=0)がgrey・外側(w=1)がlinになる=内外が完全に反転していた
     (「マスク内の色が消える」報告の原因。CPU側Mirror.applyPipeCPUの同名分岐と同時修正)。 */
  vec3 grey=ok2l(vec3(L,0.0,0.0))*(1.0-uDim);
  o=vec4(clamp(mix(lin,grey,w),0.0,1.0),1.0);
 }else{
  vec2 Pc=(d>0.0)?nearest:P;
  float rC=length(Pc), hC=atan(Pc.y,Pc.x);
  float crC=max(crefAt(mod(degrees(hC)+360.0,360.0)),1e-5);
  float Cn=rC*crC;
  vec3 linC=ok2l(vec3(L,Cn*cos(hC),Cn*sin(hC)));
  o=vec4(clamp(mix(lin,linC,w),0.0,1.0),1.0);
 }
}`;

/* PassC: 並置混色(点描/ハッチ) & 積層混色(+KM比較)
   点描モードの網点半径式について:
   円は正方形マス目の角(中心から約0.71)には、半径がその値に届かない限り絶対に到達しない。
   旧式(半径=0.53*sqrt(rt))は最大半径0.53しか出せず、濃さ100%でも角が常に白く残っていた。
   実際の網点印刷と同じ「ハイライト(白地に色の点)⇔シャドウ(色地に白い穴)」の反転を使うことで、
   濃さ100%では穴の半径が0になり、角まで含めて完全に塗りつぶせることを保証する。
   半径は面積の式(面積=π*半径^2)から逆算しているので、濃さと塗る面積が厳密に一致する。
   また、網点がaa(描画解像度)より小さくて描き切れない時は被覆率rtをそのままベタ塗りへブレンドし、
   粒の見た目は諦める代わりにValue(明るさ)だけは常に正しく保つ(resolvable変数)。
   ※GLSLソース文字列内は既存コードの慣習に合わせ非ASCII文字を使わない(ドライバ互換性のため)。 */
const FS_MIX = FRAG_LIB + `
uniform sampler2D uSrc; uniform sampler2D uPig;
uniform sampler3D uL0; uniform sampler3D uL1; uniform sampler3D uKM;
uniform vec4 uWin; uniform vec2 uRes;
uniform float uCell,uLutScale,uLutOff;
uniform int uNumCh,uMode,uKmCmp;
uniform vec3 uPaper;
const float ANG[7]=float[7](0.26179939,1.30899694,0.0,0.78539816,1.57079633,2.24399475,2.79252680);
const float GLAZE_W=0.9;
vec3 lc(vec3 s){ return s*uLutScale+uLutOff; }
float ratio(int i, vec4 r0, vec3 r1){
 if(i==0)return r0.x; if(i==1)return r0.y; if(i==2)return r0.z; if(i==3)return r0.w;
 if(i==4)return r1.x; if(i==5)return r1.y; return r1.z;
}
vec3 pigLin(int i){ return s2l(texelFetch(uPig,ivec2(i,0),0).rgb); }
/* hybrid step: blend opaque-replace and multiplicative-glaze at GLAZE_W.
   W<1 keeps a small opaque "reset" at every step, which prevents the
   multi-channel multiplicative runaway that crashes overlapping dots to near-black,
   while still recovering most of the glaze model's wider color gamut. */
vec3 hybridStep(vec3 col, vec3 pc, float ci){
 vec3 opaque=mix(col,pc,ci);
 vec3 glazed=col*mix(vec3(1.0),pc,ci);
 return mix(opaque,glazed,GLAZE_W);
}
void main(){
 if(uMode==2){
  vec3 srcc=texture(uSrc,v_uv).rgb;
  vec3 ss=l2s(srcc);
  vec4 r0=texture(uL0,lc(ss)); vec3 r1=texture(uL1,lc(ss)).rgb;
  vec3 comp=uPaper;
  for(int i=0;i<7;i++){ if(i>=uNumCh)break;
   float ci=clamp(ratio(i,r0,r1),0.0,1.0);
   comp=hybridStep(comp,pigLin(i),ci); }
  vec3 kmc=s2l(texture(uKM,lc(ss)).rgb);
  vec3 col=(uKmCmp==1)?kmc:((uKmCmp==2)?((v_uv.x<0.5)?comp:kmc):comp);
  if(uKmCmp==2&&abs(v_uv.x-0.5)*uRes.x<1.0)col=vec3(0.9);
  o=vec4(col,1.0); return;
 }
 vec2 gpx=uWin.xy+v_uv*uWin.zw;
 float pxPerFrag=max(uWin.z/uRes.x,1.0);
 float aa=max(pxPerFrag/uCell,0.02);
 vec3 col=uPaper;
 for(int i=0;i<7;i++){ if(i>=uNumCh)break;
  float a=ANG[i];
  float ca=cos(a),sa=sin(a);
  mat2 R=mat2(ca,sa,-sa,ca);
  vec2 q=(R*gpx)/uCell;
  vec2 cc=floor(q)+0.5;
  vec2 cpx=transpose(R)*(cc*uCell);
  vec2 suv=(cpx-uWin.xy)/uWin.zw;
  vec3 srcc=texture(uSrc,clamp(suv,0.0,1.0)).rgb;
  vec3 ss=l2s(srcc);
  vec4 r0=texture(uL0,lc(ss)); vec3 r1=texture(uL1,lc(ss)).rgb;
  float rt=clamp(ratio(i,r0,r1),0.0,1.0);
  float cov;
  if(uMode==0){
   /* highlight/shadow dot inversion: guarantees full corner coverage at rt=1, exact area match */
   float f=min(rt,1.0-rt);
   float rad=sqrt(f/3.14159265);
   float dd=length(q-cc);
   float covGeo=(rt<=0.5)?(1.0-smoothstep(rad-aa,rad+aa,dd)):smoothstep(rad-aa,rad+aa,dd);
   /* below-resolution fallback: blend toward flat rt so Value stays correct even if dots vanish */
   float resolvable=clamp(rad/max(aa,1e-4)-0.25,0.0,1.0);
   cov=mix(rt,covGeo,resolvable);
  }else{
   float dd=abs(fract(q.y)-0.5);
   float hw=0.5*rt;
   float covGeo=1.0-smoothstep(hw-aa*0.7,hw+aa*0.7,dd);
   float resolvable=clamp(hw/max(aa*0.7,1e-4)-0.25,0.0,1.0);
   cov=mix(rt,covGeo,resolvable);
  }
  col=hybridStep(col,pigLin(i),cov);
 }
 o=vec4(col,1.0);
}`;

/* 分離ガウシアン */
const FS_BLUR = FRAG_LIB + `
uniform sampler2D uTex; uniform vec2 uStep; uniform float uSigma;
void main(){
 float s=max(uSigma,0.001);
 int R=int(min(ceil(s*3.0),32.0));
 vec3 acc=texture(uTex,v_uv).rgb; float wsum=1.0;
 for(int i=1;i<=32;i++){ if(i>R)break;
  float w=exp(-float(i*i)/(2.0*s*s));
  acc+=w*(texture(uTex,v_uv+uStep*float(i)).rgb+texture(uTex,v_uv-uStep*float(i)).rgb);
  wsum+=2.0*w;
 }
 o=vec4(acc/wsum,1.0);
}`;

/* 画面合成: パン/ズーム・Before/After・Qホールド・sRGB出力 */
const FS_SCREEN = FRAG_LIB + `
uniform sampler2D uEdit; uniform sampler2D uOrig;
uniform vec2 uCanvas,uImgSize,uPan;
uniform float uZoom,uSplitX; uniform int uHold;
void main(){
 vec2 fpx=vec2(gl_FragCoord.x,uCanvas.y-gl_FragCoord.y);
 vec2 ipx=(fpx-uPan)/uZoom;
 vec2 uv=ipx/uImgSize;
 if(uv.x<0.0||uv.y<0.0||uv.x>1.0||uv.y>1.0){
  float g=mod(floor(fpx.x/12.0)+floor(fpx.y/12.0),2.0);
  o=vec4(vec3(0.055+g*0.008),1.0); return;
 }
 bool showOrig=(uHold==1)||(uSplitX>=0.0&&fpx.x<uSplitX*uCanvas.x);
 vec3 c=showOrig?texture(uOrig,uv).rgb:l2s(texture(uEdit,uv).rgb);
 if(uSplitX>=0.0&&abs(fpx.x-uSplitX*uCanvas.x)<1.0)c=mix(c,vec3(1.0),0.85);
 o=vec4(c,1.0);
}`;

/* 8bit読出し用コピー（スポイト/書き出し） */
const FS_COPY8 = FRAG_LIB + `
uniform sampler2D uTex; uniform vec2 uOff,uScale; uniform int uIsSrgb;
void main(){
 vec3 c=texture(uTex,uOff+v_uv*uScale).rgb;
 o=vec4(uIsSrgb==1?c:l2s(c),1.0);
}`;

