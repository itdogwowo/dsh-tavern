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
  STOP_ENABLED_KEY,
  STOP_LIMITS,
  STOP_PRESET,
  TEMPERATURE_RANGE,
  effectiveStop,
  maxTokensProblem,
  normalizeMaxTokens,
  normalizeStop,
  normalizeTemperature,
  resolveSamplers,
  samplerRequestFields,
  stopProblem,
  stopToText,
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

/* --------------------------------- stop --------------------------------- */

{
  /**
   * `stop` 是**閘門**，不是旋鈕——規矩與上面兩個欄位不一樣的地方都在這一節。
   *
   * 最容易被搞錯的一條（而它會靜靜地做錯事）：**空陣列與 `null` 都是「沒有設定」**。
   * 只認 `null` 的話，`stop: []` 會被當成「有一個 stop 欄位，裡面沒有東西」送出去
   * ——那在日誌上與「沒有這個欄位」長得一樣，但請求內容不同。
   */
  const UNSET = [null, undefined, '', []]
  for (const empty of UNSET) {
    assert.equal(stopProblem(empty), '', `${JSON.stringify(empty)} 是「清除」，不是錯誤`)
    assert.equal(normalizeStop(empty), null, `${JSON.stringify(empty)} → null（不是 []）`)
  }

  // ⚠️ **一行一個**：textarea 給的就是一整段文字，拆行是這一支的責任
  // （客戶端刻意不自己拆——兩邊各拆一份就會出現「預覽一種、送出另一種」）。
  assert.equal(stopProblem('使用者：\nUser:'), '', '一整段文字（一行一個）是合法的')
  assert.deepEqual(normalizeStop('使用者：\nUser:'), ['使用者：', 'User:'], '要拆成兩項')
  // 兩台機器的換行都要吃：Windows 的 textarea 送的是 CRLF。
  assert.deepEqual(normalizeStop('A\r\nB'), ['A', 'B'], 'CRLF 也要拆得開')
  assert.deepEqual(normalizeStop('A\rB'), ['A', 'B'], '純 CR 也一樣')

  // 已經是陣列（`tavern.json` 是手改得到的）⇒ 原樣驗、原樣正規化。
  assert.deepEqual(normalizeStop(['A', 'B']), ['A', 'B'], '陣列直接收')

  // 頭尾空白是**貼上來的產物**，要去掉；**內部**的空白是使用者要擋的字串，不准動。
  assert.deepEqual(normalizeStop(['  A  ', ' B C ']), ['A', 'B C'], 'trim 頭尾，不動中間')
  assert.deepEqual(normalizeStop('\n\n A \n\n'), ['A'], '空行是「沒有這一個」，不是錯誤')
  assert.equal(stopProblem('多按幾次 Enter\n\n\n'), '', '空行不該讓整份設定存不下去')

  // 完全相同的去重（比對的是 trim 之後的值），而且是**保留順序**的。
  assert.deepEqual(normalizeStop(['A', 'A', ' A ', 'B']), ['A', 'B'], '完全相同的去重')
  assert.deepEqual(normalizeStop(['B', 'A', 'B']), ['B', 'A'], '⚠️ 順序照使用者寫的，不排序')
  // ⚠️ 只差一個字元的是**兩個不同的閘門**，不可以被當成重複。
  assert.deepEqual(normalizeStop(['User:', 'User: ']), ['User:'], 'trim 之後相同才算重複')
  assert.deepEqual(normalizeStop(['User:', 'user:']), ['User:', 'user:'], '大小寫不同＝不同閘門')

  // 上限：數量與長度。數字來自 `STOP_LIMITS`（**我們選的**，不是 DSH 的）。
  const many = Array.from({ length: STOP_LIMITS.count }, (_, i) => `s${i}`)
  assert.equal(stopProblem(many), '', '剛好到上限是合法的')
  assert.match(
    stopProblem([...many, 'one-too-many']),
    new RegExp(String(STOP_LIMITS.count)),
    '超過數量上限要說出上限是幾個',
  )
  assert.equal(
    stopProblem(['x'.repeat(STOP_LIMITS.length)]),
    '',
    '剛好到長度上限是合法的',
  )
  assert.match(
    stopProblem(['x'.repeat(STOP_LIMITS.length + 1)]),
    new RegExp(String(STOP_LIMITS.length)),
    '超過長度上限要說出上限是幾個字',
  )
  assert.equal(normalizeStop([...many, 'one-too-many']), null, '不合法 → null（不是截斷）')

  // 型別：一個數字、一個 `true`、清單裡夾了非字串——全部要擋，而且講得出原因。
  for (const junk of [7, true, {}]) {
    assert.match(stopProblem(junk), /一組字串/, `${JSON.stringify(junk)} 要擋`)
    assert.equal(normalizeStop(junk), null, `${JSON.stringify(junk)} → null`)
  }
  assert.match(stopProblem([1]), /每一項都要是文字/, '清單裡夾非字串要擋')
  assert.equal(normalizeStop([1, 'A']), null, '有一項壞掉就整組不收（不是默默跳過）')

  // 反向：清單 → textarea 的文字。
  assert.equal(stopToText(['A', 'B']), 'A\nB', '一行一個')
  assert.equal(stopToText(null), '', '沒有設定 ⇒ 空字串（不是 "null"）')
  assert.equal(stopToText([]), '', '空陣列也一樣')
  assert.equal(stopToText('A\nB'), 'A\nB', '餵字串也讀得懂（它會先正規化）')
  assert.equal(stopToText(['A', 'A']), 'A', '讀出來的是正規化過的那一份')

  // 真正的界線：`STOP_LIMITS` 的兩個數字要與文件寫的一致（16／64）。
  assert.deepEqual(STOP_LIMITS, { count: 16, length: 64 }, 'Stop 的上限就是這兩個數字')

  console.log('4. stop OK — 一行一個、trim 頭尾不動中間、完全相同的去重、數量與長度上限、壞值擋掉')
}

