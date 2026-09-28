/**
 * 工作樓（節點圖）的測試。
 *
 * 這一塊最怕的四件事：
 *   1. **預設圖與現在的行為不一致**——使用者打開工作樓看到的那張圖，跑起來必須
 *      **就是**他現在的單人對話。不一致＝他以為自己在看自己的對話，其實不是。
 *   2. **壞掉的圖讓人打不開**——圖是使用者會手改的檔案（跟 `room.json` 一樣），
 *      為了一個打錯的字讓整頁炸掉是最糟的失敗方式。所以清洗要**丟掉並回報**。
 *   3. **既有房間被改到**——2.6.72 以前的房間沒有 `workflow` 鍵，行為必須一字不差。
 *   4. **有環的圖在執行時才卡死**——那時使用者已經送出一句話了。
 *
 * 用法：node test-workflow.mjs
 */
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  LAYOUT,
  NODE_TYPES,
  WORKFLOW_DIR,
  WORKFLOW_VERSION,
  defaultWorkflow,
  normalizeWorkflow,
  planRun,
  summarizeWorkflow,
  topoOrder,
  uniqueNodeId,
  validateWorkflow,
} from './lib/workflow.js'
import { RUN_KEEP, SUBDIRS, TavernWorkspace, defaultRoom, membersOf } from './lib/workspace.js'

/* --------------------------- 1. 預設圖＝現在的行為 ------------------------- */

{
  const graph = defaultWorkflow({ card: '老闆娘' })

  assert.equal(graph.version, WORKFLOW_VERSION)
  assert.deepEqual(
    graph.nodes.map((node) => node.type),
    ['input', 'cast', 'output'],
    '預設圖就是使用者說的那三個：使用者輸入 → 角色 → 輸出',
  )
  assert.deepEqual(
    graph.edges.map((edge) => `${edge.from}→${edge.to}`),
    ['input→cast', 'cast→output'],
    '一條路，沒有分岔——現在的單人對話就是這樣',
  )
  // 這一條是整個功能的根：**卡 id 寫在 cast 節點裡**，執行時不去猜。
  assert.equal(graph.nodes[1].config.card, '老闆娘', '角色節點要知道是哪一張卡')

  const check = validateWorkflow(graph)
  assert.equal(check.ok, true, '預設圖一定要是合法的：' + check.errors.join('｜'))
  assert.deepEqual(check.warnings, [], '而且沒有任何警告')

  const order = topoOrder(graph)
  assert.equal(order.ok, true)
  assert.deepEqual(order.layers, [['input'], ['cast'], ['output']], '三個節點三層，順序固定')

  // 排版：三個節點橫向排開，中間的距離就是 LAYOUT.dx（客戶端要畫得一樣）
  assert.equal(graph.nodes[0].at[0], LAYOUT.x0)
  assert.equal(graph.nodes[1].at[0] - graph.nodes[0].at[0], LAYOUT.dx)
  assert.equal(graph.nodes[2].at[0] - graph.nodes[1].at[0], LAYOUT.dx)

  // 沒有卡時也要生得出來（新酒館還沒有房主的那一瞬間）
  const blank = defaultWorkflow({})
  assert.equal(validateWorkflow(blank).ok, true, '沒有卡的預設圖仍然是合法的')
  assert.equal(blank.nodes[1].config.card, undefined, '沒有卡就不要編一個出來')
  assert.equal(validateWorkflow(blank).warnings.length, 1, '但要警告「還沒選角色卡」')

  const summary = summarizeWorkflow(graph)
  assert.deepEqual(
    { nodes: summary.nodes, edges: summary.edges, cards: summary.cards, broken: summary.broken },
    { nodes: 3, edges: 2, cards: ['老闆娘'], broken: false },
  )

  console.log('1. 預設圖 OK — 使用者輸入 → 角色（老闆娘） → 輸出，合法、三層、位置照 LAYOUT')
}

/* ------------------------------ 2. id 讓路 ------------------------------- */

