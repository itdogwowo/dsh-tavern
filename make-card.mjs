/**
 * 把一張普通的 PNG 接成「真正的角色卡」（給這台機器用的一次性工具）。
 *
 * 格式的知識不在這裡——在 `lib/pngcard.js` 的 `writeCardIntoPng`，
 * 這裡只負責「讀哪個檔、寫去哪個檔」。
 *
 * 用法：node make-card.mjs <酒館資料夾> <角色id> <來源圖> [輸出檔]
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { writeCardIntoPng, isPng, readCardFromPng } from './lib/pngcard.js'

const [tavern, id, source, target] = process.argv.slice(2)
if (!tavern || !id || !source) {
  console.error('用法：node make-card.mjs <酒館資料夾> <角色id> <來源圖> [輸出檔]')
  process.exit(2)
}

// 卡片資料以酒館裡的 JSON 為準（那是真正的儲存格式）。
const raw = JSON.parse(readFileSync(join(tavern, 'characters', `${id}.json`), 'utf8'))
const inner = raw && raw.spec === 'chara_card_v2' && raw.data ? raw.data : raw
const card = { spec: 'chara_card_v2', spec_version: '2.0', data: { ...inner, spec: 'chara_card_v2', spec_version: '2.0' } }

const bytes = readFileSync(source)
if (!isPng(bytes)) {
  console.error('來源不是 PNG。JPEG 不能這樣接（會把整張圖重新編碼，畫質會掉）。')
  process.exit(1)
}

const out = writeCardIntoPng(bytes, card)
const destination = target ?? join(tavern, 'cards', `${id}.png`)
mkdirSync(dirname(destination), { recursive: true })
writeFileSync(destination, out)

// 立刻用讀取端驗一次：寫得進去、讀得回來，才算成功。
const back = readCardFromPng(out)
console.log(
  JSON.stringify({
    destination,
    sourceBytes: bytes.length,
    cardBytes: out.length,
    name: back.card.data.name,
    keyword: back.keyword,
  }),
)
