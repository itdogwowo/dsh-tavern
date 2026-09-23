/**
 * `lib/render.js` 的測試：回覆格式的**指定**那一半。
 *
 * 為什麼這一支值得一個獨立的測試檔：
 *
 *   1. 它是**純函式**（沒有 import、沒有檔案系統），所以沒有任何藉口只靠整合測試碰它。
 *   2. 它產出的是**提示詞**。提示詞錯了不會丟錯、不會變紅——它只會讓模型照著
 *      錯誤的格式寫，而症狀是「畫面怪怪的」。這種東西只能靠斷言釘住。
 *   3. 它有**兩份鏡射**要守住：`RENDER_KINDS` ↔ `client.js` 的 `PARSE_KINDS`、
 *      `parseChoices`／`progressOf` ↔ `client.js` 的同名函式。
 *      這個 repo 對鏡射的既定做法就是「拿兩邊對照」（見 `plan.md` §7.9 的色票）。
 *
 * 用法：node test-render.mjs
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

import {
  DEFAULT_MARKERS,
  RENDER_KINDS,
  RENDER_LIMITS,
  RENDER_MODES,
  defaultRender,
  formatSpecEntries,
  looksLikeFormatSpec,
  normalizeRender,
  parseChoices,
  parseConfigFromRender,
  progressOf,
  renderDirective,
} from './lib/render.js'

const { TAVERN_BUILD } = await import('./lib/index.js')
const manifest = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'))
assert.equal(TAVERN_BUILD, 'tavern-' + manifest.version, '版本標記要對得上 package.json')
console.log('1. 匯出 OK —', TAVERN_BUILD)

/* ------------------------------- 預設值 ------------------------------- */

{
  /**
   * ⚠️ **預設必須是 `plain`，而且它是「一個字都不加」。**
   *
   * 這一條是「既有對話的行為一個字都不變」的實作方式。如果有人為了
   * 「一致性」把預設改成 `marked`，那所有既有使用者的提示詞會在他們
   * 不知情的情況下多出一段格式指令——而那會改變模型的寫法。
   */
  const { render } = normalizeRender(null)
  assert.equal(render.mode, 'plain', '⚠️ 預設模式是 plain（＝提示詞一個字都不加）')
  assert.equal(renderDirective(render), '', '⚠️ plain 模式的指令是**空字串**')
  assert.equal(render.choicesClickable, false, '`choices` 預設不能點（那是副作用）')
  assert.deepEqual(render.markers, DEFAULT_MARKERS, '預設標記組要完整')
  assert.equal(render.markers.length > 0, true, '預設要有標記（切到 marked 就馬上有東西）')

  // 壞輸入不可以丟錯（同 §7.4b 的型別教訓：壞輸入不該讓整個面板變死格）。
  for (const junk of [undefined, null, [], 'x', 7, true]) {
    const one = normalizeRender(junk)
    assert.equal(one.render.mode, 'plain', `${JSON.stringify(junk)} ⇒ 落回預設`)
    assert.deepEqual(one.dropped, [], `${JSON.stringify(junk)} 不是「使用者填壞了」，不該回報`)
  }

  console.log('2. 預設 OK — plain（零指令）、choices 不能點、壞輸入落回預設且不丟錯')
}

/* ------------------------------- 模式 ------------------------------- */

{
  assert.deepEqual(RENDER_MODES, ['plain', 'marked', 'structured'], '三個模式，plain 在第一個')

  // 壞的模式名 ⇒ **落回預設而且回報**（默默用預設會讓使用者以為自己改了）。
  const bad = normalizeRender({ mode: 'jsonl' })
  assert.equal(bad.render.mode, 'plain', '不認得的模式落回 plain')
  assert.equal(bad.dropped.length, 1, '要回報：' + JSON.stringify(bad.dropped))
  assert.match(bad.dropped[0], /mode/, '要指出是 mode 這一欄')

  // `null`／`''` 是「清除」＝回預設，**不是錯誤**。
  for (const empty of [null, '']) {
    const one = normalizeRender({ mode: empty })
    assert.equal(one.render.mode, 'plain', `${JSON.stringify(empty)} ⇒ 回預設`)
    assert.deepEqual(one.dropped, [], `${JSON.stringify(empty)} 是清除，不是錯誤`)
  }

  console.log('3. 模式 OK — 三種、壞值落回預設且回報、null／空字串＝清除')
}

/* --------------------------- 指令的文字 --------------------------- */

