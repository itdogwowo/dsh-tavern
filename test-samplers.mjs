/**
 * `lib/samplers.js` 的測試：生成參數的驗證與「誰蓋過誰」。
 *
 * 為什麼這一支值得一個獨立的測試檔：它是**純函式**，而它的三個呼叫端
 * （`workspace.js` 寫入時驗、`agent.js` 每一輪算、客戶端顯示）**必須對同一組
 * 值有同樣的看法**。純函式測得動，就沒有理由只靠整合測試去碰。
 *
 * 用法：node test-samplers.mjs
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

import {
  MAX_TOKENS_RANGE,
  SAMPLER_KEYS,
  TEMPERATURE_RANGE,
  maxTokensProblem,
  normalizeMaxTokens,
  normalizeTemperature,
  resolveSamplers,
  samplerRequestFields,
  temperatureProblem,
} from './lib/samplers.js'

const { TAVERN_BUILD } = await import('./lib/index.js')
const manifest = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'))
assert.equal(TAVERN_BUILD, 'tavern-' + manifest.version, '版本標記要對得上 package.json')
console.log('1. 匯出 OK —', TAVERN_BUILD)

/* ------------------------------- temperature ------------------------------- */

{
  // 合法值：數字與**數字字串**都收（`<input type="number">` 在某些情況下給字串，
  // 而 `tavern.json` 是可以手改的）。
  for (const [input, expected] of [
    [0, 0],
    [0.8, 0.8],
    ['0.8', 0.8],
    [1, 1],
    ['1.25', 1.25],
    [2, 2],
    [' 0.7 ', 0.7],
  ]) {
    assert.equal(temperatureProblem(input), '', `${JSON.stringify(input)} 應該合法`)
    assert.equal(normalizeTemperature(input), expected, `${JSON.stringify(input)} → ${expected}`)
  }

  // 兩位小數就夠了——而且避免浮點尾巴寫進 JSON。
  assert.equal(normalizeTemperature(0.123456), 0.12, '要收斂到兩位小數')
  assert.equal(normalizeTemperature('0.005'), 0.01, '四捨五入到兩位小數')

  // 沒有設定：`null`／`undefined`／空字串都算「清除」，**不是錯誤**。
  for (const empty of [null, undefined, '']) {
    assert.equal(temperatureProblem(empty), '', `${JSON.stringify(empty)} 是「清除」，不是錯誤`)
    assert.equal(normalizeTemperature(empty), null, `${JSON.stringify(empty)} → null`)
  }

  // 不合法：**判定不合法，不是夾到邊界**。
  // 把 5 靜靜變成 2 會讓使用者以為自己設成功了——那是這一組欄位最糟的失敗方式。
  assert.match(temperatureProblem(2.5), /0 到 2/, '超出上限要說出範圍')
  assert.match(temperatureProblem(-0.5), /0 到 2/, '低於下限也要擋')
  assert.match(temperatureProblem('熱一點'), /要是數字/, '不是數字要說清楚')
  assert.match(temperatureProblem(Number.NaN), /要是數字/, 'NaN 擋掉')
  assert.match(temperatureProblem(Number.POSITIVE_INFINITY), /要是數字/, 'Infinity 擋掉')
  assert.equal(normalizeTemperature(2.5), null, '不合法的值正規化之後是「沒有設定」')
  assert.equal(normalizeTemperature('熱一點'), null, '同上')

  // 邊界剛好合法（`>= min` 與 `<= max`，不是嚴格不等式）。
  assert.equal(temperatureProblem(0), '', '0 是合法的（＝最保守）')
  assert.equal(temperatureProblem(2), '', '2 是合法的（＝最發散）')
  assert.equal(TEMPERATURE_RANGE.min, 0)
  assert.equal(TEMPERATURE_RANGE.max, 2)

  console.log('2. temperature OK — 0～2、數字字串也收、超範圍判定不合法（不夾邊界）')
}

/* -------------------------------- maxTokens -------------------------------- */