/* --------------------------- 誰蓋過誰（resolve）--------------------------- */

{
  // ⚠️ 每一個預期的物件都要把**四個欄位全部寫出來**。
  // `assert.deepEqual` 是雙向的，所以漏寫一個的話「多回一個欄位」也會紅
  // ——這一組斷言的價值就在這裡：它同時釘住「值對不對」與「有沒有少／多欄位」。
  const UNSET_ALL = { temperature: null, maxTokens: null, stop: null, stopEnabled: false }

  // 兩層都沒設 → 三個 `null` ＋ 開關**關**（＝不要碰 DSH 的決定）。
  assert.deepEqual(resolveSamplers({}, {}), UNSET_ALL, '什麼都沒有時不可以塞任何預設值')
  assert.deepEqual(resolveSamplers(null, null), UNSET_ALL, '兩層都讀不到（null）也不能丟錯')
  assert.deepEqual(resolveSamplers(undefined, undefined), UNSET_ALL, 'undefined 也一樣')

  // 只有酒館設 → 用酒館的。
  assert.deepEqual(
    resolveSamplers({ temperature: 0.8, maxTokens: 512, stop: ['使用者：'] }, {}),
    { temperature: 0.8, maxTokens: 512, stop: ['使用者：'], stopEnabled: false },
    '酒館設了就用酒館的（開關沒設＝關）',
  )

  // 房間蓋過酒館（與 `allowTools` 同一條規矩），而且是**逐欄位**蓋。
  assert.deepEqual(
    resolveSamplers({ temperature: 0.8, maxTokens: 512 }, { temperature: 1.4 }),
    { temperature: 1.4, maxTokens: 512, stop: null, stopEnabled: false },
    '房間只蓋它自己有設的那一欄（maxTokens 要沿用酒館的）',
  )
  assert.deepEqual(
    resolveSamplers({ temperature: 0.8 }, { maxTokens: 256 }),
    { temperature: 0.8, maxTokens: 256, stop: null, stopEnabled: false },
    '反過來也一樣',
  )

  // ⚠️ `stop` **也是逐欄位蓋**，不是「兩層聯集」——這是 2.6.56 的決定，寫在
  // `resolveSamplers` 的註解裡。聯集會造出一個只有這個欄位才有的規矩。
  assert.deepEqual(
    resolveSamplers({ stop: ['酒館的'] }, { stop: ['房間的'] }),
    { temperature: null, maxTokens: null, stop: ['房間的'], stopEnabled: false },
    '⚠️ stop 是「房間蓋過酒館」，不是兩層聯集',
  )
  assert.deepEqual(
    resolveSamplers({ stop: ['酒館的'] }, { temperature: 1.4 }),
    { temperature: 1.4, maxTokens: null, stop: ['酒館的'], stopEnabled: false },
    '房間沒設 stop ⇒ 沿用酒館的（與聯集看起來一樣，但那是因為只有一層有值）',
  )

  /* ------------------------- 開關：三態（2.6.57） ------------------------- */
  //
  // ⚠️ **這一小段是這一節最重要的地方。** 開關與上面三個欄位不同——它是
  // **三態**（聽上一層／開／關），因為房間說「關」必須能蓋過酒館的「開」。
  // 寫成布林的話，`false` 會被當成 falsy 而落回「沒設」⇒ 症狀是
  // 「我明明把這一間房關掉了，它還是在送內建的那幾串」。

  assert.equal(resolveSamplers({ stopEnabled: true }, {}).stopEnabled, true, '酒館開 ⇒ 開')
  assert.equal(resolveSamplers({}, { stopEnabled: true }).stopEnabled, true, '房間開 ⇒ 開')
  assert.equal(resolveSamplers({}, { stopEnabled: false }).stopEnabled, false, '⚠️ 房間關 ⇒ 關')
  assert.equal(
    resolveSamplers({ stopEnabled: true }, { stopEnabled: false }).stopEnabled,
    false,
    '⚠️ 房間的「關」要能蓋過酒館的「開」（這是三態存在的全部理由）',
  )
  assert.equal(
    resolveSamplers({ stopEnabled: true }, { stopEnabled: true }).stopEnabled,
    true,
    '兩層都開 ⇒ 開',
  )
  assert.equal(
    resolveSamplers({ stopEnabled: true }, { stopEnabled: null }).stopEnabled,
    true,
    '房間的 null ＝ 聽酒館的（那是房間的預設值）',
  )
  // 沒有這個鍵（既有房間的形狀）⇒ 聽酒館的，**不是**「關」。
  // ⚠️ 這一條是「既有資料不會被這一輪改到行為」的地方：`room.json` 沒有
  //    `stopEnabled` 時，酒館開了就該開。
  assert.equal(
    resolveSamplers({ stopEnabled: true }, {}).stopEnabled,
    true,
    '⚠️ 房間沒有這個鍵 ⇒ 聽酒館的（既有房間的形狀）',
  )
  // 手改檔案寫了亂七八糟的值 ⇒ 當作沒設（往下退），**不是**當成 true。
  for (const junk of ['true', 'on', 1, 0, {}]) {
    assert.equal(
      resolveSamplers({ stopEnabled: true }, { stopEnabled: junk }).stopEnabled,
      true,
      `房間寫了 ${JSON.stringify(junk)} ⇒ 當作沒設（退回酒館）`,
    )
    assert.equal(
      resolveSamplers({ stopEnabled: junk }, {}).stopEnabled,
      false,
      `酒館寫了 ${JSON.stringify(junk)} ⇒ 當作沒設（＝關）`,
    )
  }
  assert.equal(STOP_ENABLED_KEY, 'stopEnabled', '欄位名就是這個（UI／檔案共用）')

  // 房間的 `null` ＝ 聽酒館的（那是房間的預設值）。
  assert.deepEqual(
    resolveSamplers(
      { temperature: 0.8, maxTokens: 512, stop: ['A'] },
      { temperature: null, maxTokens: null, stop: null },
    ),
    { temperature: 0.8, maxTokens: 512, stop: ['A'], stopEnabled: false },
    '房間的 null 是「聽酒館的」，不是「把酒館的清掉」',
  )
  // ⚠️ 而房間的**空字串**（textarea 清空之後送過來的就是 `null`，但手改檔案
  // 可以是 `''`）也是「聽酒館的」——不然清一格會把酒館的 stop 一起清掉。
  assert.deepEqual(
    resolveSamplers({ stop: ['A'] }, { stop: '' }),
    { temperature: null, maxTokens: null, stop: ['A'], stopEnabled: false },
    '房間層的空字串也是「聽酒館的」',
  )

  // ⚠️ 手改檔案寫了不合法的值 → 當作沒設（往下退），**不是**讓它生效。
  assert.deepEqual(
    resolveSamplers({ temperature: 99 }, {}),
    UNSET_ALL,
    '酒館層寫了 99 → 當作沒設（不是夾到 2）',
  )
  assert.deepEqual(
    resolveSamplers({ temperature: 0.8 }, { temperature: 99 }),
    { temperature: 0.8, maxTokens: null, stop: null, stopEnabled: false },
    '房間層寫壞了要**退回酒館**，不是變成沒設',
  )
  assert.deepEqual(
    resolveSamplers({ stop: ['酒館的'] }, { stop: ['x'.repeat(200)] }),
    { temperature: null, maxTokens: null, stop: ['酒館的'], stopEnabled: false },
    '房間層的 stop 太長 ⇒ 退回酒館那一組，不是變成沒有',
  )

  // 不是物件（陣列／字串／數字）也不能丟錯。
  for (const junk of [[], 'x', 7, true]) {
    assert.deepEqual(resolveSamplers(junk, junk), UNSET_ALL, `${JSON.stringify(junk)} 當作沒有設定`)
  }

  console.log('5. 誰蓋過誰 OK — 逐欄位蓋過酒館、開關是三態（房間的「關」蓋得過酒館的「開」）、壞值退回')
}

