/* ============================================================
   Color Lab — Single File HTML  (フェーズ1設計に基づく実装)
   ============================================================ */
"use strict";
/* --- 起動直後にプリスティンHTMLを退避（自己書き出し用。DOM変異前に取得） --- */
const PRISTINE = "<!DOCTYPE html>\n" + document.documentElement.outerHTML;

const $ = id => document.getElementById(id);
const clamp = (x,a,b)=>x<a?a:(x>b?b:x);
const lerp=(a,b,t)=>a+(b-a)*t;
const smooth=(a,b,x)=>{ const t=clamp((x-a)/((b-a)||1e-9),0,1); return t*t*(3-2*t); };
const fmt=(x,n=1)=>Number(x).toFixed(n);
const TAU=Math.PI*2, D2R=Math.PI/180, R2D=180/Math.PI;
const mod360=h=>((h%360)+360)%360;
/* 角度差を最短経路(-180..180]で */
const angDiff=(a,b)=>{let d=mod360(b-a); if(d>180)d-=360; return d;};

