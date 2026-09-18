/**
 * Agent 面的測試。
 *
 * 這一面**不在 `dsh web` 的啟動路徑上**（它只在 preset 裡跑），所以它壞掉的
 * 後果比另外兩面輕——但它的測試反而更重要，因為：
 *
 *   1. 它每一次模型請求都會被執行，錯了就是「每一輪都錯」；
 *   2. 它會踩到一個**症狀極不明顯**的坑：卡片裡的 `{{char}}` 會讓 DSH 的
 *      `renderPrompt` 直接丟錯（見 §R6）。
 *
 * 用法：node test-agent.mjs
 */
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const { renderCard, readCard, apply, inject, AGENT_BUILD, __clearCache, resolveBinding, resolveCardFile } =
  await import('./lib/agent.js')

const NAME = 'tavern-agent-' + '2.5.1'
assert.equal(AGENT_BUILD, NAME, '版本標記要對得上 package.json')
console.log('1. 匯出 OK — build =', AGENT_BUILD)

/* ---------------------- 依賴宣告（R1 的 agent 面版本）---------------------- */

{
  // `systemPrompt` 對這一面是硬依賴：它的工作就是決定系統提示，沒有它就沒事做。
  assert.deepEqual(inject, ['systemPrompt'], 'agent 面只依賴 systemPrompt')
  console.log('2. 依賴宣告 OK — inject =', JSON.stringify(inject))
}

/* ------------------------------ 卡片 → 文字 ------------------------------ */

{
  const card = {
    name: '老闆娘',
    description: '三十歲，講話帶刺但心軟。',
    personality: '嘴硬',
    scenario: '酒館打烊前的半小時',
    system_prompt: '',
    mes_example: 'This is how 老闆娘 should talk\n<START>\n{{user}}: 今天有什麼酒？\n{{char}}: 自己看板子。',
    first_mes: '又是你。坐吧。',
  }
  const text = renderCard(card, '阿明')

  // 欄位順序照 SillyTavern 的 Prompt Manager 預設順序。
  assert.ok(text.includes('老闆娘'), '要有名字')
  assert.ok(text.includes('# 人設'), '要有人設段')
  assert.ok(text.includes('# 性格'), '要有性格段')
  assert.ok(text.includes('# 場景'), '要有場景段')
  assert.ok(text.includes('# 對話示範'), '要有對話示範段')
  assert.ok(text.includes('# 你對使用者說的第一句話'), '要有開場白段')
  const order = ['# 人設', '# 性格', '# 場景', '# 對話示範', '# 你對使用者說的第一句話']
  for (let i = 1; i < order.length; i += 1) {
    assert.ok(text.indexOf(order[i - 1]) < text.indexOf(order[i]), `順序：${order[i - 1]} 要在 ${order[i]} 之前`)
  }

  // ST 的 main prompt 是預設值，卡片有 system_prompt 就整段取代（不是附加）。
  assert.ok(text.startsWith("Write 老闆娘's next reply"), '沒有 system_prompt 時用 ST 的預設主提示')
  const withSystem = renderCard({ ...card, system_prompt: '只寫台詞。' }, '阿明')
  assert.ok(withSystem.startsWith('只寫台詞。'), '卡片的 system_prompt 要取代預設主提示')
  assert.equal(withSystem.includes("Write 老闆娘's next reply"), false, '取代不是附加')

  // {{char}} / {{user}} 要換掉。
  assert.equal(text.includes('{{char}}'), false, '{{char}} 要被換掉')
  assert.equal(text.includes('{{user}}'), false, '{{user}} 要被換掉')
  assert.ok(text.includes('阿明: 今天有什麼酒？'), '{{user}} 換成使用者名稱')
  assert.ok(text.includes('老闆娘: 自己看板子。'), '{{char}} 換成角色名')

  // 慣例性的說明行要被去掉（ST 也跳過第一行）。
  assert.equal(text.includes('This is how'), false, '示範對話的說明行不該送出去')

  console.log('3. 卡片轉換 OK — 欄位順序、主提示取代、巨集替換、示範行處理')
}

/* ------------------- R6：`{{}}` 陷阱與它的解法（最重要）------------------- */

