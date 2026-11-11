# 店面的框架（`shop.json`）

> 狀態：**已實作**（2.11.0）。
> 相關：[設計語言 §0.0](design-language.md)（街跟 DSH、酒館跟 theme）、
> [房間佈局](room-layout.md)。

街上的一間店有**三層**，不要混在一起：

| 層 | 檔案 | 管什麼 | 誰決定 |
|---|---|---|---|
| **街道** | 插件程式 | 牌坊、路面、店面卡外框、按鈕 | **DSH 原生**（`--dsw-*`） |
| **店面** | `<酒館>/shop.json` | 招牌字、一句話、招牌樣式、店面樣式、遮陽棚、燈籠 | 這間酒館 |
| **室內裝修** | `<酒館>/theme.json` | 顏色、圓角、陰影、字體、對話框樣式 | 這間酒館 |

**店面卡吃 `theme.json` 的色盤**：招牌、牆、門、窗、遮陽棚、燈籠都用這間酒館的
`accent`／`surface`／`text`／`line`。所以房間裡按「墨藍」，回到街上那間店的店面
也會變藍灰；街道本身仍然是 DSH 的顏色。店面卡的下半（名字、計數、按鈕）維持
DSH 的閱讀層，不跟著店面變色——街要讀得清楚，店要看得出來。

## 檔案長什麼樣

```json
{
  "version": 1,
  "sign": "醉月樓",
  "tagline": "今夜有酒，也有故事。",
  "signStyle": "projecting",
  "facade": "noren",
  "awning": "solid",
  "lantern": "cool",
  "frame": "break",
  "frameShape": "arch",
  "roof": "eaves",
  "plant": "bush",
  "windows": "plain",
  "door": "square"
}
```

| 欄位 | 值 | 預設 | 意思 |
|---|---|---|---|
| `sign` | 字串，最多 24 字 | `""` | 招牌上的字。**留空＝用酒館名稱**。 |
| `tagline` | 字串，最多 40 字 | `""` | 店面卡下半的一句；留空就不顯示。 |
| `signStyle` | `hanging`／`plaque`／`banner`／`projecting`／`marquee` | `hanging` | 吊牌／門楣／店側／伸向街道／橫跨店頂。後兩個需要 `frame: "break"` 才看得出破框。 |
| `facade` | `classic`／`noren`／`counter` | `classic` | 門＋兩窗／門上暖簾／開放櫃檯。 |
| `awning` | `stripes`／`solid`／`none` | `stripes` | 條紋／素面／不要遮陽棚。 |
| `lantern` | `warm`／`cool`／`none` | `warm` | 暖色燈／主題強調色燈／不要。 |
| `frame` | `normal`／`break` | `normal` | 規矩（招牌留在卡內）／越界（招牌可伸出邊界，卡片微歪）。 |
| `frameShape` | `rounded`／`sharp`／`arch`／`soft` | `rounded` | 邊框形狀：圓角／方角／拱頂／大圓。 |
| `roof` | `none`／`eaves` | `none` | 店頂加一道屋簷；越界卡可伸出卡外。 |
| `plant` | `none`／`pot`／`bush` | `none` | 門口植物：不要／一盆／一叢。 |
| `windows` | `cross`／`plain`／`none` | `cross` | 十字窗／素面窗／不要窗。 |
| `door` | `arch`／`square` | `arch` | 拱門／方門。 |

規則：

- **沒有 `shop.json` 是正常的**：用預設（吊牌、經典店面、條紋、暖燈），招牌用酒館名稱。
- **壞掉的檔案**（不是合法 JSON）回預設，但 `shop.read` 會帶 `broken: true`，設定頁要說出來。
- **不認得的 key 直接丟掉**；`shop.write` 是**整份寫入**，不是 patch。
- 超過長度的字會在宿主截斷；控制字元會被清掉。顏色**不在這個檔案**。
- 有**店面圖**（`art/tavern/` 的主圖）時，圖就是牆：門／窗／櫃檯會藏起來，
  招牌、遮陽棚、燈籠仍然疊在圖上。沒有圖就用 CSS 畫一間店。
- **屋簷**與**門口植物**畫在裁切層外面：規矩卡留在卡框內，越界卡可以伸出
  卡外一點。窗／門在店內，不會破框。

### 破框（`frame: "break"`）

規矩是常態，破框是例外：

- `normal`：招牌／彩旗留在卡片邊界內；卡片排得整齊。
- `break`：卡片 `overflow` 打開，招牌可以伸出卡外（`projecting` 伸向街道、
  `marquee` 橫跨店頂），卡片微微旋轉 −0.6°；hover 時回正。**只建議少數店用**，
  太多間就失去「特別」的感覺。
- 破框只影響那張卡；街道骨架、路面、其他卡仍然守規矩。

## UI 在哪裡

**⚙️ 設定 → 🏮 店面（街上看到的那張臉）**：

- 招牌字／一句話；
- 招牌樣式、店面樣式、遮陽棚、燈籠；
- 框架（規矩／越界）、邊框形狀、屋簷、門口植物、窗戶、門；
- 「儲存店面」寫 `shop.json`。

**顏色**在房間的 **⚙️ 房間 → 🎨 這間酒館的外觀**（暖燈／墨藍／森林／紙白／夜紫）。
店面會跟著變；街道不會。

## 宿主介面

| op | 參數 | 回傳 |
|---|---|---|
| `shop.read` | `{ id }` | `{ exists, broken, shop }` |
| `shop.write` | `{ id, patch }` | `{ exists, broken, shop }`（正規化後） |

`street.cards` 的每張卡多一個 `shop`：

```json
{
  "sign": "醉月樓",
  "tagline": "今夜有酒，也有故事。",
  "signStyle": "plaque",
  "facade": "noren",
  "awning": "solid",
  "lantern": "cool",
  "frame": "break",
  "frameShape": "arch",
  "roof": "eaves",
  "plant": "bush",
  "windows": "plain",
  "door": "square",
  "palette": {
    "accent": "#E8A33D",
    "accentSoft": "rgba(232,163,61,.14)",
    "surface": "#1B1611",
    "surface2": "#241C16",
    "surface3": "#2E241C",
    "text": "#F3E6D2",
    "text2": "#C6B199",
    "line": "#3A2E25",
    "glow": "#D98A2B"
  }
}
```

`palette` 是宿主從 `theme.json`（基底＋覆寫）算好的一小份，只給店面用；
`street.cards` 一次回，街不必為每間店再打一次 `theme.read`。

## 加一種店面樣式

1. `lib/shop.js`：把新值加進 `SHOP_FACADES`／`SHOP_SIGN_STYLES`／`SHOP_FRAMES`／…（`normalizeShop` 會用它驗證）。
2. `lib/client.js` 的店面 CSS：加 `[data-facade="…"]` 或 `[data-sign="…"]` 的規則。
3. `ShopSettings` 的選項加一筆（label／hint）。
4. 測試：`test-workspace` 的 2c、`test-client` 的店面 seed／`ShopSettings`。

⚠️ 不要把店面顏色寫死：用 `--shop-*`（由 `palette` 注入）。也不要讓店面卡下半
跟著店面變色——那是街道的閱讀層，要維持 DSH。