/* --------------------- 開關真的送出去什麼（effectiveStop）--------------------- */

{
  /**
   * ⚠️ **開關是「多送內建那幾串」，不是「取代你填的」。**
   *
   * 這一支是「存下來的值 → 送出去的值」**唯一**的轉換點。散在別的地方就會出現
   * 「面板顯示三串、實際送四串」——而使用者只會覺得那個功能時好時壞。
   */
  assert.deepEqual(effectiveStop({ stopEnabled: false, stop: ['X'] }), [], '⚠️ 關著 ⇒ 一串都不送（即使有自填）')
  assert.deepEqual(effectiveStop({ stopEnabled: true, stop: null }), STOP_PRESET, '開著、沒自填 ⇒ 就送內建那幾串')
  assert.deepEqual(
    effectiveStop({ stopEnabled: true, stop: ['X'] }),
    STOP_PRESET.concat(['X']),
    '⚠️ 開著 ＋ 自填 ⇒ 內建在前、自填在後（順序是給讀日誌的人看的）',
  )
  // 自填的與內建的重複 ⇒ 只留一個（不然日誌上會看到同一串兩次）。
  assert.deepEqual(
    effectiveStop({ stopEnabled: true, stop: [STOP_PRESET[0]] }),
    STOP_PRESET,
    '自填與內建重複 ⇒ 去重',
  )
  // 壞輸入不可以丟錯。
  for (const junk of [null, undefined, 'x', 7, {}]) {
    assert.deepEqual(effectiveStop(junk), [], `${JSON.stringify(junk)} ⇒ 不送（不是丟錯）`)
  }
  assert.deepEqual(effectiveStop({ stopEnabled: true, stop: 'x' }), STOP_PRESET, '自填不是陣列 ⇒ 只送內建')
  assert.deepEqual(effectiveStop({ stopEnabled: true, stop: [7, '', null, 'ok'] }), STOP_PRESET.concat(['ok']), '自填裡的壞項跳過')

  // ⚠️ 內建那幾串**帶前導換行**：沒有換行的「使用者：」會誤傷正文裡剛好提到
  //    它的句子（例如角色正在讀一份說明）。
  for (const one of STOP_PRESET) {
    assert.equal(one.startsWith('\n'), true, `內建的「${one}」要帶前導換行`)
  }

  console.log('6. 開關 OK — 關＝一串都不送、開＝內建＋自填（去重、順序可讀）、壞輸入不丟錯')
}