{
  const plain = renderDirective(normalizeRender({ mode: 'plain' }).render)
  assert.equal(plain, '', '⚠️ plain 一個字都不加')

  const structured = renderDirective(normalizeRender({ mode: 'structured' }).render)
  // 指令要教會模型**四件它非得知道的事**，少一件就會走樣：
  //   一行一個物件、kind 的清單、不要包陣列、不要包程式碼區塊。
  assert.match(structured, /一行一個 JSON 物件/, '要講「一行一個」')
  for (const kind of ['speech', 'narration', 'action', 'thought']) {
    assert.ok(structured.includes(kind), `要講到 kind「${kind}」：${structured.slice(0, 120)}`)
  }
  assert.match(structured, /不要包成陣列/, '要明確禁止大陣列（那是修復成本最高的形狀）')
  assert.match(structured, /不要加 markdown/, '要明確禁止程式碼區塊（模型很愛加）')
  assert.match(structured, /"kind":"choices"/, '要教 choices 那一行怎麼寫')
  assert.match(structured, /"kind":"data"/, '要教 data 那一行怎麼寫')

  const marked = renderDirective(normalizeRender({ mode: 'marked' }).render)
  assert.match(marked, /<台詞>/, 'marked 要把標記列出來')
  assert.match(marked, /標記要成對/, '要講「成對」（那是 fatal 的那一種走樣）')

  /**
   * ⚠️ **宣告了 marked 卻一個標記都沒有 ⇒ 不要加指令。**
   * 加一段「請用下列標記：」後面什麼都沒有，比不加更糟。
   */
  assert.equal(
    renderDirective(normalizeRender({ mode: 'marked', markers: [] }).render),
    '',
    '⚠️ marked ＋ 零標記 ⇒ 回空字串（不要送一段空殼指令）',
  )

  // 指令的長度是**每一輪都要付的成本**，所以給它一個上限當煞車。
  // 這個數字不是真理，是「長到這個程度就該想想是不是在教它寫小說」。
  assert.ok(structured.length < 1600, `指令不該失控（現在 ${structured.length} 字）`)
  assert.ok(marked.length < 1200, `標記指令也一樣（現在 ${marked.length} 字）`)

  console.log(`4. 指令 OK — plain 是空的、structured ${structured.length} 字、marked ${marked.length} 字`)
}

/* ------------------------------ 標記的驗證 ------------------------------ */

{
  const good = normalizeRender({
    mode: 'marked',
    markers: [
      { tag: '台詞', kind: 'speech', who: '我' },
      { tag: 'scene', kind: 'narration' },
    ],
  })
  assert.equal(good.render.markers.length, 2, '合法的標記要收下來')
  assert.equal(good.render.markers[0].who, '我', 'who 要留著（那是語音選聲音用的）')
  assert.equal(good.render.markers[1].who, '', '沒給 who 就是空字串')

  // 每一種壞法都要擋，而且**講得出哪裡壞**（不然使用者只能瞎猜）。
  const cases = [
    [{ tag: '', kind: 'speech' }, /tag/],
    [{ tag: '有 空白', kind: 'speech' }, /空白/],
    [{ tag: 'a<b', kind: 'speech' }, /空白或/],
    [{ tag: 'x'.repeat(RENDER_LIMITS.tag + 1), kind: 'speech' }, new RegExp(String(RENDER_LIMITS.tag))],
    [{ tag: 'x', kind: 'speach' }, /kind/],
    [{ tag: 'x' }, /kind/],
    [{ tag: 'x', kind: 'speech', who: 7 }, /who/],
    ['不是物件', /物件/],
  ]
  for (const [one, pattern] of cases) {
    const out = normalizeRender({ markers: [one] })
    assert.equal(out.dropped.length, 1, `${JSON.stringify(one)} 要被擋下：${JSON.stringify(out.dropped)}`)
    assert.match(out.dropped[0], pattern, `${JSON.stringify(one)} 的訊息要說出原因`)
    assert.deepEqual(out.render.markers, DEFAULT_MARKERS, '⚠️ 整組落回預設，不是留著一半')
  }

  // 太多標記也擋（可用性：模型記不住）。
  const tooMany = normalizeRender({
    markers: Array.from({ length: RENDER_LIMITS.markers + 1 }, (_, i) => ({ tag: `t${i}`, kind: 'narration' })),
  })
  assert.equal(tooMany.dropped.length, 1, '超過數量上限要擋')
  assert.match(tooMany.dropped[0], new RegExp(String(RENDER_LIMITS.markers)))

  // ⚠️ 同一個 tag 宣告兩次 ⇒ **後面的贏**（不這樣做的話解析器拿兩份規格，
  //    而第一個命中永遠勝出——症狀是「改了 kind，沒反應」）。
  const twice = normalizeRender({
    markers: [
      { tag: '台詞', kind: 'narration' },
      { tag: '台詞', kind: 'speech' },
    ],
  })
  assert.equal(twice.render.markers.length, 1, '同名的只留一個')
  assert.equal(twice.render.markers[0].kind, 'speech', '⚠️ 後面的贏')

  // `markers: []` 是**合法**的，而且有明確的意思（這個模式沒有標記）。
  const none = normalizeRender({ markers: [] })
  assert.deepEqual(none.render.markers, [], '空陣列是合法的（＝不宣告）')
  assert.deepEqual(none.dropped, [], '空陣列不是錯誤')

  console.log('5. 標記 OK — 每一種壞法都擋下且說得出原因、同名後者勝、空陣列合法')
}

