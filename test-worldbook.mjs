/**
 * 世界書觸發邏輯的測試（R5）。
 *
 * 這一塊是照 SillyTavern 的規則自己實作的（`lib/worldbook.js` 的檔頭有對照表），
 * 所以測試的重點是**逐條釘住那些規則**——尤其是四種 `selectiveLogic`，
 * 它們很容易寫反（`NOT_ALL` 跟 `NOT_ANY` 差一個字，意思完全相反）。
 *
 * 用法：node test-worldbook.mjs
 */
import assert from 'node:assert/strict'

const {
  DEFAULT_BUDGET_CHARS,
  SELECTIVE_LOGIC,
  activationOf,
  collectLore,
  matchesKey,
  normalizeEntries,
  prependLore,
  textOfMessages,
} = await import('./lib/worldbook.js')

/* ------------------------------ 正規化兩種方言 ---------------------------- */

{
  // 原生：以字串化 uid 為 key 的物件
  const native = { entries: { '0': { uid: 0, key: ['酒'] }, '1': { uid: 1, key: ['店'] } } }
  assert.equal(normalizeEntries(native).length, 2, '原生方言要吃得下')

  // V2 內嵌：陣列
  const v2 = { entries: [{ uid: 0, keys: ['酒'] }, { uid: 1, keys: ['店'] }] }
  assert.equal(normalizeEntries(v2).length, 2, 'V2 方言要吃得下')

  // 壞東西一律當作沒有，不要丟錯（世界書是使用者從各處弄來的）
  for (const junk of [null, undefined, 42, 'x', [], {}, { entries: null }, { entries: 'x' }]) {
    assert.deepEqual(normalizeEntries(junk), [], `壞資料要回空陣列：${JSON.stringify(junk)}`)
  }
  assert.deepEqual(normalizeEntries({ entries: [null, 1, { uid: 0 }] }).length, 1, '陣列裡的雜物要濾掉')

  console.log('1. 正規化 OK — 原生／V2 兩種方言，壞資料不丟錯')
}

/* -------------------------------- 關鍵字比對 ------------------------------ */

{
  const text = '老闆娘擦了擦杯子，問他要喝什麼。'

  assert.equal(matchesKey(text, '杯子', {}), true, '單純包含')
  assert.equal(matchesKey(text, '酒瓶', {}), false, '沒有就是沒有')
  assert.equal(matchesKey(text, 'STAR', {}), false, '大小寫不敏感時比不到')

  // caseSensitive
  assert.equal(matchesKey('Hello World', 'hello', {}), true, '預設不分大小寫')
  assert.equal(matchesKey('Hello World', 'hello', { caseSensitive: true }), false, '開了就分大小寫')
  assert.equal(matchesKey('Hello World', 'Hello', { caseSensitive: true }), true)

  // matchWholeWords
  //
  // ⚠️ 這一組同時釘住**我們偏離 ST 的地方**：ST 用 `(?:^|\W)酒(?:$|\W)`，
  //    而 JS 的 `\w` 只有 ASCII，所以中文一律算 `\W`——那個邊界對中文是壞的
  //    （「酒」會在校「酒店」裡命中）。我們對非 ASCII 的關鍵字讓整詞模式無效。
  assert.equal(matchesKey('cat', 'cat', { matchWholeWords: true }), true, 'ASCII：整詞命中')
  assert.equal(matchesKey('a cat.', 'cat', { matchWholeWords: true }), true, 'ASCII：前後是標點也算整詞')
  assert.equal(matchesKey('concatenate', 'cat', { matchWholeWords: true }), false, 'ASCII：整詞模式要擋掉子字串')
  assert.equal(matchesKey('concatenate', 'cat', {}), true, '沒開整詞就是單純包含')

  assert.equal(matchesKey('點了一杯酒', '酒', {}), true, '中文：預設是包含')
  assert.equal(
    matchesKey('酒店大亨', '酒', { matchWholeWords: true }),
    true,
    '中文：整詞模式**無效**（退回包含）——這是刻意的，ST 的邊界對中文是壞的',
  )
  assert.equal(
    matchesKey('喝點酒。', '酒', { matchWholeWords: true }),
    true,
    '中文：整詞模式下仍然命中',
  )
  // 多字關鍵字用 includes（用 \W 包一個片語沒有意義）
  assert.equal(matchesKey('他喝了一杯酒', '一杯酒', { matchWholeWords: true }), true, '多字關鍵字仍用包含')

  // /regex/ 形式繞過其他選項
  assert.equal(matchesKey('abc123', '/\\d+/', {}), true, '正則關鍵字')
  assert.equal(matchesKey('abc', '/\\d+/', {}), false)
  assert.equal(matchesKey('ABC', '/abc/i', {}), true)
  // 壞掉的正則 → 不匹配，**不是**丟錯（使用者的書不該讓對話掛掉）
  assert.equal(matchesKey('abc', '/([', {}), false, '壞正則回 false 而不是丟錯')

  console.log('2. 關鍵字比對 OK — 包含／大小寫／整詞／正則／壞正則')
}