{
  for (const [input, expected] of [
    [1, 1],
    [512, 512],
    ['1000', 1000],
    [200000, 200000],
  ]) {
    assert.equal(maxTokensProblem(input), '', `${JSON.stringify(input)} 應該合法`)
    assert.equal(normalizeMaxTokens(input), expected, `${JSON.stringify(input)} → ${expected}`)
  }

  for (const empty of [null, undefined, '']) {
    assert.equal(maxTokensProblem(empty), '', `${JSON.stringify(empty)} 是「清除」`)
    assert.equal(normalizeMaxTokens(empty), null, `${JSON.stringify(empty)} → null`)
  }

  // token 數一定是整數：3.5 個 token 沒有意義，而且真的送出去會被提供方拒絕。
  assert.match(maxTokensProblem(3.5), /整數/, '小數要擋')
  assert.match(maxTokensProblem(0), /1 到 200000/, '0 不是合法的 token 數')
  assert.match(maxTokensProblem(-1), /1 到 200000/, '負數要擋')
  assert.match(maxTokensProblem(1e9), /1 到 200000/, '明顯不是 token 數的要擋')
  assert.match(maxTokensProblem('很多'), /要是數字/, '不是數字要說清楚')
  assert.equal(normalizeMaxTokens(3.5), null, '不合法 → null')

  assert.equal(MAX_TOKENS_RANGE.min, 1)
  assert.equal(MAX_TOKENS_RANGE.max, 200000)

  console.log('3. maxTokens OK — 正整數、1～200000、小數與負數都擋、留空＝清除')
}

/* --------------------------- 誰蓋過誰（resolve）--------------------------- */

{
  // 兩層都沒設 → 兩個都 `null`（＝不要碰 DSH 的決定）。
  assert.deepEqual(
    resolveSamplers({}, {}),
    { temperature: null, maxTokens: null },
    '什麼都沒有時不可以塞任何預設值',
  )
  assert.deepEqual(
    resolveSamplers(null, null),
    { temperature: null, maxTokens: null },
    '兩層都讀不到（null）也不能丟錯',
  )
  assert.deepEqual(
    resolveSamplers(undefined, undefined),
    { temperature: null, maxTokens: null },
    'undefined 也一樣',
  )

  // 只有酒館設 → 用酒館的。
  assert.deepEqual(
    resolveSamplers({ temperature: 0.8, maxTokens: 512 }, {}),
    { temperature: 0.8, maxTokens: 512 },
    '酒館設了就用酒館的',
  )

  // 房間蓋過酒館（與 `allowTools` 同一條規矩），而且是**逐欄位**蓋。
  assert.deepEqual(
    resolveSamplers({ temperature: 0.8, maxTokens: 512 }, { temperature: 1.4 }),
    { temperature: 1.4, maxTokens: 512 },
    '房間只蓋它自己有設的那一欄（maxTokens 要沿用酒館的）',
  )
  assert.deepEqual(
    resolveSamplers({ temperature: 0.8 }, { maxTokens: 256 }),
    { temperature: 0.8, maxTokens: 256 },
    '反過來也一樣',
  )

  // 房間的 `null` ＝ 聽酒館的（那是房間的預設值）。
  assert.deepEqual(
    resolveSamplers({ temperature: 0.8, maxTokens: 512 }, { temperature: null, maxTokens: null }),
    { temperature: 0.8, maxTokens: 512 },
    '房間的 null 是「聽酒館的」，不是「把酒館的清掉」',
  )

  // ⚠️ 手改檔案寫了不合法的值 → 當作沒設（往下退），**不是**讓它生效。
  assert.deepEqual(
    resolveSamplers({ temperature: 99 }, {}),
    { temperature: null, maxTokens: null },
    '酒館層寫了 99 → 當作沒設（不是夾到 2）',
  )
  assert.deepEqual(
    resolveSamplers({ temperature: 0.8 }, { temperature: 99 }),
    { temperature: 0.8, maxTokens: null },
    '房間層寫壞了要**退回酒館**，不是變成沒設',
  )

  // 不是物件（陣列／字串／數字）也不能丟錯。
  for (const junk of [[], 'x', 7, true]) {
    assert.deepEqual(
      resolveSamplers(junk, junk),
      { temperature: null, maxTokens: null },
      `${JSON.stringify(junk)} 當作沒有設定`,
    )
  }

  console.log('4. 誰蓋過誰 OK — 房間逐欄位蓋過酒館、null＝聽上一層、壞值退回、不丟錯')
}