{
  assert.equal(uniqueNodeId('cast', []), 'cast')
  assert.equal(uniqueNodeId('cast', ['cast']), 'cast-2', '第二個同名節點要讓路')
  assert.equal(uniqueNodeId('cast', ['cast', 'cast-2']), 'cast-3')
  assert.equal(uniqueNodeId('', []), 'node', '空字串不要變成空 id')
  assert.equal(uniqueNodeId('!!', []), 'node', '不合法的字元要換掉')
  assert.equal(uniqueNodeId('演出', []), '演出', '中文 id 可以（跟資料夾名的規則一致）')

  console.log('2. 節點 id OK — 重複／非法都會讓路，中文可以')
}

/* ---------------------------- 3. 清洗（壞掉的圖） -------------------------- */

{
  const cases = [
    {
      what: '不認得的型別',
      raw: { nodes: [{ id: 'x', type: 'teleport' }] },
      expect: '節點型別不認得：teleport',
    },
    {
      what: '接不到的線',
      raw: { nodes: [{ id: 'a', type: 'input' }], edges: [{ from: 'a', to: 'ghost' }] },
      expect: '線 a → ghost：接不到的節點，已忽略',
    },
    {
      what: '自己接自己',
      raw: { nodes: [{ id: 'a', type: 'input' }], edges: [{ from: 'a', to: 'a' }] },
      expect: '線 a → a：自己接自己，已忽略',
    },
    {
      what: '重複的線',
      raw: { nodes: [{ id: 'a', type: 'input' }, { id: 'b', type: 'output' }], edges: [{ from: 'a', to: 'b' }, { from: 'a', to: 'b' }] },
      expect: '線 a → b 重複，已忽略',
    },
    {
      what: 'config 裡有巢狀的東西',
      raw: { nodes: [{ id: 'a', type: 'cast', config: { card: 'x', deep: { nope: 1 } } }] },
      expect: 'a.config.deep：只接受字串／數字／布林／null',
    },
  ]
  for (const one of cases) {
    const { workflow, dropped } = normalizeWorkflow(one.raw)
    assert.ok(dropped.includes(one.expect), `${one.what}：要回報「${one.expect}」，實際 ${JSON.stringify(dropped)}`)
    // 丟掉壞的東西之後，剩下的仍然是一張形狀正確的圖（不會整張消失）
    assert.ok(Array.isArray(workflow.nodes) && Array.isArray(workflow.edges), one.what + '：清洗後仍然是圖')
  }

  // 重複的 id：後來的讓路，而且**線要跟著改**（不然線會接錯人）
  const dup = normalizeWorkflow({
    nodes: [
      { id: 'cast', type: 'cast', config: { card: 'A' } },
      { id: 'cast', type: 'cast', config: { card: 'B' } },
      { id: 'out', type: 'output' },
    ],
    edges: [{ from: 'cast', to: 'out' }],
  })
  assert.equal(dup.workflow.nodes[1].id, 'cast-2', '第二顆同名節點要改名')
  assert.equal(dup.workflow.nodes[1].config.card, 'B', '改名不可以把 config 弄丟')
  assert.ok(dup.dropped.some((line) => line.includes('重複或非法')), '要回報改了名字')

  // 整個檔案不是物件（例如使用者打了一個陣列）
  const array = normalizeWorkflow([1, 2, 3])
  assert.equal(array.workflow.nodes.length, 0, '不是物件時回一張空圖（不是丟錯）')
  assert.ok(array.dropped.some((line) => line.includes('不是一個物件')), '要說出來')

  // 不認得的版本：照讀，不要擋
  const future = normalizeWorkflow({ version: 99, nodes: [{ id: 'a', type: 'input' }] })
  assert.equal(future.workflow.version, WORKFLOW_VERSION, '版本一律寫回我們認得的這一個')
  assert.equal(future.workflow.nodes.length, 1, '未來的版本照讀')
  assert.ok(future.dropped.some((line) => line.includes('99')), '但要提一句')

  console.log('3. 清洗 OK — 五種壞掉的情況都有中文回報，剩下的仍然是一張圖')
}

/* --------------------------- 4. 驗證：錯誤 vs 警告 ------------------------ */

