/* ============================================================
   Store: 単一状態 + ダーティフラグ + rAFバッチ通知
   flags: lut,a,b,c,blur,screen,analysis,overlay,panels,mixpanel
   ============================================================ */
const state={
 file:{name:"",w:0,h:0,has:false},
 /* holdLatch(§II-1): 「元画像」ボタンのクリック固定用。holdは既存のQ/\キー押下中momentary値のまま不変。
    isHold()=hold||holdLatch のORで両者を統合する(表示設定でありUNDO_KEYS対象外)。 */
 view:{zoom:1,panX:0,panY:0,mode:"pick",tempPan:false,hold:false,holdLatch:false,split:false,splitX:0.5},
 global:{brightness:0,saturation:0,pickRadius:2},
 hueWarp:{enabled:false,nodes:[],mode:"light",light:[1,1,1],refId:null,refTarget:null,adapt:true,density:0,nextId:1},
 night:{on:false,level:0},
 /* dither既定オフ(§IV-3): 低段階数では段境界の視認をディザが妨げるため。オンにすれば従来と同じ結果。 */
 value:{gray:false,pivot:0.6,cmp:0,postOn:false,steps:4,dither:false,
        lev:{bi:0,wi:1,bo:0,wo:1}},
 mixing:{on:false,subMode:"juxta",system:"CMYK",ideal:false,
         assign:{C:"phthalo_blue",M:"quin_magenta",Y:"cad_yellow",K:"ivory_black",W:"titanium_white",
                 R:"pyrrole_red",G:"phthalo_green",B:"ultramarine",
                 /* カスタム(自由編成)系統: P1〜P7に任意の顔料を割り当てる。初期値は印象派(モネ)パレット */
                 P1:"titanium_white",P2:"cad_yellow",P3:"vermilion",P4:"madder_red",P5:"cobalt_blue",P6:"emerald_green",P7:"ivory_black"},
         customCount:6,
         dotR:4,style:"dot",dist:0,kmCmp:0},
 munsell:{H:0,V:5,C:0,mode:"abs",pct:0,rot:30,el:18,dist:3.6,scale:1,density:0.28,pick:[0.5,0.5,0.5]},
 /* histCh/histChFront(§III-4): ヒストグラムRGBモードのチャンネル表示切替。表示設定でUNDO_KEYS対象外、
    localStorage(clab.v1.histch)へ保存する。histChFrontは「最後にオンへ切り替えたチャンネル」を保持し、
    そのチャンネルだけ不透明で最前面に描く(overplotting対策)。 */
 /* WS-04: compareMode=false(単体表示,既定)/true(3種同時比較)。overMode廃止(旧side/over排他選択を
    「3種同時比較を常時表示+重ね合わせを任意サブビュー」構成へ変更したため)。
    anchorTicks/showOverlayも表示設定でUNDO_KEYS対象外。 */
 analysis:{pick:null,wheelType:"rgb",compareMode:false,anchorTicks:true,showOverlay:false,histMode:"lum",cvd:"none",
  histCh:{r:true,g:true,b:true},histChFront:"b",
  /* _wheelProbe(§III-2b / WS-16 S2): 色相環でのドラッグ仮選択色。この機能ローカルの一時値であり、
     state.analysis.pickや数値パネル等へは一切書き込まない(素通りフック)。画像上でドット選択
     すると active=false に戻す(doPick参照)。underscore=Undo対象外の一時値(§I-2規約)。
     h_rgb: 他環へ写すための共通表現(HSL色相角)。
     srgb/srcType(WS-16追加): 実際に指の下にある環(srcType)の代表色(srgb)。プローブの
     スウォッチ表示は常にsrcTypeの実色を使う(旧実装はh_rgbからRGB環の色を再構成しており、
     マンセル環をドラッグしてもRGB環の色が表示される不整合があった)。 */
  _wheelProbe:{h_rgb:0,srgb:null,srcType:null,active:false}},
 /* _baseSrc(§VI-1): 基準色の由来("pick"|"manual"|"palette")。表示用の1語ヒントに使うのみで、
    判定ロジックには使わない。既存gamut._extractDotsと同じ扱い(underscore=非本質的な付随情報)。 */
 /* WS-10: schemeの「真実」はlch([L,C,h], OkLCh)であり、baseはlchをガマット内に射影した
    表示用sRGBキャッシュ。旧実装はbaseからlchを都度再導出しclampして書き戻していたため、
    バリューを下げてから戻すと彩度が復元不能になる不可逆バグがあった(詳細は各書込箇所の
    コメント参照)。lchはbaseから初回のみ導出し、以後は各書込箇所がlchを正として更新する。 */
 scheme:{base:[0.72,0.35,0.3],lch:K.okLCh(K.srgb2ok([0.72,0.35,0.3])),rule:"comp",curPal:{name:"",colors:[]},palettes:[],_baseSrc:"manual",
  /* WS-12: レシピ逆算の顔料元。"linked"=混色タブの割当と連動(既定)/"independent"=このタブ
     専用の選択(recipePigIdsを使用)。scheme全体がUNDO_KEYSに含まれるため、この2フィールドも
     自動的にUndo/Redo対象になる。 */
  recipeSrc:"linked", recipePigIds:[]},
 pigments:{custom:[],presets:[]},
 /* F2 トリミング: 原本(R.origBitmap)座標系ではなく、orient適用後の座標系での矩形 {x,y,w,h}
    (§II-5/6のパイプライン定義: 原本→①orient→②crop)。null=未トリミング(orient後の全体)。
    非破壊(再標本化なし)のベイク方式で、実データはR.origBitmapに保持し続ける(§F2参照)。 */
 crop:null,
 /* §II-5/6 画像回転・反転。rotは時計回り0/90/180/270度。orient自体も編集でありUNDO対象。
    パイプライン: 原本(R.origBitmap)→①この変換→②state.cropの矩形(orient後座標系)で切出し。 */
 orient:{rot:0,flipH:false,flipV:false},
 /* F7 明瞭度(局所コントラスト): amt=-1..+1(0=無効), rad=0..1(ぼかし半径の相対値) */
 clarity:{amt:0,rad:0.5},
 /* F14 部分マスク適用: M=lumM×hueM×geoM(積)。判定は常に元画像基準(§F14科学的裏付け) */
 /* WS-16 S3-1(Sonnet実装): geo.kindとgeo.onの意味を分離する。
    旧実装はkindの初期値が"rect"なのにon:falseだったため、
    syncMaskShapeUI()が`kind = on ? kind : "none"`と評価して常に「なし」が点灯し、
    形状ボタンを押しても点灯せず「範囲を描く」も有効化されないデッドロックがあった(WS-16 V-1)。
    kind = 「ユーザーが今選んでいる形状」("none"|"rect"|"lasso")。on とは独立。
    on   = 「確定した幾何が存在し、マスク演算に参加する」(computeGeoStage の意味は不変)。
    初期値をkind:"none"に変更し、on:falseと矛盾しない状態から開始する。 */
 mask:{on:false, invert:false, feather:0.05,
  lum:{on:false, lo:0, hi:1, soft:0.08},
  hue:{on:false, center:30, width:60, soft:20},
  geo:{on:false, kind:"none", rect:null, lasso:null},
  targets:{warp:true, night:true, bs:true, cmp:true, lev:true, post:true}},
 /* F13 混色スケール練習: 選択顔料・段階数・tint表示は「表示設定」のためUNDO_KEYSに入れない。
    localStorageに保存する(§F13)。 */
 mixScale:{a:"",b:"",c:"",steps:7,tint:false},
 /* F12/F15/WS-15 カラーガマットマスク(Gurney式)。座標系はP=r·(cos h,sin h),
    r=C/Cref(h), Cref(h)=K.cmax(0.72,h)(§F12座標系の定義)。マスク形状は制作上の意思決定=編集。
    WS-15: 単一多角形(verts/rot)から複数マスク配列masksへ拡張。
    Mask = {type:"poly", verts:[{h,r}](3〜12点), rot:number}
         | {type:"circle", h:number, r:number, rad:number} (h,r=中心の極座標、radは半径。
           中心・半径ともpoly頂点のrと同じ正規化単位)
    最大3個。選択中マスク(activeIdx)はUndo対象外の表示設定のため、あえてここに置かず
    module-scopeの_gmActiveIdxで管理する(直下のstate定義コメント規約どおり)。
    state.gamutはlocalStorage/自己書き出しのいずれにも一切登場しないため(grep調査済み)、
    旧セッションとの後方互換マイグレーションは不要(WS-10のscheme.lchと同じ理由)。 */
 gamut:{on:false, mode:"off", masks:[], softness:0.08, dimIn:0.35, hullIncludeOrigin:true},
 /* ui.lang(§VIII-2): 表示言語。ここではプレースホルダ値のみを置き、実際の判定はinit()内のapplyLang(detectInitialLang())で行う。 */
 ui:{tab:"analyze", lang:"ja"}
};
const _subs=[]; let _dirty=new Set(), _rafQ=false;
function mark(...f){ f.forEach(x=>_dirty.add(x)); if(!_rafQ){ _rafQ=true; requestAnimationFrame(_flush); } }
function _flush(){ _rafQ=false; const d=_dirty; _dirty=new Set();
 for(const s of _subs){ for(const f of d){ if(s.flags.has(f)){ try{s.cb(d);}catch(e){console.error(e);} break; } } } }
function sub(flags,cb){ _subs.push({flags:new Set(flags),cb}); }
/* パイプライン下流を含めてマーク */
const M_A=["a","b","c","blur","screen","analysis"];
const M_B=["b","c","blur","screen","analysis"];
const M_C=["c","blur","screen"];
/* isHold()(§II-1): 「元画像を表示すべきか」の単一判定窓口。momentary(state.view.hold, Q/\キー押下中)と
   latch(state.view.holdLatch, 「元画像」ボタンのクリック固定)のORを取る。既存のstate.view.hold直読み箇所は
   全数grepで洗い出し、表示切替のための読み出しはすべてこの関数経由へ置換した(§II-1実装方式)。
   Q/\キーのkeydown/keyupおよびボタンのクリックトグル自身が行うstate.view.holdへの「書き込み」は
   このヘルパの対象外(momentary値そのものの制御は従来のまま)。 */
function isHold(){ return state.view.hold||state.view.holdLatch; }

