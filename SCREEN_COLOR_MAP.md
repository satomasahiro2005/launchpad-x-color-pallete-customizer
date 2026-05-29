# Launchpad X 4.2.2 — 画面別グリッド & 色の編集ポイント

目的:**将来「全画面の UI を見ながら、各色が指すパレット番号を変更できる」エディタ**を作るための、
画面(モード/設定)ごとの「グリッドに何が割り当てられているか」と「その色がファーム内のどこに格納され、編集可能か」の対応表。

- ファーム解析の詳細・実ベース(`0x0800C000`)・パレット実体(`0x0801E034`)は [COLOR_PALETTE_USAGE.md](./COLOR_PALETTE_USAGE.md) を参照。
- 出典凡例 — **[FW]** 逆アセンブルで確認 / **[Man]** Novation 公式マニュアル / **[Corr]** FW の色と Man の記述を突き合わせた相関(高確度の推定)。

---

## 0. 共通:グリッド座標と LED 番号

物理は **9×9(8×8 パッド + 上段機能ボタン + 右シーン列 + ロゴ)**。

### MIDI 番号(Programmer mode 基準。全レイアウト共通の LED index)[Man]

```
        (上段=CC, row9)   91   92   93   94   95   96   97   98     ← ↑ ↓ ← → / Session / Note / Custom / Capture
                        ┌────────────────────────────────────┐
   row8(上)            │ 81  82  83  84  85  86  87  88       │ 89   ┐
   row7                │ 71 ...                          78   │ 79   │
   ...                 │                                      │ ...  │ 右列 Scene Launch (CC, col9)
   row1(下)            │ 11  12  13  14  15  16  17  18       │ 19   ┘
                        └────────────────────────────────────┘
        bottom-left=11, bottom-right=18, top-left=81, top-right=88,  Logo=99
```

- 上段機能ボタン(CC): `91`=↑ `92`=↓ `93`=← `94`=→ `95`=Session `96`=Note `97`=Custom `98`=Capture MIDI
- 右シーン列(CC, 下→上): `19 29 39 49 59 69 79 89`
- 点灯チャンネル:Ch1=静止 / Ch2=点滅 / Ch3=パルス [Man]

> ⚠️ **ファーム内部 index は別系**(`row*10+col` だが row0=上段・top-down の 0..99)。MIDI 番号 ↔ 内部 index の対応はエディタ実装時に変換テーブルが要る。[FW]

---

## 1. Note モード

**グリッド割り当て**[Man/FW]:8×8 が音階パッド。本アプリの `getGridPitch = col + (7-row)*5`(行ごとに完全4度=5半音ずれる標準レイアウト)。押下で MIDI Note On、ベロシティは打鍵の強さ。上段=モード/転調、右列=シーン。

**使用色(編集ポイント)**:

| 役割 | パレットidx(初期) | 格納場所(file offset) | 格納形式 | 編集可否 |
| --- | --- | --- | --- | --- |
| Root(ルート音) | `0x5E` | `0x0D126` | `movs` 即値 | ◎ 既存アプリで編集可 |
| Scale(スケール音) | `0x24` | `0x0D128` | `movs` 即値 | ◎ |
| Off(スケール外) | `0x00` | `0x0D12E` | `movs` 即値 | ◎ |
| Accent(押下/強打) | `0x15` | `0x0D130` | `movs` 即値 | ◎ |

これらは RAM のパッド状態に書かれ、共通レンダラ `0x800FD0E` が `palette[idx]` で色化。[FW 確定]

---

## 2. 上段「↑ ↓ ← →」= オクターブ / 転調インジケータ

**割り当て**:左2つ=オクターブ ±、右2つ=転調(または上下左右で octave/transpose)。長さで色の濃淡(`udiv` で按分)を表示。[FW]

**使用色(編集ポイント)** — 描画関数 `0x8018D74`:

