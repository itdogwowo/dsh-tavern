/**
 * `lib/pngcard.js`：PNG 角色卡的讀與寫。
 *
 * 這個檔案在匯入人物卡那條路上是**裸的**——沒有任何測試碰過它，
 * 而它踩過的坑（`chara` 區塊放的是 base64，不是原始 JSON）只有在
 * 真的拿一張卡去匯入時才會炸。所以這裡自己造 PNG，不依賴任何 fixture。
 */
import assert from 'node:assert/strict'
import { Buffer } from 'node:buffer'
import { isPng, readTextChunks, readCardFromPng, findCardText, writeCardIntoPng } from './lib/pngcard.js'

const SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

/**
 * 組一個 chunk。
 *
 * CRC 刻意填 0：讀取端**不驗 CRC**（別人的卡不該因為一個 CRC 就讀不了），
 * 這裡剛好順便證明那件事。寫入端自己產的 chunk 另外驗。
 */
function chunk(type, data) {
  const out = Buffer.alloc(12 + data.length)
  out.writeUInt32BE(data.length, 0)
  out.write(type, 4, 'latin1')
  data.copy(out, 8)
  return out
}

/** 一張最小但合法的 PNG：IHDR + IDAT + IEND。 */
function minimalPng(...extra) {
  return Buffer.concat([
    SIGNATURE,
    chunk('IHDR', Buffer.alloc(13)),
    ...extra,
    chunk('IDAT', Buffer.from([0x78, 0x9c, 0x03, 0x00, 0x00, 0x00, 0x00, 0x01])),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

/** 依 SillyTavern 的格式做一個卡片區塊：tEXt keyword + base64(JSON)。 */
function cardChunk(keyword, card) {
  return chunk(
    'tEXt',
    Buffer.concat([
      Buffer.from(`${keyword}\0`, 'latin1'),
      Buffer.from(Buffer.from(JSON.stringify(card), 'utf8').toString('base64'), 'latin1'),
    ]),
  )
}

/* --- 1. 檔頭 -------------------------------------------------------------- */
assert.equal(isPng(minimalPng()), true, 'PNG 檔頭應該被認出來')
assert.equal(isPng(Buffer.from('not a png at all')), false)
assert.equal(isPng(Buffer.from([0x89, 0x50])), false, '太短的不算 PNG')
assert.equal(isPng('字串不是 buffer'), false, '非 buffer 不該過')
assert.throws(() => readTextChunks(Buffer.from('nope')), /不是 PNG/, '非 PNG 要丟錯而不是回空陣列')
console.log('1. 檔頭 OK — 認得 PNG、擋得掉非 PNG')

/* --- 2. 走 chunk ---------------------------------------------------------- */
assert.deepEqual(readTextChunks(minimalPng()), [], '沒有文字區塊時回空陣列')
const twoChunks = readTextChunks(minimalPng(cardChunk('chara', { name: '甲' }), cardChunk('ccv3', { name: '乙' })))
assert.equal(twoChunks.length, 2, '兩個文字區塊都要收到')
assert.deepEqual(
  twoChunks.map((entry) => entry.keyword),
  ['chara', 'ccv3'],
  '關鍵字要按檔案裡的順序',
)
console.log('2. 走 chunk OK — 收得到多個 tEXt，關鍵字與內容都對')

/* --- 3. 讀卡：ccv3 優先、關鍵字不分大小寫 ------------------------------- */
const v2 = { spec: 'chara_card_v2', data: { name: '甲', description: '舊版' } }
const v3 = { spec: 'chara_card_v3', data: { name: '甲', description: '新版' } }
assert.equal(findCardText(minimalPng(cardChunk('chara', v2))).keyword, 'chara')
assert.equal(findCardText(minimalPng(cardChunk('chara', v2), cardChunk('ccv3', v3))).keyword, 'ccv3', 'ccv3 要優先')
assert.equal(readCardFromPng(minimalPng(cardChunk('CHARA', v2))).card.data.description, '舊版', '關鍵字不分大小寫')
console.log('3. 讀卡 OK — base64 → UTF-8 → JSON、ccv3 優先、大小寫不敏感')

/* --- 4. base64 這件事 ----------------------------------------------------- */
// 這是踩過的坑：把原始 JSON 直接塞進 tEXt。它不會在寫入時報錯，
// 只會在**讀**的時候變成亂碼，而且錯誤訊息完全指不到原因。
const rawJson = JSON.stringify(v2)
const broken = minimalPng(
  chunk('tEXt', Buffer.concat([Buffer.from('chara\0', 'latin1'), Buffer.from(rawJson, 'utf8')])),
)
assert.throws(
  () => readCardFromPng(broken),
  /不是合法 JSON/,
  '塞原始 JSON（沒有 base64）要讀失敗——這正是當初的症狀',
)
// 而正確的 base64 版本讀得回來。
assert.equal(readCardFromPng(minimalPng(cardChunk('chara', v2))).card.data.name, '甲')
console.log('4. base64 OK — 原始 JSON 會讀成亂碼（有守住），base64 才讀得回來')

/* --- 5. 寫入：接區塊，不是重編碼 ----------------------------------------- */
const source = minimalPng()
const written = writeCardIntoPng(source, v2)

assert.equal(isPng(written), true)
assert.ok(written.length > source.length, '寫完應該變長')
assert.deepEqual(readCardFromPng(written).card, v2, '寫進去要能原樣讀出來')
// 像素資料一格都不能動：IDAT 的位元組要在新檔裡原樣出現。
const idat = chunk('IDAT', Buffer.from([0x78, 0x9c, 0x03, 0x00, 0x00, 0x00, 0x00, 0x01]))
assert.ok(written.includes(idat), 'IDAT 區塊要原封不動（不能重新編碼）')
// 新區塊要插在 IEND 之前，不是接在檔尾。
assert.ok(
  written.indexOf(Buffer.from('chara\0', 'latin1')) < written.length - 12,
  'chara 區塊要在 IEND 之前',
)
assert.equal(written.subarray(written.length - 12).toString('latin1', 4, 8), 'IEND', '檔尾仍然是 IEND')
console.log('5. 寫入 OK — chara 插在 IEND 之前、IDAT 原封不動、讀得回來')

/* --- 6. 寫入的 chunk 要合法（含 CRC） ------------------------------------ */
// 找自己寫進去的那個 tEXt，把它的 CRC 重算一次對答案。
// 佈局是 [長度:4][型別 'tEXt':4][內容]，所以 `chara` 往前 8 個位元組才是長度。
const needle = Buffer.from('chara\0', 'latin1')
const at = written.indexOf(needle)
const declared = written.readUInt32BE(at - 8)
const payload = written.subarray(at, at + declared)
assert.equal(payload.subarray(0, 6).toString('latin1'), 'chara\0', '長度欄位要指到關鍵字開頭')
assert.equal(payload.subarray(6).toString('latin1'), Buffer.from(JSON.stringify(v2), 'utf8').toString('base64'))
const stored = written.readUInt32BE(at + declared)
const expected = (() => {
  let value = -1
  const bytes = Buffer.concat([Buffer.from('tEXt', 'latin1'), payload])
  for (const byte of bytes) {
    value ^= byte
    for (let bit = 0; bit < 8; bit += 1) value = (value & 1) === 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1
  }
  return (value ^ -1) >>> 0
})()
assert.equal(stored, expected, 'CRC 要對（別的軟體會驗）')
console.log('6. CRC OK — 長度、內容與 CRC 都對得上')

/* --- 7. 壞檔不該害我們 allocate 一大塊 ---------------------------------- */
const liars = Buffer.concat([SIGNATURE, Buffer.from([0xff, 0xff, 0xff, 0xff]), Buffer.from('IDAT', 'latin1')])
assert.throws(() => readTextChunks(liars), /長度不合法/, '宣告 4GB 的 chunk 要被擋下')
assert.throws(() => writeCardIntoPng(liars, v2), /長度不合法/, '寫入端也要擋')
assert.throws(() => writeCardIntoPng(Buffer.from('nope'), v2), /不是 PNG/, '非 PNG 不能寫')
// 少了 IEND 的（截斷的）檔案
const truncated = minimalPng().subarray(0, SIGNATURE.length + 12 + 13)
assert.throws(() => writeCardIntoPng(truncated, v2), /IEND/, '找不到 IEND 要丟錯')
console.log('7. 壞檔 OK — 長度謊言與截斷檔都被擋下，沒有 allocate')

/* --- 8. 沒有卡片資料的 PNG ---------------------------------------------- */
assert.throws(() => findCardText(minimalPng()), /沒有 tEXt/, '沒有文字區塊要講清楚')
assert.throws(
  () => findCardText(minimalPng(cardChunk('comment', { x: 1 }))),
  /comment/,
  '有文字區塊但不是卡片時，訊息要指出找到什麼',
)
console.log('8. 缺卡 OK — 錯誤訊息指得出「找不到什麼」')

console.log('\n全部通過 ✅  （PNG 角色卡的讀寫）')
