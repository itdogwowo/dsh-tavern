/**
 * 出貨範例卡片：把 `lib/defaults.js` 的預設角色做成一份 **V3** PNG 角色卡。
 *
 * 內容的來源是 `defaults.js` 的 `sampleCard()`——**不是在這裡另外抄一份**，
 * 所以範例永遠不會跟「新建酒館拿到的東西」走樣。
 *
 * 圖本身不在 repo 裡（那是畫，不是程式）。這支工具把它接進來：
 *
 *   node build-sample.mjs <來源圖.png>
 *
 * 產出兩個檔案，因為它們的用途不同：
 *
 *   samples/characters/老闆娘.json   人可以讀、diff 看得懂的卡片本體
 *   samples/characters/老闆娘.png    同一份資料以 `ccv3` 區塊接進圖裡
 *
 * ⚠️ **只吃 PNG。** JPEG 沒有地方可以接區塊，硬做就是重新編碼一次，畫質會掉。
 * 這也是社群格式選 PNG 的原因：圖與資料同一個檔，而且不必動到像素。
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { writeCardIntoPng, readCardFromPng, isPng } from './lib/pngcard.js'
import { sampleCard, DEFAULT_CHARACTER_ID } from './lib/defaults.js'

const source = process.argv[2]
if (!source) {
  console.error('用法：node build-sample.mjs <來源圖.png>')
  process.exit(2)
}

const bytes = readFileSync(source)
if (!isPng(bytes)) {
  console.error('來源必須是 PNG。JPEG 要重新編碼才接得進去，畫質會掉，所以不收。')
  process.exit(1)
}

const card = sampleCard()
const dir = join('samples', 'characters')
mkdirSync(dir, { recursive: true })

const jsonPath = join(dir, `${DEFAULT_CHARACTER_ID}.json`)
const pngPath = join(dir, `${DEFAULT_CHARACTER_ID}.png`)

// 縮排兩格：這一份是給人看的，也是 V3 格式在 repo 裡的可讀樣本。
writeFileSync(jsonPath, `${JSON.stringify(card, null, 2)}\n`)
// V3 的區塊關鍵字是 `ccv3`（規格寫死 MUST）。寫入端只接區塊，不動像素。
const png = writeCardIntoPng(bytes, card, { keyword: 'ccv3' })
writeFileSync(pngPath, png)

// 寫完立刻用讀取端驗一次：接得進去、讀得回來，才算成功。
const back = readCardFromPng(png)
console.log(
  JSON.stringify(
    {
      json: jsonPath,
      png: pngPath,
      sourceBytes: bytes.length,
      cardBytes: png.length,
      added: png.length - bytes.length,
      keyword: back.keyword,
      spec: back.card.spec,
      name: back.card.data.name,
      asset: back.card.data.assets[0].uri,
    },
    null,
    0,
  ),
)