| 役割 | idx | 格納場所 | 形式 | 備考 |
| --- | --- | --- | --- | --- |
| 系A 基準色 | `0x5E` | `0xCDBA` (`add.w r,palette,#0x178`) | アドレス即値(=idx×4) | `0x178/4 = 0x5E` |
| 系A 第2色 | `0x5F` | `0xCE86` (`ldr [r,#4]`) | ldr オフセット | `+4` = 次のidx |
| 系B 基準色 | `0x24` | `0xCE14` (`add.w r,palette,#0x90`) | アドレス即値 | `0x90/4 = 0x24` |
| 系B 第2色 | **`0x2D`** | `0xCE30` (`ldr [r,#0x24]`) | ldr オフセット | 0x90+0x24=0xB4 → idx`0x2D`(※既存docの`0x25`は誤り) |
| 簡易表示(state2)点灯/消灯 | `0x0D` / `0x00` | `0xA40A` / `0xA40C` (`ldr [palette,#imm]`) | ldr オフセット | 別関数 `0x8016408` |

> 編集機構:`add.w`/`ldr` の **即値(idx×4 または ×1)** を書き換えると参照idxが変わる。ただし `add.w` は Thumb2 modified-immediate 符号化のため、任意idxにするには再エンコードが必要。RGB だけ変えたいなら該当idxのパレット値を編集するのが安全。

---

## 3. 上段「Session / Note / Custom / Capture」+ 右シーン列

**割り当て**[Man]:上段右4つ=モード切替ボタン、右列=シーン起動 / 設定ページ選択。

**使用色(編集ポイント)** — 描画 `0x801523C` 近傍:

| 役割 | idx | 格納場所 | 形式 |
| --- | --- | --- | --- |
| 消灯/未選択 | `0x00` | `0x924A` (`ldr [palette,#0]`) | ldr |
| アイドル(微灰) | `0x01` | `0x9252` (`ldr.w [palette,#4]`) | ldr.w |
| 選択/点灯(明緑) | `0x1C` | `0x9266` (`ldr [palette,#0x70]`) | ldr |
| 補助(暗赤) | `0x07` | `0x931C` (`add.w palette,#0x1C`) | アドレス即値 |
| 現在モード色 | 可変 | `0x9246` (`ldr.w [palette, idx<<2]`) | テーブル/RAM 由来 |

---

## 4. Settings(設定)メニュー — Session 長押しで表示

`Session` を短く長押しで進入。上 4 行に「LED / VEL / AFT / FAD」の文字、右上 4 つの Scene Launch でページ切替。[Man]
文字描画は `0x800F002`(NULヌル終端のパッドビットマップを 1 個ずつ点灯)。[FW]

**ページと各パッドの割り当て**[Man]:

| ページ(Scene) | パッドの内容 | 状態色(マニュアル表記) |
| --- | --- | --- |
| **LED** | 明るさスライダ(8段)/ LED feedback(内部)/ LED feedback(外部)/ LED sleep | 選択段=**明白**、有効=**明緑**、無効=**暗赤** |
| **VEL** | ベロシティ ON/OFF / 3種カーブ(Low/Med/High) | 有効=**明緑**/無効=**暗赤**、選択カーブ=**明橙**、非選択=**暗白** |
| **AFT** | Off / Channel Pressure / Poly + しきい値3段 | 選択=**明るく**、しきい値選択=**明紫**、非選択=**暗白** |
| **FAD** | フェーダのベロシティ感度 ON/OFF | 有効=**明緑**/無効=**暗赤** |
| (共通) | Live=緑 Scene / Programmer=橙 Scene | Live=**緑**、Programmer=**橙** |

**色の編集ポイント**[Corr] — Settings 描画クラスタ `0x80158D4`:

| マニュアルの色 | パレットidx | 実RGB | 格納場所 | 形式 |
| --- | --- | --- | --- | --- |
| 明緑(有効 / Live) | `0x15` | `#00fc00` | `0x98FC` (`ldr [palette,#0x54]`) | ldr |
| 明橙(VELカーブ / Programmer) | `0x09` | `#fc3c00` | `0x991E` (`ldr [palette,#0x24]`) | ldr |
| 明紫(AFTしきい値) | `0x35` | `#fc00fc` | `0x993E` (`ldr.w [palette,#0xD4]`) | ldr.w |
| 暗赤(無効) | `0x07` | `#3c0000` | (各所 `ldr/ add.w`) | ldr |
| 暗白(非選択) | `0x01` | `#3c3c3c` | (各所) | ldr |
| 明白(明るさ選択段) | `0x03` | `#fcfcfc` | (LED ページ) | — |