/* --------------------------- 引號與括號 --------------------------- */

{
  const custom = normalizeRender({ quotes: [['《', '》']], parens: [['【', '】']] })
  assert.deepEqual(custom.render.quotes, [['《', '》']], '自訂引號要收下來')
  assert.deepEqual(custom.render.parens, [['【', '】']], '自訂括號要收下來')

  const cases = [
    [['x'], /一對/],
    [['', '」'], /空的/],
    [['「', '「'], /一樣/],
    [[7, '」'], /文字/],
  ]
  for (const [one, pattern] of cases) {
    const out = normalizeRender({ quotes: [one] })
    assert.equal(out.dropped.length, 1, `${JSON.stringify(one)} 要被擋下`)
    assert.match(out.dropped[0], pattern, `${JSON.stringify(one)} 要說出原因：${out.dropped[0]}`)
  }

  console.log('6. 引號／括號 OK — 自訂收得下來、不成對／空／相同字元都擋')
}

/* ------------------------ 解析設定（給 parseMessage）------------------------ */

{
  /**
   * ⚠️ **只有 `marked` 模式才把標記交給解析器。** 這一條是這一節的重點：
   *
   * 模型在 `structured` 模式裡如果真的吐了 `<台詞>`，那代表它**走樣了**
   * ——我們應該看見那些角括號（`unknown-tag` 也會回報它），不是默默畫成台詞。
   * 反過來，`marked` 模式下的引號／括號推斷**照樣留著**（它是安全網，§1）。
   */
  const markers = [{ tag: '台詞', kind: 'speech', who: '' }]
  assert.deepEqual(parseConfigFromRender({ mode: 'marked', markers }).markers, markers, 'marked ⇒ 有標記')
  assert.deepEqual(parseConfigFromRender({ mode: 'plain', markers }).markers, [], 'plain ⇒ 沒有標記')
  assert.deepEqual(parseConfigFromRender({ mode: 'structured', markers }).markers, [], 'structured ⇒ 沒有標記')

  // 引號／括號**三種模式都有**（那是排版慣例，不是格式指令）。
  for (const mode of RENDER_MODES) {
    const cfg = parseConfigFromRender({ mode, quotes: [['《', '》']], parens: [['【', '】']] })
    assert.deepEqual(cfg.quotes, [['《', '》']], `${mode} 也要有引號`)
    assert.deepEqual(cfg.parens, [['【', '】']], `${mode} 也要有括號`)
  }

  // 壞輸入不可以丟錯，而且 `defaultWho` 要原樣傳下去（那是「誰說的」的預設值）。
  assert.equal(parseConfigFromRender(null, '老闆娘').defaultWho, '老闆娘', 'defaultWho 要傳下去')
  assert.equal(parseConfigFromRender(undefined, undefined).defaultWho, '', '沒給就是空字串')
  assert.equal(parseConfigFromRender(null).markers.length, 0, 'null 也不能丟錯')
  // 不認得的模式 ⇒ 當 plain（**安全**的那一邊：不啟用標記）。
  assert.deepEqual(parseConfigFromRender({ mode: 'nope', markers }).markers, [], '不認得的模式 ⇒ 當 plain')

  // `choicesClickable` 只有**真的是 true** 才算（字串 "true" 不算）。
  assert.equal(parseConfigFromRender({ choicesClickable: true }).choicesClickable, true, 'true 才算')
  assert.equal(parseConfigFromRender({ choicesClickable: 'true' }).choicesClickable, false, '字串不算')
  assert.equal(parseConfigFromRender(null).choicesClickable, false, '預設 false')

  console.log('7. 解析設定 OK — ⚠️ 只有 marked 給標記、引號三種模式都有、壞輸入不丟錯')
}