{
  /**
   * 這一段模擬 `dsh-system-prompt` 的 `interpolate()` 行為。
   *
   * 為什麼要模擬而不是直接 import：`@deepseek-ai/dsh-system-prompt` 不在本專案的
   * node_modules 裡（它是 DSH 的套件）。這裡照著它的**文件化行為**寫一個最小版本：
   *   - 認不得的 `{{...}}` → **丟錯**
   *   - 沒有跳脫字面大括号的語法
   *   - **替換進去的值不會再被掃描一次**
   * （`lib/index.js:151-175`、`README.md:173`）
   */
  function interpolate(text, variables) {
    return text.replace(/\{\{([^{}]*)\}\}/g, (_match, name) => {
      if (Object.prototype.hasOwnProperty.call(variables, name) === false) {
        throw new Error(`unknown prompt variable ${name}`)
      }
      const value = variables[name]
      if (value === undefined) throw new Error(`undefined prompt variable ${name}`)
      return value // ← 不再掃描
    })
  }

  /**
   * ⚠️ 這裡要放**真實的卡片**，不是理想化的卡片。
   *
   * 我們只換掉 `{{char}}` 和 `{{user}}`——SillyTavern 的巨集幾十個，
   * 真實的卡裡一定還有別的（`{{persona}}`、`{{random}}`、`{{time}}`、
   * `{{getvar::x}}`…）。**那些會原樣留在文字裡**，而它們就是陷阱的來源。
   */
  const card = {
    name: '老闆娘',
    description: '{{char}} 是老闆娘，{{persona}} 是老主顧。今天的特價是 {{random}}。',
    first_mes: '{{char}} 抬頭看了 {{user}} 一眼。',
  }
  const cardText = renderCard(card, '阿明')

  // 先確認我們**沒有**換掉不認識的巨集——這是刻意的：認不得的東西留著讓使用者看見，
  // 比默默吃掉好，而且使用者才知道自己的卡用了我們還不支援的功能。
  assert.ok(cardText.includes('{{persona}}'), '不認識的巨集要原樣留著（誠實，不要默默吃掉）')
  assert.ok(cardText.includes('{{random}}'), '同上')
  assert.equal(cardText.includes('{{char}}'), false, '認識的巨集要被換掉')
  assert.equal(cardText.includes('{{user}}'), false, '認識的巨集要被換掉')

  // ① 陷阱：把卡片原文直接當 section 的文字 → 丟錯。
  //    （剩下的 {{persona}} / {{random}} 就是未爆彈——這就是為什麼不能直接放。）
  assert.throws(
    () => interpolate(cardText, {}),
    /unknown prompt variable/,
    'R6：卡片原文直接進 section 會炸',
  )

  // ② 解法：卡片放變數，section 只放參照 → 過關，而且結果就是卡片全文。
  const sectionText = '{{tavern_card}}'
  const rendered = interpolate(sectionText, { tavern_card: cardText })
  assert.equal(rendered, cardText, 'R6：透過變數間接之後，卡片全文原樣送達')
  // ⭐ 關鍵：卡片裡的 {{persona}} **不會**被再掃一次——不然上面那一行就會丟錯。
  //    也就是說「不認識的巨集」在變數裡是安全的，模型只會看到字面上的 {{persona}}。
  assert.ok(rendered.includes('{{persona}}'), '卡片裡的未支援巨集原樣到達模型，不會炸')

  console.log('4. R6 大括号陷阱 OK — 直接放會炸；走變數連未支援的巨集都安全')
}

/* --------------------------- 讀檔 ＋ mtime 快取 --------------------------- */