> ✅ Settings の主要色(緑/橙/紫)が `0x80158D4` の `ldr [palette,#…]` 即値とマニュアル記述で一致 →
> このクラスタが Settings メニューのレンダラであることを確認(`0x800F002` が "LED/VEL/AFT/FAD" 文字も描画)。

---

## 5. Session モード

**割り当て**[Man]:8×8 が DAW(Ableton 等)のセッションクリップ。色は DAW から MIDI(Ch1 静止/Ch2 点滅/Ch3 パルス)で送られ、**ファーム固定色ではない**。右列=シーン起動。

**色の出所**:ホスト送信 index → RAM パッド状態 → 共通レンダラ `0x800FD0E`。**固定の編集ポイントなし**(色はホスト依存)。[FW 構造]

---

## 6. Custom モード(1–4)

**割り当て**[Man]:
- Custom 1:8×8 Note On(工場出荷=Drum Rack 配列)
- Custom 2:8×8 Note On
- Custom 3:Lighting(Drum Rack 配列)— 既定で全消灯、ホストの Note でパッド点灯
- Custom 4:Lighting(Session 配列)
- Ghost モード:Note→Custom を素早く押すと縁の機能ボタンを消灯

**色の出所**:Lighting 系はホスト指定 index、内蔵 feedback は設定の LED feedback(内部)に従う。固定色テーブルではなく **可変**(`0x800FD0E` 経由)。[FW 構造]

---

## 7. Programmer モード

**割り当て**[Man]:9×9 全面が独立した Note/CC を送出(上記§0 の番号)。電源時は全消灯。
パッド点灯は MIDI(Note/CC + ベロシティ=色 index)で完全にホスト制御。

**色の出所**:ホストが velocity に色 index(0–127)を指定 → そのまま `palette[index]`。
受信ハンドラ `0x801CCCC`(`~0x801CB1E`)が可変 index でパレットを引く。**固定の編集ポイントなし**(色はホスト依存だが、参照されるパレット実体 `0x0801E034` を編集すれば全 index の見え方は変えられる)。[FW]

---

## 8. 将来エディタ向けまとめ:編集の2方式

1. **パレット RGB を編集**(既存アプリの方式):`0x0801E034 + idx*4` の BGR を書き換え。
   どの画面でも、その画面が使う **idx の色** が変わる。Session/Custom/Programmer のようにホストが index を選ぶ画面でも有効。
   → 「画面ごとに使われている idx 群」を本書の表でグルーピングし、スウォッチを画面別に並べるだけで実現可能。**推奨・最も安全**。

2. **参照 index を張り替え**(どのスロットを指すか変更):
   - `movs` 即値(Note テーブル):任意 idx に変更可。◎
   - `ldr [palette,#imm]`:imm = idx×4。idx<32 は `ldr`(imm5×4)で表現可だが、それ以上や `ldr.w`/`add.w` は符号化の制約・再エンコードが必要。△
   - ホスト/RAM 由来(Session/Custom/Programmer/現在モード色):静的パッチ不可。✕

> 各画面の「固定色」は本書 §1–§4 の表に集約済み。§5–§7 はホスト依存のため方式1のみ。

---

## 出典

- Novation, *Launchpad X — Programmer's Reference Manual*
  https://fael-downloads-prod.focusrite.com/customer/prod/s3fs-public/downloads/Launchpad%20X%20-%20Programmers%20Reference%20Manual.pdf
- Novation, *Launchpad X — User Guide v2.0*
  https://files.kraftmusic.com/media/ownersmanual/Novation_Launchpad_X_User_Guide.pdf
- ファーム解析:`launchpadx-firmware-422.syx`(本リポジトリ手順、`work/` の逆アセンブル)