/* -------------------------------- 觸發判斷 -------------------------------- */

{
  const options = {}

  assert.equal(activationOf({ disable: true, constant: true }, '任何字', options), null, 'disable 是硬跳過')
  assert.equal(activationOf({ enabled: false, constant: true }, '任何字', options), null, 'V2 的 enabled:false 同理')
  assert.equal(activationOf({ constant: true }, '', options), 'constant', 'constant 不需要關鍵字')
  assert.equal(activationOf({ key: [] }, '任何字', options), null, '沒有關鍵字又不是 constant → 選不到')
  assert.equal(activationOf({ key: ['酒'] }, '喝點酒', options), 'key', '主關鍵字命中')
  assert.equal(activationOf({ key: ['酒'] }, '喝茶', options), null, '主關鍵字沒中')

  // selective + keysecondary：四種邏輯
  const base = { key: ['酒'], selective: true }
  const withSecondary = (logic) => ({ ...base, keysecondary: ['老闆娘', '深夜'], selectiveLogic: logic })

  // AND_ANY（預設）：次要關鍵字**任一**命中
  assert.equal(activationOf(withSecondary(SELECTIVE_LOGIC.AND_ANY), '酒 老闆娘', options), 'key', 'AND_ANY：中一個')
  assert.equal(activationOf(withSecondary(SELECTIVE_LOGIC.AND_ANY), '酒 白天', options), null, 'AND_ANY：都沒中')

  // NOT_ALL：次要關鍵字**不是全部**命中（＝至少一個沒中）
  assert.equal(activationOf(withSecondary(SELECTIVE_LOGIC.NOT_ALL), '酒 老闆娘', options), 'key', 'NOT_ALL：只中一個')
  assert.equal(
    activationOf(withSecondary(SELECTIVE_LOGIC.NOT_ALL), '酒 老闆娘 深夜', options),
    null,
    'NOT_ALL：兩個都中 → 反而不啟用',
  )

  // NOT_ANY：次要關鍵字**都沒**命中
  assert.equal(activationOf(withSecondary(SELECTIVE_LOGIC.NOT_ANY), '酒 白天', options), 'key', 'NOT_ANY：都沒中')
  assert.equal(activationOf(withSecondary(SELECTIVE_LOGIC.NOT_ANY), '酒 深夜', options), null, 'NOT_ANY：中一個就不啟用')

  // AND_ALL：次要關鍵字**全部**命中
  assert.equal(
    activationOf(withSecondary(SELECTIVE_LOGIC.AND_ALL), '酒 老闆娘 深夜', options),
    'key',
    'AND_ALL：全中',
  )
  assert.equal(activationOf(withSecondary(SELECTIVE_LOGIC.AND_ALL), '酒 老闆娘', options), null, 'AND_ALL：少一個就不啟用')

  // selective 關掉、或沒有次要關鍵字 → 主關鍵字中了就算中
  assert.equal(
    activationOf({ ...base, selective: false, keysecondary: ['不存在'] }, '酒', options),
    'key',
    'selective 關掉時不看次要關鍵字',
  )
  assert.equal(activationOf({ ...base, keysecondary: [] }, '酒', options), 'key', '沒有次要關鍵字時不看')

  console.log('3. 觸發判斷 OK — disable／constant／selective 四種邏輯都對')
}

/* ------------------------------ 收集與排序 -------------------------------- */

{
  const book = (id, entries) => ({ id, data: { entries } })

  const books = [
    book('a', {
      '0': { uid: 0, key: ['酒'], content: '普通的酒。', order: 100 },
      '1': { uid: 1, key: ['酒'], content: '很重要的事。', order: 500 },
      '2': { uid: 2, key: ['酒'], content: '一樣重要。', order: 500 },
      '3': { uid: 3, constant: true, content: '這間店的規矩。', order: 1 },
      '4': { uid: 4, key: ['酒'], content: '   ', order: 900 },
      '5': { uid: 5, key: ['茶'], content: '不會被選到。', order: 999 },
    }),
    book('b', { '0': { uid: 0, key: ['酒'], content: '另一本的內容。', order: 200 } }),
  ]

  const lore = collectLore(books, '來點酒', {})
  const contents = lore.entries.map((entry) => entry.content)

  // order 由大到小；同 order 用 uid 遞增（可重現）
  assert.deepEqual(
    contents,
    ['很重要的事。', '一樣重要。', '另一本的內容。', '普通的酒。', '這間店的規矩。'],
    'order 由大到小，同 order 用 uid 遞增',
  )
  assert.equal(contents.includes('不會被選到。'), false, '沒命中的不該出現')
  assert.equal(contents.includes('   '), false, '只有空白的條目要跳過')
  assert.ok(lore.text.includes('很重要的事。') && lore.text.includes('這間店的規矩。'), '接起來的文字要含全部')
  assert.equal(lore.truncated, false)
  assert.equal(lore.entries[0].reason, 'key')
  assert.equal(lore.entries[lore.entries.length - 1].reason, 'constant', 'constant 那條要標對原因')

  // 預算：先到先得，超過就整條跳過（不切斷單一條目）
  const tight = collectLore(books, '來點酒', { budgetChars: 12 })
  assert.equal(tight.truncated, true, '超過預算要標記')
  assert.ok(tight.entries.length >= 1, '至少留一條')
  assert.ok(
    tight.entries.every((entry) => entry.content.length <= 12),
    '不可以留下超過預算的單一條目',
  )
  assert.ok(tight.text.length <= 12 + 2 * (tight.entries.length - 1), '接起來的總長要受控')

  // 一本書都沒有 / 掃描文字是空的 → 安靜地回空的
  assert.deepEqual(collectLore([], '酒', {}), { entries: [], text: '', truncated: false })
  assert.equal(collectLore(null, '酒', {}).text, '', 'books 不是陣列也不能丟錯')
  assert.equal(collectLore(books, '', {}).entries.filter((e) => e.reason === 'constant').length, 1, '空文字只剩 constant')

  console.log('4. 收集與排序 OK — order 排序、uid 決勝、預算截斷、空輸入')
}

