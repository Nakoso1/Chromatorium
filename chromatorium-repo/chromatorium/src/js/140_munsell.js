/* ============================================================
   マンセル HVC UI (2.2) — %モードは限界Chroma毎回再計算追従
   ============================================================ */
function refreshMunsellUI(){
 const m=state.munsell;
 const cm=K.cmaxHV(m.H,m.V);
 let Ceff;
 if(m.mode==="pct"){ Ceff=cm*m.pct/100; m.C=Ceff; }
 else Ceff=Math.min(m.C,cm);
 const srgb=K.HVC2srgb(m.H,m.V,Ceff);
 m.cur=srgb;
 if(document.activeElement!==$("mH"))$("mH").value=m.H;
 if(document.activeElement!==$("mV"))$("mV").value=m.V;
 if(m.mode==="pct"){
  $("mC").max=100;
  if(document.activeElement!==$("mC"))$("mC").value=m.pct;
  $("vmC").textContent=fmt(m.pct)+"%";
 }else{
  $("mC").max=30;
  if(document.activeElement!==$("mC"))$("mC").value=m.C;
  $("vmC").textContent=fmt(m.C,1);
 }
 $("vmH").textContent=K.mhLabel(m.H);
 $("vmV").textContent=fmt(m.V,2);
 $("mCmaxLabel").textContent=t("ui.munsellCmaxApprox",{cm:fmt(cm,1)})+
  (m.mode==="abs"&&m.C>cm+0.05?t("ui.munsellClipNote",{c:fmt(m.C,1),cm:fmt(cm,1)}):"");
 $("mHVC").textContent=t("ui.munsellApproxLabel",{h:K.mhLabel(m.H),v:fmt(m.V,1),c:fmt(Ceff,1)});
 $("mSwatch").style.background=K.hex(srgb);
}

/* ============================================================
   マンセル3D色立体 (2.2) — Three.js 0.160.0 を遅延ロード
   立体座標式(Workerメッシュと同一): x=C·2.2·cosθ, y=(L-0.55)·2.4, z=C·2.2·sinθ
   ============================================================ */
const M3D_DEFAULT={rot:30,el:18,dist:3.6,scale:1,density:0.28};
const T3={ready:false,failed:false,THREE:null,renderer:null,scene:null,camera:null,marker:null,glow:null,
          markerGrp:null,stem:null,group:null,matS:null,matW:null,drag:null};