{
  const dir = mkdtempSync(join(tmpdir(), 'dsh-tavern-agent-'))
  const file = join(dir, 'card.json')
  __clearCache()

  // 讀不到 → 回空字串，**不丟錯**。
  // 理由：provider 每一輪都被呼叫；在這裡丟錯＝「卡片被搬走之後每一輪都失敗」，
  // 而且錯誤會以很難懂的形式冒出來。回空字串至少對話還能繼續。
  assert.equal(readCard(file, '阿明'), '', '檔案不存在時回空字串')
  assert.equal(readCard('', '阿明'), '', '路徑是空的也回空字串')
  assert.equal(readCard(null, '阿明'), '', '路徑不是字串也回空字串')

  // 正常讀取。
  writeFileSync(file, JSON.stringify({ spec: 'chara_card_v2', data: { name: '酒保', description: '沉默。' } }))
  utimesSync(file, new Date(1_700_000_000_000), new Date(1_700_000_000_000))
  const first = readCard(file, '阿明')
  assert.ok(first.includes('酒保'), '讀得到信封裡的卡片')

  // 快取命中：同樣的 mtime 再讀一次，拿到一樣的字串。
  assert.equal(readCard(file, '阿明'), first, 'mtime 沒變時回快取')

  // ⭐ 這是整個架構的關鍵保證：**改了檔案，下一次讀就要看到新內容**，
  //    不需要重開 session。mtime 變了就要重讀。
  writeFileSync(file, JSON.stringify({ name: '酒保', description: '其實很多話。' }))
  utimesSync(file, new Date(1_700_000_100_000), new Date(1_700_000_100_000))
  const second = readCard(file, '阿明')
  assert.notEqual(second, first, 'mtime 變了一定要重讀')
  assert.ok(second.includes('其實很多話'), '拿到的是新內容')

  // 壞掉的 JSON → 回空字串，而且**下一次 mtime 變了要能恢復**。
  writeFileSync(file, '{ 這不是 JSON')
  utimesSync(file, new Date(1_700_000_200_000), new Date(1_700_000_200_000))
  assert.equal(readCard(file, '阿明'), '', '壞檔回空字串而不是丟錯')
  writeFileSync(file, JSON.stringify({ name: '酒保', description: '回來了。' }))
  utimesSync(file, new Date(1_700_000_300_000), new Date(1_700_000_300_000))
  assert.ok(readCard(file, '阿明').includes('回來了'), '修好之後要能恢復')

  // 檔案被刪掉 → 回空字串，而且快取不留殘骸。
  rmSync(file)
  assert.equal(readCard(file, '阿明'), '', '檔案被刪掉之後回空字串')

  rmSync(dir, { recursive: true, force: true })
  console.log('5. 讀檔與快取 OK — 缺檔／壞檔不丟錯，mtime 一變就重讀（＝改卡片下一輪生效）')
}

/* ------------------------------ apply() 的接線 ---------------------------- */

{
  __clearCache()
  const seen = {
    variables: [],
    sections: [],
    suppressed: 0,
    effects: 0,
    injectDeps: null,
    restricted: [],
    events: [],
  }

  /** 最小的假 ctx：只記下我們註冊了什麼。 */
  function makeCtx(scope) {
    return {
      effect(fn, _label) {
        if (scope === undefined) seen.effects += 1
        return fn()
      },
      systemPrompt: {
        variable(name, provider) {
          seen.variables.push({ name, provider })
          return () => {}
        },
        section(section) {
          seen.sections.push(section)
          return () => {}
        },
        suppressRuntimeContext() {
          seen.suppressed += 1
          return () => {}
        },
      },
      inject(deps, callback) {
        seen.injectDeps = deps
        // 模擬 Cordis：服務到齊之後用「同一個 scope 的子 context」呼叫 callback。
        callback(makeScopedCtx())
        return { then: () => {} }
      },
      on(event, listener) {
        seen.events.push(event)
        return () => {}
      },
      tools: {
        schemas() {
          return [{ name: 'global_tool_a' }, { name: 'global_tool_b' }, { name: 'run_code' }]
        },
        restrict(filter) {
          seen.restricted.push(filter)
          return () => {}
        },
      },
    }
  }

  /** `ctx.inject(['tools'], cb)` 傳進去的 context。 */
  function makeScopedCtx() {
    return {
      effect(fn) {
        return fn()
      },
      tools: makeCtx('scoped').tools,
    }
  }

  apply(makeCtx(), { card: 'C:\\cards\\老闆娘.json', user: '阿明' })

  assert.equal(seen.variables.length, 1, '註冊一個變數')
  assert.equal(seen.variables[0].name, 'tavern_card', '變數名固定（section 要引用它）')
  assert.equal(typeof seen.variables[0].provider, 'function', '變數的值要是 provider（每次組裝時才算）')

  assert.equal(seen.sections.length, 1, '註冊一個 section')
  const section = seen.sections[0]
  assert.equal(section.name, 'tavern:card', 'section 名有命名空間')
  assert.equal(section.order, 0, '放在 persona prefix 的位置')
  assert.equal(section.text, '{{tavern_card}}', 'R6：section 只放變數參照，絕不放卡片原文')
  assert.equal(section.complete, true, '這一段要是全部的系統提示')
  // 只有一個大括号群組，而且就是我們的變數——多一個都會讓 renderPrompt 丟錯。
  assert.deepEqual(section.text.match(/\{\{[^{}]*\}\}/g), ['{{tavern_card}}'], 'section 只能有那一個參照')

  assert.equal(seen.suppressed, 1, '要關掉執行環境快照（沙箱／審批政策那些）')
  assert.equal(seen.effects, 3, '三個註冊都要包在 ctx.effect 裡（fiber 卸載時自動回收）')
  assert.deepEqual(seen.events, ['agent/pre-step'], 'R5：預設要掛世界書的 hook')

  // 卡片路徑讀不到時，變數 provider 要回空字串而不是丟錯。
  assert.equal(seen.variables[0].provider(), '', '路徑不存在時回空字串')

  console.log('6. apply() 接線 OK — 一個變數、一個 complete section、關掉 runtime context')
}