{
  const noInput = validateWorkflow(normalizeWorkflow({ nodes: [{ id: 'o', type: 'output' }] }).workflow)
  assert.equal(noInput.ok, false)
  assert.ok(noInput.errors.some((line) => line.includes('沒有「使用者輸入」')), '沒有起點＝錯誤')

  const noOutput = validateWorkflow(normalizeWorkflow({ nodes: [{ id: 'i', type: 'input' }] }).workflow)
  assert.equal(noOutput.ok, false, '沒有輸出＝錯誤')

  // ⚠️ 編輯到一半的圖（cast 還沒選卡）**不能是錯誤**，否則存不下去。
  const halfDone = normalizeWorkflow({
    nodes: [
      { id: 'i', type: 'input' },
      { id: 'c', type: 'cast' },
      { id: 'o', type: 'output' },
    ],
    edges: [{ from: 'i', to: 'c' }, { from: 'c', to: 'o' }],
  }).workflow
  const check = validateWorkflow(halfDone)
  assert.equal(check.ok, true, '還沒選卡仍然可以存')
  assert.ok(check.warnings.some((line) => line.includes('還沒選角色卡')), '但要警告')

  // 有環：錯誤（執行時會卡死，所以要在存檔／執行前就說）
  const cyclic = normalizeWorkflow({
    nodes: [
      { id: 'i', type: 'input' },
      { id: 'a', type: 'cast', config: { card: 'x' } },
      { id: 'b', type: 'cast', config: { card: 'y' } },
      { id: 'o', type: 'output' },
    ],
    edges: [{ from: 'i', to: 'a' }, { from: 'a', to: 'b' }, { from: 'b', to: 'a' }, { from: 'b', to: 'o' }],
  }).workflow
  const cycleCheck = validateWorkflow(cyclic)
  assert.equal(cycleCheck.ok, false, '有環＝錯誤')
  assert.ok(cycleCheck.errors.some((line) => line.includes('循環')), '要說出是循環')
  const cycleOrder = topoOrder(cyclic)
  assert.equal(cycleOrder.ok, false)
  assert.deepEqual(cycleOrder.layers, [], '拓撲排序失敗時不要回一半的順序')

  console.log('4. 驗證 OK — 沒有起點／沒有輸出／有環是錯誤，還沒選卡只是警告')
}

/* --------------------------- 5. 並聯＝同一層 ----------------------------- */

{
  const parallel = normalizeWorkflow({
    nodes: [
      { id: 'i', type: 'input' },
      { id: 'a', type: 'cast', config: { card: 'A' } },
      { id: 'b', type: 'cast', config: { card: 'B' } },
      { id: 'c', type: 'cast', config: { card: 'C' } },
      { id: 'o', type: 'output' },
    ],
    edges: [
      { from: 'i', to: 'a' },
      { from: 'i', to: 'b' },
      { from: 'i', to: 'c' },
    ],
  }).workflow
  const order = topoOrder(parallel)
  assert.equal(order.ok, true)
  // ⚠️ 這一條就是「並聯」的全部：三個角色節點在**同一層**。
  assert.deepEqual(order.layers[1].sort(), ['a', 'b', 'c'], '三個角色節點要落在同一層（＝同時跑）')
  // ⚠️ 沒有上游的節點都在第 0 層——包括那顆**沒有接線**的 output。
  //    這是刻意的：跑一張還沒接完的圖時，「沒有人餵東西給它」的節點就是沒有輸入，
  //    不是錯誤（編輯到一半的圖一定會這樣）。
  assert.equal(order.layers.length, 2, '兩層：沒有上游的那兩顆 → 三個角色節點')
  assert.deepEqual(order.layers[0].sort(), ['i', 'o'], '沒有上游的節點都在第 0 層')
  assert.equal(validateWorkflow(parallel).ok, true, '有 input 與 output，即使沒接線也合法')

  console.log('5. 拓撲 OK — 三個角色節點同一層＝並聯，不需要額外的機制')
}

/* ---------------------------- 6. 檔案層（workspace） ---------------------- */

