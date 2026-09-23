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
import { mkdirSync, mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const { renderCard, readCard, apply, inject, AGENT_BUILD, __clearCache, resolveBinding, resolveCardFile, TOOL_LEVELS, renderDirectiveFor } =
  await import('./lib/agent.js')

const { STOP_PRESET } = await import('./lib/samplers.js')

/**
 * ⚠️ 版本**不要寫死在測試裡**。
 *
 * 這裡以前是 `'tavern-agent-' + '2.5.1'`——所以每次升版都要記得改這一行，
 * 而訊息卻寫著「要對得上 package.json」，它根本沒讀 package.json。
 * 現在直接讀 manifest：版本只有一個來源，升版不會漏掉這一條。
 */
const manifest = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'))
const NAME = 'tavern-agent-' + manifest.version
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
  // 四個註冊：卡片變數、complete section、關掉 runtime context、生成參數。
  // ⚠️ 這一條刻意**寫死數字**：加了新註冊卻忘記包 `ctx.effect()` 的話，
  // fiber 卸載時那條 listener 會留下來（換一個 session 就多一份）。
  assert.equal(seen.effects, 4, '四個註冊都要包在 ctx.effect 裡（fiber 卸載時自動回收）')
  // `agent/request` 是生成參數（2.6.48），`agent/pre-step` 是世界書（R5）。
  // **兩個都要有**：只留一個的話不是「生成參數沒生效」就是「世界書不注入了」。
  assert.deepEqual(
    seen.events,
    ['agent/request', 'agent/pre-step'],
    'R5 世界書的 hook ＋ 生成參數的 hook',
  )

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

/* --------------------- 世界書的注入位置（2.6.59）--------------------- */

{
  /**
   * ⚠️ **這一節驗的是「另外兩個位置真的走系統提示」**，而不只是「純函式算得對」。
   *
   * 背景：`docs/worldbook-plan.md` 第 131 行原本寫著「DSH 只給使用者訊息
   * 一個槓桿，所以 ST 的八種位置我們只有一種」。那**只對一半**——
   * `ctx.systemPrompt.variable()` 的取值函式每一輪都重跑（2.6.47 的
   * live-reload 就是靠它），所以系統提示是第二個槓桿。
   *
   * 這一節要證明三件事，而三件都只有接線才看得出來：
   *   1. `system-after` 的書出現在**卡片變數**裡（＝系統提示）
   *   2. 同一本書**不會**同時被接進使用者訊息（不然就是送兩份）
   *   3. `in-chat` 的書照舊接在訊息尾巴（**沒有回歸**）
   */
  __clearCache()
  const dir = mkdtempSync(join(tmpdir(), 'dsh-tavern-lorepos-'))
  const root = join(dir, '酒館')
  const SID = 'session-lorepos-0000-1111-2222-333344445555'
  mkdirSync(join(root, 'characters'), { recursive: true })
  mkdirSync(join(root, '.sessions'), { recursive: true })
  mkdirSync(join(root, 'worldbooks'), { recursive: true })
  writeFileSync(join(root, 'characters', '酒保.json'), JSON.stringify({ name: '酒保', description: '沉默' }))
  writeFileSync(
    join(root, '.sessions', `${SID}.json`),
    JSON.stringify({ sessionId: SID, character: '酒保', room: '', chat: '夜晚' }),
  )
  /** 三本書，三個位置。 */
  const writeBook = (name, position, content) =>
    writeFileSync(
      join(root, 'worldbooks', `${name}.json`),
      JSON.stringify({ name, position, entries: { 0: { uid: 0, comment: name, content, constant: true } } }),
    )
  writeBook('前面', 'system-before', '【BEFORE-LORE】')
  writeBook('後面', 'system-after', '【AFTER-LORE】')
  writeBook('尾巴', 'in-chat', '【CHAT-LORE】')

  const listeners = new Map()
  let cardResolver = null
  const ctx = {
    effect: (fn) => fn(),
    systemPrompt: {
      variable: (name, fn) => {
        cardResolver = fn
        return () => {}
      },
      section: () => () => {},
      suppressRuntimeContext: () => () => {},
    },
    inject: () => ({ then: () => {} }),
    on(event, listener) {
      listeners.set(event, listener)
      return () => {}
    },
  }
  apply(ctx, { card: '', user: '' })
  assert.equal(typeof cardResolver, 'function', '要註冊卡片變數')
  assert.equal(listeners.has('agent/pre-step'), true, '要掛 agent/pre-step')
  const preStep = listeners.get('agent/pre-step')
  const agent = { id: SID, session: { header: { cwd: root } } }

  // ① **先跑一次 pre-step**（那一輪的掃描文字就留在快取裡），再問卡片變數。
  const messages = [{ id: 'm1', role: 'user', content: [{ type: 'text', text: '晚安' }], source: { kind: 'user' } }]
  const decision = await preStep({ agent, messages, turn: 1, step: 1 }, async () => ({ kind: 'enter', messages }))
  const injectedTail = decision.messages[0].content[0].text

  // ② ⚠️ 尾巴**只有** `in-chat` 那一本——另外兩本**不可以在這裡**（不然就是送兩份）。
  assert.ok(injectedTail.includes('【CHAT-LORE】'), 'in-chat 的書要接在訊息尾巴（沒有回歸）')
  assert.equal(injectedTail.includes('【AFTER-LORE】'), false, '⚠️ system-after 的書**不可以**同時接在尾巴')
  assert.equal(injectedTail.includes('【BEFORE-LORE】'), false, '⚠️ system-before 也一樣')

  // ③ 卡片變數（＝系統提示）裡要有那兩本，而且順序是 before → 卡片 → after。
  const prompt = cardResolver({ agent })
  assert.ok(prompt.includes('【BEFORE-LORE】'), 'system-before 要在系統提示裡')
  assert.ok(prompt.includes('【AFTER-LORE】'), 'system-after 要在系統提示裡')
  assert.equal(prompt.includes('【CHAT-LORE】'), false, '⚠️ in-chat 的書**不可以**跑進系統提示')
  assert.ok(
    prompt.indexOf('【BEFORE-LORE】') < prompt.indexOf('沉默'),
    '⚠️ `system-before` 要在角色卡**前面**（卡片的 description 是「沉默」）',
  )
  assert.ok(
    prompt.indexOf('沉默') < prompt.indexOf('【AFTER-LORE】'),
    '⚠️ `system-after` 要在角色卡**後面**',
  )

  // ④ 酒館層的預設：沒指定位置的書跟著它走（這裡把它指到 system-after）。
  writeFileSync(join(root, 'tavern.json'), JSON.stringify({ version: 1, worldbookPosition: 'system-after' }))
  writeFileSync(
    join(root, 'worldbooks', '沒指定.json'),
    JSON.stringify({ name: '沒指定', entries: { 0: { uid: 0, content: '【DEFAULT-LORE】', constant: true } } }),
  )
  __clearCache()
  const prompt2 = cardResolver({ agent })
  assert.ok(prompt2.includes('【DEFAULT-LORE】'), '⚠️ 沒指定位置的書要跟著酒館層的預設走')
  assert.equal(
    (await preStep({ agent, messages, turn: 1, step: 1 }, async () => ({ kind: 'enter', messages }))).messages[0].content[0].text.includes('【DEFAULT-LORE】'),
    false,
    '它去了系統提示就不該同時在尾巴',
  )
  // 預設清空 ⇒ 回到 in-chat（＝與 2.6.58 一字不差）。
  writeFileSync(join(root, 'tavern.json'), JSON.stringify({ version: 1 }))
  __clearCache()
  const tail2 = (
    await preStep({ agent, messages, turn: 1, step: 1 }, async () => ({ kind: 'enter', messages }))
  ).messages[0].content[0].text
  assert.ok(tail2.includes('【DEFAULT-LORE】'), '⚠️ 沒有預設時回到 in-chat（舊行為）')

  // ⑤ 壞掉的世界書目錄 ⇒ 系統提示那邊原樣（不可以讓提示詞算不出來）。
  rmSync(join(root, 'worldbooks'), { recursive: true, force: true })
  __clearCache()
  const bare = cardResolver({ agent })
  assert.equal(typeof bare, 'string', '沒有世界書時還是要回得出提示詞')
  assert.ok(bare.includes('沉默'), '而且角色卡要在')

  /* ---- ⑥ ⚠️ 房間那一層真的會蓋過酒館（2.6.62）-------------------------- */
  //
  // 使用者：「酒館的藏書應該是有分酒館 global 以及房間，所以要有兩個設定位置」。
  // 這一條驗的是**最後一哩**：`room.json` 的 `worldbookPosition` 有沒有真的
  // 改變「那一本書被放在哪」——純函式測得動規則，但測不到接線。
  mkdirSync(join(root, 'worldbooks'), { recursive: true })
  writeBook('酒館書', null, '【TAVERN-BOOK】')
  writeFileSync(join(root, 'tavern.json'), JSON.stringify({ version: 1, worldbookPosition: 'in-chat' }))
  const roomDir = join(root, 'chats', '酒保', 'r-pos')
  mkdirSync(roomDir, { recursive: true })
  writeFileSync(join(roomDir, 'chat.jsonl'), `${JSON.stringify({ chat_metadata: {} })}\n`)
  writeFileSync(join(root, '.sessions', `${SID}.json`), JSON.stringify({ sessionId: SID, character: '酒保', room: 'r-pos' }))
  const withRoom = (position) => {
    writeFileSync(
      join(roomDir, 'room.json'),
      JSON.stringify(position === null ? { version: 1 } : { version: 1, worldbookPosition: position }),
    )
    __clearCache()
    return cardResolver({ agent })
  }
  // ⚠️ **酒館那一層要先確認是 in-chat**（否則下面第一條會誤判成「房間生效了」）。
  assert.equal(
    withRoom(null).includes('【TAVERN-BOOK】'),
    false,
    '房間沒指定、酒館說 in-chat ⇒ 那一本不該進系統提示',
  )
  // 房間指定 system-after ⇒ **蓋過酒館**，那一本跑到系統提示。
  assert.ok(
    withRoom('system-after').includes('【TAVERN-BOOK】'),
    '⚠️ 房間說 system-after ⇒ 蓋過酒館的 in-chat（那一本要進系統提示）',
  )
  // 反向：酒館說 system-after、房間說 in-chat ⇒ 也聽房間的。
  writeFileSync(join(root, 'tavern.json'), JSON.stringify({ version: 1, worldbookPosition: 'system-after' }))
  assert.equal(
    withRoom('in-chat').includes('【TAVERN-BOOK】'),
    false,
    '⚠️ 房間說 in-chat ⇒ 蓋過酒館的 system-after',
  )
  // 房間的 `null` ＝ 聽酒館的 ⇒ 回到酒館那一層（system-after）。
  assert.ok(withRoom(null).includes('【TAVERN-BOOK】'), '房間的 null ＝ 聽酒館的（所以回到系統提示）')

  /* ---- ⑦ ⚠️ 房間也可以**逐書**開／關（2.6.64）-------------------------- */
  //
  // 使用者：「房間也要世界書管理頁面……房間的時候其微調可以自己在整理兩層」。
  // 這一條驗「房間關掉一本書」有沒有真的生效——而**兩條路都要驗**
  // （系統提示那一條 ＋ 訊息尾巴那一條），因為它們是兩個不同的地方。
  const withOverrides = (overrides) => {
    writeFileSync(join(roomDir, 'room.json'), JSON.stringify({ version: 1, worldbookOverrides: overrides }))
    __clearCache()
    return cardResolver({ agent })
  }
  // 那一本自己沒有指定位置，房間說 system-after ⇒ 它會進系統提示。
  assert.ok(
    withOverrides({ 酒館書: { position: 'system-after' } }).includes('【TAVERN-BOOK】'),
    '房間逐書指定位置 ⇒ 那一本進系統提示',
  )
  // 房間把它關掉 ⇒ **系統提示那一條路不該有它**。
  assert.equal(
    withOverrides({ 酒館書: { enabled: false } }).includes('【TAVERN-BOOK】'),
    false,
    '⚠️ 房間關掉的書不該在系統提示裡',
  )
  // 而且**訊息尾巴那一條路**也不該有它（酒館說 in-chat）。
  writeFileSync(join(root, 'tavern.json'), JSON.stringify({ version: 1, worldbookPosition: 'in-chat' }))
  writeFileSync(
    join(roomDir, 'room.json'),
    JSON.stringify({ version: 1, worldbookOverrides: { 酒館書: { enabled: false } } }),
  )
  __clearCache()
  const tailAfterClose = (
    await preStep({ agent, messages, turn: 1, step: 1 }, async () => ({ kind: 'enter', messages }))
  ).messages[0].content[0].text
  assert.equal(tailAfterClose.includes('【TAVERN-BOOK】'), false, '⚠️ 房間關掉的書也不該在訊息尾巴裡')

  /* ---- ⑧ ⚠️ 房間調的**條目優先序**真的會改變注入順序（2.6.70）----------- */
  //
  // ⚠️ 這一條驗的是**接線**（最後一哩）：`lib/worldbook.js` 的排序規則在
  // `test-worldbook.mjs` §4b 有測試，但那一條驗不到「`room.json` 的值有沒有真的
  // 傳進 `collectLore`」——漏掉那一格的症狀是**安靜的**：畫面上一樣調得動，
  // 注入的順序卻沒變，而使用者只會覺得「調了沒差」。
  //
  // ⚠️ **兩條路都要驗**（訊息尾巴 ＋ 系統提示）：只傳一邊的症狀是**同一輪裡
  // 兩堆條目的順序不一樣**，而那是安靜的。
  writeFileSync(join(root, 'tavern.json'), JSON.stringify({ version: 1, worldbookPosition: 'in-chat' }))
  const writeOrdered = (name, position, order, content) =>
    writeFileSync(
      join(root, 'worldbooks', `${name}.json`),
      JSON.stringify({
        name,
        position,
        entries: { 0: { uid: 0, comment: name, content, constant: true, order } },
      }),
    )
  // 甲：條目 order 900（照條目排一定在前面）／乙：order 1。
  writeOrdered('甲書', 'in-chat', 900, '【甲】')
  writeOrdered('乙書', 'in-chat', 1, '【乙】')
  /** 把 `room.json` 寫成指定的覆寫，回傳這一輪要注入的尾巴文字。 */
  const tailWith = async (patch) => {
    writeFileSync(join(roomDir, 'room.json'), JSON.stringify({ version: 1, ...(patch ?? {}) }))
    __clearCache()
    return (await preStep({ agent, messages, turn: 1, step: 1 }, async () => ({ kind: 'enter', messages }))).messages[0]
      .content[0].text
  }
  const plainTail = await tailWith(null)
  assert.ok(
    plainTail.includes('【甲】') && plainTail.includes('【乙】'),
    '兩本書都要進尾巴（不然下面的順序斷言沒有意義）',
  )
  assert.ok(plainTail.indexOf('【甲】') < plainTail.indexOf('【乙】'), '都沒有覆寫 ⇒ 照書自己的 order（900 在 1 前面）')

  // 房間把「乙」那一條（uid 0）拉到 950 ⇒ 它排到甲的前面。
  const raisedTail = await tailWith({ worldbookEntryOverrides: { 乙書: { 0: { order: 950 } } } })
  assert.ok(
    raisedTail.indexOf('【乙】') < raisedTail.indexOf('【甲】'),
    '⚠️ 房間把乙那一條調到 950 ⇒ 它排到甲的 900 前面（房間的覆寫真的傳進 collectLore）',
  )
  // 相反方向：把「甲」那一條壓到 0 ⇒ 乙在前面（壓低也生效）。
  const loweredTail = await tailWith({ worldbookEntryOverrides: { 甲書: { 0: { order: 0 } } } })
  assert.ok(loweredTail.indexOf('【乙】') < loweredTail.indexOf('【甲】'), '⚠️ 把甲壓到 0 ⇒ 乙在前面')

  /**
   * ⚠️ **系統提示那一條路也要吃同一份覆寫**。
   *
   * 把兩本都指到 `system-after`（進系統提示），再用房間的覆寫決定誰在前面：
   * 那一堆的順序由 `collectLore` 決定，所以它必須也收到 `entryOverrides`。
   */
  writeOrdered('甲書', 'system-after', 900, '【甲】')
  writeOrdered('乙書', 'system-after', 1, '【乙】')
  const promptWith = (patch) => {
    writeFileSync(join(roomDir, 'room.json'), JSON.stringify({ version: 1, ...(patch ?? {}) }))
    __clearCache()
    return cardResolver({ agent })
  }
  const promptPlain = promptWith(null)
  assert.ok(
    promptPlain.indexOf('【甲】') < promptPlain.indexOf('【乙】'),
    '系統提示那一堆：沒覆寫 ⇒ 照書自己的 order（甲 900 在乙 1 前面）',
  )
  const promptRaised = promptWith({ worldbookEntryOverrides: { 乙書: { 0: { order: 950 } } } })
  assert.ok(
    promptRaised.indexOf('【乙】') < promptRaised.indexOf('【甲】'),
    '⚠️ 房間的覆寫在**系統提示那一條路**也要生效（只傳一邊＝同一輪兩堆順序不一樣）',
  )
  // 而且尾端那一條路不會被它影響（兩本都搬到系統提示了 ⇒ 尾巴裡沒有它們）。
  const tailAfterMove = await tailWith({ worldbookEntryOverrides: { 乙書: { 0: { order: 950 } } } })
  assert.equal(tailAfterMove.includes('【甲】'), false, '搬到系統提示的書不該同時在尾巴（兩份）')

  rmSync(dir, { recursive: true, force: true })
  console.log(
    '10. 世界書位置 OK — system-* 進系統提示、in-chat 照舊、房間蓋過酒館、房間可逐書開關、條目優先序真的改變注入順序',
  )
}

/* ------------- persona：{{user}}／「你是誰」／「這間店的規則」 ------------- */

{
  /**
   * 這一節是**補上來的**（2.6.47）。
   *
   * persona 那一整條鏈（`tavern.json` 的 `userName`／`userPersona`／`tavernPrompt`
   * → 系統提示 ＋ ⚙️ 設定那一區的輸入框）在 2.6.5 就做好了，但 `test-agent.mjs`
   * 對它**一行斷言都沒有**——`plan.md` §8 甚至還寫著「persona：沒做」。
   * 那是最危險的狀態：功能在、卻沒有人知道它還在不在（§2.6.44 的 `ensureTheme()`
   * 就是同一型的：純函式全綠，只是沒有人呼叫）。
   *
   * 所以這裡從**真正的接線點**驗：抓 `ctx.systemPrompt.variable()` 註冊的那個解析器，
   * 餵真的 `assembly` 進去，看它吐出來的**整份系統提示**。
   */
  __clearCache()
  const dir = mkdtempSync(join(tmpdir(), 'dsh-tavern-persona-'))
  const root = join(dir, '酒館')
  const SID = 'session-persona-0000-1111-2222-333344445555'
  const ROOM = 'm1k3x9-a7f2'
  const cardPath = join(root, 'characters', '老闆娘.json')

  mkdirSync(join(root, 'characters'), { recursive: true })
  mkdirSync(join(root, '.sessions'), { recursive: true })
  mkdirSync(join(root, 'chats', '老闆娘', ROOM), { recursive: true })
  writeFileSync(
    cardPath,
    JSON.stringify({
      name: '老闆娘',
      description: '{{char}} 是店主。{{user}} 是常客。',
      first_mes: '{{user}}，你來了。',
    }),
  )
  writeFileSync(
    join(root, '.sessions', `${SID}.json`),
    JSON.stringify({ sessionId: SID, character: '老闆娘', room: ROOM, chat: '夜晚' }),
  )
  const writeTavern = (patch) =>
    writeFileSync(join(root, 'tavern.json'), JSON.stringify({ version: 1, ...patch }))
  writeTavern({})

  /** 抓 `systemPrompt.variable()` 的解析器——那才是真正的接線點。 */
  let resolver = null
  const ctx = {
    effect: (fn) => fn(),
    systemPrompt: {
      variable: (name, fn) => {
        resolver = fn
        return () => {}
      },
      section: () => () => {},
      suppressRuntimeContext: () => () => {},
    },
    inject: () => ({ then: () => {} }),
    on: () => () => {},
  }
  const render = (config) => {
    apply(ctx, config ?? { card: '', user: '' })
    assert.equal(typeof resolver, 'function', 'apply 一定要註冊 systemPrompt.variable')
    return resolver({ agent: { id: SID, session: { header: { cwd: root } } } })
  }

  // ① 基準：三個欄位都留空 → 提示詞**只有卡片**（與以前一字不差）。
  const bare = render()
  assert.ok(bare.includes('老闆娘 是店主。你 是常客。'), '卡片要先被渲染出來：' + bare)
  assert.equal(bare.includes('# 關於'), false, '沒設 persona 就不該多出那一段')
  assert.equal(bare.includes('# 這間店的規則'), false, '沒設店規就不該多出那一段')
  assert.equal(bare.includes('# 這一場'), false, '沒設房間指示就不該多出那一段')

  // ② `userName` → 卡片的 `{{user}}`。
  writeTavern({ userName: '阿明' })
  __clearCache()
  const named = render()
  assert.ok(named.includes('阿明 是常客。'), 'userName 要進到卡片的 {{user}}：' + named)
  assert.equal(named.includes('{{user}}'), false, '認識的巨集不該原樣留著')

  // ③ agent 面的 `settings.user` 蓋過 `tavern.json` 的 `userName`
  //    （preset 的出貨值就住在那一格）。
  const overridden = render({ card: '', user: '小美' })
  assert.ok(overridden.includes('小美 是常客。'), 'settings.user 要蓋過 tavern.json：' + overridden)
  assert.equal(overridden.includes('阿明'), false, '被蓋掉的那個不該還在')

  // ④ persona ＋ 店規：**接在卡片後面**，不是取代它。
  writeTavern({ userName: '阿明', userPersona: '老主顧，話不多。', tavernPrompt: '店裡不談政治。' })
  __clearCache()
  const full = render()
  assert.ok(full.includes('阿明 是常客。'), '卡片還在（是附加，不是取代）')
  assert.ok(full.indexOf('# 關於') > full.indexOf('# 人設'), 'persona 那一段要在卡片後面')
  assert.ok(full.includes('老主顧，話不多。'), 'persona 的內文要進去')
  assert.ok(full.includes('店裡不談政治。'), '店規的內文要進去')
  assert.ok(full.indexOf('# 這間店的規則') > full.indexOf('# 關於'), '店規在 persona 之後')

  // ⑤ ⚠️ 2.6.47 的修正：這兩段**也要換巨集**。
  //    以前標題本身就是 `# 關於 {{user}}`，原樣送到模型——同一份提示詞裡
  //    卡片被換、標題沒被換。使用者在 persona 裡寫 `{{char}}` 也一樣不會被換。
  assert.equal(full.includes('{{user}}'), false, 'persona 那一段的 {{user}} 也要被換掉：' + full)
  assert.ok(full.includes('# 關於 阿明'), '標題要換成真的名字')
  writeTavern({
    userName: '阿明',
    userPersona: '{{user}} 是 {{char}} 的老朋友。',
    tavernPrompt: '{{char}} 不接受殺價。',
  })
  __clearCache()
  const macros = render()
  assert.ok(macros.includes('阿明 是 老闆娘 的老朋友。'), 'persona 內文的巨集要被換：' + macros)
  assert.ok(macros.includes('老闆娘 不接受殺價。'), '店規內文的巨集要被換：' + macros)
  // 不認識的巨集照樣原樣留著（與卡片同一條規矩，不要默默吃掉）。
  writeTavern({ userName: '阿明', userPersona: '今天是 {{random}}。' })
  __clearCache()
  assert.ok(
    render().includes('今天是 {{random}}。'),
    '不認識的巨集要原樣留著（與 renderCard 一致）',
  )

  // ⑥ 房間的「這一場」也一樣（同一個修正）。
  writeFileSync(
    join(root, 'chats', '老闆娘', ROOM, 'room.json'),
    JSON.stringify({ version: 1, name: '夜晚', roomPrompt: '{{user}} 剛從雨裡走進來。' }),
  )
  writeTavern({ userName: '阿明' })
  __clearCache()
  const roomy = render()
  assert.ok(roomy.includes('阿明 剛從雨裡走進來。'), '房間指示的巨集要被換：' + roomy)
  assert.ok(roomy.indexOf('# 這一場') > roomy.indexOf('# 人設'), '房間指示也在卡片後面')

  // ⑦ ⚠️ 快取鍵的修正：**改名字之後卡片要重畫**。
  //    以前快取只比 mtime，所以在 ⚙️ 設定改名字之後，卡片還是舊的渲染結果
  //    ——「改了名字，提示詞裡還是舊的」，而且只有動卡片檔才會好。
  __clearCache()
  const before = render({ card: '', user: '小美' })
  assert.ok(before.includes('小美'), '第一次渲染要用小美')
  const after = render({ card: '', user: '小華' })
  assert.ok(after.includes('小華'), '換了名字就要重畫（mtime 沒變也一樣）：' + after)
  assert.equal(after.includes('小美'), false, '舊名字不該留在快取裡')

  // ⑧ 讀不到的東西一律不丟錯：tavern.json 壞掉、卡片檔消失。
  writeFileSync(join(root, 'tavern.json'), '{ 這不是 JSON')
  __clearCache()
  const broken = render()
  assert.ok(broken.includes('老闆娘 是店主。'), 'tavern.json 壞掉不該影響卡片')
  assert.equal(broken.includes('# 關於'), false, '讀不到設定就當作沒設（不是炸掉）')
  rmSync(cardPath, { force: true })
  __clearCache()
  const noCard = render()
  assert.equal(typeof noCard, 'string', '卡片檔消失時還是要回一份提示詞（可能是空的）')
  // ⚠️ 卡片沒了，但使用者寫的 persona 仍然要送出去——那是他自己打的字，
  //    不該因為一張卡被搬走就靜靜消失。
  writeTavern({ userPersona: '老主顧。' })
  __clearCache()
  assert.ok(render().includes('老主顧。'), '卡片檔消失時 persona 還是要送出去')

  rmSync(dir, { recursive: true, force: true })
  console.log('11. persona OK — userName／persona／店規／房間指示都進提示詞，巨集會換、留空不變')
}

/* ---------- 酒館層級的工具等級真的讀得到（`tavernField` 的死路）---------- */

{
  /**
   * ⚠️ 這一節是為了 `dirname` 那個 bug 補的（2.6.47）。
   *
   * `tavernField()` 用 `dirname(cardFile)` 去算 `tavern.json` 的路徑，而
   * `lib/agent.js` 的 import 只有 `join`——**`dirname` 從來沒有被 import 過**。
   * 那支函式整包包在 `try/catch` 裡（刻意的：設定讀不到不該讓一輪對話失敗），
   * 所以 `ReferenceError` 被靜靜吃掉，永遠回空字串。
   *
   * 後果是**整條 `tavern.json` 的讀取路徑都是死的**：
   *   - `{{user}}` 永遠是預設的「你」（`userName` 沒人讀）
   *   - persona 與店規**永遠不會**進提示詞
   *   - `allowTools` 永遠讀成 `none`（fail closed，所以症狀是「設了全開，工具還是全關」）
   *
   * 為什麼拖了這麼久沒被發現：`node --check` 只看語法，而**純函式測試**只餵參數
   * 進去、不會碰到讀檔那條路；`test-agent.mjs` 對 persona 一行斷言都沒有。
   * 這一節把「讀得到」本身釘住——上面的第 10 節驗的是「讀到之後怎麼用」。
   */
  __clearCache()
  const dir = mkdtempSync(join(tmpdir(), 'dsh-tavern-level-'))
  const root = join(dir, '酒館')
  const SID = 'session-level-0000-1111-2222-333344445555'
  mkdirSync(join(root, 'characters'), { recursive: true })
  mkdirSync(join(root, '.sessions'), { recursive: true })
  writeFileSync(join(root, 'characters', '酒保.json'), JSON.stringify({ name: '酒保' }))
  writeFileSync(
    join(root, '.sessions', `${SID}.json`),
    JSON.stringify({ sessionId: SID, character: '酒保', chat: '夜晚' }),
  )

  const seen = { allow: [], deny: [], injected: false }
  const scoped = {
    effect: (fn) => fn(),
    tools: {
      schemas: () => [{ name: 'global_tool_a' }],
      restrict(filter) {
        if (Array.isArray(filter.allow)) seen.allow.push(filter.allow)
        else seen.deny.push(filter.deny)
        return () => {}
      },
    },
  }
  let resolver = null
  const ctx = {
    effect: (fn) => fn(),
    systemPrompt: {
      variable: (name, fn) => {
        resolver = fn
        return () => {}
      },
      section: () => () => {},
      suppressRuntimeContext: () => () => {},
    },
    inject(deps, callback) {
      seen.injected = true
      callback(scoped)
      return { then: () => {} }
    },
    on: () => () => {},
  }

  apply(ctx, { card: '', user: '' })
  assert.equal(seen.injected, true, '要等 tools（工具遮罩靠它）')
  // 還沒組裝之前是關著的（fail closed）——`deny` 的是繼承來的全域工具。
  assert.equal(seen.deny.length, 1, '預設要先把繼承來的全域工具擋掉')
  assert.deepEqual(seen.deny[0], ['global_tool_a'], '預設擋掉全域工具，不含保留的 run_code')

  const assemble = () => resolver({ agent: { id: SID, session: { header: { cwd: root } } } })
  const writeTavern = (value) =>
    writeFileSync(join(root, 'tavern.json'), JSON.stringify({ version: 1, allowTools: value }))

  // `read` → 白名單（**不是** deny）：`denyInheritedTools` 走的是另一條路。
  writeTavern('read')
  assemble()
  assert.deepEqual(seen.allow.pop(), TOOL_LEVELS.read, '`read` 要套白名單，而且就是 TOOL_LEVELS 那一組')

  writeTavern('write')
  assemble()
  assert.deepEqual(seen.allow.pop(), TOOL_LEVELS.write, '`write` 要套白名單')

  writeTavern('web')
  assemble()
  assert.deepEqual(seen.allow.pop(), TOOL_LEVELS.web, '`web` 要套白名單')

  // `all` → 完全不套限制。
  const allowBefore = seen.allow.length
  const denyBefore = seen.deny.length
  writeTavern('all')
  assemble()
  assert.equal(seen.allow.length, allowBefore, '`all` 不該套白名單')
  assert.equal(seen.deny.length, denyBefore, '`all` 不該 deny 任何東西')

  // 手改檔案寫了不認識的值 → **回到 none（fail closed）**，不要默默放行。
  writeTavern('全部都開')
  assemble()
  assert.deepEqual(seen.deny.pop(), ['global_tool_a'], '不明的值要 fail closed 成 none')

  // 房間層級蓋過酒館（`inherit` 除外）——這是「有些設定適合精細化」的落地。
  mkdirSync(join(root, 'chats', '酒保', 'r1'), { recursive: true })
  writeFileSync(join(root, 'chats', '酒保', 'r1', 'room.json'), JSON.stringify({ version: 1, allowTools: 'read' }))
  writeFileSync(
    join(root, '.sessions', `${SID}.json`),
    JSON.stringify({ sessionId: SID, character: '酒保', room: 'r1', chat: '夜晚' }),
  )
  writeTavern('all')
  assemble()
  assert.deepEqual(seen.allow.pop(), TOOL_LEVELS.read, '房間選 read 就要蓋過酒館的 all')

  // `inherit`（房間的預設值）＝聽酒館的。
  writeFileSync(
    join(root, 'chats', '酒保', 'r1', 'room.json'),
    JSON.stringify({ version: 1, allowTools: 'inherit' }),
  )
  const allowBeforeInherit = seen.allow.length
  assemble()
  assert.equal(seen.allow.length, allowBeforeInherit, 'inherit 要聽酒館的（酒館是 all＝不套限制）')

  rmSync(dir, { recursive: true, force: true })
  console.log('12. 工具等級 OK — tavern.json 真的讀得到、白名單正確、房間蓋過酒館、不明值 fail closed')
}

/* ------------- 生成參數：agent/request 這一條真的接上了（2.6.48）------------- */

{
  /**
   * 這一節驗的是**接線**，不是規則（規則在 `test-samplers.mjs`）。
   *
   * 為什麼一定要有這一節：`resolveSamplers()` 全綠**不代表**參數真的會送到模型
   * ——中間還隔著「有沒有掛 `agent/request`」、「`next()` 有沒有被呼叫」、
   * 「回傳的物件有沒有被下游採用」。2.6.44 的 `ensureTheme()` 就是同一型的：
   * 純函式測試全綠，只有「有沒有人呼叫」沒被釘住。
   *
   * `agent/request` 的形狀是照 `dsh-agent/lib/index.js` 的 `installModelSelection`
   * 抄的：waterfall、`payload` 是 `{turn, step, signal}`、`next()` 回傳**已經解析好的
   * `LlmCallConfig`**。
   */
  __clearCache()
  const dir = mkdtempSync(join(tmpdir(), 'dsh-tavern-sampling-'))
  const root = join(dir, '酒館')
  const SID = 'session-sampling-0000-1111-2222-333344445555'
  const ROOM = 'r-sampling'

  mkdirSync(join(root, 'characters'), { recursive: true })
  mkdirSync(join(root, '.sessions'), { recursive: true })
  mkdirSync(join(root, 'chats', '老闆娘', ROOM), { recursive: true })
  writeFileSync(join(root, 'characters', '老闆娘.json'), JSON.stringify({ name: '老闆娘' }))
  const writeBinding = (room) =>
    writeFileSync(
      join(root, '.sessions', `${SID}.json`),
      JSON.stringify({ sessionId: SID, character: '老闆娘', room: room, chat: '夜晚' }),
    )
  writeBinding(ROOM)
  const writeTavern = (patch) =>
    writeFileSync(join(root, 'tavern.json'), JSON.stringify({ version: 1, ...patch }))
  const writeRoom = (patch) =>
    writeFileSync(join(root, 'chats', '老闆娘', ROOM, 'room.json'), JSON.stringify({ version: 1, ...patch }))
  writeTavern({})
  writeRoom({})

  /** 收集 apply 掛了哪些事件（`agent/request` 是其中之一）。 */
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

  apply(ctx, { card: '', user: '' })
  assert.equal(listeners.has('agent/request'), true, '生成參數要掛 agent/request')
  const request = listeners.get('agent/request')
  const payload = { agent: { id: SID, session: { header: { cwd: root } } }, turn: 1, step: 1 }

  /** DSH 那邊 `next()` 會回一份已經解析好的 config（照真實形狀寫）。 */
  const DSH_CONFIG = { provider: 'deepseek', model: 'deepseek-chat', reasoningEffort: 'high' }
  const run = async () => request(payload, () => Promise.resolve({ ...DSH_CONFIG }))

  // ① 什麼都沒設 → **原樣回傳**（identity 一樣），不可以塞任何欄位。
  const untouched = await run()
  assert.deepEqual(untouched, DSH_CONFIG, '沒設定時不可以動任何欄位')
  assert.equal(
    'temperature' in untouched,
    false,
    '沒設定時**不可以**出現 temperature（那會改變既有對話的行為）',
  )

  // ② 酒館設了 → 蓋上去，而且**其他人的決定要留著**。
  writeTavern({ temperature: 0.8, maxTokens: 512 })
  const fromTavern = await run()
  assert.equal(fromTavern.temperature, 0.8, '酒館的 temperature 要生效')
  assert.equal(fromTavern.maxTokens, 512, '酒館的 maxTokens 要生效')
  assert.deepEqual(
    [fromTavern.provider, fromTavern.model, fromTavern.reasoningEffort],
    [DSH_CONFIG.provider, DSH_CONFIG.model, DSH_CONFIG.reasoningEffort],
    '⚠️ `next()` 的結果要留著——把 provider／model／reasoningEffort 吃掉的話，' +
      '症狀是「選了模型卻沒生效」，而且看起來像 DSH 壞了',
  )

  // ③ 房間蓋過酒館（逐欄位）。
  writeRoom({ temperature: 1.4 })
  const fromRoom = await run()
  assert.equal(fromRoom.temperature, 1.4, '房間的 temperature 要蓋過酒館')
  assert.equal(fromRoom.maxTokens, 512, '房間沒設的那一欄要沿用酒館的')

  // ④ 房間的 `null` ＝ 聽酒館的。
  writeRoom({ temperature: null, maxTokens: null })
  const inherited = await run()
  assert.equal(inherited.temperature, 0.8, '房間的 null 要退回酒館')
  assert.equal(inherited.maxTokens, 512, '同上')

  // ⑤ 手改檔案寫了不合法的值 → 當作沒設，**不可以**送出去。
  //    （`temperature: 99` 真的送給提供方會被拒絕，而且錯誤訊息很難懂。）
  writeTavern({ temperature: 99 })
  const invalid = await run()
  assert.equal('temperature' in invalid, false, '不合法的值不可以送到請求裡')
  assert.deepEqual(invalid, DSH_CONFIG, '不合法的值等於沒設（回到原樣）')

  // ⑥ `temperature: 0` 是合法值，不可以被 falsy 判斷吃掉。
  writeTavern({ temperature: 0 })
  const zero = await run()
  assert.equal(zero.temperature, 0, 'temperature 0 要送出去（0 不是「沒有」')

  // ⑦ `next()` 一定要被呼叫，而且只呼叫一次（waterfall 的規矩）。
  let nextCalls = 0
  await request(payload, () => {
    nextCalls += 1
    return Promise.resolve({ ...DSH_CONFIG })
  })
  assert.equal(nextCalls, 1, '`next()` 要被呼叫，而且剛好一次')

  // ⑧ 沒有綁定（不知道是哪間酒館）→ 原樣放行，不丟錯。
  listeners.clear()
  apply(ctx, { card: '', user: '' })
  const unboundPayload = { agent: { id: 'session-unknown', session: { header: { cwd: root } } } }
  const passthrough = await listeners.get('agent/request')(unboundPayload, () =>
    Promise.resolve({ ...DSH_CONFIG }),
  )
  assert.deepEqual(passthrough, DSH_CONFIG, 'R11：沒有綁定時原樣放行')

  console.log('13. 生成參數 OK — agent/request 接上了、房間蓋過酒館、留空原樣、不吃掉別人的決定')
}

/* ------------- stop 序列：同一條 waterfall 真的送到請求裡（2.6.56）------------- */

{
  /**
   * ⚠️ 為什麼 `test-samplers.mjs` 全綠還要在這裡再驗一次：那裡的 `resolveSamplers()`
   * 是純函式，而**純函式對不代表參數會到模型**——中間還隔著「`agent/request`
   * 有沒有把它展開進請求」。這一節驗的**只有那一格**（規則在 `test-samplers.mjs`）。
   *
   * 這一條與 12 節同一型：2.6.44 的 `ensureTheme()` 就是「純函式全綠、沒有人呼叫」。
   *
   * ⚠️ 而它這次多了一個理由：`stop` 是**第二種形狀**的欄位（清單，不是數字），
   * 所以「前兩個會過」不能推論「這一個也會過」——`samplerRequestFields()` 對它的
   * 判斷是另一條（要同時檢查不是 null 與長度大於 0）。
   */
  __clearCache()
  const dir = mkdtempSync(join(tmpdir(), 'dsh-tavern-stop-'))
  const root = join(dir, '酒館')
  const SID = 'session-stop-0000-1111-2222-333344445555'
  const ROOM = 'r-stop'

  mkdirSync(join(root, 'characters'), { recursive: true })
  mkdirSync(join(root, '.sessions'), { recursive: true })
  mkdirSync(join(root, 'chats', '老闆娘', ROOM), { recursive: true })
  writeFileSync(join(root, 'characters', '老闆娘.json'), JSON.stringify({ name: '老闆娘' }))
  writeFileSync(
    join(root, '.sessions', `${SID}.json`),
    JSON.stringify({ sessionId: SID, character: '老闆娘', room: ROOM, chat: '夜晚' }),
  )
  const writeTavern = (patch) =>
    writeFileSync(join(root, 'tavern.json'), JSON.stringify({ version: 1, ...patch }))
  const writeRoom = (patch) =>
    writeFileSync(join(root, 'chats', '老闆娘', ROOM, 'room.json'), JSON.stringify({ version: 1, ...patch }))
  writeTavern({})
  writeRoom({})

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
  apply(ctx, { card: '', user: '' })
  const request = listeners.get('agent/request')
  const payload = { agent: { id: SID, session: { header: { cwd: root } } }, turn: 1, step: 1 }
  const DSH_CONFIG = { provider: 'deepseek', model: 'deepseek-chat', reasoningEffort: 'high' }
  const run = async () => request(payload, () => Promise.resolve({ ...DSH_CONFIG }))

  // ① 沒設 → **不可以出現 `stop`**（連 `stop: []` 都不行：那在日誌上看起來像
  //    「有設一個空的」，而我們的意思是完全不要碰）。
  const untouched = await run()
  assert.deepEqual(untouched, DSH_CONFIG, '沒設定時不可以動任何欄位')
  assert.equal('stop' in untouched, false, '⚠️ 沒設定時不可以出現 stop（連空陣列也不行）')

  // ② **開關關著時，自填的 stop 也不會送出去**（2.6.57 的語意：開關是閘門）。
  //    ⚠️ 這一條是「有人只想留著自己的清單、但把開關關掉」時的正確行為；
  //    也是「舊的 tavern.json 只有 stop、沒有 stopEnabled」時的行為
  //    ——**不會**突然開始送（那是這一輪最重要的向後相容）。
  writeTavern({ stop: '使用者：\nUser:' })
  const switchOff = await run()
  assert.equal('stop' in switchOff, false, '⚠️ 開關沒開 ⇒ 自填的 stop 也不送（舊檔案的形狀）')

  // ③ 酒館開了開關 → 送到請求裡的是**內建那幾串 ＋ 自填**。
  writeTavern({ stop: '使用者：\nUser:', stopEnabled: true })
  const fromTavern = await run()
  assert.deepEqual(
    fromTavern.stop,
    STOP_PRESET.concat(['使用者：', 'User:']),
    '⚠️ 開關開著 ⇒ 送內建＋自填（內建在前，順序是給讀日誌的人看的）',
  )
  assert.deepEqual(
    [fromTavern.provider, fromTavern.model, fromTavern.reasoningEffort],
    [DSH_CONFIG.provider, DSH_CONFIG.model, DSH_CONFIG.reasoningEffort],
    '⚠️ 別人的決定要留著（同 12 節第 ② 條）',
  )
  // 開著但沒有自填 ⇒ 只送內建那幾串。
  writeTavern({ stopEnabled: true })
  const presetOnly = await run()
  assert.deepEqual(presetOnly.stop, STOP_PRESET, '開著、沒自填 ⇒ 就送內建那幾串')

  // ④ 自填的清單照樣是「房間蓋過酒館」（與溫度同一條規矩，不是聯集）。
  writeTavern({ stopEnabled: true })
  writeRoom({ stop: '房間的' })
  const fromRoom = await run()
  assert.deepEqual(
    fromRoom.stop,
    STOP_PRESET.concat(['房間的']),
    '⚠️ 房間的 stop 要蓋過酒館那一組自填的，不是兩層聯集',
  )

  // ⑤ ⚠️ **房間說「關」要蓋過酒館的「開」**——三態存在的全部理由。
  //    這一條錯了就是「我明明把這一間房關掉了，它還是在送」。
  writeTavern({ stopEnabled: true })
  writeRoom({ stopEnabled: false })
  const roomOff = await run()
  assert.equal('stop' in roomOff, false, '⚠️ 房間說關 ⇒ 連內建的都不送')

  // ⑥ 房間的 `null` ＝ 聽酒館的。
  writeTavern({ stopEnabled: true })
  writeRoom({ stopEnabled: null })
  const inherited = await run()
  assert.deepEqual(inherited.stop, STOP_PRESET, '房間的 null 要退回酒館（＝開）')

  // ⑦ 手改檔案寫了不合法的一組 → 當作沒設，**不可以**送出去。
  //    （一個 200 字的 stop 送到提供方，症狀是整個請求被拒絕，而那很難懂。）
  writeTavern({ stop: ['x'.repeat(200)], stopEnabled: true })
  const invalid = await run()
  assert.deepEqual(invalid.stop, STOP_PRESET, '⚠️ 自填那一組壞掉 ⇒ 只送內建的（不是整組消失）')

  writeTavern({})
  writeRoom({})
  rmSync(dir, { recursive: true, force: true })
  console.log('14. stop 序列 OK — 開關真的擋得住（房間的關蓋過酒館的開）、內建＋自填、別人的決定留著')
}

/* ------------- 回覆格式的指令真的進得了提示詞（2.6.57）------------- */

{
  /**
   * ⚠️ **這一節驗的是「指定」，而那是這一輪真正的新東西。**
   *
   * 客戶端早就有 `parseStructuredLine`／`parseMarkedRegions`（讀得懂結構化的一行
   * 與標記），但**沒有任何一份提示詞告訴模型要那樣寫**——所以永遠是
   * 「模型寫小說、我們在後面猜」，而 `choices`／`data` 這些 kind 一次都沒出現過。
   *
   * 這裡釘住的是那一條線：`render.json` → 提示詞。純函式（`renderDirective`）在
   * `test-render.mjs` 驗過了，這一節只驗**有沒有接到**（2.6.44 的
   * `ensureTheme()` 就是「純函式全綠、沒有人呼叫」那一型）。
   */
  __clearCache()
  const dir = mkdtempSync(join(tmpdir(), 'dsh-tavern-render-'))
  const root = join(dir, '酒館')
  mkdirSync(join(root, 'characters'), { recursive: true })
  writeFileSync(
    join(root, 'characters', '老闆娘.json'),
    JSON.stringify({ name: '老闆娘', description: '掌櫃的' }),
  )
  const cardFile = join(root, 'characters', '老闆娘.json')
  const writeRender = (payload) =>
    writeFileSync(join(root, 'render.json'), JSON.stringify({ version: 1, ...payload }))

  // ① 沒有 `render.json` ⇒ **一個字都不加**（這就是「既有對話行為不變」）。
  rmSync(join(root, 'render.json'), { force: true })
  assert.equal(renderDirectiveFor(cardFile), '', '⚠️ 沒有 render.json ⇒ 零指令')

  // ② `plain` 也一樣是零指令。
  writeRender({ mode: 'plain' })
  assert.equal(renderDirectiveFor(cardFile), '', '⚠️ plain ⇒ 零指令')

  // ③ `structured` ⇒ 指令真的出來了，而且含著 model 非知道不可的那幾句。
  writeRender({ mode: 'structured' })
  const structured = renderDirectiveFor(cardFile)
  assert.match(structured, /一行一個 JSON 物件/, 'structured 的指令要出來')
  assert.match(structured, /不要包成陣列/, '要含「不要包成陣列」')

  // ④ `marked` ⇒ 列出標記。
  writeRender({ mode: 'marked', markers: [{ tag: '台詞', kind: 'speech', who: '' }] })
  assert.match(renderDirectiveFor(cardFile), /<台詞>/, 'marked 的指令要列出標記')

  // ⑤ 壞掉的 render.json ⇒ 回預設（零指令），**不丟錯**。
  writeFileSync(join(root, 'render.json'), '{ 這不是 JSON')
  assert.equal(renderDirectiveFor(cardFile), '', '壞檔 ⇒ 落回 plain（零指令），不丟錯')

  /**
   * ⑥ ⚠️ **接線的最後一哩：它真的會被放進系統提示。**
   *
   * 上面驗的是那一支純函式，而這一條驗的是 `apply()` 有沒有**呼叫**它
   * ——少了它，`render.json` 就是一個存得起來、完全沒有作用的檔案。
   * 做法與 `test-client.mjs` 的 `ensureTheme(` 那條原始碼斷言同一型。
   */
  const source = readFileSync(new URL('./lib/agent.js', import.meta.url), 'utf8').replace(/\r\n/g, '\n')
  assert.ok(
    /const format = renderDirectiveFor\(cardFile\)/.test(source),
    '⚠️ card variable 裡要真的呼叫 renderDirectiveFor（不然 render.json 是死的）',
  )
  assert.ok(
    /if \(format !== ''\) parts\.push\(format\)/.test(source),
    '⚠️ 而且回空字串時**不可以** push（plain 模式要零指令）',
  )
  assert.ok(
    source.indexOf('renderDirectiveFor(cardFile)') < source.indexOf('tavernExtras(cardFile, names)'),
    '格式指令要在 persona／店規**之前**（那是「請你這樣回答」，比故事背景更基礎）',
  )

  writeRender({ mode: 'plain' })
  rmSync(dir, { recursive: true, force: true })
  console.log('15. 回覆格式 OK — render.json → 提示詞真的接上了、plain 與壞檔都是零指令')
}

console.log('\n全部通過 ✅')
