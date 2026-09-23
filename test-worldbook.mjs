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
  ORDER_LIMITS,
  SELECTIVE_LOGIC,
  WORLDBOOK_POSITION_INFO,
  WORLDBOOK_POSITIONS,
  activationOf,
  applyBookOverride,
  collectLore,
  entryKeyOf,
  entryOverridesOf,
  groupByPosition,
  matchesKey,
  normalizeEntries,
  normalizeOrder,
  normalizePosition,
  orderOf,
  positionOf,
  prependLore,
  textOfEntries,
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

/* ------------------- 房間對條目優先序的覆寫（2.6.70）------------------- */

{
  /**
   * 使用者：
   *   > 酒館有個圖書館，開房間的時候會將所有預設放進去，然後房間自己可以微調修改，
   *   > 不包括內容，只是修改位置以及優先序
   *
   * ⚠️ **這一節的第一版做的是「書層」的優先序**（一本書一個數字、整本排在別本
   * 前面），而使用者打回來：
   *
   *   > 等等為什麼多了這些東西，我說的次序可能和你說的次序不一樣，
   *   > 我看見**世界書裏面有不同的項目設定次序**，我說的是那個，
   *   > 你獨立給了我另一個次序了
   *
   * 他看得到的是**條目自己的 `order`**（「📖 藏書 → 點一本書 → 每一條條目」
   * 下面標著「優先序」的那個數字）。所以現在的規矩是：
   *
   *   **這一間房對某一條的覆寫 → 書自己的 `order` → ST 的預設 100**
   *
   * 覆寫存在 `room.json` 的 `worldbookEntryOverrides`——**書的檔案一個字都不會
   * 被改**（那是使用者的 ST 檔）。
   */

  // ① 正規化：`null` ＝ 沒指定／不合法（**與 0 不同**——0 是合法的 order）。
  assert.equal(normalizeOrder(0), 0, '0 是合法的 order（ST 的慣例裡 0～19 是「錦上添花」那一級）')
  assert.equal(normalizeOrder(-5), -5, '負數合法（排到最後）')
  assert.equal(normalizeOrder('950'), 950, '數字字串收（`<input>` 送的就是字串）')
  assert.equal(normalizeOrder(1.5), null, '小數不合法')
  assert.equal(normalizeOrder('abc'), null, '不是數字不合法')
  assert.equal(normalizeOrder(''), null, '空字串＝沒指定')
  assert.equal(normalizeOrder(null), null, 'null ＝沒指定')
  assert.equal(normalizeOrder(NaN), null, 'NaN 不合法')
  assert.equal(normalizeOrder(ORDER_LIMITS.max + 1), null, '超出上限不合法')
  assert.equal(normalizeOrder(ORDER_LIMITS.max), ORDER_LIMITS.max, '上下限本身合法')

  /**
   * ② **鍵的規則是 `uid` 優先**（沒有 `uid` 才用 `#<索引>`）。
   *
   * ⚠️ 這一條重要是因為**用索引當鍵會安靜地錯**：書裡插一條，整份覆寫就位移到
   * 別的條目上——使用者只會覺得「我設定的順序自己跑了」。`uid` 是 ST 給條目的
   * 識別碼，改內容、改關鍵字都不會動到它。
   */
  assert.equal(entryKeyOf({ uid: 7, content: 'x' }, 3), '7', '有 uid 就用 uid（不是索引）')
  assert.equal(entryKeyOf({ uid: 0 }, 5), '0', '⚠️ uid 0 也是有效的（看型別，不是看 truthy）')
  assert.equal(entryKeyOf({ content: 'x' }, 3), '#3', '沒有 uid 才退回索引')
  assert.equal(entryKeyOf({ uid: 'nope' }, 2), '#2', 'uid 不是整數 ⇒ 當作沒有')
  assert.equal(entryKeyOf({ uid: 1.5 }, 2), '#2', 'uid 是小數 ⇒ 當作沒有')
  assert.equal(entryKeyOf(null, 4), '#4', '壞條目也不丟錯')

  // ③ `orderOf`：這一間房的覆寫 → 書自己的 → 100。
  const entry = { uid: 0, order: 200, content: 'x' }
  assert.equal(orderOf(entry, 0, undefined, 'A'), 200, '沒有覆寫 ⇒ 書自己的')
  assert.equal(orderOf(entry, 0, { A: { 0: { order: 900 } } }, 'A'), 900, '房間的覆寫贏')
  assert.equal(orderOf(entry, 0, { A: { 0: { order: 0 } } }, 'A'), 0, '⚠️ 覆寫成 0 是有效的（不是「沒指定」）')
  assert.equal(orderOf({ uid: 0, content: 'x' }, 0, undefined, 'A'), 100, '書沒有 order ⇒ ST 的預設 100')
  assert.equal(orderOf(entry, 0, { B: { 0: { order: 900 } } }, 'A'), 200, '別本書的覆寫不關它的事')
  assert.equal(orderOf(entry, 0, { A: { 1: { order: 900 } } }, 'A'), 200, '別條的覆寫不關它的事')
  assert.equal(orderOf(entry, 0, { A: { 0: { order: 1.5 } } }, 'A'), 200, '壞覆寫當作沒有（不丟錯）')
  assert.equal(entryOverridesOf({ A: { 0: { order: 1 } } }, 'A')['0'].order, 1, '取某一本書那一包')
  assert.deepEqual(entryOverridesOf(null, 'A'), {}, '壞輸入回空物件')

  /**
   * ④ **排序真的照覆寫走**（功能本體）。
   *
   * 同一本書裡兩條：`order` 100 與 900。房間把 100 那一條調到 950 ⇒ 它要排前面。
   */
  const book = {
    id: '酒館',
    data: {
      entries: {
        0: { uid: 0, comment: '普通', content: '普通條目', order: 100, constant: true },
        1: { uid: 1, comment: '重要', content: '重要條目', order: 900, constant: true },
      },
    },
  }
  const plain = collectLore([book], '', {})
  assert.deepEqual(plain.entries.map((one) => one.content), ['重要條目', '普通條目'], '沒覆寫 ⇒ 照書自己的 order')
  assert.deepEqual(plain.entries.map((one) => one.key), ['1', '0'], '每一條要帶著它的鍵（房間那一頁靠它送 patch）')
  assert.deepEqual(plain.entries.map((one) => one.ownOrder), [900, 100], '`ownOrder` 是**書自己的**（還原要用它）')

  const overridden = collectLore([book], '', { entryOverrides: { 酒館: { 0: { order: 950 } } } })
  assert.deepEqual(
    overridden.entries.map((one) => one.content),
    ['普通條目', '重要條目'],
    '⚠️ 這一間房把 uid 0 調到 950 ⇒ 它排到 900 前面（房間的覆寫真的傳到排序）',
  )
  assert.deepEqual(overridden.entries.map((one) => one.order), [950, 900], '`order` 是算完的')
  assert.deepEqual(overridden.entries.map((one) => one.ownOrder), [100, 900], '⚠️ `ownOrder` 仍然是書自己的值')

  /**
   * ⑤ **它不改書**（最重要的那一條）：`collectLore` 不可以動到傳進來的物件。
   *
   * ⚠️ 書的檔案由 `workspace.js` 負責（房間這條路根本不會寫 `worldbooks/`），
   * 但**這裡也不可以改到呼叫端手上那一份**：`readWorldbooks()` 有 mtime 快取，
   * 改到它就會污染下一個房間。
   */
  const frozen = JSON.stringify(book)
  collectLore([book], '', { entryOverrides: { 酒館: { 0: { order: 950 } } } })
  assert.equal(JSON.stringify(book), frozen, '⚠️ 排完之後那一本書要一字不差（快取共用同一個物件）')

  /**
   * ⑥ **預算是先到先得**——所以調高 `order` 就是「這一條先吃預算」。
   *    這是使用者調這一格時真正的代價，要用測試寫出來。
   */
  const budgeted = collectLore([book], '', {
    entryOverrides: { 酒館: { 0: { order: 950 } } },
    budgetChars: 5,
  })
  assert.deepEqual(budgeted.entries.map((one) => one.content), ['普通條目'], '排前面的先吃到預算')
  assert.equal(budgeted.truncated, true, '被擠掉的那一條要回報 truncated')

  /**
   * ⑦ **`order` 相同的決勝仍然是 uid 遞增**（可重現）——這一條是「既有酒館
   * 一行都不變」的保證：沒有覆寫時排序鍵與 2.6.69 一字不差。
   */
  const tieBooks = [
    {
      id: 'A',
      data: {
        entries: {
          0: { uid: 0, content: 'a0', order: 100, constant: true },
          1: { uid: 1, content: 'a1', order: 300, constant: true },
        },
      },
    },
    { id: 'B', data: { entries: { 0: { uid: 0, content: 'b0', order: 300, constant: true } } } },
  ]
  const tie = collectLore(tieBooks, '', {})
  assert.deepEqual(
    tie.entries.map((one) => one.content),
    ['b0', 'a1', 'a0'],
    '⚠️ 同 order ⇒ **uid 遞增（跨書也比）**——b0 與 a1 都是 300，b0 的 uid 是 0 所以在前',
  )
  // 房間把 A 的 uid 0 調到 300 ⇒ 三條同 order，仍然照 uid 排（可重現）。
  const tie2 = collectLore(tieBooks, '', { entryOverrides: { A: { 0: { order: 300 } } } })
  assert.deepEqual(
    tie2.entries.map((one) => one.content),
    ['a0', 'b0', 'a1'],
    '同 order 的三條照 uid 遞增（a0 與 b0 的 uid 都是 0 ⇒ a0 在前，因為 A 在 B 前面）',
  )

  // ⑧ 房間關掉一本書 ＋ 條目覆寫可以同時存在（兩者走不同的鍵，互不干擾）。
  const offed = collectLore([book], '', {
    bookOverrides: { 酒館: { enabled: false } },
    entryOverrides: { 酒館: { 0: { order: 950 } } },
  })
  assert.deepEqual(offed.entries, [], '關掉的書整本不進去（覆寫再高也一樣）')

  console.log('4b. 條目優先序 OK — uid 當鍵／房間覆寫贏過書自己的／不改書／先吃預算／可重現')
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

  console.log('6. 注入 OK — 接在最新一則、保留 id/role/source、不改原陣列')
}