/* ---------------- 擋掉繼承來的全域工具（spike 實測發現的）---------------- */

{
  __clearCache()
  const calls = { injectDeps: null, restricted: [] }

  function toolsService() {
    return {
      schemas() {
        // 全域視圖：別人的工具 + PTC 的保留通道
        return [{ name: 'global_tool_a' }, { name: 'global_tool_b' }, { name: 'run_code' }]
      },
      restrict(filter) {
        calls.restricted.push(filter)
        return () => {}
      },
    }
  }

  const ctx = {
    effect: (fn) => fn(),
    systemPrompt: {
      variable: () => () => {},
      section: () => () => {},
      suppressRuntimeContext: () => () => {},
    },
    inject(deps, callback) {
      calls.injectDeps = deps
      callback({ effect: (fn) => fn(), tools: toolsService() })
      return { then: () => {} }
    },
    on: () => () => {},
  }

  apply(ctx, { card: '' })

  // 用 ctx.inject 而不是寫進 inject 陣列：這一條是可選的，不該拖垮核心功能。
  assert.deepEqual(calls.injectDeps, ['tools'], '要用 ctx.inject 等 tools（Cordis 的正規做法）')

  assert.equal(calls.restricted.length, 1, '應該呼叫一次 restrict')
  const filter = calls.restricted[0]
  assert.deepEqual(
    filter.deny,
    ['global_tool_a', 'global_tool_b'],
    '全域工具都要 deny，但**不可以**包含保留的 run_code（restrict 會拒收）',
  )
  assert.equal(filter.allow, undefined, '不該用 allow（那會連 scope 自己的工具都被濾掉）')

  // `denyGlobalTools: false` 時完全不碰工具（給「我就是要用那些工具」的人）。
  calls.restricted.length = 0
  calls.injectDeps = null
  apply(ctx, { card: '', denyGlobalTools: false })
  assert.equal(calls.injectDeps, null, 'denyGlobalTools: false 時不該去等 tools')
  assert.equal(calls.restricted.length, 0, '也不該 restrict')

  // 拿不到工具清單時（服務壞掉／回空）→ 什麼都不做，不要擋錯。
  calls.restricted.length = 0
  const emptyCtx = {
    ...ctx,
    inject(deps, callback) {
      callback({
        effect: (fn) => fn(),
        tools: { schemas: () => [], restrict: (f) => calls.restricted.push(f) },
      })
      return { then: () => {} }
    },
  }
  apply(emptyCtx, { card: '' })
  assert.equal(calls.restricted.length, 0, '沒有全域工具時不該呼叫 restrict（空篩選會丟錯）')

  console.log('7. 全域工具遮罩 OK — deny 繼承來的、避開 run_code、可關閉、空清單不呼叫')
}

/* ---------------- R3：從 Agent 找出「這個 session 是誰」 ---------------- */