/* --------------------------- 展開成請求欄位 --------------------------- */

{
  assert.deepEqual(samplerRequestFields({ temperature: null, maxTokens: null }), {}, '沒設就不帶欄位')
  assert.deepEqual(
    samplerRequestFields({ temperature: 0.8, maxTokens: null }),
    { temperature: 0.8 },
    '只有 temperature 時**不可以**帶一個 maxTokens: null 出去',
  )
  assert.deepEqual(
    samplerRequestFields({ temperature: 0.8, maxTokens: 512 }),
    { temperature: 0.8, maxTokens: 512 },
    '兩個都有就兩個都帶',
  )
  // `0` 是合法值，不可以被 falsy 判斷吃掉（那是這一類程式碼的經典 bug）。
  assert.deepEqual(
    samplerRequestFields({ temperature: 0, maxTokens: 1 }),
    { temperature: 0, maxTokens: 1 },
    'temperature 0 與 maxTokens 1 都要帶出去（0 不是「沒有」）',
  )
  assert.deepEqual(samplerRequestFields(null), {}, 'null 也不能丟錯')

  console.log('5. 請求欄位 OK — 沒設就不帶、0 不會被當成「沒有」')
}

/* ------------------------------ 契約（給未來的人）------------------------------ */

{
  // ⚠️ **`top_p` 不會、也不該出現在這裡。**
  //
  // DSH 的 `LlmCallConfig` 欄位是 provider／model／reasoningEffort／temperature／
  // maxTokens／stop——**沒有 top_p**（`dsh-llm/lib/types/call-config.d.ts`）。
  // 而且那不是「還沒做」，是**DSH 刻意拿掉的**：它的 README 寫在
  // 「Known limitations and deferred work」（`dsh-llm/README.md:154`）——
  //   > GenerateOptions sampling is temperature/maxTokens/stop only
  //   > — no tool_choice, top_p, or penalty fields
  // 後面掛的設計註記叫 `drop-inert-request-knobs`（拿掉沒有作用的旋鈕）。
  // 也就是說「做一個存得起來但不會生效的參數」正是 DSH 自己判定要避免的事。
  //
  // 使用者要求過 top_p，而那是**做不到**的：做一個存得起來、送不出去的欄位，
  // 比沒有這個欄位更糟（他會調它、存它、以為它生效了）。
  //
  // 這一條釘住「有人想順手補上 top_p」的那一刻：那個人必須先改這裡，
  // 而改這裡的時候他就會看到上面那一段理由。
  assert.deepEqual(SAMPLER_KEYS, ['temperature', 'maxTokens'], '只有這兩個是 DSH 支援的')
  assert.equal(SAMPLER_KEYS.includes('topP'), false, 'top_p 不在 DSH 的介面裡，不要做')
  assert.equal(SAMPLER_KEYS.includes('top_p'), false, '同上')

  // 純模組：只准 import `node:` 與相對檔案（見 AGENTS.md 的零執行期依賴）。
  // 這一支目前**一個 import 都沒有**——加 import 的時候要守住同一條規矩。
  const source = readFileSync(new URL('./lib/samplers.js', import.meta.url), 'utf8')
  const imports = [...source.matchAll(/^\s*import\s[^\n]*from\s*'([^']+)'/gm)].map((m) => m[1])
  for (const spec of imports) {
    assert.ok(
      spec.startsWith('node:') || spec.startsWith('./') || spec.startsWith('../'),
      `零執行期依賴：不可以 import ${spec}`,
    )
  }

  console.log('6. 契約 OK — 只有 DSH 真的支援的兩個欄位、沒有 top_p、零執行期依賴')
}

console.log('\n全部通過 ✅')