/* ------------------------------ 可選項 ------------------------------ */

{
  // 一行一個（最常見）。
  assert.deepEqual(parseChoices('去酒窖\n留下來'), ['去酒窖', '留下來'], '一行一個')
  // 模型很愛加的項目符號與編號——只去開頭那一小段。
  assert.deepEqual(parseChoices('- 去酒窖\n* 留下來\n1. 問她'), ['去酒窖', '留下來', '問她'], '去項目符號與編號')
  assert.deepEqual(parseChoices('1、去酒窖\n2) 留下來'), ['去酒窖', '留下來'], '編號的兩種寫法都去')
  // ⚠️ **刻意不切逗號**：中文的選項裡有逗號是常態。
  assert.deepEqual(
    parseChoices('去酒窖，順便拿燈'),
    ['去酒窖，順便拿燈'],
    '⚠️ 不切逗號（切了會把一個選項變成兩個）',
  )
  // 空行與重複。
  assert.deepEqual(parseChoices('A\n\n\nA\nB'), ['A', 'B'], '空行跳過、完全相同的去重')
  assert.deepEqual(parseChoices(''), [], '空字串回空陣列')
  assert.deepEqual(parseChoices(null), [], 'null 不炸')
  // 只有項目符號沒有內容 ⇒ 不是選項。
  assert.deepEqual(parseChoices('- \n*  '), [], '只有符號不算選項')
  // 內部的空白要留著（那是內容）。
  assert.deepEqual(parseChoices('  去 酒 窖  '), ['去 酒 窖'], 'trim 頭尾，不動中間')

  console.log('8. 可選項 OK — 一行一個、去項目符號、不切逗號、去重、壞輸入不炸')
}

/* ------------------------------ 進度條 ------------------------------ */

{
  assert.deepEqual(progressOf('62%'), { percent: 62, label: '62%' }, '百分號')
  assert.deepEqual(progressOf('62 ％'), { percent: 62, label: '62 ％' }, '全形百分號也認')
  assert.deepEqual(progressOf('3/10'), { percent: 30, label: '3/10' }, '分數')
  assert.deepEqual(progressOf('3／10'), { percent: 30, label: '3／10' }, '全形斜線也認')
  assert.equal(progressOf('7/0'), null, '分母 0 ⇒ null')

  // 夾在 0～100（畫出一條超出框的條比不畫更糟）。
  assert.equal(progressOf('150%').percent, 100, '超過 100 夾到 100')
  assert.equal(progressOf('-20%').percent, 0, '負數夾到 0')

  /**
   * ⚠️ **猜錯比不畫更糟。** 這幾種都必須回 `null`：
   *   - 沒有單位的數字（我們不知道 62 滿分是 100 還是 1000）
   *   - 時間（`晚上 11:30` 有一個冒號，很容易被誤認成分數）
   *   - 一般文字
   */
  for (const value of ['62', '晚上 11:30', '11:30', '很好', '', '   ', '約 62%', '62 % 上下']) {
    assert.equal(progressOf(value), null, `「${value}」不該畫成進度條`)
  }
  assert.equal(progressOf(null), null, 'null 不炸')
  assert.equal(progressOf(undefined), null, 'undefined 不炸')

  console.log('9. 進度條 OK — 只認 % 與分數、夾在 0～100、沒有單位的一律不畫')
}

/* ------------------------------ 契約 ------------------------------ */