{
  const dir = mkdtempSync(join(tmpdir(), 'dsh-tavern-bind-'))
  const root = join(dir, '酒館')
  const SID = 'session-11112222-3333-4444-5555-666677778888'

  // 造一個像樣的酒館資料夾
  mkdirSync(join(root, 'characters'), { recursive: true })
  mkdirSync(join(root, '.sessions'), { recursive: true })
  writeFileSync(
    join(root, 'characters', '酒保.json'),
    JSON.stringify({ name: '酒保', description: '話很少。' }),
  )
  writeFileSync(
    join(root, '.sessions', `${SID}.json`),
    JSON.stringify({ version: 1, sessionId: SID, character: '酒保', chat: '打烊後' }),
  )

  /** 造一個像 DSH 給我們的 agent（只有 id 與 session.header.cwd 是我們會讀的）。 */
  const agentFor = (sessionId, cwd) => ({ id: sessionId, session: { header: { cwd } } })

  // 正常情況：兩個資訊都拿得到 → 指到那張卡
  const bound = resolveCardFile(agentFor(SID, root), '')
  assert.equal(bound, join(root, 'characters', '酒保.json'), 'R3：綁定優先')
  __clearCache()
  assert.ok(readCard(bound, '阿明').includes('話很少'), '讀得到綁定的那張卡')

  // 沒綁定 → 退回 preset 的 card 設定
  assert.equal(
    resolveCardFile(agentFor('session-unknown', root), 'C:\\fallback.json'),
    'C:\\fallback.json',
    'R3：沒綁定時退回 preset 的 card',
  )
  // 連 cwd 都沒有 → 一樣退回
  assert.equal(
    resolveCardFile(agentFor(SID, ''), 'C:\\fallback.json'),
    'C:\\fallback.json',
    'R3：沒有 cwd 時退回 preset 的 card',
  )
  // 沒有 agent（診斷用的組裝）→ 退回，而且**不丟錯**
  assert.equal(resolveCardFile(undefined, 'C:\\fallback.json'), 'C:\\fallback.json', 'R11：沒有 agent 也不能丟錯')
  assert.equal(resolveCardFile(null, ''), '', '什麼都沒有時回空字串')
  assert.equal(resolveCardFile({}, ''), '', 'agent 是空物件時回空字串')

  // 綁定檔壞掉 → 當作沒綁定（回退），不是炸掉
  writeFileSync(join(root, '.sessions', `${SID}.json`), '{ 這不是 JSON')
  assert.equal(resolveBinding(agentFor(SID, root)), null, 'R11：壞掉的綁定檔回 null')
  assert.equal(resolveCardFile(agentFor(SID, root), 'C:\\fallback.json'), 'C:\\fallback.json')

  // 綁定檔裡的 character 型別不對 → 一樣當作沒綁定
  writeFileSync(join(root, '.sessions', `${SID}.json`), JSON.stringify({ character: 123 }))
  assert.equal(resolveBinding(agentFor(SID, root)), null, 'R11：character 不是字串時回 null')

  // 路徑跳脫：sessionId 直接變成檔名，所以 `../` 一定要走不出去
  assert.equal(resolveBinding(agentFor('../../tavern.json', root)), null, 'R3：路徑跳脫拿不到東西')

  rmSync(dir, { recursive: true, force: true })
  console.log('8. session 綁定 OK — 綁定優先、退回 preset、壞檔與跳脫都不丟錯')
}

/* ------------------- R5：世界書在 pre-step 被注入（接線）------------------- */

