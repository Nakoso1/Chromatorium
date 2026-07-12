# Chromatorium
Chromatoriumは、AIによる画像生成機能を持たない、画像の色彩を観察・調整するためのツールです。
開発では、計画、コード整理、技術的な調査の補助として言語モデルを使用しました。ツールの方針、設計上の判断、最終的な検証は作者が行っています。
Chromatoriumは、観察と実践を通じて自身の表現をつくる人のための道具であることを目指しています。

本ツールは画像を読み込んで色を選択・比較・変換しながら扱う、ブラウザ完結型の画像色彩操作ツールです。
色相環やマンセルHVC、顔料混色（Kubelka-Munk近似）、カラーガマットマスクなど、色彩科学に基づく複数の解析・編集機能を単一の画面に統合しています。

## 主な機能と理論的な基盤

Chromatoriumは、色彩に関する理論や数理モデルを、画像を観察・編集するための実用的なインターフェースとして実装しています。以下は主な対応関係です。

 色の選択・数値表示； 画像上の任意の色を読み取り、複数の表色系で比較します。
 　sRGBの線形化、Oklab / OkLCh、CIELAB、HSL / HSV。色差の表示には CIEDE2000 (ΔE00) を用います。
・色相環・マンセル表示： RGB、RYB、マンセルの色相環を比較し、マンセルHVCを立体表示します。
　RGB / RYB / マンセルの異なる色相配置の比較。マンセル値はOklabを内部計算に用いた近似であり、公式マンセルデータベースとの厳密な照合値ではありません。
・ ヒストグラム・色覚シミュレーション ： 輝度・RGB分布を確認し、P型・D型・T型色覚の見え方を比較します。 
　　相対輝度、RGBヒストグラム、Machado et al. の色覚異常シミュレーション行列を用いた近似表示。医学的な診断を目的とするものではありません。 
・明度・階調・明瞭度の調整 ：グレースケール化、階調制限、ディザ、局所的な明瞭度調整を行います。
　線形光での輝度処理、量子化とディザリング、ぼかしとの差分を使う中間周波数の局所コントラスト処理を行います。 
・色相・ガマットマスク ：特定の色相・彩度領域だけを観察・補正し、画像の実効ガマットを抽出します。
　OkLCh上での距離・角度によるマスク、k-meansクラスタリング、凸包（Andrew's monotone chain）による色域輪郭の抽出を行います。
・配色・パレット抽出：主要色を抽出し、補色などの配色ルールを試せます。
　k-meansによる代表色抽出、OkLChの色相角に基づく補色・類似色・分裂補色などの幾何学的な配色規則に従います。 
・顔料混色・レシピ | デジタルの重ね塗りと顔料の減法混色を比較し、混色段階や近似レシピを確認します。
　Kubelka–Munk理論に基づく減法混色の近似、CMY / RGBの理想混色との比較、ΔE00による近似誤差の表示。実在する絵具の配合結果を保証するものではありません。

### 注記

- 画面表示はブラウザ・ディスプレイのsRGB環境を前提とします。モニターの校正状態、画像に埋め込まれたプロファイル、印刷条件までは保証しません。
- RYB色相環、マンセル近似、顔料混色、色覚シミュレーションは、理解と比較のためのモデルです。物理測定・印刷校正・医療診断の代替ではありません。
- 主な参照概念：Oklab（Björn Ottosson）、CIEDE2000（Sharma et al.）、Kubelka–Munk理論、Munsell Color System、Machado et al. の色覚シミュレーション、k-meansクラスタリング。

## 配布と実行

`dist/Chromatorium.html` をダウンロードし、ブラウザで直接開くだけで動作します。インストールやビルドは不要です。基本機能はすべてオフラインで動作しますが、マンセル3D色立体の表示のみ、初回表示時にThree.jsをCDNから取得します（オフライン時は3D以外の機能に影響なく利用できます）。

## 対応形式

JPEG / PNG / WebP / GIF / BMP に対応しています（AVIF / HEICは、お使いのブラウザが対応していれば読み込めます）。TIFF / RAW形式は、このリポジトリでは読込対応を終了しています。

## 開発

`src/` 以下のソースを編集し、以下を実行すると `dist/Chromatorium.html` が再生成されます。