{
  /**
   * ⚠️ **`RENDER_KINDS` 是 `client.js` 的 `PARSE_KINDS` 的鏡射。**
   *
   * 兩邊走散的症狀是**安靜的**：宿主半放行一個客戶端不認得的 kind，
   * 於是那個標記在畫面上變成普通文字（而使用者以為自己設定成功了）。
   * 這一段就是拿兩邊對照——沒有它，改一邊不會有任何東西變紅。
   */
  const client = readFileSync(new URL('./lib/client.js', import.meta.url), 'utf8')
  const parsed = /var PARSE_KINDS = \[([^\]]*)\]/.exec(client)
  assert.ok(parsed !== null, '要在 client.js 找到 PARSE_KINDS（它是不是被改名了？）')
  const clientKinds = parsed[1]
    .split(',')
    .map((one) => one.trim().replace(/^'|'$/g, ''))
    .filter((one) => one !== '')
  assert.deepEqual(
    [...RENDER_KINDS].sort(),
    [...clientKinds].sort(),
    '⚠️ RENDER_KINDS 要等於客戶端的 PARSE_KINDS（改一邊就會紅）',
  )

  // 純模組：只准 import `node:` 與相對檔案（AGENTS.md 的零執行期依賴）。
  // 這一支目前**一個 import 都沒有**——加 import 時要守住同一條規矩。
  const source = readFileSync(new URL('./lib/render.js', import.meta.url), 'utf8')
  const imports = [...source.matchAll(/^\s*import\s[^\n]*from\s*'([^']+)'/gm)].map((m) => m[1])
  for (const spec of imports) {
    assert.ok(
      spec.startsWith('node:') || spec.startsWith('./') || spec.startsWith('../'),
      `零執行期依賴：不可以 import ${spec}`,
    )
  }

  // 設定檔名要是 `render.json`（`docs/reply-format.md` §9 定的名字）。
  const exported = await import('./lib/render.js')
  assert.equal(exported.RENDER_FILE, 'render.json', '設定檔就叫 render.json')

  // `defaultRender()` 是**純的**：呼叫兩次不會共享同一個陣列（不然改一份會動到另一份）。
  const a = defaultRender()
  const b = defaultRender()
  a.markers.push({ tag: 'x', kind: 'speech', who: '' })
  assert.equal(b.markers.length, DEFAULT_MARKERS.length, '兩次呼叫不可以共用同一個陣列')

  console.log('10. 契約 OK — RENDER_KINDS 與客戶端一致、零執行期依賴、檔名是 render.json')
}

/* --------------------- 「誰在教格式」的偵測（2.6.58）--------------------- */

{
  /**
   * ⚠️ **這一段的用途是「一個東西兩個來源」的警告**，不是功能。
   *
   * 格式指令可以有兩個老師：世界書（`constant` 條目，住在訊息裡）與
   * `render.json`（plugin 送進系統提示）。兩個同時開著就會給模型兩份規格
   * ——而使用者看到的是「有時候是表格、有時候是一行文字」。
   *
   * 偵測是**啟發式**，所以負向的案例（不可以誤判的那些）比正向的重要：
   * 一個愛亂叫的警告等於沒有警告。
   */
  assert.equal(looksLikeFormatSpec('{"kind":"speech","text":"…"}'), true, '有 "kind" ⇒ 命中')
  assert.equal(looksLikeFormatSpec('kind 只能用 speech、narration、action'), true, '列舉兩個以上 kind ⇒ 命中')
  assert.equal(
    looksLikeFormatSpec('一行一個 JSON 物件：speech（台詞）、narration（旁白）'),
    true,
    '教格式的散文也認得（沒有大括號但列舉了 kind）',
  )

  // 負向：這些都**不可以**命中（實測在使用者自己的《酒館》那本上驗過）。
  for (const text of [
    '她是個喜歡讀 JSON 設定檔的工程師。',
    '這間店的帳本用 Excel，不用 JSON。',
    '他說話很簡短，常常只回一個字。',
    '牆上掛著一幅畫，畫的是一行一行的字。',
    '',
    null,
    undefined,
  ]) {
    assert.equal(looksLikeFormatSpec(text), false, `「${String(text)}」不該被當成格式教學`)
  }

  // `formatSpecEntries`：兩種 entries 形狀（原生物件與 V2 陣列）都要吃。
  const nativeBook = {
    entries: {
      0: { comment: '輸出格式', content: 'kind 只能用 speech、narration', constant: true },
      1: { comment: '這間酒館', content: '有一道櫃檯、幾張桌子。', constant: true },
      2: { comment: '已經關掉的', content: '"kind" 什麼的', disable: true },
    },
  }
  assert.deepEqual(
    formatSpecEntries(nativeBook),
    ['輸出格式'],
    '⚠️ 只回命中且**沒有被關掉**的條目（`disable` 是使用者明確的決定）',
  )
  assert.deepEqual(
    formatSpecEntries({ entries: [{ name: '格式', content: '"kind"' }] }),
    ['格式'],
    'V2 的陣列形狀也要吃，而且沒有 comment 時用 name',
  )
  assert.deepEqual(formatSpecEntries({ entries: [] }), [], '空的回空陣列')
  assert.deepEqual(formatSpecEntries(null), [], 'null 不炸')
  assert.deepEqual(formatSpecEntries({}), [], '沒有 entries 也不炸')
  assert.deepEqual(
    formatSpecEntries({ entries: [{ content: '"kind"' }] }),
    ['（沒有標題）'],
    '連 name 都沒有時給一個看得懂的佔位字串',
  )

  console.log('11. 格式教學的偵測 OK — 正向命中、散文也認得、不誤判 JSON 一詞、disable 跳過')
}

console.log('\n全部通過 ✅')