{
  const root = mkdtempSync(join(tmpdir(), 'dsh-tavern-workflow-'))
  try {
    const ws = new TavernWorkspace(root)
    await ws.ensure()
    assert.ok(SUBDIRS.includes(WORKFLOW_DIR), 'workflows/ 要是酒館結構的一部分')
    assert.ok(readFileSync(join(root, 'README.txt'), 'utf8').length > 0, 'ensure() 還是要寫說明檔')

    // 既有的房間（沒有 workflow 鍵）→ 預設值必須是空字串，行為一字不差
    assert.equal(defaultRoom('x').workflow, '', '舊房間的預設值＝沒有綁圖')

    const created = await ws.createRoom('老闆娘', '初次見面')
    const roomId = created.room
    const inferred = await ws.roomWorkflow('老闆娘', roomId)
    assert.equal(inferred.source, 'default', '還沒綁圖時回**算出來的**預設圖')
    assert.equal(inferred.dangling, false)
    assert.equal(inferred.workflow.nodes[1].config.card, '老闆娘', '預設圖的 cast 節點＝房主')
    // ⚠️ 讀取只讀：問一次圖不可以生出任何檔案（`docs/plan.md` 的硬規則）
    assert.deepEqual(await ws.listWorkflows(), [], '問預設圖不可以寫檔')

    const written = await ws.writeWorkflow('演出', {
      name: '演出',
      nodes: [
        { id: 'i', type: 'input' },
        { id: 'c', type: 'cast', config: { card: '老闆娘' } },
        { id: 'o', type: 'output' },
      ],
      edges: [{ from: 'i', to: 'c' }, { from: 'c', to: 'o' }],
    })
    assert.equal(written.id, '演出', '圖的 id 可以由名稱推導（中文可以）')
    assert.deepEqual(written.errors, [])
    const onDisk = JSON.parse(readFileSync(join(root, WORKFLOW_DIR, '演出.json'), 'utf8'))
    assert.equal(onDisk.id, '演出', '檔案裡的 id ＝檔名（身分以檔名為準）')
    assert.equal(onDisk.nodes.length, 3)

    await ws.writeRoom('老闆娘', roomId, { workflow: written.id })
    const bound = await ws.roomWorkflow('老闆娘', roomId)
    assert.equal(bound.source, 'file', '綁了圖就跑那一張')
    assert.equal(bound.id, '演出')

    // 圖被刪掉 → 退回預設並回報 dangling（**不丟錯**：整頁打不開是最糟的）
    await ws.deleteWorkflow(written.id)
    const dangling = await ws.roomWorkflow('老闆娘', roomId)
    assert.equal(dangling.source, 'default')
    assert.equal(dangling.dangling, true, '要說「你原本用的圖不見了」')
    assert.equal(dangling.workflow.nodes[1].config.card, '老闆娘', '退回的預設圖仍然是這一房的')

    // 非法 id／路徑跳脫：不可以寫進 room.json，而且**原本的值要留著**
    // （這跟生成參數那條規矩一樣：壞值回報 `dropped`，不覆蓋原本的設定）
    const before = (await ws.readRoom('老闆娘', roomId)).workflow
    const bad = await ws.writeRoom('老闆娘', roomId, { workflow: '../evil' })
    assert.ok(Array.isArray(bad.dropped) && bad.dropped.some((line) => line.includes('workflow')), '要回報不合法')
    const after = (await ws.readRoom('老闆娘', roomId)).workflow
    assert.equal(after, before, '不合法的值不可以落地，原本的綁定也不可以被清掉')
    assert.notEqual(after, '../evil')

    // 解綁（三態的第三態）
    await ws.writeRoom('老闆娘', roomId, { workflow: '演出' })
    await ws.writeRoom('老闆娘', roomId, { workflow: '' })
    assert.equal((await ws.roomWorkflow('老闆娘', roomId)).source, 'default', '解綁＝回到預設圖')

    // 有環的圖**照樣存**（使用者正在編輯），但回報錯誤——執行那一端才擋
    const saved = await ws.writeWorkflow('壞掉', {
      nodes: [
        { id: 'i', type: 'input' },
        { id: 'c', type: 'cast', config: { card: 'x' } },
        { id: 'o', type: 'output' },
      ],
      edges: [{ from: 'i', to: 'c' }, { from: 'c', to: 'o' }, { from: 'o', to: 'c' }],
    })
    assert.ok(saved.errors.some((line) => line.includes('循環')), '要回報循環')
    assert.ok((await ws.listWorkflows()).some((row) => row.id === '壞掉'), '但圖要留在磁碟上（不要丟掉使用者的編輯）')

    // 壞掉的 JSON 要被列出來（不是消失）
    writeFileSync(join(root, WORKFLOW_DIR, '手改壞的.json'), '{ 這不是 JSON')
    const listed = await ws.listWorkflows()
    const brokenRow = listed.find((row) => row.id === '手改壞的')
    assert.ok(brokenRow !== undefined, '壞掉的檔案不可以從清單上消失')
    assert.equal(brokenRow.broken, true)
    assert.equal(brokenRow.summary, null, '壞掉的圖不要給一份看起來正常的摘要')
    const readBroken = await ws.readWorkflow('手改壞的')
    assert.equal(readBroken.broken, true)
    assert.deepEqual(readBroken.workflow.nodes, [], '壞掉時回一張空圖，不丟錯')

    // 不存在的圖：exists:false（而且不丟錯）
    const missing = await ws.readWorkflow('沒有這張')
    assert.equal(missing.exists, false)
    assert.equal(missing.broken, false)

    console.log('6. 檔案層 OK — 預設圖不落地、綁定／解綁／dangling、壞檔照列、有環照存但回報')
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
}

/* --------------------------- 6b. 執行計畫（宿主算、客戶端跑） ---------------- */

{
  const graph = normalizeWorkflow({
    nodes: [
      { id: 'i', type: 'input' },
      { id: 'a', type: 'cast', config: { card: 'A' } },
      { id: 'b', type: 'cast', config: { card: 'B' } },
      { id: 'o', type: 'output' },
    ],
    edges: [
      { from: 'i', to: 'a' },
      { from: 'i', to: 'b' },
      { from: 'a', to: 'o' },
      { from: 'b', to: 'o' },
    ],
  }).workflow
  const planned = planRun(graph)
  assert.equal(planned.ok, true, '合法的圖要有計畫')
  assert.deepEqual(planned.layers[0].map((one) => one.id), ['i'])
  assert.deepEqual(planned.layers[1].map((one) => one.id), ['a', 'b'], '同一層＝同時跑')
  assert.deepEqual(planned.layers[2].map((one) => one.id), ['o'])

  // ⚠️ `from` 的順序＝**拉線的順序**（不是字母序）：那是使用者唯一能表達先後的東西。
  const sink = planned.layers[2][0]
  assert.deepEqual(sink.from, ['a', 'b'], '上游要照 edges 的順序排')
  assert.equal(sink.type, 'output')
  assert.deepEqual(planned.layers[1][0].config, { card: 'A' }, 'config 要跟著節點進計畫')

  // 有環 → 沒有計畫（而且**不要回一半的順序**：跑一半的圖比不跑更難查）
  const cyclic = normalizeWorkflow({
    nodes: [{ id: 'i', type: 'input' }, { id: 'o', type: 'output' }],
    edges: [{ from: 'i', to: 'o' }, { from: 'o', to: 'i' }],
  }).workflow
  const refused = planRun(cyclic)
  assert.equal(refused.ok, false)
  assert.deepEqual(refused.layers, [], '沒有計畫時不要回一半的層')
  assert.ok(refused.error.includes('循環'))

  console.log('6b. 執行計畫 OK — 分層、上游照拉線順序、有環就沒有計畫')
}

/* --------------------------- 6c. 執行紀錄（runs/） ------------------------- */

{
  const root = mkdtempSync(join(tmpdir(), 'dsh-tavern-runs-'))
  try {
    const ws = new TavernWorkspace(root)
    await ws.ensure()
    const created = await ws.createRoom('老闆娘', '紀錄房')
    const roomId = created.room

    assert.deepEqual(await ws.listRuns('老闆娘', roomId), [], '還沒有跑過＝空的')

    await ws.appendRunLines('老闆娘', roomId, 'run-a', [
      { node: 'input', type: 'input', at: '2026-09-28T10:00:00.000Z', ms: 1, out: '哈囉' },
      {
        node: 'cast',
        type: 'cast',
        at: '2026-09-28T10:00:02.000Z',
        ms: 2000,
        out: '（她抬起頭）',
        // ⚠️ 這一顆鍵不是單純的值 → 要**丟掉**（這一列是證據，不是小資料庫）
        nested: { nope: true },
        // ⚠️ 超長的字要截斷（模型輸出可能很長，而它會被寫成一行）
        huge: 'x'.repeat(30000),
      },
    ])
    await ws.appendRunLines('老闆娘', roomId, 'run-a', [
      { node: 'output', type: 'output', at: '2026-09-28T10:00:02.500Z', ms: 3, failed: true },
    ])

    const one = await ws.readRun('老闆娘', roomId, 'run-a')
    assert.equal(one.lines.length, 3, '追加的每一行都要在（同一個 run 分兩次送）')
    assert.equal(one.broken, 0)
    assert.equal(one.lines[1].nested, undefined, '不是單純值的鍵要被丟掉')
    assert.ok(one.lines[1].huge.length < 30000, '過長的字要截斷')
    assert.ok(one.lines[1].huge.includes('已截斷'), '而且要說它被截斷了')

    const summary = (await ws.listRuns('老闆娘', roomId)).find((row) => row.run === 'run-a')
    assert.equal(summary.nodes, 3)
    assert.equal(summary.failed, 1, '有失敗的節點要算出來（清單上要看得到）')
    assert.equal(summary.ms, 2004, '時間要加總')
    assert.equal(summary.at, '2026-09-28T10:00:00.000Z', '時間軸的第一個時間＝這一輪的開始')

    // 壞掉的行要跳過但**要說**（安靜地少幾行比壞掉更糟）
    writeFileSync(join(root, 'chats', '老闆娘', roomId, 'runs', 'run-a.jsonl'), '{ 壞行\n', { flag: 'a' })
    const withBroken = await ws.readRun('老闆娘', roomId, 'run-a')
    assert.equal(withBroken.lines.length, 3, '壞掉的行不進 lines')
    assert.equal(withBroken.broken, 1, '但要回報有幾行壞掉')

    // 上限：只留最新的 RUN_KEEP 份
    for (let n = 0; n < RUN_KEEP + 3; n += 1) {
      await ws.appendRunLines('老闆娘', roomId, `keep-${String(n)}`, [{ node: 'input', ms: 1 }])
    }
    const kept = await ws.listRuns('老闆娘', roomId)
    assert.ok(kept.length <= RUN_KEEP, `最多留 ${String(RUN_KEEP)} 份，實際 ${String(kept.length)}`)
    assert.ok(kept.length > 0)

    // 讀不到＝可行動的錯誤（帶相對路徑）
    await assert.rejects(() => ws.readRun('老闆娘', roomId, '沒有這一份'), /runs\//)

    console.log(`6c. 執行紀錄 OK — 追加、摘要、截斷、壞行回報、上限 ${String(RUN_KEEP)} 份`)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
}

/* ------------------------- 6d. 多人房間（cast 與預設圖） -------------------- */

{
  // ── 預設圖：成員一人一顆角色節點，並聯接去輸出 ──
  const many = defaultWorkflow({ card: '老闆娘', cast: ['老闆娘', '酒保', '常客'] })
  assert.deepEqual(
    many.nodes.map((node) => `${node.id}:${node.type}`),
    ['input:input', 'cast:cast', 'cast-2:cast', 'cast-3:cast', 'output:output'],
    '三個成員＝三顆角色節點',
  )
  assert.deepEqual(
    many.nodes.slice(1, 4).map((node) => node.config.card),
    ['老闆娘', '酒保', '常客'],
    '⚠️ 順序照 cast（那是有意義的：預設圖的節點順序）',
  )
  assert.deepEqual(
    many.edges.map((edge) => `${edge.from}→${edge.to}`),
    ['input→cast', 'cast→output', 'input→cast-2', 'cast-2→output', 'input→cast-3', 'cast-3→output'],
    '⚠️ 預設是**並聯**（每個成員各自看使用者的輸入），不是串聯',
  )
  const layers = topoOrder(many)
  assert.deepEqual(layers.layers[1], ['cast', 'cast-2', 'cast-3'], '三顆成員節點同一層＝同時跑')
  assert.equal(validateWorkflow(many).ok, true, '多人的預設圖也要合法')
  // 輸入與輸出要在成員的**垂直中間**（不然圖會歪一邊）
  assert.equal(many.nodes[0].at[1], 300, '輸入要置中（三顆成員＝中間那一顆的 y）')
  assert.equal(many.nodes[4].at[1], 300, '輸出也一樣')

  // 一個成員都沒有時：還是留一顆**沒有卡**的角色節點（看得見的「還沒選人」）
  const empty = defaultWorkflow({ cast: [] })
  assert.equal(empty.nodes.length, 3, '沒有成員時仍然是三個節點')
  assert.equal(empty.nodes[1].config.card, undefined, '而且不編一個卡 id 出來')
  assert.equal(
    validateWorkflow(empty).warnings.length,
    1,
    '⚠️ 要警告「還沒選角色卡」——不然那張圖會把你說的話當成角色的回覆寫進紀錄',
  )

  // `membersOf`：**唯一**算成員名單的地方
  assert.deepEqual(membersOf({ cast: [] }, '房主'), ['房主'], '空名單＝單人房（既有房間的行為）')
  assert.deepEqual(membersOf({}, '房主'), ['房主'], '沒有那個鍵也一樣')
  assert.deepEqual(membersOf({ cast: ['B', 'B', ' A ', ''] }, '房主'), ['B', 'A'], '去重、去空白')
  assert.deepEqual(membersOf({ cast: ['B'] }, '房主'), ['B'], '⚠️ 房主不一定在 cast 裡')

  const root = mkdtempSync(join(tmpdir(), 'dsh-tavern-cast-'))
  try {
    const ws = new TavernWorkspace(root)
    await ws.ensure()
    // 兩張卡（`character.create` 需要卡物件；這裡用「寫一個空殼」的最小形狀）
    await ws.writeCharacter('老闆娘', { name: '老闆娘' })
    await ws.writeCharacter('酒保', { name: '酒保' })
    const created = await ws.createRoom('老闆娘', '群聊房')
    const roomId = created.room

    // 沒有指定過 → 成員就是房主
    const rows = await ws.listRooms('老闆娘')
    assert.deepEqual(rows[0].cast, ['老闆娘'], '清單要帶成員（客戶端畫那個膠囊列）')
    assert.equal(rows[0].castDeclared, false)

    const saved = await ws.writeRoom('老闆娘', roomId, { cast: ['老闆娘', '酒保', '不存在的人'] })
    assert.deepEqual(saved.cast, ['老闆娘', '酒保'], '⚠️ 只收認得的卡（打錯的名字不可以留下來）')
    assert.ok(
      Array.isArray(saved.dropped) && saved.dropped.some((line) => line.includes('不存在的人')),
      '不認得的要回報：' + JSON.stringify(saved.dropped),
    )

    // 這一間房的工作樓預設圖要照成員畫
    const graph = await ws.roomWorkflow('老闆娘', roomId)
    assert.equal(graph.source, 'default')
    assert.deepEqual(
      graph.workflow.nodes.filter((node) => node.type === 'cast').map((node) => node.config.card),
      ['老闆娘', '酒保'],
      '⚠️ 多人房間打開工作樓＝看到「這一間房有誰」',
    )

    // 空陣列＝回到單人房
    await ws.writeRoom('老闆娘', roomId, { cast: [] })
    assert.deepEqual((await ws.listRooms('老闆娘'))[0].cast, ['老闆娘'], '清空＝回到房主一個人')
    assert.equal((await ws.listRooms('老闆娘'))[0].castDeclared, false)

    // 壞形狀：不是陣列 → 回報，而且**原本的成員要留著**
    await ws.writeRoom('老闆娘', roomId, { cast: ['老闆娘', '酒保'] })
    const bad = await ws.writeRoom('老闆娘', roomId, { cast: '酒保' })
    assert.ok(
      Array.isArray(bad.dropped) && bad.dropped.some((line) => line.includes('cast')),
      '要回報形狀不對',
    )
    assert.deepEqual((await ws.listRooms('老闆娘'))[0].cast, ['老闆娘', '酒保'], '壞值不覆蓋原本的成員')

    console.log('6d. 多人房間 OK — cast 只收認得的卡、空＝房主、預設圖照成員畫（並聯）')
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
}

/* --------------------------- 7. 節點型別沒有走散 -------------------------- */

{
  // 這一份清單是**契約**：`type` 只有這三種，別的地方（客戶端、文件）都靠它。
  assert.deepEqual(NODE_TYPES, ['input', 'cast', 'output'], 'v1 的節點型別就是這三個')
  console.log('7. 節點型別 OK —', NODE_TYPES.join('／'))
}

console.log('\n全部通過 ✅ 工作樓的圖層與檔案層都對')