/* --------------------------- 展開成請求欄位 --------------------------- */

{
  assert.deepEqual(
    samplerRequestFields({ temperature: null, maxTokens: null, stop: null, stopEnabled: false }),
    {},
    '沒設就不帶欄位',
  )
  assert.deepEqual(
    samplerRequestFields({ temperature: 0.8, maxTokens: null, stop: null, stopEnabled: false }),
    { temperature: 0.8 },
    '只有 temperature 時**不可以**帶一個 maxTokens: null 出去',
  )
  // ⚠️ **開關關著時自填的 stop 不會送出去**（它是「開關 ＋ 額外」的語意）。
  assert.deepEqual(
    samplerRequestFields({ temperature: 0.8, maxTokens: 512, stop: ['使用者：'], stopEnabled: false }),
    { temperature: 0.8, maxTokens: 512 },
    '⚠️ 開關關著 ⇒ 即使有自填的 stop 也不送（那正是「開關」的意思）',
  )
  assert.deepEqual(
    samplerRequestFields({ temperature: 0.8, maxTokens: 512, stop: null, stopEnabled: true }),
    { temperature: 0.8, maxTokens: 512, stop: STOP_PRESET },
    '⚠️ 開關開著 ⇒ 送出去的是 effectiveStop()（內建那幾串），不是 `stop` 本身',
  )
  // `0` 是合法值，不可以被 falsy 判斷吃掉（那是這一類程式碼的經典 bug）。
  assert.deepEqual(
    samplerRequestFields({ temperature: 0, maxTokens: 1, stop: null, stopEnabled: false }),
    { temperature: 0, maxTokens: 1 },
    'temperature 0 與 maxTokens 1 都要帶出去（0 不是「沒有」）',
  )
  // ⚠️ `stop` 的判斷與前兩個不同：它要同時檢查「不是 null」與「長度 > 0」。
  //    空陣列漏出去的話，提供方收到的是「有一個 stop，但裡面沒有東西」。
  assert.deepEqual(
    samplerRequestFields({ stop: [], stopEnabled: false }),
    {},
    '⚠️ 空陣列是「沒有設定」，不可以變成一個空的 stop 欄位',
  )
  assert.deepEqual(
    samplerRequestFields({ stop: ['A'], stopEnabled: true }),
    { stop: STOP_PRESET.concat(['A']) },
    '開關開著 ＋ 自填 ⇒ 送內建＋自填',
  )
  assert.deepEqual(
    samplerRequestFields({ stop: 'A', stopEnabled: true }),
    { stop: STOP_PRESET },
    '⚠️ 沒正規化過的字串不可以在這裡被當成清單送出去（那是 resolveSamplers 的工作）',
  )
  assert.deepEqual(samplerRequestFields(null), {}, 'null 也不能丟錯')

  console.log('7. 請求欄位 OK — 沒設就不帶、0 不會被當成「沒有」、空的 stop 不會漏出去')
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
  assert.deepEqual(SAMPLER_KEYS, ['temperature', 'maxTokens', 'stop'], '只有這三個是 DSH 支援的')
  assert.equal(SAMPLER_KEYS.includes('topP'), false, 'top_p 不在 DSH 的介面裡，不要做')
  assert.equal(SAMPLER_KEYS.includes('top_p'), false, '同上')
  // ⚠️ `stopEnabled` **不在** `SAMPLER_KEYS` 裡，而且那不是漏掉：那份清單是
  // 「有值／沒有值」的欄位，而開關是**三態**（聽上一層／開／關）。
  // 混進去會被「只搬認得的欄位」的規矩漏掉，於是關不掉。
  assert.equal(SAMPLER_KEYS.includes('stopEnabled'), false, '⚠️ 開關不是 sampler key（它是三態）')

  // ⚠️ 這三個就是 `LlmCallConfig` 的全部取樣欄位，而**這一份清單是那張表的鏡射**。
  // 多的話是「存得起來、送不出去」；少的話是「DSH 支援而我們沒做」。
  // 所以這一條要在**讀過** `call-config.d.ts` 之後才可以改。
  assert.equal(SAMPLER_KEYS.length, 3, '改這一行之前先去讀 dsh-llm 的 call-config.d.ts')

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

  console.log('8. 契約 OK — 只有 DSH 真的支援的三個欄位、沒有 top_p、開關不是 sampler key、零執行期依賴')
}

console.log('\n全部通過 ✅')