{
  __clearCache()
  const dir = mkdtempSync(join(tmpdir(), 'dsh-tavern-lore-'))
  const root = join(dir, '酒館')
  const SID = 'session-lore-0000-1111-2222-333344445555'

  mkdirSync(join(root, 'characters'), { recursive: true })
  mkdirSync(join(root, 'worldbooks'), { recursive: true })
  mkdirSync(join(root, '.sessions'), { recursive: true })
  writeFileSync(join(root, 'characters', '老闆娘.json'), JSON.stringify({ name: '老闆娘', description: '店主。' }))
  writeFileSync(
    join(root, '.sessions', `${SID}.json`),
    JSON.stringify({ sessionId: SID, character: '老闆娘', chat: '夜晚' }),
  )
  writeFileSync(
    join(root, 'worldbooks', '酒館.json'),
    JSON.stringify({
      entries: {
        '0': { uid: 0, constant: true, content: '【店規】晚上才開。', order: 100 },
        '1': { uid: 1, key: ['琴酒'], content: '【琴酒】櫃子最上層那瓶。', order: 200, selective: false },
        '2': { uid: 2, key: ['不存在的字'], content: '不該出現。', order: 300 },
      },
    }),
  )

  /** 收集 apply 註冊了哪些事件。 */
  const listeners = new Map()
  const ctx = {
    effect: (fn) => fn(),
    systemPrompt: {
      variable: () => () => {},
      section: () => () => {},
      suppressRuntimeContext: () => () => {},
    },
    inject: () => ({ then: () => {} }),
    on(event, listener) {
      listeners.set(event, listener)
      return () => {}
    },
  }

  apply(ctx, { card: '', user: '阿明' })
  assert.equal(listeners.has('agent/pre-step'), true, 'R5：要掛 agent/pre-step')
  const preStep = listeners.get('agent/pre-step')

  /** 造一個像 DSH 會給的 payload。 */
  const makePayload = (text) => ({
    agent: { id: SID, session: { header: { cwd: root } } },
    messages: [{ id: 'm1', role: 'user', content: [{ type: 'text', text }], source: { kind: 'user' } }],
    turn: 1,
    step: 1,
    signal: undefined,
  })
  const enterWith = (messages) => async () => ({ kind: 'enter', messages })

  // 命中關鍵字 → constant 那條也要一起進來
  const hit = await preStep(makePayload('今天有琴酒嗎？'), enterWith(makePayload('今天有琴酒嗎？').messages))
  assert.equal(hit.kind, 'enter')
  assert.equal(hit.messages[0].content.length, 2, '要插入一個文字區塊')
  const injected = hit.messages[0].content[0].text
  assert.ok(injected.includes('【琴酒】'), '命中的條目要注入')
  assert.ok(injected.includes('【店規】'), 'constant 的條目也要注入')
  assert.equal(injected.includes('不該出現'), false, '沒命中的不可以注入')
  assert.equal(hit.messages[0].content[1].text, '今天有琴酒嗎？', '使用者的話要在後面')

  // 都沒命中 → 只有 constant
  const mild = await preStep(makePayload('今天天氣不錯'), enterWith(makePayload('今天天氣不錯').messages))
  assert.ok(mild.messages[0].content[0].text.includes('【店規】'), 'constant 永遠在')
  assert.equal(mild.messages[0].content[0].text.includes('【琴酒】'), false, '沒提到就不該出現')

  // 別的 waterfall 已經拒絕這一步 → 我們不要多事
  const rejected = await preStep(makePayload('琴酒'), async () => ({ kind: 'reject' }))
  assert.equal(rejected.kind, 'reject', 'R5：別人拒絕就照樣拒絕')

  // 沒有綁定（不知道是哪間酒館）→ 原樣放行，不丟錯
  const unbound = makePayload('琴酒')
  unbound.agent.id = 'session-unknown'
  const passthrough = await preStep(unbound, enterWith(unbound.messages))
  assert.equal(passthrough.messages[0].content.length, 1, 'R11：沒有綁定時原樣放行')

  // 沒有 tools 服務時 inject 不會被呼叫——確認 apply 沒有因此壞掉（上面已經跑完了）

  // 世界書目錄壞掉／不存在 → 原樣放行
  rmSync(join(root, 'worldbooks'), { recursive: true, force: true })
  __clearCache()
  const noBooks = await preStep(makePayload('琴酒'), enterWith(makePayload('琴酒').messages))
  assert.equal(noBooks.messages[0].content.length, 1, 'R11：沒有世界書時原樣放行')

  // useWorldbook: false → 完全不掛 hook
  listeners.clear()
  apply(ctx, { card: '', useWorldbook: false })
  assert.equal(listeners.has('agent/pre-step'), false, 'useWorldbook: false 時不該掛 hook')

  rmSync(dir, { recursive: true, force: true })
  console.log('9. 世界書注入 OK — constant＋關鍵字命中、拒絕時不插手、沒有綁定就放行')
}

console.log('\n全部通過 ✅')