```bash
python3 build.py
```

`build.py` は標準ライブラリのみを使い、`src/` のファイルを決まった順序で連結するだけの処理です。ビルド結果が正しいことは、連結前の基準ファイルとのSHA-256ハッシュ一致で検証できます。

```bash
python3 build.py
sha256sum dist/Chromatorium.html
```

### なぜソースを分割しつつ、単一HTMLへ連結しているか

- 本ツールには、現在の画面状態をHTML1ファイルとして書き出す自己書き出し(バックアップ)機能があり、これは実行中のページ全体(`document.documentElement.outerHTML`)をそのまま保存する仕組みのため、配布物が単一HTMLであることを前提としています。
- 本ツールはローカルの `file://` として直接開く配布形態を想定しており、外部ファイルへの分割(ES moduleの`import`や外部`<script src>`)は主要ブラウザのCORS制限により `file://` 環境で読み込みに失敗します。
- JS本体は単一の `<script type="module">` スコープを前提に実装されており(トップレベルの関数・定数が相互参照)、複数の`<script>`タグに分割するとスコープが分断され動作しません。

このため、GitHub上のソースはレビューしやすいよう18本のJSファイル等に分割する一方、配布物(`dist/Chromatorium.html`)は単一HTMLとしてビルド・コミットしています。

## 開発記および開発者コメント

【免責事項】
大前提として私はhtmlをちょっと触った程度の知識で、開発に関する知識はゼロに近い状態でした。
Chromatoriumについても、これは専ら自家用に作成したツールでしたが、機能を拡大化するにつれ、このツールはオープンソースとして公開され、多くの人の力となるべきと考えるようになりました。
しかしながら、本ツールはまだまだ発展途上の側面があります。是非皆様のご協力でよりよいものにできればと思います。

なお、本ツールの開発の趣旨は、あくまでも作品は自分の頭で考え、手で描く人のためのツールにほかなりません。
計画・コード整理・技術的検討の補助として言語モデル(Claude Fable5, Opus4.8 Sonnet5, ChatGPT 5.6 Terra, Gemini 3.5 Pro, flash)を使用しました。
設計判断、最終確認は当方が担っています。

【ご協力のお願い】

顔料混合シミュレーションなど、一部機能ついては当方の環境で検証することが叶っていません。ご協力いだける方を募集いたします。
また、今後拡張したい箇所等があれば、是非改良にご協力いただきたく思います。
コントリビューターの枠を設けましたので、開発改良にご協力いただいた皆様は、お名前を刻んでいただければと思います。当方と皆様は対等な立場です。

最後に、作成にあたり当方がインスピレーションを受けた ジェームズ・ガーニー氏、パク・リノ氏、絵を描く人(@Mo1HNumjeU45057) にこの場を借りて感謝を申し上げます。
皆様の著書・発信内容なしにこのツールは完成しておりませんでした。

20260712 Nakoso

=English=

Disclaimer

As a foundational note, I had almost zero knowledge of software development, with only a rudimentary understanding of HTML when I began.
Chromatorium was originally created exclusively for my own personal use. However, as its features expanded, I came to believe that this tool should be released as open source to serve as a resource for others.
Please be aware that this tool is still very much a work in progress, and I would be delighted to work with you all to make it even better.

The fundamental purpose of this tool is to support those who conceive their work in their own minds and draw with their own hands.
I utilized language models (Claude Fable 5, Opus 4.8, Sonnet 5, ChatGPT 5.6 Terra, Gemini 3.5 Pro, and Flash) to assist with planning, code organization, and technical research. All design decisions and final verifications were made by me.

 Call for Collaboration

Some features, such as pigment mixing simulations, have not been fully verified in my own environment. I am currently seeking collaborators who can assist with testing.
Furthermore, if there are areas you would like to see expanded, I would greatly appreciate your help in improving the tool. I have established a space for contributors, and I invite everyone who assists with development and improvements to add their names there; you and I stand on equal footing.

Finally, I would like to express my gratitude to James Gurney, Park Pyeong-jun (Lino), and 絵を描く人 (@Mo1HNumjeU45057), who inspired me during the creation of this tool. This project could not have been completed without your books and the content you have shared.

12 Jul 2026, Nakoso