/* ------------------------------- 注入到訊息 ------------------------------- */

{
  const makeMessage = (id, role, text) => ({
    id,
    role,
    content: [{ type: 'text', text }],
    source: { kind: 'user' },
  })

  const messages = [
    makeMessage('m1', 'user', '第一句'),
    makeMessage('m2', 'assistant', '回覆'),
    makeMessage('m3', 'user', '最新的一句'),
  ]
  const before = JSON.stringify(messages)

  const next = prependLore(messages, '【世界設定】\n這間店晚上才開。')

  assert.equal(messages.length, next.length, '不該增加訊息數量')
  assert.equal(JSON.stringify(messages), before, '**不可以改到原陣列**（DSH 給的是它自己的東西）')
  assert.notEqual(next, messages, '要回一個新陣列')

  // 接在**最新**那一則使用者訊息前面（KV 快取：只動尾端）
  assert.equal(next[0].content.length, 1, '第一則不動')
  assert.equal(next[1].content.length, 1, '中間那則不動')
  assert.equal(next[2].content.length, 2, '最新那則多一個區塊')
  assert.equal(next[2].content[0].type, 'text')
  assert.equal(next[2].content[0].text, '【世界設定】\n這間店晚上才開。', '注入的內容排在使用者的話前面')
  assert.equal(next[2].content[1].text, '最新的一句', '使用者原本的話要保留')

  // id / role / source 全部不變——**這是最重要的一條**：
  // id 是耐久紀錄的識別碼，自己生一個新的有風險。
  assert.equal(next[2].id, 'm3', 'id 不可以換')
  assert.equal(next[2].role, 'user', 'role 不可以換')
  assert.deepEqual(next[2].source, { kind: 'user' }, 'source 不可以換')

  // 邊界：空的注入、空的訊息、沒有使用者訊息
  assert.equal(prependLore(messages, ''), messages, '空的注入要原樣回傳')
  assert.equal(prependLore(messages, '   '), messages, '只有空白也算空的')
  assert.deepEqual(prependLore([], '東西'), [], '沒有訊息時原樣回傳')
  assert.equal(prependLore(null, '東西'), null, '不是陣列時原樣回傳')
  const onlyAssistant = [makeMessage('a1', 'assistant', '我說話')]
  assert.equal(prependLore(onlyAssistant, '東西'), onlyAssistant, '沒有使用者訊息時不注入')

  // 掃描文字：只取 text 區塊
  assert.equal(textOfMessages(messages), '第一句\n回覆\n最新的一句')
  assert.equal(
    textOfMessages([{ role: 'user', content: [{ type: 'image', attachment: {} }, { type: 'text', text: '看這張' }] }]),
    '看這張',
    '非文字區塊要跳過',
  )
  assert.equal(textOfMessages(null), '', '不是陣列時回空字串')
  assert.equal(textOfMessages([{ role: 'user' }]), '', '沒有 content 時回空字串')

  console.log('5. 注入 OK — 接在最新一則、保留 id/role/source、不改原陣列')
}

/* ----------------------------- 跟 default 對齊 ---------------------------- */

{
  // 預設值是文件承諾的一部分，改動它要有意識。
  assert.equal(DEFAULT_BUDGET_CHARS, 6000, '預設預算改了要一起改文件')
  assert.equal(SELECTIVE_LOGIC.AND_ANY, 0, '跟 SillyTavern 的常數對齊')
  assert.equal(SELECTIVE_LOGIC.NOT_ALL, 1)
  assert.equal(SELECTIVE_LOGIC.NOT_ANY, 2)
  assert.equal(SELECTIVE_LOGIC.AND_ALL, 3)
  console.log('6. 常數 OK — 預設預算與 selectiveLogic 都跟 ST 對齊')
}

console.log('\n全部通過 ✅')