async function openM3d(){
 const wrap=$("m3dWrap");
 const show=wrap.style.display==="none";
 wrap.style.display=show?"":"none";
 $("m3dOpen").textContent=show?t("ui.munsellCollapse3d"):t("ui.munsellExpand3d");
 if(!show||T3.ready||T3.failed)  { if(show)renderM3d(); return; }
 status_(t("status.module3dLoading"),false,true);
 try{
  const THREE=await import("https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js");
  const mesh=await W.call("mesh",{});
  T3.THREE=THREE;
  const cv=$("m3dCanvas");
  const rd=new THREE.WebGLRenderer({canvas:cv,antialias:true});
  rd.setSize(cv.width,cv.height,false);
  rd.setClearColor(0x0c0d10,1);
  const sc=new THREE.Scene();
  const cam=new THREE.PerspectiveCamera(40,cv.width/cv.height,0.05,50);
  const geo=new THREE.BufferGeometry();
  geo.setAttribute("position",new THREE.BufferAttribute(mesh.pos,3));
  geo.setAttribute("color",new THREE.BufferAttribute(mesh.col,3));
  geo.setIndex(new THREE.BufferAttribute(mesh.idx,1));
  const matS=new THREE.MeshBasicMaterial({vertexColors:true,transparent:true,opacity:state.munsell.density,side:THREE.DoubleSide,depthWrite:false});
  const matW=new THREE.MeshBasicMaterial({vertexColors:true,wireframe:true,transparent:true,opacity:0.5});
  /* 拡大率はこのグループのscaleにのみ適用し、頂点座標(pos)自体は変更しない */
  const grp=new THREE.Group();
  grp.add(new THREE.Mesh(geo,matS));
  grp.add(new THREE.Mesh(geo,matW));
  /* 中立軸 */
  const axG=new THREE.BufferGeometry();
  axG.setAttribute("position",new THREE.BufferAttribute(new Float32Array([0,-1.35,0, 0,1.15,0]),3));
  grp.add(new THREE.Line(axG,new THREE.LineBasicMaterial({color:0x777788})));
  /* 中心軸への引き出し線（点の高さ・位置を掴みやすくする視認補助、座標計算には無関係） */
  const stemG=new THREE.BufferGeometry();
  stemG.setAttribute("position",new THREE.BufferAttribute(new Float32Array(6),3));
  const stem=new THREE.Line(stemG,new THREE.LineDashedMaterial({color:0xffffff,transparent:true,opacity:0.55,dashSize:0.03,gapSize:0.02,depthTest:false}));
  stem.computeLineDistances(); stem.renderOrder=6;
  grp.add(stem);
  /* 選択色マーカー: 実色の芯 + 白黒の的(まと)リングで、立体の色に埋もれず常に視認できるようにする */
  const mk=new THREE.Mesh(new THREE.SphereGeometry(0.05,16,12),
   new THREE.MeshBasicMaterial({color:0xffffff,depthTest:false}));
  mk.renderOrder=10;
  const gw=new THREE.Mesh(new THREE.SphereGeometry(0.095,16,12),
   new THREE.MeshBasicMaterial({color:0xffffff,transparent:true,opacity:0.35,depthWrite:false,depthTest:false}));
  gw.renderOrder=7;
  const ringW=new THREE.Mesh(new THREE.SphereGeometry(0.068,16,12),
   new THREE.MeshBasicMaterial({color:0xffffff,wireframe:true,depthTest:false}));
  ringW.renderOrder=9;
  const ringB=new THREE.Mesh(new THREE.SphereGeometry(0.085,16,12),
   new THREE.MeshBasicMaterial({color:0x000000,wireframe:true,depthTest:false}));
  ringB.renderOrder=8;
  const markerGrp=new THREE.Group();
  markerGrp.add(gw,ringB,ringW,mk);
  grp.add(markerGrp);
  sc.add(grp);
  T3.renderer=rd;T3.scene=sc;T3.camera=cam;T3.marker=mk;T3.glow=gw;T3.markerGrp=markerGrp;T3.stem=stem;
  T3.group=grp;T3.matS=matS;T3.matW=matW;T3.ready=true;
  status_(t("status.module3dReady"));
  wireM3dDrag(cv);
  renderM3d();
 }catch(e){
  console.error(e);
  T3.failed=true;
  status_(t("status.module3dFailed"),true);
  $("m3dWrap").innerHTML="<div class='hint'>"+t("status.threejsLoadFailed")+"</div>";
 }
}
/* ドラッグで自由回転(方位角+仰角) / ホイールでズーム。頂点座標(pos)は一切変更せず、カメラ視点のみ動かす */
function wireM3dDrag(cv){
 const st={down:false,x:0,y:0};
 cv.addEventListener("pointerdown",e=>{
  st.down=true; st.x=e.clientX; st.y=e.clientY;
  cv.classList.add("grabbing"); cv.setPointerCapture(e.pointerId);
 });
 cv.addEventListener("pointermove",e=>{
  if(!st.down)return;
  const dx=e.clientX-st.x, dy=e.clientY-st.y;
  st.x=e.clientX; st.y=e.clientY;
  const m=state.munsell;
  m.rot=((m.rot - dx*0.4)%360+360)%360;
  m.el=Math.max(-85,Math.min(85,m.el + dy*0.4));
  renderM3d();
 });
 const endDrag=e=>{ st.down=false; cv.classList.remove("grabbing"); };
 cv.addEventListener("pointerup",endDrag);
 cv.addEventListener("pointercancel",endDrag);
 cv.addEventListener("pointerleave",endDrag);
 cv.addEventListener("wheel",e=>{
  e.preventDefault();
  const m=state.munsell;
  m.dist=Math.max(1.6,Math.min(9,m.dist + e.deltaY*0.0025));
  renderM3d();
 },{passive:false});
}
function resetM3d(){
 Object.assign(state.munsell,{rot:M3D_DEFAULT.rot,el:M3D_DEFAULT.el,dist:M3D_DEFAULT.dist,
  scale:M3D_DEFAULT.scale,density:M3D_DEFAULT.density});
 $("m3dDensity").value=M3D_DEFAULT.density; $("vm3dDensity").textContent=fmt(M3D_DEFAULT.density,2);
 renderM3d();
 status_(t("status.m3dReset"));
}
function renderM3d(){
 if(!T3.ready)return;
 const m=state.munsell;
 const az=m.rot*D2R, el=m.el*D2R, d=m.dist;
 T3.camera.position.set(d*Math.cos(el)*Math.cos(az), d*Math.sin(el), d*Math.cos(el)*Math.sin(az));
 T3.camera.lookAt(0,0,0);
 /* 拡大率: Groupのscaleのみ変更（元の座標データ pos は不変） */
 T3.group.scale.setScalar(m.scale);
 /* 濃さ: 面(matS)の不透明度のみ変更（座標・色は不変） */
 T3.matS.opacity=m.density;
 const srgb=m.cur||[0.5,0.5,0.5];
 const lab=K.srgb2ok(srgb);
 const C=Math.hypot(lab[1],lab[2]), h=Math.atan2(lab[2],lab[1]);
 const x=C*2.2*Math.cos(h), y=(lab[0]-0.55)*2.4, z=C*2.2*Math.sin(h);
 T3.markerGrp.position.set(x,y,z);
 /* 中心軸への引き出し線を点の実位置に追従させる（視認補助のみ、座標計算そのものは変更しない） */
 const sp=T3.stem.geometry.attributes.position.array;
 sp[0]=x;sp[1]=y;sp[2]=z; sp[3]=0;sp[4]=y;sp[5]=0;
 T3.stem.geometry.attributes.position.needsUpdate=true;
 T3.stem.computeLineDistances();
 const ci=(Math.round(clamp(srgb[0],0,1)*255)<<16)|(Math.round(clamp(srgb[1],0,1)*255)<<8)|Math.round(clamp(srgb[2],0,1)*255);
 T3.marker.material.color.setHex(ci);
 T3.renderer.render(T3.scene,T3.camera);
}
/* ポップアップ表示: 既存の#m3dWrap(canvas含む)と#mHVCWrap(H/V/C)をDOM上で移動するだけ。
   WebGLコンテキストは再生成しないため状態は保持され、閉じれば元の親要素・元位置へ完全に戻る。
   ユーザーの選択制であり(ボタン/Escで即座に戻せる)、3D立体の座標計算やレンダリングの中核コードには一切触れない。
   §III-3: H/V/Cはm3dWrap内のm3dDensityRowの直前へ挿入し、「キャンバス(大)+下部にH/V/C+濃さ+リセット」の
   レイアウトにする(これ以上の項目は置かない、という仕様の上限を厳守)。 */