/* --------------------------- 注入位置（2.6.59）--------------------------- */

{
  /**
   * ⚠️ **這一節推翻了一份舊的判斷**：`docs/worldbook-plan.md` 第 131 行寫著
   * 「DSH 只給使用者訊息一個槓桿，所以 ST 的八種位置我們只有一種」。
   * 那**只對一半**——`ctx.systemPrompt.variable()` 的取值函式每一輪都重跑
   * （2.6.47 的 live-reload 就是靠它），所以系統提示是第二個槓桿。
   *
   * 三個位置的優先序：**這本書自己 → 酒館預設 → `in-chat`**。
   * ⚠️ 最後那一個**必須是 `in-chat`**：那是 2.6.58 以前的行為，
   * 所以「沒設定」的既有酒館一個字都不變。
   */
  assert.deepEqual(WORLDBOOK_POSITIONS, ['system-before', 'system-after', 'in-chat'], '三個位置')
  for (const one of WORLDBOOK_POSITIONS) {
    assert.equal(typeof WORLDBOOK_POSITION_INFO[one].label, 'string', `${one} 要有人話標籤`)
    assert.equal(typeof WORLDBOOK_POSITION_INFO[one].hint, 'string', `${one} 要有說明`)
  }

  // 書自己指定 ⇒ 蓋過房間與酒館。
  assert.equal(positionOf({ position: 'system-after' }, 'system-before'), 'system-after', '書自己指定優先')
  // ⚠️ **書沒指定 ⇒ 先問房間那一層**（2.6.62 加的）。
  assert.equal(
    positionOf({ entries: {} }, 'system-after', 'system-before'),
    'system-after',
    '⚠️ 房間蓋過酒館（由窄到寬：書 → 房 → 酒館）',
  )
  // 房間也沒指定 ⇒ 才輪到酒館。
  assert.equal(positionOf({ entries: {} }, '', 'system-before'), 'system-before', '房間沒指定才用酒館')
  assert.equal(positionOf({ entries: {} }, null, 'system-before'), 'system-before', '房間的 null ＝ 聽酒館的')
  // 兩層都沒有 ⇒ **in-chat**（＝與以前一字不差）。
  assert.equal(positionOf({ entries: {} }, '', ''), 'in-chat', '⚠️ 預設必須是 in-chat（舊行為）')
  assert.equal(positionOf(null, undefined, undefined), 'in-chat', '壞輸入也一樣')

  // ST 的數字要接得住（匯入的書帶著它們）。
  assert.equal(positionOf({ position: 0 }, ''), 'system-before', 'ST 0 ＝ 角色定義前')
  assert.equal(positionOf({ position: 1 }, ''), 'system-after', 'ST 1 ＝ 角色定義後')
  for (const value of [2, 3, 4, 5, 6, 7]) {
    assert.equal(positionOf({ position: value }, ''), 'in-chat', `ST ${value}（對話中第 N 層）⇒ 我們只有尾巴`)
  }
  // ST 的數字**蓋不過酒館預設**嗎？——蓋得過（它就是「這本書自己指定」）。
  assert.equal(positionOf({ position: 4 }, 'system-after'), 'in-chat', '⚠️ ST 的 4 是明確的 in-chat，不是「沒指定」')
  // 胡說八道的位置名 ⇒ 當作沒指定（往下退），不是當成 in-chat 蓋掉預設。
  for (const junk of ['nope', 42, {}, [], true]) {
    assert.equal(normalizePosition(junk), '', `${JSON.stringify(junk)} 不合法`)
    assert.equal(positionOf({ position: junk }, 'system-after'), 'system-after', `${JSON.stringify(junk)} ⇒ 退回酒館預設`)
  }

  // `collectLore` 把位置**掛在挑中的條目上**（給後面的分堆用）。
  const books = [
    { id: '格式', data: { position: 'system-after', entries: { 0: { uid: 0, content: 'SPEC', constant: true } } } },
    { id: '酒館', data: { entries: { 0: { uid: 0, content: 'LORE', constant: true } } } },
    { id: '關鍵字', data: { position: 'system-before', entries: { 0: { uid: 0, key: ['龍'], content: 'DRAGON', constant: false } } } },
  ]
  const lore = collectLore(books, '這裡有一條龍', { defaultPosition: 'in-chat' })
  const byContent = {}
  for (const one of lore.entries) byContent[one.content] = one.position
  assert.equal(byContent.SPEC, 'system-after', '書自己的位置要跟著條目走')
  assert.equal(byContent.LORE, 'in-chat', '沒指定的跟酒館預設走')
  assert.equal(byContent.DRAGON, 'system-before', '關鍵字命中的也一樣')

  // ⚠️ **房間那一層真的會蓋過酒館**（`roomPosition`）。
  const roomLore = collectLore(books, '這裡有一條龍', { defaultPosition: 'in-chat', roomPosition: 'system-after' })
  const byRoom = {}
  for (const one of roomLore.entries) byRoom[one.content] = one.position
  assert.equal(byRoom.LORE, 'system-after', '⚠️ 房間蓋過酒館（酒館說 in-chat）')
  assert.equal(byRoom.SPEC, 'system-after', '書自己指定的優先序不變（它本來就是 system-after）')
  assert.equal(byRoom.DRAGON, 'system-before', '書自己指定也仍然最優先')

  // 分堆：三堆都在，而且**排序在切開之後仍然成立**（order 由大到小）。
  const grouped = groupByPosition(lore.entries)
  assert.deepEqual(Object.keys(grouped).sort(), ['in-chat', 'system-after', 'system-before'], '三堆')
  assert.deepEqual(grouped['system-after'].map((one) => one.content), ['SPEC'])
  assert.deepEqual(grouped['system-before'].map((one) => one.content), ['DRAGON'])
  assert.deepEqual(grouped['in-chat'].map((one) => one.content), ['LORE'])
  // 壞輸入不可以丟錯。
  assert.deepEqual(groupByPosition(null), { 'system-before': [], 'system-after': [], 'in-chat': [] }, 'null 不炸')
  assert.equal(groupByPosition([{ content: 'x' }])['in-chat'].length, 1, '沒有 position 的條目落到 in-chat')
  assert.equal(textOfEntries(grouped['system-after']), 'SPEC', '接回文字')
  assert.equal(textOfEntries(null), '', 'null 回空字串')

  console.log('7. 注入位置 OK — 房（指定那一本）→書→房預設→酒館→in-chat、ST 的數字接得住、分三堆、排序不變')
}

/* ------------------- 房間對「個別世界書」的覆寫（2.6.64）------------------- */

{
  /**
   * 使用者：「房間也要世界書管理頁面，酒館的是預設所有房間都會是預設，
   * 房間的時候其微調可以自己在整理兩層，所以要加一個新標籤」。
   *
   * ⚠️ 覆寫的粒度是**一本書**（不是一條條目）：條目是**書的內容**，
   * 而房間要調的是「這一場要不要用它、把它放在哪」。
   */
  const a = { id: 'A', data: { entries: { 0: { uid: 0, content: 'A-LORE', constant: true } } } }
  const b = { id: 'B', data: { entries: { 0: { uid: 0, content: 'B-LORE', constant: true } } } }
  const ids = (list) => list.entries.map((one) => one.content).sort()

  // ① 沒有覆寫 ⇒ 兩本都在，而且**使用者的書一個欄位都沒被動到**。
  const plain = collectLore([a, b], '', { defaultPosition: 'in-chat' })
  assert.deepEqual(ids(plain), ['A-LORE', 'B-LORE'], '沒有覆寫時兩本都在')
  assert.equal(a.data.position, undefined, '⚠️ 覆寫不可以改到使用者的書')
  assert.equal(a.data.positionOverride, undefined, '⚠️ 也不可以把影子欄位留在原物件上')

  // ② 關掉一本 ⇒ 它整本不出現（另一本不受影響）。
  const off = collectLore([a, b], '', { defaultPosition: 'in-chat', bookOverrides: { B: { enabled: false } } })
  assert.deepEqual(ids(off), ['A-LORE'], '⚠️ 房間關掉的那一本不該出現')

  // ③ 指定一本的位置 ⇒ 那一本換位置，別本照舊。
  const moved = collectLore([a, b], '', {
    defaultPosition: 'in-chat',
    bookOverrides: { B: { position: 'system-after' } },
  })
  assert.equal(moved.entries.find((one) => one.content === 'B-LORE').position, 'system-after', 'B 要換位置')
  assert.equal(moved.entries.find((one) => one.content === 'A-LORE').position, 'in-chat', 'A 照舊')

  /**
   * ④ ⚠️ **房間指定的位置贏過書自己的**（2.6.69 改的）。
   *
   * 2.6.64–2.6.68 的順序是相反的（書贏），結果是**書自己指定過的那一本，
   * 房間怎麼選都不會生效**——那一格能改卻改不動，只好在 UI 上鎖起來。
   * 使用者要的是「房間可以設定位置」，所以房間那一層排到最前面。
   *
   * ⚠️ 注意這**只影響「這一間房真的指定了這一本」**的情況：
   * 沒有那一筆覆寫時，書自己的值照樣贏過房間與酒館的**預設**（下面 ⑤ 驗）。
   */
  const fixed = {
    id: 'C',
    data: { position: 'system-before', entries: { 0: { uid: 0, content: 'C-LORE', constant: true } } },
  }
  const roomTried = collectLore([fixed], '', {
    defaultPosition: 'in-chat',
    bookOverrides: { C: { position: 'system-after' } },
  })
  assert.equal(
    roomTried.entries[0].position,
    'system-after',
    '⚠️ 房間指定的位置**贏過**書自己的（房間是更窄、更晚決定的那一層）',
  )
  // 但房間還是可以**關掉**它（那是不同的軸：要不要用 vs 放在哪）。
  assert.equal(
    collectLore([fixed], '', { defaultPosition: 'in-chat', bookOverrides: { C: { enabled: false } } }).entries.length,
    0,
    '房間仍然可以關掉一本「自己指定了位置」的書',
  )

  // ⑤ 房間**沒有**指定那一本時，書自己的值照樣贏過「這一間房的預設」與酒館的預設。
  const bookWins = collectLore([fixed], '', {
    defaultPosition: 'in-chat',
    roomPosition: 'system-after',
    bookOverrides: { 別的書: { position: 'system-after' } },
  })
  assert.equal(bookWins.entries[0].position, 'system-before', '⚠️ 房間沒指定的話，書自己的還是贏過那些「預設」')

  // ⑤ 壞覆寫不可以丟錯，也不可以讓書整本消失。
  for (const junk of [null, 'x', 7, [], { A: 'x' }, { A: null }, { 不存在的書: { enabled: false } }]) {
    const out = collectLore([a, b], '', { defaultPosition: 'in-chat', bookOverrides: junk })
    assert.equal(out.entries.length >= 1, true, `${JSON.stringify(junk)} 不可以讓所有書消失`)
  }

  console.log('8. 房間的逐書覆寫 OK — 關掉一本、指定位置（贏過書自己）、沒指定時書自己仍贏過預設、壞覆寫不丟錯')
}

/* ----------------------------- 跟 default 對齊 ---------------------------- */

{
  // 預設值是文件承諾的一部分，改動它要有意識。
  assert.equal(DEFAULT_BUDGET_CHARS, 6000, '預設預算改了要一起改文件')
  assert.equal(SELECTIVE_LOGIC.AND_ANY, 0, '跟 SillyTavern 的常數對齊')
  assert.equal(SELECTIVE_LOGIC.NOT_ALL, 1)
  assert.equal(SELECTIVE_LOGIC.NOT_ANY, 2)
  assert.equal(SELECTIVE_LOGIC.AND_ALL, 3)
  console.log('9. 常數 OK — 預設預算與 selectiveLogic 都跟 ST 對齊')
}

console.log('\n全部通過 ✅')