let _m3dPop={open:false,parent:null,next:null,hvcParent:null,hvcNext:null,w:360,h:300};
function _m3dResize(w,h){
 const cv=$("m3dCanvas");
 cv.width=w; cv.height=h;
 if(T3.ready){
  T3.renderer.setSize(w,h,false);
  T3.camera.aspect=w/h; T3.camera.updateProjectionMatrix();
  renderM3d();
 }
}
async function openM3dPopup(){
 if($("m3dWrap").style.display==="none") await openM3d(); /* 未展開なら展開(状態は変更しない) */
 if(!T3.ready)return;
 const wrap=$("m3dWrap"), hvc=$("mHVCWrap");
 _m3dPop.parent=wrap.parentNode; _m3dPop.next=wrap.nextSibling;
 _m3dPop.hvcParent=hvc.parentNode; _m3dPop.hvcNext=hvc.nextSibling;
 $("m3dModalBody").appendChild(wrap);
 wrap.insertBefore(hvc,$("m3dDensityRow"));
 $("m3dModal").classList.add("show");
 _m3dPop.open=true;
 $("m3dPopup").textContent=t("ui.munsellPopupHide");
 const box=$("m3dModal").querySelector(".box");
 const w=Math.round(box.clientWidth-28), h=Math.round(Math.min(window.innerHeight*0.64,640));
 _m3dResize(w,h);
}
function closeM3dPopup(){
 if(!_m3dPop.open)return;
 const wrap=$("m3dWrap"), hvc=$("mHVCWrap");
 if(_m3dPop.hvcNext)_m3dPop.hvcParent.insertBefore(hvc,_m3dPop.hvcNext); else _m3dPop.hvcParent.appendChild(hvc);
 if(_m3dPop.next)_m3dPop.parent.insertBefore(wrap,_m3dPop.next); else _m3dPop.parent.appendChild(wrap);
 $("m3dModal").classList.remove("show");
 _m3dPop.open=false;
 $("m3dPopup").textContent=t("ui.munsellPopupShow");
 _m3dResize(_m3dPop.w,_m3dPop.h);
}
function toggleM3dPopup(){ _m3dPop.open?closeM3dPopup():openM3dPopup(); }

