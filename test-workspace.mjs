/**
 * 酒館資料層的測試：資料夾結構、人物卡、世界書、對話、設定檔。
 *
 * 這一層是 v2 插件的全部「邏輯」——它只碰檔案，所以測試完全不需要 DSH
 * （用暫存目錄，不會動到你的真酒館）。
 *
 * 用法：node test-workspace.mjs
 */
import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { SUBDIRS, TavernWorkspace, requireId, resolveDshHome, segmentFromName, unwrapCard } from './lib/workspace.js'
import { DEFAULT_MARKERS } from './lib/render.js'
import { isPng, readCardFromPng } from './lib/pngcard.js'
import {
  assetIdFor,
  assetOwner,
  makeAssetIdResolver,
  parseAssetOwner,
  resolveAssetPath,
  safeAssetName,
  sniffImageExtension,
  uniqueName,
} from './lib/assets.js'

const root = await mkdtemp(join(tmpdir(), 'tavern-ws-'))

try {
  const ws = new TavernWorkspace(root)

  /* --- 1. 建立結構 ------------------------------------------------------ */
  {
    const created = await ws.ensure()
    for (const part of SUBDIRS) {
      assert.ok(created.includes(`${part}/`), `應該建立 ${part}/（實際：${created.join(' ')}）`)
      const info = await stat(join(root, part))
      assert.equal(info.isDirectory(), true, `${part} 應該是資料夾`)
    }
    assert.ok(created.includes('tavern.json'), '應該建立設定檔')
    assert.ok(created.includes('README.txt'), '應該建立說明檔')

    // 再跑一次不會重建、也不會覆蓋。
    const again = await ws.ensure()
    assert.deepEqual(again, [], '第二次 ensure 不應該再建立任何東西')

    const settings = JSON.parse(await readFile(join(root, 'tavern.json'), 'utf8'))
    assert.equal(settings.version, 1, 'tavern.json 要有版本號')
    assert.equal(typeof settings.createdAt, 'string', 'tavern.json 要有建立時間')
    const readme = await readFile(join(root, 'README.txt'), 'utf8')
    assert.ok(readme.includes('characters/'), 'README 要說明資料夾結構')
    console.log('1. 建立結構 OK —', SUBDIRS.join('/'), '+ tavern.json + README.txt')
  }

  /* --- 2. 設定檔讀寫 ---------------------------------------------------- */
  {
    const empty = await ws.readSettings()
    assert.equal(empty.note, '', '預設備註是空的')
    const saved = await ws.writeSettings({ name: '鯨落', note: '測試用' })
    assert.equal(saved.name, '鯨落')
    assert.equal(saved.note, '測試用')
    const reread = await ws.readSettings()
    assert.equal(reread.note, '測試用', '寫完要讀得回來')
    assert.equal(typeof reread.updatedAt, 'string', '更新時要蓋時間')

    // 壞掉的設定檔不該讓面板開不起來。
    await writeFile(join(root, 'tavern.json'), '{ 壞掉', 'utf8')
    const recovered = await ws.readSettings()
    assert.equal(recovered.note, '', '壞檔要退化成預設值')
    await writeFile(join(root, 'tavern.json'), JSON.stringify({ version: 1, name: 'x', note: '' }), 'utf8')
    console.log('2. 設定檔 OK — tavern.json 讀寫與壞檔容錯')
  }

  /* --- 2b. 主題（theme.json ＋ custom.css）------------------------------ */
  {
    // 沒有 theme.json 是**正常**的，不是錯誤。
    const none = await ws.readTheme()
    assert.equal(none.exists, false, '沒有 theme.json 時 exists 要是 false')
    assert.equal(none.broken, false, '沒有檔案不算壞掉')
    assert.deepEqual(none.theme.style, { bubble: 'bubble' }, '要有一組預設 style')
    assert.equal(await ws.readCustomCss(), '', '沒有 custom.css 時回空字串（不是錯誤）')

    // 寫進去：token 與 style 都要留著，不認得的 key 要被丟掉。
    const written = await ws.writeTheme({
      base: 'dark',
      tokens: { accent: '#123456' },
      style: { bubble: 'paper' },
    })
    assert.equal(written.theme.style.bubble, 'paper', 'style 要留下來')

    const onDisk = JSON.parse(await readFile(join(root, 'theme.json'), 'utf8'))
    assert.equal(onDisk.style.bubble, 'paper', 'style 要真的寫進檔案（不然重開就沒了）')
    assert.equal(onDisk.version, 1, '主題檔要有版本號')

    const reread = await ws.readTheme()
    assert.equal(reread.exists, true)
    assert.equal(reread.broken, false)
    assert.equal(reread.theme.tokens.accent, '#123456', 'token 要讀得回來')
    assert.equal(reread.theme.style.bubble, 'paper', 'style 要讀得回來')

    // 打錯的樣式名要落回預設**而且**回報——不然使用者以為自己改了。
    const bad = await ws.writeTheme({ base: 'dark', tokens: {}, style: { bubble: 'buble' } })
    assert.equal(bad.theme.style.bubble, 'bubble', '打錯要落回預設')
    assert.ok(bad.theme.dropped.includes('style.bubble'), '打錯要回報')

    // 壞掉的主題檔：用預設，但**要說它壞了**（設定頁才告訴得了使用者）。
    await writeFile(join(root, 'theme.json'), '{ 壞掉', 'utf8')
    const broken = await ws.readTheme()
    assert.equal(broken.exists, true, '檔案在')
    assert.equal(broken.broken, true, '要回報它壞了，不能默默用預設')
    assert.equal(broken.theme.style.bubble, 'bubble', '壞掉時用預設')

    // custom.css：原樣讀出來（宿主不解析、不驗證）。
    await writeFile(join(root, 'custom.css'), '.dsh-tv-bubble { border-radius: 0 }\n', 'utf8')
    assert.match(await ws.readCustomCss(), /border-radius: 0/, 'custom.css 要原樣讀出來')
    console.log('2b. 主題 OK — theme.json 的 style 存得住、壞檔會回報、custom.css 原樣讀出')
  }

  /* --- 3. 人物卡 -------------------------------------------------------- */
  {
    const id = await ws.writeCharacter('', { name: '測試劍士', description: '很會測試。' })
    assert.equal(id, '測試劍士', 'id 由 name 推導')
    const listed = await ws.listCharacters()
    assert.equal(listed.length, 1, '應該有一張卡')
    assert.equal(listed[0].name, '測試劍士')
    assert.equal(listed[0].card.description, '很會測試。')

    // 磁碟上是 SillyTavern 相容信封。
    const onDisk = JSON.parse(await readFile(join(root, 'characters', '測試劍士.json'), 'utf8'))
    assert.equal(onDisk.spec, 'chara_card_v2', '檔案要帶 spec 信封')
    assert.equal(onDisk.spec_version, '2.0')
    assert.equal(onDisk.data.name, '測試劍士')

    // 未知欄位原樣保留（面板只改它認得的欄位）。
    const kept = await ws.writeCharacter('測試劍士', {
      name: '測試劍士',
      description: '改過。',
      some_future_field: { nested: [1, 2, 3] },
    })
    assert.equal(kept, '測試劍士')
    const readBack = await ws.readCharacter('測試劍士')
    assert.equal(readBack.description, '改過。')
    assert.deepEqual(readBack.some_future_field, { nested: [1, 2, 3] }, '不認識的欄位要原樣保留')

    // 直接丟一張裸卡（沒有信封）進去也要讀得到。
    await writeFile(join(root, 'characters', '裸卡.json'), JSON.stringify({ name: '裸卡', first_mes: '嗨' }), 'utf8')
    const bare = await ws.listCharacters()
    assert.equal(bare.length, 2)
    assert.equal(bare.find((item) => item.id === '裸卡').card.first_mes, '嗨')

    // 壞掉的 JSON 只標記錯誤，不讓清單整個失敗。
    await writeFile(join(root, 'characters', '壞卡.json'), '{ nope', 'utf8')
    const withBroken = await ws.listCharacters()
    assert.equal(withBroken.length, 3, '壞卡也要列出來')
    assert.equal(withBroken.find((item) => item.id === '壞卡').card, null)
    assert.ok(withBroken.find((item) => item.id === '壞卡').error !== '')

    await ws.deleteCharacter('裸卡')
    assert.equal((await ws.listCharacters()).length, 2, '刪除只刪那一個檔案')
    console.log('3. 人物卡 OK — 信封格式、未知欄位保留、裸卡與壞卡都處理')
  }

  /* --- 4. 世界書 -------------------------------------------------------- */
  {
    const id = await ws.writeWorldbook('', { name: '群島誌', entries: { a: { key: ['島'] } } })
    assert.equal(id, '群島誌')
    const books = await ws.listWorldbooks()
    assert.equal(books.length, 1)
    assert.equal(books[0].file, '群島誌.json')
    const data = await ws.readWorldbook('群島誌')
    assert.deepEqual(data.entries.a.key, ['島'], '世界書原樣讀回')
    await ws.deleteWorldbook('群島誌')
    assert.equal((await ws.listWorldbooks()).length, 0, '刪除後清單是空的')
    console.log('4. 世界書 OK — 原樣讀寫與刪除')
  }

  /* --- 5. 房間（一間房＝一個資料夾）-------------------------------------- */
  {
    // 用 `readFile`／`readdir` 當存在性檢查，不必新增匯入。
    const existsFile = (path) => readFile(path).then(() => true, () => false)
    const existsDir = (path) => readdir(path).then(() => true, () => false)

    const created = await ws.createRoom('測試劍士', '初次見面')
    assert.equal(created.name, '初次見面', '顯示名稱是使用者給的那個')
    assert.match(created.room, /^[0-9a-z]+-[0-9a-z]{4}$/, 'id 是「時間 base36-隨機 4 碼」：' + created.room)

    // 佈局：設定、對話、插圖三個東西都在**同一個資料夾**裡。
    const dir = join(root, 'chats', '測試劍士', created.room)
    assert.equal(await existsFile(join(dir, 'room.json')), true, 'room.json 要在房間資料夾裡')
    assert.equal(await existsFile(join(dir, 'chat.jsonl')), true, 'chat.jsonl 要在房間資料夾裡')
    assert.equal(await existsDir(join(dir, 'art')), true, 'art/ 要在房間資料夾裡')
    const header = JSON.parse((await readFile(join(dir, 'chat.jsonl'), 'utf8')).trim().split('\n')[0])
    assert.equal(typeof header.chat_metadata, 'object', '第一行要是 SillyTavern 聊天標頭')
    assert.equal(header.user_name, 'unused')

    // **同名不是衝突**：再開一間同名 → 不同的 id（身分不是名字）。
    // 舊的 `createChat` 會編成 `初次見面-2`，因為它拿名字當檔名——那正是這裡解掉的問題。
    const again = await ws.createRoom('測試劍士', '初次見面')
    assert.notEqual(again.room, created.room, '同名要拿到不同的房間 id')
    assert.equal(again.name, '初次見面', '同名的顯示名稱就該一樣')

    // 改名**只改 room.json 裡的名字，資料夾與檔案全部不動**。
    await ws.renameRoom('測試劍士', created.room, '雨夜')
    assert.equal((await ws.readRoom('測試劍士', created.room)).name, '雨夜', '改名寫進 room.json')
    assert.equal(await existsFile(join(dir, 'chat.jsonl')), true, '改完名資料夾與對話檔還在原地')

    // 訊息：寫進去、讀得回來（含思考）。
    await ws.appendRoomMessages('測試劍士', created.room, [
      { name: 'unused', isUser: true, text: '嗨' },
      { name: '測試劍士', isUser: false, text: '你來了。', reasoning: '他終於來了' },
    ])
    const messages = await ws.readRoomMessages('測試劍士', created.room)
    assert.equal(messages.length, 2)
    assert.equal(messages[0].isUser, true)
    assert.equal(messages[1].text, '你來了。')
    assert.equal(messages[1].reasoning, '他終於來了', '思考要跟著訊息一起保存')

    // 每房自己的設定（從酒館下放的那幾個）。
    const patched = await ws.writeRoom('測試劍士', created.room, {
      roomPrompt: '這一場下著雨',
      allowTools: 'read',
    })
    assert.equal(patched.roomPrompt, '這一場下著雨')
    assert.equal(patched.allowTools, 'read')
    assert.equal((await ws.readRoom('測試劍士', created.room)).roomPrompt, '這一場下著雨', '設定讀得回來')
    // 不明的值一律 fail closed（回到「聽酒館的」）。
    const junk = await ws.writeRoom('測試劍士', created.room, { allowTools: 'ALL' })
    assert.equal(junk.allowTools, 'inherit', '不認識的工具等級要回到 inherit')

    // **只認 id**：顯示名稱不是身分——同名可以有兩間房，依名字解析會命中第一間
    // （那正是 2.6.6 三個 bug 的來源）。id 解析得到，名字**不再**解析得到。
    assert.equal(await ws.resolveRoom('測試劍士', created.room), created.room, 'id 解析得到')
    await assert.rejects(
      () => ws.resolveRoom('測試劍士', '雨夜'),
      /找不到這間房/,
      '顯示名稱不再解析得到（它只是顯示用的）',
    )
    console.log('5. 房間 OK — 資料夾佈局、同名不衝突、改名不動路徑、設定與訊息')
  }

  /* --- 6. 路徑防護與文字轉換 -------------------------------------------- */
  {
    const rejected = []
    for (const bad of ['../外面', 'a/b', '', '..']) {
      try {
        requireId(bad, '測試 id')
      } catch {
        rejected.push(bad)
      }
    }
    assert.equal(rejected.length, 4, '不安全的 id 一律拒絕')
    assert.equal(segmentFromName('森林魔女：艾莉'), '森林魔女-艾莉', '由內容推導時才轉換非法字元')
    assert.equal(segmentFromName('...'), '', '推導不出來時回傳空字串')

    let escaped = false
    try {
      await ws.writeWorldbook('../外面', {})
    } catch {
      escaped = true
    }
    assert.equal(escaped, true, '跳脫路徑要被拒絕')
    console.log('6. 路徑防護 OK — 明確 id 拒絕、推導名轉換、跳脫擋下')
  }

  /* --- 7. 概況與 DSH home ------------------------------------------------ */
  {
    const summary = await ws.summary()
    assert.equal(summary.exists, true)
    assert.equal(summary.counts.characters, 2, '前面留下兩張卡')
    assert.equal(summary.counts.worldbooks, 0)
    assert.equal(summary.counts.chats, 2, '上面開了兩間同名的房')
    assert.equal(summary.name, root.split(/[\\/]/).pop())

    assert.equal(resolveDshHome({ DSH_HOME: 'C:\\tmp\\dsh' }).includes('dsh'), true)
    const files = await readdir(root)
    assert.ok(files.includes('tavern.json'), '設定檔在酒館資料夾裡')
    console.log('7. 概況 OK —', JSON.stringify(summary.counts))
  }

  /** 最小但真的是 PNG 的位元組（magic bytes 正確）。 */
  const pngBytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

  /* --- 8. 插圖的識別與防護 --------------------------------------------- */
  {
    // 對話名是使用者取的，可能含不能當資料夾名的字元 → 正規化成 assetId。
    assert.equal(assetIdFor('chat', '老闆娘/初次見面'), '老闆娘/初次見面')
    assert.equal(assetIdFor('chat', '老闆娘/初次 見面!'), '老闆娘/初次-見面')
    assert.equal(assetIdFor('chat', '老闆娘/a&b'), '老闆娘/a-b')
    assert.equal(assetIdFor('character', '老闆娘'), '老闆娘')
    assert.equal(assetIdFor('tavern', ''), '')
    assert.throws(() => assetIdFor('chat', '只有角色'), /對話名/, '對話 id 一定要有「角色/對話名」')
    assert.throws(() => parseAssetOwner('character', '../逃出去'), /不合法/)

    // 同一組對話名每次都要拿到同一組 assetId（不然重開面板就找不到自己的圖）。
    const resolveA = makeAssetIdResolver('甲')
    const resolveB = makeAssetIdResolver('甲')
    assert.deepEqual(['a', 'b', 'a'].map(resolveA), ['a', 'b', 'a'])
    assert.deepEqual(['a', 'b'].map(resolveB), ['a', 'b'])

    // 兩個名字正規化後撞在一起時要自動分開。
    const collide = makeAssetIdResolver('甲')
    assert.equal(collide('初次見面'), '初次見面')
    assert.equal(collide('初次見面!'), '初次見面-2', '撞名要編號，不能共用同一個插圖資料夾')

    // 檔名整理與撞名編號。
    assert.equal(safeAssetName('../../etc/passwd.png'), 'passwd.png', '路徑片段要被拿掉')
    assert.equal(safeAssetName('微笑 圖.png'), '微笑-圖.png')
    assert.equal(safeAssetName('...'), '')
    assert.equal(uniqueName('a.png', new Set(['a.png'])), 'a-2.png')
    assert.equal(uniqueName('a.png', new Set(['a.png', 'a-2.png'])), 'a-3.png')

    // 只信內容不信副檔名。
    assert.equal(sniffImageExtension(pngBytes, 'x.jpg'), 'png', '宣告 jpg 但內容是 png ⇒ 存成 png')
    assert.equal(sniffImageExtension(Buffer.from([0xff, 0xd8, 0xff, 0xe0]), 'x.jpg'), 'jpg')
    assert.throws(() => sniffImageExtension(Buffer.from('not an image'), 'x.png'), /不是/)
    assert.equal(resolveAssetPath('/root', ['characters', '甲', '微笑.png']), join('/root', 'art', 'characters', '甲', '微笑.png'))
    assert.throws(() => resolveAssetPath('/root', ['characters', '..', 'tavern.json']), /不是圖片檔名/)
    // 用圖片副檔名試著跳脫：要在 id 這一層就被擋下。
    assert.throws(() => resolveAssetPath('/root', ['characters', '..', 'x.png']), /不合法/)
    assert.throws(() => resolveAssetPath('/root', ['nope', '甲', 'x.png']), /不認得/)
    assert.throws(() => resolveAssetPath('/root', ['chats', '甲', '初次見面', 'x.txt']), /不是圖片/)
    // 對話資產一定要三層（種類／角色／對話 id／檔名）。
    assert.throws(() => resolveAssetPath('/root', ['chats', '甲', 'x.png']), /對話資產需要/)
    console.log('8. 插圖識別 OK — assetId 正規化、撞名、magic bytes、路徑防護')
  }

  /* --- 9. 主圖設定要真的寫進 tavern.json -------------------------------- */
  {
    // 這一條釘住一個真的踩過的 bug：writeSettings 只認得 name/note，
    // 面板設了主圖卻**默默被丟掉**，看起來像「設了沒生效」。
    const owner = assetOwner('character', ['老闆娘'])
    const ws2 = new TavernWorkspace(root)
    await ws2.setPrimaryAsset('character', '老闆娘', '微笑.png') // 這張圖不存在 ⇒ 應該被拒
      .then(
        () => assert.fail('指定不存在的圖應該失敗'),
        (error) => assert.match(error.message, /沒有這張圖/),
      )
    const dir = join(root, 'art', 'characters', '老闆娘')
    await mkdir(dir, { recursive: true })
    await writeFile(join(dir, '微笑.png'), pngBytes)
    await writeFile(join(dir, '生氣.png'), pngBytes)

    const after = await ws2.setPrimaryAsset('character', '老闆娘', '生氣.png')
    assert.equal(after.assets['character:老闆娘'], '生氣.png', '主圖要真的寫進 tavern.json')
    const onDisk = JSON.parse(await readFile(join(root, 'tavern.json'), 'utf8'))
    assert.equal(onDisk.assets['character:老闆娘'], '生氣.png', '而且要是磁碟上的事實')

    const described = await ws2.describeEntityAssets('character', '老闆娘')
    assert.deepEqual(described.items.map((item) => item.name), ['生氣.png', '微笑.png'], '清單要列出所有圖')
    assert.equal(described.primary, '生氣.png', '主圖優先於檔名排序')
    assert.equal(described.owner, owner.name)

    // 清掉主圖 ⇒ 回到檔名排序第一張。
    await ws2.clearPrimaryAsset('character', '老闆娘')
    const cleared = await ws2.describeEntityAssets('character', '老闆娘')
    assert.equal(cleared.primary, '生氣.png', '清掉指定後仍要有主圖（第一張）')
    assert.deepEqual((await ws2.readSettings()).assets, {}, '設定裡不該留下指向空氣的主圖')
    console.log('9. 主圖 OK — 寫得進 tavern.json、清得掉、不存在的圖會被拒')
  }

  /* --- 9b. 生成參數：寫得進去、驗得出來、壞值回報（2.6.48）---------------- */
  {
    // 這一條釘住的是**白名單**與**誠實回報**兩件事。
    //
    // ⚠️ 白名單：`writeSettings`／`writeRoom` 只搬它們認得的欄位，沒列到的會被
    // **默默丟掉**（`assets` 就是這樣壞過一次，見第 9 節）。所以「欄位存得進去」
    // 這件事一定要有測試——畫面看起來完全正常，只有磁碟上的檔案知道。
    //
    // ⚠️ 誠實回報：`allowTools` 打錯字落回 `none` 是 fail closed（安全的），
    // 但 `temperature: 5` 落回「沒有設定」是**看起來有設、其實沒設**。
    // 所以不合法的值要回報（`dropped`），不准靜靜吞掉。
    const ws3 = new TavernWorkspace(root)

    // ① 酒館層：合法值存得進去，而且磁碟上是真的。
    const tavernSaved = await ws3.writeSettings({ temperature: 0.8, maxTokens: 512 })
    assert.equal(tavernSaved.temperature, 0.8, 'temperature 要寫進 tavern.json')
    assert.equal(tavernSaved.maxTokens, 512, 'maxTokens 要寫進 tavern.json')
    assert.equal(tavernSaved.dropped, undefined, '全都合法時不該有 dropped')
    const tavernOnDisk = JSON.parse(await readFile(join(root, 'tavern.json'), 'utf8'))
    assert.equal(tavernOnDisk.temperature, 0.8, '要是磁碟上的事實')
    assert.equal(tavernOnDisk.maxTokens, 512, '同上')

    // ② 清除：送 `null` 回去，而且**不是刪掉欄位**（`readSettings` 的 fallback 有它）。
    const cleared = await ws3.writeSettings({ temperature: null })
    assert.equal(cleared.temperature, null, 'null ＝ 沒有設定')
    assert.equal(cleared.maxTokens, 512, '只清 temperature，maxTokens 不可以被連帶清掉')
    assert.equal((await ws3.readSettings()).temperature, null, '讀回來也要是 null')

    // ③ 不合法 → **回報**，而且不寫進檔案。
    //
    // ⚠️ 這裡的行為是「**保留原本的值**」而不是「清成 null」：`writeSettings` 是
    // 合併寫入（從 `readSettings()` 的結果開始），所以被丟掉的欄位維持原狀。
    // 那個選擇是對的——打錯一個字不該把上一個好值也毀掉。
    const bad = await ws3.writeSettings({ temperature: 5, maxTokens: 3.5 })
    assert.equal(bad.temperature, null, '不合法的 temperature 不可以生效（不是夾到 2）')
    assert.equal(bad.maxTokens, 512, '不合法的 maxTokens 要**保留原本的值**，不是清掉它')
    assert.equal(Array.isArray(bad.dropped), true, '不合法時要回報 dropped')
    assert.equal(bad.dropped.length, 2, '兩個都要回報：' + JSON.stringify(bad.dropped))
    assert.ok(bad.dropped.some((one) => one.startsWith('temperature')), '要指出是哪一個欄位')
    assert.ok(bad.dropped.some((one) => one.startsWith('maxTokens')), '同上')
    const afterBad = JSON.parse(await readFile(join(root, 'tavern.json'), 'utf8'))
    assert.equal(afterBad.temperature, null, '被丟掉的值不可以留在磁碟上')
    assert.equal(afterBad.maxTokens, 512, '原本合法的值要活下來')

    // ④ 房間層：同一組行為，而且 `null` ＝ 聽酒館的。
    //
    // ⚠️ 用 `createRoom()` 而不是直接 `writeRoom()`：`listRooms()` 把「沒有對話檔
    // 又沒有名字」的資料夾當殘骸跳過（見它的註解），所以手動 `writeRoom` 建出來的
    // 房間**不會出現在清單裡**——而下面 ⑤ 要驗的正是清單投影。
    await ws3.writeSettings({ temperature: 0.8, maxTokens: 512 })
    const made = await ws3.createRoom('甲', '生成參數房')
    const roomId = made.room
    const roomSaved = await ws3.writeRoom('甲', roomId, { temperature: 1.4 })
    assert.equal(roomSaved.temperature, 1.4, '房間的 temperature 要存得進去')
    assert.equal(roomSaved.maxTokens, null, '房間沒設的那一欄是 null（＝聽酒館的）')
    const roomBad = await ws3.writeRoom('甲', roomId, { maxTokens: -1 })
    assert.equal(roomBad.maxTokens, null, '房間層不合法的值也不可以生效')
    assert.equal(roomBad.dropped.length, 1, '房間層也要回報')
    assert.equal(roomBad.temperature, 1.4, '同一次寫入裡合法的那一欄要留著')

    // ⑤ 清單的投影要帶得出這兩個欄位——「⚙️ 房間」那一格讀的是清單，
    //    不是每一列都再打一次 `room.read`。漏掉投影的症狀是「存了但格子是空的」。
    const listed = (await ws3.listRooms('甲')).find((one) => one.room === roomId)
    assert.ok(listed !== undefined, '剛建的房間要在清單裡')
    assert.equal('temperature' in listed, true, '清單要帶 temperature')
    assert.equal('maxTokens' in listed, true, '清單要帶 maxTokens')
    assert.equal(listed.temperature, 1.4, '值的來源是 room.json')
    // 房間沒設 maxTokens ⇒ 清單回 `null`（＝聽酒館的），**不是**把酒館的 512 抄進來。
    // ⚠️ 這一條很重要：抄進來的在畫面上看不出差別，但「這一間房到底有沒有自己的
    //    設定」就永遠分不出來了——而使用者按「清除」時的行為取決於那件事。
    assert.equal(listed.maxTokens, null, '房間層的 null 要原樣回傳，不要填成酒館的值')

    // 還原：後面的段落不該拿到這裡的設定。
    await ws3.writeSettings({ temperature: null, maxTokens: null })
    assert.equal(
      JSON.parse(await readFile(join(root, 'tavern.json'), 'utf8')).temperature,
      null,
      '收尾要把設定清乾淨',
    )
    console.log('9b. 生成參數 OK — 存得進 tavern.json／room.json、null ＝清除、壞值回報不寫入')
  }

  /* --- 9c. stop 序列：一行一個、正規化、壞值回報（2.6.56）----------------- */
  {
    /**
     * `stop` 與 9b 那兩個欄位**不是同一種東西**，所以它值得自己一段：
     *
     *   - 它是一個**清單**（`string[]`），不是數字；
     *   - 客戶端送來的是**一整段文字**（textarea，一行一個），拆行是這裡的事
     *     ——兩邊各拆一份就會出現「面板預覽一種、實際送出另一種」；
     *   - 「沒有設定」有**兩種寫法**（`null` 與 `[]`），而存檔只能有一種。
     *
     * ⚠️ 這一節同時是 `applySamplerPatch()` 的測試。那一支是 9b 那兩個欄位與
     * `stop` **共用**的寫入路徑，所以「酒館層與房間層行為一致」在這一段順便就驗到了。
     */
    const ws4 = new TavernWorkspace(root)

    // ① 一整段文字（客戶端真的送的形狀）⇒ 拆行、trim 頭尾、去空行、去重。
    const saved = await ws4.writeSettings({ stop: '使用者：\r\n\r\nUser:\r\n  使用者：  ' })
    assert.deepEqual(
      saved.stop,
      ['使用者：', 'User:'],
      '一行一個：要拆行、去空行、trim 頭尾、去掉完全相同的（順序照寫的）',
    )
    assert.equal(saved.dropped, undefined, '合法的值不該有 dropped')
    const onDisk = JSON.parse(await readFile(join(root, 'tavern.json'), 'utf8'))
    assert.deepEqual(onDisk.stop, ['使用者：', 'User:'], '要是磁碟上的事實（而且是陣列）')
    assert.equal(Array.isArray(onDisk.stop), true, '存進去的必須是陣列，不是那一整段文字')

    // ② 陣列也收（`tavern.json` 是手改得到的），而且讀回來是同一份。
    const asArray = await ws4.writeSettings({ stop: ['A', 'B'] })
    assert.deepEqual(asArray.stop, ['A', 'B'], '陣列直接收')
    assert.deepEqual((await ws4.readSettings()).stop, ['A', 'B'], '讀回來也要一樣')

    // ③ 清除：**兩個寫法都要變成同一種結果**（`null`）。
    //    ⚠️ 這一條是這一節的重點：`[]` 與 `null` 在 JSON 裡看起來不一樣，
    //    但意思一樣——兩種並存就會出現「這一間是空的、那一間是沒有」的假區別。
    const clearedEmpty = await ws4.writeSettings({ stop: [] })
    assert.equal(clearedEmpty.stop, null, '⚠️ 空陣列要存成 null，不是 []')
    await ws4.writeSettings({ stop: ['A'] })
    const clearedNull = await ws4.writeSettings({ stop: null })
    assert.equal(clearedNull.stop, null, 'null ＝ 清除')
    assert.equal(
      JSON.parse(await readFile(join(root, 'tavern.json'), 'utf8')).stop,
      null,
      '磁碟上是 null',
    )

    // ④ 不合法 → **回報**，而且不寫進檔案（同 9b 的規矩）。
    await ws4.writeSettings({ stop: ['好的'] })
    const tooMany = await ws4.writeSettings({
      stop: Array.from({ length: 17 }, (_, i) => `s${i}`),
    })
    assert.equal(Array.isArray(tooMany.dropped), true, '不合法要回報 dropped')
    assert.ok(tooMany.dropped[0].startsWith('stop'), '要指出是 stop：' + JSON.stringify(tooMany.dropped))
    assert.deepEqual(tooMany.stop, ['好的'], '⚠️ 原本的值要活下來，不是被清掉')
    const longOne = await ws4.writeSettings({ stop: ['x'.repeat(65)] })
    assert.ok(longOne.dropped[0].startsWith('stop'), '太長的那一項也要回報')
    assert.match(longOne.dropped[0], /64/, '而且要說出上限是幾個字')

    // ⑤ 房間層：同一組行為，而且 `null` ＝ 聽酒館的（清單投影要帶得出來）。
    await ws4.writeSettings({ stop: ['酒館的'] })
    const made = await ws4.createRoom('甲', '停止序列房')
    const roomSaved = await ws4.writeRoom('甲', made.room, { stop: '房間的\n第二個' })
    assert.deepEqual(roomSaved.stop, ['房間的', '第二個'], '房間層的 stop 存得進去')
    const roomListed = (await ws4.listRooms('甲')).find((one) => one.room === made.room)
    assert.ok(roomListed !== undefined, '剛建的房間要在清單裡')
    assert.equal('stop' in roomListed, true, '⚠️ 清單要帶 stop，不然「⚙️ 房間」那一格永遠是空的')
    assert.deepEqual(roomListed.stop, ['房間的', '第二個'], '值的來源是 room.json')
    // ⚠️ 房間沒設時回 `null`（＝聽酒館的），**不是**把酒館那一組抄進來——
    //    抄進來的在畫面上看不出差別，但「這一間房到底有沒有自己的設定」就分不出來了。
    const other = await ws4.createRoom('甲', '沒有停止序列的房')
    const otherListed = (await ws4.listRooms('甲')).find((one) => one.room === other.room)
    assert.equal(otherListed.stop, null, '房間層的 null 要原樣回傳，不要填成酒館的值')
    // 而房間清空（送 `null`）之後也退回 null，不是空陣列。
    const roomCleared = await ws4.writeRoom('甲', made.room, { stop: null })
    assert.equal(roomCleared.stop, null, '房間層清空也是 null')

    // 還原：後面的段落不該拿到這裡的設定。
    await ws4.writeSettings({ stop: null })
    assert.equal(
      JSON.parse(await readFile(join(root, 'tavern.json'), 'utf8')).stop,
      null,
      '收尾要把 stop 清乾淨',
    )
    console.log('9c. stop 序列 OK — 一行一個拆得開、[] 與 null 都存成 null、壞值回報不寫入、清單帶得出')
  }

  /* --- 9d. stop 的開關（三態）＋ render.json（2.6.57）--------------------- */
  {
    /**
     * 這一節有兩件事，而它們是同一輪加的：
     *
     *   1. **`stopEnabled`**：開關是**三態**（聽上一層／開／關），不是布林。
     *      房間說「關」必須存得下去——存成布林的話 `false` 會被「只搬認得的欄位」
     *      的規矩漏掉，症狀是「我明明把這一間房關掉了，它還是在送」。
     *   2. **`render.json`**：回覆格式住**另一個檔案**（不是 theme.json），
     *      而且壞檔要落回預設 ＋ 回報，不可以讓那一間酒館打不開。
     */
    const ws5 = new TavernWorkspace(root)

    // ① 開關：酒館層。
    const off = await ws5.writeSettings({ stopEnabled: false })
    assert.equal(off.stopEnabled, false, '⚠️ 酒館層的 false 要存得下去（不是被當成「沒送」）')
    assert.equal(
      JSON.parse(await readFile(join(root, 'tavern.json'), 'utf8')).stopEnabled,
      false,
      '磁碟上是 false',
    )
    const on = await ws5.writeSettings({ stopEnabled: true })
    assert.equal(on.stopEnabled, true, 'true 也存得下去')

    // ② 房間層的**三態**：`'inherit'` 在這一行就是 `null`。
    const made = await ws5.createRoom('甲', '開關房')
    const roomOff = await ws5.writeRoom('甲', made.room, { stopEnabled: false })
    assert.equal(roomOff.stopEnabled, false, '⚠️ 房間層的 false 要存得下去（蓋過酒館的開）')
    assert.equal(
      JSON.parse(await readFile(join(root, 'chats', '甲', made.room, 'room.json'), 'utf8')).stopEnabled,
      false,
      '磁碟上是 false，不是 null',
    )
    const roomInherit = await ws5.writeRoom('甲', made.room, { stopEnabled: null })
    assert.equal(roomInherit.stopEnabled, null, '送 null ⇒ 回「聽酒館的」')
    // 壞值要回報，而且**不覆蓋原本的值**。
    await ws5.writeRoom('甲', made.room, { stopEnabled: true })
    const roomBad = await ws5.writeRoom('甲', made.room, { stopEnabled: 'on' })
    assert.equal(roomBad.stopEnabled, true, '⚠️ 壞值不可以覆蓋原本的值')
    assert.ok(
      roomBad.dropped.some((one) => one.startsWith('stopEnabled')),
      '要回報是 stopEnabled 被丟掉：' + JSON.stringify(roomBad.dropped),
    )

    // ③ 清單投影要帶得出來（「⚙️ 房間」那一格讀的是清單）。
    const listed = (await ws5.listRooms('甲')).find((one) => one.room === made.room)
    assert.equal('stopEnabled' in listed, true, '⚠️ 清單要帶 stopEnabled，不然那一格永遠是空的')
    assert.equal(listed.stopEnabled, true, '值的來源是 room.json')

    // ④ `render.json`：沒那個檔案 ⇒ 預設（plain）。
    const absent = await ws5.readRender()
    assert.equal(absent.exists, false, '一開始沒有 render.json')
    assert.equal(absent.render.mode, 'plain', '⚠️ 沒有檔案 ⇒ plain（＝提示詞零指令）')
    assert.equal(absent.render.markers.length > 0, true, '預設標記組要在（切到 marked 就馬上有東西）')

    // ⑤ 寫進去、讀回來（而且是**真的落在酒館資料夾裡**）。
    const written = await ws5.writeRender({ mode: 'marked', markers: [{ tag: '台詞', kind: 'speech' }] })
    assert.equal(written.mode, 'marked', '模式要存下來')
    assert.equal(
      existsSync(join(root, 'render.json')),
      true,
      '⚠️ render.json 要住在**酒館資料夾**裡（整包帶走時格式跟著走）',
    )
    const readBack = await ws5.readRender()
    assert.equal(readBack.exists, true, '讀得回來')
    assert.equal(readBack.render.mode, 'marked', '模式讀得回來')
    assert.deepEqual(readBack.render.markers, [{ tag: '台詞', kind: 'speech', who: '' }], '標記讀得回來')

    // ⑥ 不合法 ⇒ 回報，而且**落回預設**（不是留著一半）。
    const badRender = await ws5.writeRender({ mode: 'marked', markers: [{ tag: 'x', kind: 'nope' }] })
    assert.equal(badRender.mode, 'marked', '模式那一欄是合法的，要留著')
    assert.ok(
      badRender.dropped.some((one) => one.startsWith('markers')),
      '要回報 markers 被丟掉：' + JSON.stringify(badRender.dropped),
    )
    assert.equal(
      badRender.markers.length,
      DEFAULT_MARKERS.length,
      '⚠️ 不合法的那一組整組落回預設（不是留著一半，也不是變成空的）',
    )

    // ⑦ 壞檔 ⇒ 預設 ＋ `broken`，**不丟錯**（設定檔壞掉不該讓酒館打不開）。
    await writeFile(join(root, 'render.json'), '{ 這不是 JSON')
    const broken = await ws5.readRender()
    assert.equal(broken.exists, true, '檔案在')
    assert.equal(broken.broken, true, '⚠️ 要回報 broken，不可以默默用預設')
    assert.equal(broken.render.mode, 'plain', '壞檔 ⇒ 落回 plain')

    // 收尾：把 render.json 清掉，後面的段落不該拿到這裡的設定。
    await rm(join(root, 'render.json'), { force: true })
    await ws5.writeSettings({ stopEnabled: false, stop: null })
    console.log('9d. 開關與回覆格式 OK — 三態存得下去、壞值不覆蓋、render.json 進得了酒館資料夾、壞檔落回預設')
  }

  /* --- 10. 無損往返：未知欄位一個都不能丟 --------------------------------- */
  {
    // 這一項取代了「匯入時留一份 .original」——見 docs/storage-layout.md §6。
    // 決定不做備份的前提下，「寫入時就做對」是唯一的保障，所以要用測試釘死。
    const ws3 = new TavernWorkspace(root)

    // 真實形狀的卡：信封 + 一堆我們不認識的欄位 + extensions + 內嵌世界書。
    const fullCard = {
      name: '無損測試角色',
      description: '人設',
      personality: '性格',
      scenario: '場景',
      first_mes: '開場白',
      mes_example: '<START>示範',
      creator_notes: '作者的話',
      system_prompt: '系統提示',
      post_history_instructions: '歷史後指令',
      alternate_greetings: ['問候一', '問候二'],
      tags: ['奇幻', '測試'],
      creator: '某作者',
      character_version: '1.2.3',
      // 未知的頂層欄位（未來規格或第三方擴充）
      future_field_we_do_not_know: { deep: { nested: [1, 2, 3] } },
      'kebab-case-field': '連字號也要活下來',
      emoji_field: '🎭',
      extensions: {
        talkativeness: 0.5,
        fav: true,
        world: '某個世界書',
        depth_prompt: { depth: 4, prompt: '深度提示', role: 'system' },
        regex_scripts: [
          { scriptName: '美化', findRegex: '/<(\\w+)>/g', replaceString: '<$1>', placement: [1, 2], disabled: false },
        ],
        // 第三方命名空間（ST 自己也保留這些）
        pygmalion_id: 'abc123',
        chub: { id: 42 },
        unknown_namespace: { keep: 'me' },
      },
      character_book: {
        name: '內嵌世界書',
        entries: [{ keys: ['龍'], secondary_keys: [], content: '龍的設定', insertion_order: 100, enabled: true }],
      },
    }

    const written = await ws3.writeCharacter('無損測試角色', fullCard)
    assert.equal(written, '無損測試角色')
    const readBack = await ws3.readCharacter('無損測試角色')

    // 逐欄位比對（不是逐位元組——我們會刻意把它寫成信封）。
    assert.deepEqual(readBack, fullCard, '寫入再讀出必須逐欄位相等，未知欄位不能消失')

    // 磁碟上的形狀也要是合法信封。
    const onDisk = JSON.parse(await readFile(join(root, 'characters', '無損測試角色.json'), 'utf8'))
    assert.equal(onDisk.spec, 'chara_card_v2')
    assert.equal(onDisk.spec_version, '2.0')
    assert.ok(onDisk.data !== undefined, '資料要包在 data 裡')
    assert.equal(
      typeof onDisk.data.future_field_we_do_not_know,
      'object',
      '未知欄位要真的寫進磁碟，不是只在記憶體裡對',
    )

    // 再寫一次（模擬使用者按兩次儲存）：不能因為來回轉換而劣化。
    await ws3.writeCharacter('無損測試角色', readBack)
    assert.deepEqual(await ws3.readCharacter('無損測試角色'), fullCard, '來回多次也不能劣化（idempotent）')

    // 裸卡（沒有信封）也要能寫入，而且讀出來還是同一組欄位。
    const bare = { name: '裸卡角色', description: '沒有信封', custom_thing: { a: 1 } }
    await ws3.writeCharacter('裸卡角色', bare)
    assert.deepEqual(await ws3.readCharacter('裸卡角色'), bare, '裸卡寫入後也要完整保留')
    console.log('10. 卡片無損往返 OK — 未知欄位、extensions、內嵌世界書都不丟')
  }

  /* --- 11. 世界書無損往返 -------------------------------------------------- */
  {
    const ws4 = new TavernWorkspace(root)

    // 世界書有兩種方言：原生（entries 是「uid 為 key 的物件」）與內嵌（entries 是陣列）。
    // 我們不表單化、不做欄位轉換，所以兩種都必須原樣活下來。
    const native = {
      entries: {
        0: {
          uid: 0,
          key: ['鯨落', '燈塔'],
          keysecondary: ['夜晚'],
          comment: '地點',
          content: '鯨落港的設定',
          constant: false,
          selective: true,
          order: 100,
          position: 0,
          disable: false,
          displayIndex: 0,
          addMemo: true,
          group: '',
          groupOverride: false,
          groupWeight: 100,
          sticky: null,
          cooldown: null,
          delay: null,
          probability: 100,
          depth: 4,
          useProbability: true,
          role: 0,
          vectorized: false,
          excludeRecursion: false,
          preventRecursion: false,
          delayUntilRecursion: 0,
          scanDepth: null,
          caseSensitive: null,
          matchWholeWords: null,
          useGroupScoring: null,
          automationId: '',
        },
      },
      unknownTopLevel: { keep: true },
    }
    assert.equal(await ws4.writeWorldbook('鯨落設定', native), '鯨落設定')
    assert.deepEqual(await ws4.readWorldbook('鯨落設定'), native, '原生世界書要逐欄位相等')

    const embedded = {
      name: '內嵌方言',
      entries: [{ keys: ['a'], secondary_keys: ['b'], content: 'x', insertion_order: 5, enabled: true }],
    }
    await ws4.writeWorldbook('內嵌方言', embedded)
    assert.deepEqual(await ws4.readWorldbook('內嵌方言'), embedded, '陣列方言也要原樣保留（不做轉換）')

    // 頂層是陣列也算合法世界書（我們接受物件或陣列）。
    const arrayForm = [{ uid: 1, key: ['k'], content: 'c' }]
    await ws4.writeWorldbook('陣列形式', arrayForm)
    assert.deepEqual(await ws4.readWorldbook('陣列形式'), arrayForm)
    console.log('11. 世界書無損往返 OK — 兩種方言與未知欄位都原樣保留')
  }

  /* --- 12. 新建酒館的預設內容（老闆娘 ＋ 世界書）------------------------ */
  {
    const seedRoot = await mkdtemp(join(tmpdir(), 'tavern-seed-'))
    const seedWs = new TavernWorkspace(seedRoot)

    const created = await seedWs.seed()
    // 房間的 id 是隨機的，所以先把它挑出來、其餘照順序比對。
    const roomEntry = created.filter((item) => /^chats\//.test(item))
    assert.equal(roomEntry.length, 1, '新酒館要附**一間**可以直接聊的房間：' + created.join(', '))
    assert.match(
      roomEntry[0],
      /^chats\/老闆娘\/[a-z0-9]+-[a-z0-9]+\/chat\.jsonl$/,
      '房間路徑要是 chats/<角色>/<房間 id>/chat.jsonl：' + roomEntry[0],
    )
    assert.deepEqual(
      created.filter((item) => !/^chats\//.test(item)).sort(),
      ['characters/老闆娘.png', 'custom.css', 'worldbooks/輸出格式.json', 'worldbooks/酒館.json'],
      '應該回報實際建立了這些（預設角色是 PNG 卡）：' + created.join(', '),
    )
    // 預設房間：room.json ＋ chat.jsonl（標頭）＋ 開場白（卡片的 first_mes）
    const roomId = roomEntry[0].split('/')[2]
    const roomSettings = JSON.parse(
      await readFile(join(seedRoot, 'chats', '老闆娘', roomId, 'room.json'), 'utf8'),
    )
    assert.match(roomSettings.name, /^老闆娘-[a-z0-9]+$/, '沒給名字時 createRoom 會補上隨機尾巴')
    const seededMessages = await seedWs.readRoomMessages('老闆娘', roomId)
    assert.equal(seededMessages.length, 1, '預設房間要有一則開場白')
    assert.equal(seededMessages[0].isUser, false, '開場白是角色說的')
    assert.ok(seededMessages[0].text.length > 10, '開場白要有內容')

    /**
     * 預設角色**就是那張 PNG 卡**（使用者：「留意他的提示詞要寫進 PNG 卡片當中」
     * ＋「PNG 卡直接就是卡」）：`characters/老闆娘.png` 逐位元組等於出貨檔，
     * 提示詞住在它的 `ccv3` 裡，而同一張圖就是她的立繪。
     */
    const sampleCardBytes = await readFile(
      new URL('./samples/characters/老闆娘.png', import.meta.url),
    )
    assert.equal(isPng(sampleCardBytes), true, '出貨檔要是一張 PNG')
    const fromPng = unwrapCard(readCardFromPng(sampleCardBytes).card)
    const seededBytes = await readFile(join(seedRoot, 'characters', '老闆娘.png'))
    assert.deepEqual(seededBytes, sampleCardBytes, '種子卡要逐位元組等於出貨的那張 PNG')
    assert.equal(
      await stat(join(seedRoot, 'characters', '老闆娘.json')).then(() => true).catch(() => false),
      false,
      'PNG 卡就是卡，不要再寫一份 JSON（兩份真相）',
    )
    const seededCard = await seedWs.readCharacter('老闆娘')
    assert.equal(seededCard.description, fromPng.description, '提示詞要從 PNG 裡讀出來')
    assert.equal(seededCard.first_mes, seededMessages[0].text, '房間的開場白就是卡片的 first_mes')
    const arts = await seedWs.describeEntityAssets('character', '老闆娘')
    assert.equal(arts.items.length, 1, '預設角色要有一張圖（卡片本體）')
    assert.equal(arts.items[0].name, '老闆娘.png', '就是那張 PNG 卡本身')
    assert.equal(arts.items[0].source, 'card', '在清單裡標成 card（不是插圖，客戶端不給刪）')
    assert.equal(arts.primary, '老闆娘.png', '而且要是主圖（海報牆／訊息頭像都用它）')

    // 「裝修」的入口：一份**整份註解掉**的 custom.css 範本。
    // 沒有它，這一層功能只存在於 README（使用者得先知道有這個檔案才用得下去）；
    // 有它則代價是零——範本裡沒有一條生效的規則。
    const cssTemplate = await readFile(join(seedRoot, 'custom.css'), 'utf8')
    assert.match(cssTemplate, /theme\.json/, '範本要告訴使用者「能改 token 就先改 token」')
    assert.match(cssTemplate, /@scope/, '範本要說明它會被 @scope 包住（碰不到宿主）')
    assert.match(cssTemplate, /\.dsh-tv-bubble/, '範本要列出常用類別，不然使用者不知道要寫什麼')
    assert.deepEqual(
      cssTemplate
        .split('\n')
        .filter((line) => line.trim() !== '')
        .filter((line) => !/^\s*(\/\*|\*)/.test(line)),
      [],
      '範本裡不可以有生效的規則（附了就不該改變外觀）',
    )

    // 酒館資料夾裡的 README.txt 也要跟著現況（房間＝資料夾、附件、裝修）——
    // 它是使用者打開資料夾時唯一會看到的說明。
    const readme = await readFile(join(seedRoot, 'README.txt'), 'utf8')
    assert.match(readme, /room\.json/, 'README 要寫出房間＝資料夾的現況')
    assert.match(readme, /files\//, 'README 要提到附件（files/）')
    assert.match(readme, /custom\.css/, 'README 要提到裝修那一層')
    assert.match(readme, /PNG 卡/, 'README 要說明 PNG 卡（提示詞住在圖裡）')
    assert.doesNotMatch(readme, /chats\/<角色>\/<對話名>\.jsonl/, '舊的「一個 .jsonl 一份對話」寫法不該還在')

    // 輸出格式是**預設**，不是選配：沒有它模型就吐普通小說（解析器只剩推斷）。
    // 而且它必須是 `constant` ＋ 大 `order`——被預算擠掉就等於模型不知道格式。
    const formatBook = JSON.parse(await readFile(join(seedRoot, 'worldbooks', '輸出格式.json'), 'utf8'))
    const formatEntry = formatBook.entries['0']
    assert.equal(formatEntry.constant, true, '格式說明要每輪都注入')
    assert.ok(formatEntry.order >= 900, 'order 要大——世界書是先到先得，排後面會被擠掉')
    assert.ok(formatEntry.content.includes('"kind"'), '內容要真的寫著格式')

    // 卡片要是可以直接用的（SillyTavern 信封 ＋ 八個面板欄位都有內容）
    const card = await seedWs.readCharacter('老闆娘')
    assert.equal(card.name, '老闆娘')
    for (const field of ['description', 'personality', 'scenario', 'first_mes', 'mes_example']) {
      assert.ok(
        typeof card[field] === 'string' && card[field].length > 10,
        `預設卡片的 ${field} 不可以是空的（那等於沒給）`,
      )
    }
    assert.ok(Array.isArray(card.tags) && card.tags.length > 0, '至少要有標籤')

    // 世界書要是原生形狀（entries 是 uid 物件），而且面板讀得出來
    const book = await seedWs.readWorldbook('酒館')
    assert.equal(typeof book.entries, 'object', 'entries 應該是物件')
    const entries = Object.values(book.entries)
    assert.ok(entries.length >= 2, '至少要有兩條（這間店 ＋ 老闆娘）')
    for (const entry of entries) {
      assert.ok(Array.isArray(entry.key) && entry.key.length > 0, '每條都要有觸發關鍵字')
      assert.equal(typeof entry.content, 'string')
      assert.equal(typeof entry.uid, 'number')
    }

    // 列舉要看得見它們（使用者一開面板就該看到有人）
    assert.equal((await seedWs.listCharacters()).length, 1, '人物卡清單要有老闆娘')
    assert.equal((await seedWs.listWorldbooks()).length, 2, '世界書清單要有那兩本（酒館 ＋ 輸出格式）')

    // 只補不覆蓋：使用者改過的東西不可以被第二次 seed 蓋掉
    await seedWs.writeCharacter('老闆娘', { name: '我自己的老闆娘', description: '改過了' })
    const second = await seedWs.seed()
    assert.deepEqual(second, [], '第二次 seed 不該建立任何東西')
    const after = await seedWs.readCharacter('老闆娘')
    assert.equal(after.name, '我自己的老闆娘', '使用者的版本不能被預設內容覆蓋')
    assert.equal(after.description, '改過了')

    await rm(seedRoot, { recursive: true, force: true })
    console.log('12. 預設內容 OK — 新建附老闆娘與世界書，且不覆蓋使用者的版本')
  }

  /* ------------------- 13. 對話 ↔ session 的對照表（R3） ------------------- */

  {
    const ws = new TavernWorkspace(join(root, 'sessions-shop'))
    await ws.ensure()
    await ws.createRoom('老闆娘', '夜晚')
    await ws.createRoom('酒保', '打烊後')

    const SID = 'session-8e6ef1b9-b52f-47f3-8f60-c92f1f575e74'

    // 一開始什麼都沒有：讀不到要回 null，**不是丟錯**（Agent 面每一輪都呼叫它）。
    assert.equal(await ws.readSession(SID), null, '沒綁定時回 null')
    assert.deepEqual(await ws.listSessionBindings(), [], '清單是空的')

    // 綁定。
    const bound = await ws.bindSession(SID, { character: '老闆娘', chat: '夜晚' })
    assert.equal(bound.sessionId, SID)
    assert.equal(bound.character, '老闆娘')
    assert.equal(bound.chat, '夜晚')
    assert.equal(bound.version, 1)
    assert.equal(typeof bound.boundAt, 'string')

    const read = await ws.readSession(SID)
    assert.equal(read.character, '老闆娘', '讀得回來')
    assert.equal(read.chat, '夜晚')
    assert.equal((await ws.listSessionBindings()).length, 1)

    // 重新綁定不該假裝是新開的（boundAt 保留、updatedAt 換新）。
    await new Promise((resolveDone) => setTimeout(resolveDone, 5))
    const again = await ws.bindSession(SID, { character: '老闆娘', chat: '夜晚' })
    assert.equal(again.boundAt, bound.boundAt, '重新綁定要保留原本的 boundAt')

    // ⚠️ sessionId 會變成檔名，所以路徑跳脫一定要擋下來。
    for (const bad of ['../escape', '..', '.hidden', 'a/b', '', 'a\\b']) {
      await assert.rejects(
        () => ws.bindSession(bad, { character: '老闆娘', chat: '夜晚' }),
        /session id/,
        `R3：不安全的 session id 要拒絕：${JSON.stringify(bad)}`,
      )
    }
    assert.equal(await ws.readSession('../tavern'), null, '讀取也要擋（回 null 而不是丟錯）')

    // 對話檔的標頭：真相寫在這裡，索引掉了可以重建。
    // 現在要先有**一間房**，標頭是蓋在 `<房間>/chat.jsonl` 上。
    const stampedRoom = await ws.createRoom('老闆娘', '夜晚')
    const stamped = await ws.stampChatSessionId('老闆娘', stampedRoom.room, SID)
    assert.equal(stamped, true, '第一次要真的改到東西')
    assert.equal(await ws.stampChatSessionId('老闆娘', stampedRoom.room, SID), false, '已經一樣就不重寫')
    assert.equal(await ws.readChatSessionId('老闆娘', stampedRoom.room), SID, '讀得回來')
    assert.equal(await ws.readChatSessionId('老闆娘', '不存在'), null, '不存在的房間回 null')

    // 標頭改到了，但訊息一則都不能少。
    const raw = await readFile(
      join(root, 'sessions-shop', 'chats', '老闆娘', stampedRoom.room, 'chat.jsonl'),
      'utf8',
    )
    const lines = raw.split('\n').filter((line) => line !== '')
    assert.equal(lines.length, 1, '只有標頭行')
    assert.equal(JSON.parse(lines[0]).chat_metadata.dsh_session_id, SID)
    assert.equal(JSON.parse(lines[0]).character_name, 'unused', 'SillyTavern 的欄位要留著')

    // 索引砍掉 → rebuild 要能從對話檔長回來。
    await ws.unbindSession(SID)
    assert.equal(await ws.readSession(SID), null, '解綁之後讀不到')
    const rebuilt = await ws.rebuildSessionBindings()
    assert.equal(rebuilt, 1, '只有一份對話有 session id')
    const recovered = await ws.readSession(SID)
    assert.equal(recovered?.character, '老闆娘', '重建之後要指回同一個角色')
    assert.equal(recovered?.chat, '夜晚')

    // 不覆蓋：重建不該動到對話檔本身。
    // ⚠️ 一定要用 `stampedRoom.room`（上面蓋過標頭的那一間），不能用名字——
    // 這段測試裡有**兩間**都叫「夜晚」的房，而 `resolveRoom` 依名字會命中第一間。
    /* ---- 訊息上的「用量／用时」要跟著檔案走（xtra.usage／xtra.ms）---- */

    {
      const usageRoom = await ws.createRoom('老闆娘', '用量那一間')
      await ws.appendRoomMessages('老闆娘', usageRoom.room, [
        { name: '你', isUser: true, text: '嗨' },
        {
          name: '老闆娘',
          isUser: false,
          text: '歡迎。',
          reasoning: '（想一下）',
          usage: { input: 1167, output: 13229, cacheRead: 21205376, cacheWrite: 0, reasoning: 3501 },
          ms: 198000,
        },
      ])
      const back = await ws.readRoomMessages('老闆娘', usageRoom.room)
      assert.equal(back.length, 2, '兩則都讀回來')
      assert.equal(back[0].usage, null, '使用者那一則沒有用量')
      assert.equal(back[0].ms, null, '也沒有用時')
      assert.deepEqual(
        back[1].usage,
        { input: 1167, output: 13229, cacheRead: 21205376, cacheWrite: 0, reasoning: 3501 },
        '助理那一則的用量要原樣回來（DSH 那兩個標籤就是讀它）',
      )
      assert.equal(back[1].ms, 198000, '用時也要回來')
      assert.equal(back[1].reasoning, '（想一下）', '思考在同一個 extra 裡，不能被蓋掉')
      // 沒有用量的訊息：xtra 不該被塞一個空的 usage 進去。
      await ws.appendRoomMessages('老闆娘', usageRoom.room, [
        { name: '你', isUser: true, text: '再說一次' },
      ])
      const raw = await readFile(
        join(root, 'sessions-shop', 'chats', '老闆娘', usageRoom.room, 'chat.jsonl'),
        'utf8',
      )
      const last = JSON.parse(raw.split('\n').filter((line) => line !== '').pop())
      assert.equal(last.extra, undefined, '沒東西就不要寫 extra')
    }
    assert.equal(await ws.readChatSessionId('老闆娘', stampedRoom.room), SID)

    // 壞掉的索引檔 → 當作沒綁定，不要讓 Agent 面炸掉。
    await writeFile(join(root, 'sessions-shop', '.sessions', 'broken.json'), '{ 不是 JSON')
    assert.equal(await ws.readSession('broken'), null, '壞檔回 null')
    assert.equal(
      (await ws.listSessionBindings()).some((item) => item.sessionId === 'broken'),
      false,
      '壞掉的那筆不該出現在清單裡',
    )

    console.log('13. 對話 ↔ session 對照表 OK — 綁定／解綁／重建／路徑防護／壞檔容錯')
  }

  /* ------------------------- 14. 刪除對話（不連帶清理） -------------------- */

  {
    const ws = new TavernWorkspace(join(root, 'delete-shop'))
    await ws.ensure()
    await ws.createRoom('老闆娘', '要留的')
    const dropRoom = await ws.createRoom('老闆娘', '要刪的')

    const SID = 'session-delete-0000-1111-2222-333344445555'
    await ws.bindSession(SID, { character: '老闆娘', room: dropRoom.room, chat: '要刪的' })
    await ws.stampChatSessionId('老闆娘', dropRoom.room, SID)

    // 這間房自己的插圖——**在房間資料夾裡**，不再是 `art/chats/…`。
    const artDir = join(root, 'delete-shop', 'chats', '老闆娘', dropRoom.room, 'art')
    await mkdir(artDir, { recursive: true })
    await writeFile(join(artDir, '場景.png'), 'not really a png')

    const before = (await ws.listAllRooms()).map((item) => item.name).sort()
    assert.deepEqual(before, ['要刪的', '要留的'], '兩間都在')

    const removed = await ws.deleteRoom('老闆娘', dropRoom.room)
    assert.equal(removed.room, dropRoom.room)
    assert.deepEqual(removed.unbound, [SID], '要順手解掉綁在這間房上的 session')

    const after = (await ws.listAllRooms()).map((item) => item.name)
    assert.deepEqual(after, ['要留的'], '只刪掉指定的那一間')

    // 對照表是「關於這間房」的中繼資料 → 一起清掉（不然之後同名房間會繼承舊綁定）
    assert.equal(await ws.readSession(SID), null, '房間沒了，綁定也不該留著')

    // ⚠️ **房間的資源跟著房間走**：刪房就是整個資料夾刪掉，房裡的插圖一起走。
    // 這與舊的 `deleteChat` **相反**——那一條只刪 `.jsonl`，插圖留在 `art/chats/`
    // 變成孤兒圖。房間的模型是「我把這間房拆了」，所以刪除就是刪除整個房間。
    assert.equal(existsSync(join(artDir, '場景.png')), false, '房間拆了，房裡的插圖也不該留著')
    assert.equal(
      existsSync(join(root, 'delete-shop', 'chats', '老闆娘', dropRoom.room)),
      false,
      '整個房間資料夾都不見了',
    )

    // 刪不存在的 → 明確報錯（不然「刪掉了」跟「本來就沒有」在畫面上長得一樣）
    await assert.rejects(
      () => ws.deleteRoom('老闆娘', '不存在'),
      /找不到這間房/,
      '不存在的房間要明確報錯',
    )
    await assert.rejects(() => ws.deleteRoom('老闆娘', ''), /房間/, '空 id 要拒絕')
    await assert.rejects(() => ws.deleteRoom('../escape', 'x'), /角色 id/, '路徑跳脫要擋下')

    console.log('14. 刪除房間 OK — 整間拆掉（含插圖）、解掉綁定、不存在時明確報錯')
  }

  /* --------------------- 15. 房間訊息的追加與讀取 ------------------------- */

  {
    const ws = new TavernWorkspace(join(root, 'messages-shop'))
    await ws.ensure()
    const room = (await ws.createRoom('老闆娘', '夜晚')).room
    const file = join(root, 'messages-shop', 'chats', '老闆娘', room, 'chat.jsonl')

    assert.deepEqual(await ws.readRoomMessages('老闆娘', room), [], '剛開好的房間沒有訊息')

    const written = await ws.appendRoomMessages('老闆娘', room, [
      { name: '阿明', isUser: true, text: '今天有什麼酒？' },
      { name: '老闆娘', isUser: false, text: '自己看板子。' },
    ])
    assert.equal(written, 2, '兩則都要寫進去')

    const messages = await ws.readRoomMessages('老闆娘', room)
    assert.equal(messages.length, 2)
    assert.equal(messages[0].text, '今天有什麼酒？')
    assert.equal(messages[0].isUser, true)
    assert.equal(messages[0].name, '阿明')
    assert.equal(messages[1].isUser, false)
    assert.equal(messages[1].name, '老闆娘')
    assert.equal(typeof messages[0].sendDate, 'string', '要有時間戳')

    // ⚠️ 追加，不是改寫：既有的訊息一則都不能少
    await ws.appendRoomMessages('老闆娘', room, [{ name: '阿明', isUser: true, text: '再一杯。' }])
    assert.equal((await ws.readRoomMessages('老闆娘', room)).length, 3, '追加不能蓋掉前面的')

    // 標頭行要還在，而且沒有被當成訊息
    const raw = await readFile(file, 'utf8')
    const lines = raw.split('\n').filter((line) => line !== '')
    assert.equal(lines.length, 4, '一行標頭 ＋ 三則訊息')
    assert.equal(JSON.parse(lines[0]).character_name, 'unused', '標頭還是標頭')
    assert.equal(JSON.parse(lines[1]).mes, '今天有什麼酒？')

    // 空訊息、壞輸入 → 不寫，也不要丟錯
    assert.equal(await ws.appendRoomMessages('老闆娘', room, [{ name: 'x', text: '' }]), 0, '空字串不寫')
    assert.equal(await ws.appendRoomMessages('老闆娘', room, []), 0, '空陣列不寫')
    assert.equal(await ws.appendRoomMessages('老闆娘', room, null), 0, '不是陣列也不丟錯')
    assert.equal((await ws.readRoomMessages('老闆娘', room)).length, 3, '上面三次都沒寫進東西')

    // 房間不存在 → 明確報錯（不准憑空生一份沒有標頭的檔案）
    //
    // ⚠️ 訊息從「找不到這份對話」變成「找不到這間房」：東西現在是房間，
    // 而契約是「明確失敗、訊息可行動」，不是那幾個字。
    await assert.rejects(
      () => ws.appendRoomMessages('老闆娘', '不存在', [{ name: 'x', text: 'y' }]),
      /找不到這間房/,
      '對不存在的房間追加要報錯',
    )

    // 壞掉的一行 → 跳過那一行，其他照讀（不要讓一行壞資料毀掉整間房）
    await writeFile(file, raw + '{ 這不是 JSON\n' + JSON.stringify({ name: 'x', is_user: true, mes: '好的' }) + '\n')
    const survived = await ws.readRoomMessages('老闆娘', room)
    assert.equal(survived.length, 4, '壞行跳過，好的那則還是要讀到')
    assert.equal(survived[3].text, '好的')

    console.log('15. 房間訊息 OK — 追加不覆蓋、空輸入不寫、壞行跳過、不存在時報錯')
  }

  /* --------------------- 15b. 訊息上的附件（`extra.media`）----------------- */

  {
    // 使用者：「沒法上傳檔案」。附件跟著訊息走的那一份存在 `extra.media`
    // ——那是 **SillyTavern 自己的欄位**，所以形狀照它（`{type,url,name,bytes}`），
    // 而且**沒有正文也寫得進去**（丟一張圖不說話是合法的）。
    const ws = new TavernWorkspace(join(root, 'media-shop'))
    await ws.ensure()
    const room = (await ws.createRoom('老闆娘', '看圖')).room
    const file = join(root, 'media-shop', 'chats', '老闆娘', room, 'chat.jsonl')

    const wrote = await ws.appendRoomMessages('老闆娘', room, [
      {
        name: '你',
        isUser: true,
        text: '',
        media: [{ type: 'image', url: '/api/dsh-tavern/files/老闆娘/' + room + '/照片.png', name: '照片.png', bytes: 1234 }],
      },
      {
        name: '老闆娘',
        isUser: false,
        text: '這是什麼？',
        media: [{ type: 'file', url: '/api/dsh-tavern/files/老闆娘/' + room + '/筆記.txt', name: '筆記.txt', bytes: 12 }],
      },
    ])
    assert.equal(wrote, 2, '只有附件的那一則也要寫（以前空正文整則被丟掉）')

    const back = await ws.readRoomMessages('老闆娘', room)
    assert.equal(back.length, 2)
    assert.equal(back[0].text, '', '正文可以是空的')
    assert.equal(back[0].media.length, 1)
    assert.equal(back[0].media[0].type, 'image')
    assert.equal(back[0].media[0].name, '照片.png')
    assert.equal(back[0].media[0].bytes, 1234)
    assert.equal(back[1].media[0].type, 'file')
    assert.equal(back[1].media[0].url, '/api/dsh-tavern/files/老闆娘/' + room + '/筆記.txt')

    // 磁碟上的形狀：`extra.media`（SillyTavern 的欄位），不是我們自己發明的名字。
    const lines = (await readFile(file, 'utf8')).split('\n').filter((line) => line !== '')
    const record = JSON.parse(lines[1])
    assert.equal(record.mes, '', '沒有正文就是空字串')
    assert.deepEqual(Object.keys(record.extra), ['media'], '只有 media 時不要多寫別的欄位')
    assert.equal(record.extra.media[0].type, 'image')

    // 壞掉的媒體一律當沒有，而**那一則訊息不能被它帶走**。
    await ws.appendRoomMessages('老闆娘', room, [
      { name: '你', isUser: true, text: '壞資料', media: [null, { type: 'image' }, 'x', { url: '' }] },
    ])
    const messy = await ws.readRoomMessages('老闆娘', room)
    assert.equal(messy.at(-1).text, '壞資料')
    // `{url:''}` 這種「有欄位沒值」的也算壞——留著只會畫出一顆點不開的 chip。
    assert.deepEqual(messy.at(-1).media, [], '壞掉的媒體一律當沒有')

    // 沒有 media 的訊息形狀不變（既有檔案不要長出新欄位）。
    await ws.appendRoomMessages('老闆娘', room, [{ name: '你', isUser: true, text: '普通的一則' }])
    const plain = JSON.parse((await readFile(file, 'utf8')).split('\n').filter((line) => line !== '').at(-1))
    assert.equal(plain.extra, undefined, '沒有附件就不要寫 extra')
    assert.deepEqual((await ws.readRoomMessages('老闆娘', room)).at(-1).media, [], '讀回來是空陣列，不是 undefined')

    console.log('15b. 訊息附件 OK — 存進 extra.media、只有附件也寫得進去、壞資料被丟掉')
  }

  /* ------------------------------- 16. 對話改名 ------------------------------- */

  {
    // 房間的**身分是 id**，所以改名**只改 `room.json` 裡的名字**——資料夾、對話檔、
    // `.sessions` 對照表、插圖全部不用動。
    //
    // 舊的 `renameChat` 要同時搬四處（檔名、對照表、插圖資料夾、`tavern.json` 的主圖
    // key），因為它拿**名字**當身分。那正是這個佈局要解掉的東西——所以這一段的斷言
    // 從「四處都搬對了」變成「**四處都沒動**」。
    const ws = new TavernWorkspace(join(root, 'rename-shop'))
    const room = (await ws.createRoom('老闆娘', '夜晚')).room
    await ws.appendRoomMessages('老闆娘', room, [
      { name: '你', isUser: true, text: '今天有什麼酒？' },
      { name: '老闆娘', isUser: false, text: '有剛到的麥酒。' },
    ])
    const session = await ws.bindSession('session-rename-0001', {
      character: '老闆娘',
      room: room,
      chat: '夜晚',
    })
    // 用 `readFile` 當存在性檢查（不必新增匯入）。
    const existsFile = (path) => readFile(path).then(() => true, () => false)

    // 房裡的插圖（跟著房間走）
    const artDir = join(root, 'rename-shop', 'chats', '老闆娘', room, 'art')
    await mkdir(artDir, { recursive: true })
    await writeFile(join(artDir, '微笑.png'), 'x')

    const renamed = await ws.renameRoom('老闆娘', room, '初次見面')
    assert.equal(renamed.name, '初次見面', '回傳新的顯示名稱')
    assert.equal(renamed.room, room, '房間 id 不變（身分不是名字）')

    // 1. 資料夾、對話檔、插圖**全部留在原地**
    assert.equal((await ws.readRoom('老闆娘', room)).name, '初次見面', '新名字寫進 room.json')
    assert.equal(
      await existsFile(join(root, 'rename-shop', 'chats', '老闆娘', room, 'chat.jsonl')),
      true,
      '對話檔沒有被搬',
    )
    assert.equal(await existsFile(join(artDir, '微笑.png')), true, '插圖沒有被搬')
    const kept = await ws.readRoomMessages('老闆娘', room)
    assert.equal(kept.length, 2, '訊息原樣還在')
    assert.equal(kept[1].text, '有剛到的麥酒。')

    // 2. 綁定也沒被動到（它記的是 id，不是名字）
    assert.equal((await ws.readSession(session.sessionId)).room, room, '綁定指向同一個房間 id')

    // 3. **同名不再衝突**：再開一間也叫「初次見面」的房，兩間各自存在、沒有一間被蓋掉。
    const twin = (await ws.createRoom('老闆娘', '初次見面')).room
    assert.notEqual(twin, room, '同名要拿到不同的房間 id')
    assert.equal((await ws.listRooms('老闆娘')).length, 2, '兩間都在')

    // 4. 錯誤路徑：不存在的房間要報錯；空名字**不會改掉現有的名字**（不是丟錯）
    await assert.rejects(
      () => ws.renameRoom('老闆娘', '不存在', '隨便'),
      /找不到這間房/,
      '不存在的房間要報錯',
    )
    await ws.renameRoom('老闆娘', room, '   ')
    assert.equal(
      (await ws.readRoom('老闆娘', room)).name,
      '初次見面',
      '空名字不會把現有的名字清掉',
    )

    console.log('16. 房間改名 OK — 只改 room.json；資料夾／對話／插圖／綁定全部不動；同名不衝突')
  }

  /* --------------------------- 17. 思考（reasoning）無損往返 --------------------------- */

  {
    // 思考放在訊息的 `extra.reasoning`——那是 SillyTavern 本來就有的自由欄位，
    // 所以帶著走的 `.jsonl` 裡思考不會丟，別的軟體也讀得懂那一則訊息。
    const ws = new TavernWorkspace(join(root, 'think-shop'))
    const room = (await ws.createRoom('老闆娘', '想一下')).room
    await ws.appendRoomMessages('老闆娘', room, [
      { name: '你', isUser: true, text: '今天有什麼酒？' },
      { name: '老闆娘', isUser: false, text: '有麥酒。', reasoning: '他問的是酒。\n先看庫存。' },
    ])
    const read = await ws.readRoomMessages('老闆娘', room)
    assert.equal(read.length, 2, '兩則')
    assert.equal(read[0].reasoning, '', '使用者那一則沒有思考，要回空字串（呼叫端不必再判 null）')
    assert.equal(read[1].reasoning, '他問的是酒。\n先看庫存。', '思考要原樣讀回來（含換行）')
    assert.equal(read[1].text, '有麥酒。', '思考不可以混進正文')

    // 檔案形狀：`extra.reasoning`，而且**沒有思考的訊息不該長出空的 extra**
    const raw = await readFile(
      join(root, 'think-shop', 'chats', '老闆娘', room, 'chat.jsonl'),
      'utf8',
    )
    const lines = raw.trim().split('\n')
    assert.equal(JSON.parse(lines[2]).extra.reasoning, '他問的是酒。\n先看庫存。', '寫成 extra.reasoning')
    assert.equal(JSON.parse(lines[1]).extra, undefined, '沒有思考的訊息不該有空的 extra')

    // 壞行與缺欄位照舊要能讀（既有行為不能被這一條弄壞）
    await writeFile(
      join(root, 'think-shop', 'chats', '老闆娘', room, 'chat.jsonl'),
      raw + JSON.stringify({ name: 'x', is_user: false, mes: '沒有 extra' }) + '\n{ 壞行\n',
    )
    const survived = await ws.readRoomMessages('老闆娘', room)
    assert.equal(survived.length, 3, '壞行跳過，缺 extra 的那一則照讀')
    assert.equal(survived[2].reasoning, '', '缺 extra 時 reasoning 是空字串')

    console.log('17. 思考往返 OK — extra.reasoning 原樣往返，不混進正文、不留空的 extra')
  }

  /* --- 18. 世界書的注入位置（2.6.59）-------------------------------------- */
  {
    /**
     * ⚠️ **這一支只改書的 `position` 一個欄位**，不是「讀出來、改一格、寫回去」。
     * 理由：那是使用者的 ST 檔，裡面幾十個我們不認得的欄位，而
     * 「整本送過來再寫回去」等於相信那一趟來回沒有掉東西。
     *
     * 所以這一節的**重點斷言是「其他欄位一個都沒動」**。
     */
    const ws6 = new TavernWorkspace(root)
    const book = {
      name: '輸出格式',
      // ST 的一堆欄位：我們不認得，但**不准掉**。
      entries: { 0: { uid: 0, comment: '格式', content: 'SPEC', constant: true, token_budget: 400 } },
      unknownTopLevel: { keep: 'me' },
      position: 4,
    }
    const id = await ws6.writeWorldbook('', book)

    // ① 一開始：ST 的 `4` ⇒ in-chat（而且 `explicit` 是 true——它是明確的）。
    const before = await ws6.worldbookPositions()
    const one = before.books.find((b) => b.id === id)
    assert.ok(one !== undefined, '清單要有這一本')
    assert.equal(one.position, 'in-chat', 'ST 的 4 映射到 in-chat')
    assert.equal(one.explicit, true, '⚠️ ST 的數字是「明確指定」，不是「沒指定」')
    assert.equal(before.fallback, '', '酒館層預設一開始是空的（＝沒有指定）')

    // ② 改位置 ⇒ 只有 `position` 變，其餘逐位元組保留。
    const written = await ws6.writeWorldbookPosition(id, 'system-after')
    assert.equal(written, 'system-after', '回寫進去的值')
    const after = JSON.parse(await readFile(join(root, 'worldbooks', `${id}.json`), 'utf8'))
    assert.equal(after.position, 'system-after', 'position 要改到')
    assert.equal(after.name, '輸出格式', 'name 不可以掉')
    assert.deepEqual(after.unknownTopLevel, { keep: 'me' }, '⚠️ 不認得的頂層欄位不可以掉')
    assert.equal(after.entries['0'].token_budget, 400, '⚠️ 條目裡的欄位也不可以掉')
    assert.equal(after.entries['0'].content, 'SPEC', '內容不變')
    assert.equal(after.entries['0'].constant, true, 'constant 不變')

    // ③ 酒館層的預設：書沒有指定時才用它。
    const fallbackSaved = await ws6.writeSettings({ worldbookPosition: 'system-before' })
    assert.equal(fallbackSaved.worldbookPosition, 'system-before', '酒館層預設存得下去')
    const listed2 = await ws6.worldbookPositions()
    assert.equal(listed2.fallback, 'system-before', '讀回來要看得到預設')
    assert.equal(
      listed2.books.find((b) => b.id === id).position,
      'system-after',
      '⚠️ 書自己指定了 ⇒ 蓋過酒館預設',
    )
    // 沒指定位置的新書 ⇒ 用酒館預設。
    const plainId = await ws6.writeWorldbook('', { name: '沒指定', entries: { 0: { uid: 0, content: 'X' } } })
    const listed3 = await ws6.worldbookPositions()
    const plain = listed3.books.find((b) => b.id === plainId)
    assert.equal(plain.position, 'system-before', '沒指定的書用酒館預設')
    assert.equal(plain.explicit, false, '而且 `explicit` 要是 false')

    // ④ 壞值：**丟錯**（不是靜靜落回預設）——這一格錯了會讓書被讀成「使用者的話」。
    await assert.rejects(
      () => ws6.writeWorldbookPosition(id, 'nope'),
      /位置要是/,
      '不合法要明確報錯',
    )
    await assert.rejects(
      () => ws6.writeWorldbookPosition('不存在的書', 'in-chat'),
      /找不到這本世界書/,
      '不存在的書要明確報錯',
    )
    /**
     * ⚠️ **空字串／`null` ＝ 把 `position` 刪掉**（2.6.70 的三態）。
     *
     * 在那之前畫面上寫著「要回到跟著酒館預設，請到原始 JSON 把 position 刪掉」
     * ——那是一個**做不到的設定**（這條路上沒有刪欄位的辦法）。
     */
    const unset = await ws6.writeWorldbookPosition(id, null)
    assert.equal(unset, null, '清掉時回 null')
    assert.equal(
      'position' in JSON.parse(await readFile(join(root, 'worldbooks', `${id}.json`), 'utf8')),
      false,
      '⚠️ 而且檔案裡真的沒有那個鍵了',
    )
    assert.equal(
      (await ws6.worldbookPositions()).books.find((b) => b.id === id).explicit,
      false,
      '清掉之後 `explicit` 要回到 false（書自己沒指定了）',
    )
    // 放回去（後面的斷言要用）。
    await ws6.writeWorldbookPosition(id, 'system-after')
    // 而 `writeSettings` 那一格是**回報**（dropped），不是丟錯——同生成參數的規矩。
    const bad = await ws6.writeSettings({ worldbookPosition: 'nope' })
    assert.equal(bad.worldbookPosition, 'system-before', '⚠️ 壞值不可以覆蓋原本的值')
    assert.ok(
      bad.dropped.some((x) => x.startsWith('worldbookPosition')),
      '要回報：' + JSON.stringify(bad.dropped),
    )
    // 空字串是**合法**的（＝取消指定 ⇒ 回到 in-chat）。
    const cleared = await ws6.writeSettings({ worldbookPosition: '' })
    assert.equal(cleared.worldbookPosition, '', '空字串＝取消指定')
    assert.equal(
      (await ws6.worldbookPositions()).books.find((b) => b.id === plainId).position,
      'in-chat',
      '⚠️ 沒有預設、書也沒指定 ⇒ in-chat（＝與 2.6.58 一字不差）',
    )

    console.log('18. 世界書位置 OK — 只改一個欄位、ST 欄位不掉、書蓋過酒館、壞值回報')
  }

  /* --- 18b. 房間對**條目優先序**的覆寫（2.6.70）---------------------------- */
  {
    /**
     * 使用者：
     *   > 酒館有個圖書館，開房間的時候會將所有預設放進去，然後房間自己可以微調修改，
     *   > 不包括內容，只是修改位置以及優先序
     *
     * ⚠️ **這一節的第一版做的是「書層」的優先序**（`worldbookOverrides[id].priority`），
     * 使用者驗收時打回來：
     *
     *   > 我看見**世界書裏面有不同的項目設定次序**，我說的是那個，
     *   > 你獨立給了我另一個次序了
     *
     * 所以現在調的是**條目自己的 `order`**（他看得到的那個），值存在
     * `room.json` 的 `worldbookEntryOverrides`——**書的檔案一個字都不會被改**。
     *
     * 這一節釘住四件事：
     *   1. 房間的覆寫存得下去、讀得回來（`roomEntries`），而且**不動書**
     *   2. **鍵是 `uid`**（沒有 uid 才用 `#<索引>`）——鍵錯了會覆寫到別的條目上
     *   3. 三態：`order: null` ＝ 還原成書自己的值
     *   4. 壞值（不存在的書／不存在的條目／不是整數）**回報**而且不寫進檔案
     */
    const ws7 = new TavernWorkspace(root)
    const bookId = await ws7.writeWorldbook('', {
      name: '順序書',
      entries: {
        0: { uid: 4, comment: '第一條', content: 'A', order: 100, constant: true },
        1: { uid: 9, comment: '第二條', content: 'B', order: 900, constant: true },
        2: { comment: '沒有 uid', content: 'C', order: 500, constant: true },
      },
    })
    const room = (await ws7.createRoom('甲', '順序房')).room

    // ① 一開始：每一條都是書自己的值，而且 `overridden` 都是 false。
    const before = await ws7.roomEntries('甲', room, bookId)
    assert.deepEqual(before.entries.map((one) => one.key), ['4', '9', '#2'], '⚠️ 鍵：uid 優先，沒有 uid 才用 #索引')
    assert.deepEqual(before.entries.map((one) => one.order), [100, 900, 500], '沒覆寫 ⇒ 書自己的 order')
    assert.deepEqual(before.entries.map((one) => one.ownOrder), [100, 900, 500], '`ownOrder` 也要回（還原要用）')
    assert.deepEqual(before.entries.map((one) => one.overridden), [false, false, false], '一條都沒被調過')
    assert.deepEqual(before.entries.map((one) => one.label), ['第一條', '第二條', '沒有 uid'], '標題由宿主半算（`comment`）')
    assert.deepEqual(before.entries.map((one) => one.content), ['A', 'B', 'C'], '內容唯讀但要畫得出來')

    // ② 寫一筆覆寫：把 uid 4 那一條拉到最前面。
    const saved = await ws7.writeRoom('甲', room, {
      worldbookEntryOverrides: { [bookId]: { 4: { order: 950 } } },
    })
    assert.deepEqual(saved.worldbookEntryOverrides, { [bookId]: { 4: { order: 950 } } }, '存得下去')
    const after = await ws7.roomEntries('甲', room, bookId)
    assert.deepEqual(after.entries.map((one) => one.order), [950, 900, 500], '這一間房算完的值')
    assert.deepEqual(after.entries.map((one) => one.ownOrder), [100, 900, 500], '⚠️ 書自己的值不變')
    assert.deepEqual(after.entries.map((one) => one.overridden), [true, false, false], '只有那一條被調過')

    // ③ ⚠️ **書的檔案一個字都不會被改**（這是這個功能的全部重點）。
    const raw = JSON.parse(await readFile(join(root, 'worldbooks', `${bookId}.json`), 'utf8'))
    assert.equal(raw.entries['0'].order, 100, '⚠️ 書裡的 order 不可以被房間改到')
    assert.equal(raw.entries['1'].order, 900, '別的條目也不可以')
    assert.equal(raw.entries['2'].order, 500, '沒有 uid 的那一條也不可以')
    assert.equal('worldbookEntryOverrides' in raw, false, '房間的設定不可以寫進書的檔案')

    // ④ 三態：`order: null` ＝ 把那一條的覆寫刪掉（還原成書自己的）。
    await ws7.writeRoom('甲', room, { worldbookEntryOverrides: { [bookId]: { 4: { order: null } } } })
    assert.deepEqual(
      (await ws7.roomEntries('甲', room, bookId)).entries.map((one) => one.overridden),
      [false, false, false],
      'null ＝ 還原（鍵都刪光就整包不見）',
    )
    assert.deepEqual(
      (await ws7.roomEntries('甲', room, bookId)).entries.map((one) => one.order),
      [100, 900, 500],
      '還原之後回到書自己的值',
    )

    // ⑤ 壞值：**回報**（dropped）而且不寫進檔案。
    const badBook = await ws7.writeRoom('甲', room, {
      worldbookEntryOverrides: { 不存在的書: { 0: { order: 1 } } },
    })
    assert.deepEqual(badBook.worldbookEntryOverrides, {}, '不認得的書不留')
    assert.ok(badBook.dropped.some((x) => x.includes('沒有這本世界書')), '要回報：' + JSON.stringify(badBook.dropped))
    const badEntry = await ws7.writeRoom('甲', room, {
      worldbookEntryOverrides: { [bookId]: { '999': { order: 1 } } },
    })
    assert.deepEqual(badEntry.worldbookEntryOverrides, {}, '不存在的條目不留')
    assert.ok(badEntry.dropped.some((x) => x.includes('沒有這一條')), '要回報：' + JSON.stringify(badEntry.dropped))
    const badOrder = await ws7.writeRoom('甲', room, {
      worldbookEntryOverrides: { [bookId]: { 4: { order: 1.5 } } },
    })
    assert.deepEqual(badOrder.worldbookEntryOverrides, {}, '不合法的 order 不留')
    assert.ok(badOrder.dropped.some((x) => x.includes('優先序')), '要回報：' + JSON.stringify(badOrder.dropped))
    // 數字字串**收**（`<input>` 送的就是字串）。
    await ws7.writeRoom('甲', room, { worldbookEntryOverrides: { [bookId]: { 4: { order: '777' } } } })
    assert.equal(
      (await ws7.roomEntries('甲', room, bookId)).entries[0].order,
      777,
      '數字字串收得下來（parse 只該有一份，在宿主半）',
    )

    // ⑥ 兩層覆寫互不干擾：關掉一本書，條目覆寫還在（它們是不同的鍵）。
    await ws7.writeRoom('甲', room, { worldbookOverrides: { [bookId]: { enabled: false } } })
    const listed = await ws7.roomWorldbookPositions('甲', room)
    assert.equal(listed.books.find((b) => b.id === bookId).enabled, false, '書被這一間房關掉了')
    assert.deepEqual(
      listed.entryOverrides,
      { [bookId]: { 4: { order: 777 } } },
      '⚠️ 條目覆寫要跟清單一起回去（房間那一頁送 patch 是整份取代，不知道就會清掉別的）',
    )

    // ⑦ 不存在的書／壞掉的書：`roomEntries` 要**明確報錯**（不是回空的）。
    await assert.rejects(() => ws7.roomEntries('甲', room, '不存在的書'), /找不到這本世界書/, '要說出是哪一本')
    await assert.rejects(() => ws7.roomEntries('甲', '不存在的房', bookId), /找不到這間房/, '房間也要驗')

    console.log('18b. 房間的條目優先序 OK — uid 當鍵、書一個字都不改、三態還原、壞值回報')
  }

  /* --- 19. 驗收探針的兩條原始碼契約（2.6.58）-------------------------------- */
  {
    /**
     * ⚠️ **驗證工具壞掉是「安靜的成功」**——它會回報一個看起來很正常的答案，
     * 而那個答案是**別的東西的**。這一輪兩種都真的踩到了，所以用斷言釘住：
     *
     * 1. **它必須只看這一間酒館的 session。** 第一版是「所有 log 按 mtime 排序、
     *    取最新的」，於是它報的是 `dsh-tavern` 工作區底下那個 session
     *    ——**agent 自己講話的那一個**，不是酒館的房間。使用者看到的是
     *    「驗證通過」，而它驗的是別人的對話。
     * 2. **它必須是唯讀的。** 第一版用「送一個不合法值當探針」，那會寫進
     *    使用者的 `tavern.json`（而且「不合法」的判斷會隨版本漂移）。
     *
     * 這兩條都只能用原始碼掃描驗（那支腳本要連真的 DSH 才跑得動），
     * 而同一個 repo 對 `ensureTheme(` 已經有同樣形狀的斷言。
     */
    const probe = (await readFile(new URL('./verify-stop.mjs', import.meta.url), 'utf8')).replace(/\r\n/g, '\n')

    assert.ok(
      /const wanted = new Set\(\)/.test(probe) && /\.sessions/.test(probe) && /chat_metadata/.test(probe),
      '⚠️ 探針要先把「這一間酒館的 session id」收集起來（`.sessions` ＋ `chat.jsonl` 的標頭），' +
        '再拿它去過濾 log——不然它會讀到**別的** session（實測發生過）',
    )
    assert.ok(
      /\.filter\(\(one\) => wanted\.size === 0 \|\|/.test(probe),
      '⚠️ 收集到的 session id 要真的拿來 filter（收了不用等於沒收）',
    )
    // 唯讀：不可以有任何寫入的 op 字串。
    for (const op of ['settings.write', 'room.write', 'render.write', 'theme.write', 'tavern.add', 'tavern.remove']) {
      assert.equal(
        probe.includes(`'${op}'`),
        false,
        `⚠️ 探針必須唯讀，不可以送 ${op}（第一版會寫進使用者的 tavern.json）`,
      )
    }
    // `readdirSync` 不是 Promise：`.catch()` 會丟，而症狀是「讀不到 session log」。
    assert.equal(
      /readdirSync\([^)]*\)\.catch\(/.test(probe),
      false,
      '⚠️ `readdirSync` 回陣列不是 Promise——`.catch()` 會丟（這個坑這一支踩過兩次）',
    )
    // 非零結束碼只能用 `process.exitCode`（`process.exit()` 會觸發 libuv 的 assert）。
    // ⚠️ 這一條要用**去過註解**的原始碼：那一支的註解裡**故意寫著** `process.exit()`
    //    （解釋為什麼不可以用它），用原文會命中自己的說明文字。
    //    `test-client.mjs` 的 `stripComments()` 就是為同一件事存在的。
    const code = probe
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/(^|[^:])\/\/[^\n]*/g, '$1')
    assert.ok(/process\.exitCode =/.test(code), '要用 process.exitCode 收尾')
    assert.equal(
      /(?<!Code)process\.exit\(/.test(code),
      false,
      '⚠️ 不可以用 process.exit()（用過 fetch 之後會觸發 libuv 的 assert）',
    )

    console.log('19. 驗收探針 OK — 只看這一間酒館的 session、唯讀、readdirSync 不用 .catch')
  }

  /* --- 20. 出貨預設的升級路徑（2.6.59）------------------------------------ */
  {
    /**
     * ⚠️ **這一節是「更新了但沒變」的解藥。**
     *
     * 新建酒館會自動拿到出貨的預設；**既有的不會**——`seed()` 只在建立時跑一次。
     * 所以出貨內容的修正（例如 2.6.59 多了一條「哪種內容用哪個 kind」）
     * 到不了舊酒館，而使用者只會覺得「更新沒用」。
     *
     * ⚠️ **但「補」不等於「覆蓋」。** 這一節最重要的斷言全部是**否定**的：
     * 使用者改過一個字、或多加一條，那本書就**完全不動**。
     * 判斷方法是**逐字比對出貨版**（不是版本號——版本號在「手改之後」還是舊的，
     * 那會讓使用者的東西被蓋掉）。
     */
    const { upgradeFormatBook } = await import('./lib/workspace.js')
    const { defaultFormatWorldbook, FORMAT_INSTRUCTION, FORMAT_KIND_GUIDE } = await import('./lib/defaults.js')
    const shipped = defaultFormatWorldbook()
    const shippedCount = Object.keys(shipped.entries).length
    assert.equal(shippedCount, 2, '出貨版有兩條：格式 ＋ 哪種內容用哪個 kind')
    assert.equal(
      shipped.position,
      'system-after',
      '⚠️ 出貨的格式書放在**系統提示**（角色卡後面）——模型才不會把它讀成使用者的話',
    )

    // ① 舊原版（只有格式那一條）⇒ 升級，而且是**逐條**升級（不需要使用者做任何事）。
    const legacy = {
      name: '輸出格式',
      entries: { 0: { uid: 0, comment: '輸出格式（酒館模式）', content: FORMAT_INSTRUCTION, constant: true, order: 999 } },
    }
    const up = upgradeFormatBook(JSON.stringify(legacy), shipped)
    assert.ok(up !== null, '沒改過的原版要被升級（不然「更新了但沒變」）')
    assert.equal(Object.keys(up.entries).length, 2, '要補上第二條')
    assert.equal(up.position, 'system-after', '要帶上新的位置')
    const contents = Object.values(up.entries).map((one) => one.content)
    assert.ok(contents.includes(FORMAT_KIND_GUIDE), '補上的就是「哪種內容用哪個 kind」')
    assert.equal(up.entries['0'].uid, 0, '⚠️ uid 要保留（`collectLore` 用它決勝負）')
    assert.equal(up.entries['0'].comment, '輸出格式（酒館模式）', '標題保留')

    // ② 使用者**改過一個字** ⇒ 完全不動。
    const edited = JSON.parse(JSON.stringify(legacy))
    edited.entries['0'].content = edited.entries['0'].content + '\n我自己加的'
    assert.equal(upgradeFormatBook(JSON.stringify(edited), shipped), null, '⚠️ 改過就不升級')

    // ③ 使用者**多加一條** ⇒ 完全不動。
    const extra = JSON.parse(JSON.stringify(legacy))
    extra.entries['1'] = { uid: 1, content: '我的東西' }
    assert.equal(upgradeFormatBook(JSON.stringify(extra), shipped), null, '⚠️ 多一條就不升級')

    // ④ **只改了標題** ⇒ 還是升級（標題不是內容，不該讓整本書停止升級），
    //    而且那個標題要留著。
    const renamed = JSON.parse(JSON.stringify(legacy))
    renamed.entries['0'].comment = '我的格式說明'
    const renamedUp = upgradeFormatBook(JSON.stringify(renamed), shipped)
    assert.ok(renamedUp !== null, '只改標題 ⇒ 還是升級')
    assert.equal(renamedUp.entries['0'].comment, '我的格式說明', '⚠️ 標題要留著（那是使用者的字）')

    // ⑤ 頂層多了不認得的鍵 ⇒ 不動。
    const withExtraKey = JSON.parse(JSON.stringify(legacy))
    withExtraKey.未知的鍵 = 1
    assert.equal(upgradeFormatBook(JSON.stringify(withExtraKey), shipped), null, '⚠️ 有額外的頂層鍵就不動')

    // ⑥ 壞檔 ⇒ 不動（不丟錯）。
    assert.equal(upgradeFormatBook('{ 壞', shipped), null, '壞檔不丟錯')
    assert.equal(upgradeFormatBook('null', shipped), null, 'null 不丟錯')
    assert.equal(upgradeFormatBook(JSON.stringify({ entries: {} }), shipped), null, '空的 entries 不動')

    // ⑦ **幂等**：升級過的再跑一次**什麼都不做**。
    //    ⚠️ 這一條是實測抓到的：第一版會回一個「內容一樣但物件不同」的結果，
    //    於是使用者按「補上預設內容」時畫面說「已更新」而實際上什麼都沒變
    //    ——那比不做事更糟，因為它讓「有沒有做事」失去意義。
    assert.equal(
      upgradeFormatBook(JSON.stringify(up), shipped),
      null,
      '⚠️ 已經是最新版 ⇒ 回 null（＝不必寫檔、也不必回報更新）',
    )

    // ⑧ `repairDefaults()` 走真的檔案：沒有檔案時建、建完再跑一次說「沒有東西要補」。
    const ws7 = new TavernWorkspace(join(root, 'repair-shop'))
    await ws7.ensure()
    const first = await ws7.repairDefaults()
    assert.equal(first.changed.length, 1, '第一次要建那一本：' + JSON.stringify(first.changed))
    assert.ok(existsSync(join(root, 'repair-shop', 'worldbooks', '輸出格式.json')), '檔案要真的落地')
    const secondRun = await ws7.repairDefaults()
    assert.deepEqual(secondRun.changed, [], '⚠️ 第二次沒有東西要補（**不可以假裝做了事**）')
    // 改了它之後再跑 ⇒ 進 `skipped`（保留），不是 `changed`。
    const path2 = join(root, 'repair-shop', 'worldbooks', '輸出格式.json')
    const mine = JSON.parse(await readFile(path2, 'utf8'))
    mine.entries['0'].content = '我自己寫的格式'
    await writeFile(path2, JSON.stringify(mine, null, 2))
    const third = await ws7.repairDefaults()
    assert.deepEqual(third.changed, [], '⚠️ 改過之後不可以再改它')
    assert.equal(third.skipped.length, 1, '而且要說「你改過它，原樣保留」：' + JSON.stringify(third.skipped))

    console.log('20. 預設升級 OK — 沒改過才升級、改一個字就不動、幂等、壞檔不丟錯')
  }

  /* --- 21. 世界書位置的**房間那一層**（2.6.62）--------------------------- */
  {
    /**
     * 使用者：「酒館的藏書應該是有分酒館 global 以及房間，所以要有**兩個**設定
     * 位置，現在只有酒館沒能在房間中仔細設定」。
     *
     * ⚠️ 這一節的重點是**優先序**（書 → 房 → 酒館）與**三態**
     * （`null` ＝ 聽酒館的，不是一個位置）。
     */
    const ws8 = new TavernWorkspace(join(root, 'roompos-shop'))
    const bookId = await ws8.writeWorldbook('', {
      name: '沒指定位置的書',
      entries: { 0: { uid: 0, content: 'X', constant: true } },
    })
    const fixedId = await ws8.writeWorldbook('', {
      name: '自己指定位置的書',
      position: 'system-before',
      entries: { 0: { uid: 0, content: 'Y', constant: true } },
    })
    const room = (await ws8.createRoom('甲', '位置房')).room

    // ① 只有酒館層 ⇒ 沒指定的書用酒館的（自己指定的那本除外）。
    await ws8.writeSettings({ worldbookPosition: 'in-chat' })
    const l1 = await ws8.roomWorldbookPositions('甲', room)
    assert.equal(l1.tavern, 'in-chat', '讀得到酒館層')
    assert.equal(l1.room, '', '房間層一開始是空的')
    assert.equal(l1.books.find((b) => b.id === bookId).position, 'in-chat', '沒指定的用酒館的')
    assert.equal(l1.books.find((b) => b.id === fixedId).position, 'system-before', '沒人指定的話，書自己的贏過酒館的預設')
    assert.equal(
      l1.books.find((b) => b.id === fixedId).ownPosition,
      'system-before',
      '⚠️ 也要回報**書自己的**那一個值（房間那一頁的空選項標籤靠它，才不會說謊）',
    )
    assert.equal(l1.books.find((b) => b.id === bookId).ownPosition, '', '書沒指定 ⇒ 空字串')

    // ② 房間層蓋過酒館。
    const saved = await ws8.writeRoom('甲', room, { worldbookPosition: 'system-after' })
    assert.equal(saved.worldbookPosition, 'system-after', '房間層存得下去')
    const l2 = await ws8.roomWorldbookPositions('甲', room)
    assert.equal(l2.room, 'system-after', '讀得到房間層')
    assert.equal(
      l2.books.find((b) => b.id === bookId).position,
      'system-after',
      '⚠️ 房間蓋過酒館（酒館說 in-chat）',
    )
    assert.equal(
      l2.books.find((b) => b.id === fixedId).position,
      'system-before',
      '⚠️ 房間的「預設」蓋不過書自己的（預設只是一種 fallback）',
    )

    // ②b **房間對這一本書的指定 ⇒ 贏過書自己的**（2.6.69 改的）。
    //
    //     2.6.64–2.6.68 的順序是「書贏」，於是書自己指定過的那一本在房間裡
    //     怎麼選都不生效（UI 只好把它鎖起來）。使用者要的是「房間可以設定位置」。
    await ws8.writeRoom('甲', room, { worldbookOverrides: { [fixedId]: { position: 'in-chat' } } })
    const l2b = await ws8.roomWorldbookPositions('甲', room)
    assert.equal(
      l2b.books.find((b) => b.id === fixedId).position,
      'in-chat',
      '⚠️ 房間指定的位置贏過書自己的——不然房間那一格能改卻改不動',
    )
    assert.equal(
      l2b.books.find((b) => b.id === fixedId).ownPosition,
      'system-before',
      '⚠️ `position` 是房間算完的，`ownPosition` 仍然是書自己的（兩個都在，才驗得出差別）',
    )
    await ws8.writeRoom('甲', room, { worldbookOverrides: null })

    // ③ **三態**：`null` ＝ 聽酒館的（不是一個位置）。
    const back = await ws8.writeRoom('甲', room, { worldbookPosition: null })
    assert.equal(back.worldbookPosition, null, '送 null ⇒ 回「聽酒館的」')
    assert.equal(
      (await ws8.roomWorldbookPositions('甲', room)).books.find((b) => b.id === bookId).position,
      'in-chat',
      '回到聽酒館的之後，又變回酒館那一層的值',
    )

    // ④ 壞值要回報，而且**不覆蓋原本的值**。
    await ws8.writeRoom('甲', room, { worldbookPosition: 'system-after' })
    const bad = await ws8.writeRoom('甲', room, { worldbookPosition: 'nope' })
    assert.equal(bad.worldbookPosition, 'system-after', '⚠️ 壞值不可以覆蓋原本的值')
    assert.ok(
      bad.dropped.some((x) => x.startsWith('worldbookPosition')),
      '要回報：' + JSON.stringify(bad.dropped),
    )

    // ⑤ 清單的投影要帶得出來（「⚙️ 房間」那一格讀的是清單）。
    const listed = (await ws8.listRooms('甲')).find((one) => one.room === room)
    assert.equal('worldbookPosition' in listed, true, '⚠️ 清單要帶 worldbookPosition')
    assert.equal(listed.worldbookPosition, 'system-after', '值是 room.json 的')

    // ⑥ ⚠️ 酒館那一支（`worldbookPositions`）**不可以**把房間的值算進去
    //    ——那兩支答的是不同的問題。
    const tavernSide = await ws8.worldbookPositions()
    assert.equal(
      tavernSide.books.find((b) => b.id === bookId).position,
      'in-chat',
      '⚠️ 酒館層那一支只看酒館的預設（房間的值不關它的事）',
    )

    console.log('21. 房間的藏書位置 OK — 三態、房間蓋過酒館、房間指定的蓋過書、兩支 op 答不同的問題')
  }

  /* --- 22. 房間對個別世界書的覆寫（2.6.64）------------------------------- */
  {
    const ws9 = new TavernWorkspace(join(root, 'bookover-shop'))
    const keep = await ws9.writeWorldbook('', { name: '留著', entries: { 0: { uid: 0, content: 'K', constant: true } } })
    const drop = await ws9.writeWorldbook('', { name: '關掉', entries: { 0: { uid: 0, content: 'D', constant: true } } })
    const room = (await ws9.createRoom('甲', '覆寫房')).room

    // ① 預設是空的（＝既有房間的行為不變）。
    const l0 = await ws9.roomWorldbookPositions('甲', room)
    assert.deepEqual(l0.overrides, {}, '一開始沒有覆寫')
    assert.equal(l0.books.every((one) => one.enabled === true), true, '每一本都算「有在用」')
    assert.equal(l0.books.every((one) => one.overridden === false), true, '而且都沒有被碰過')

    // ② 關掉一本 ⇒ 清單要看得出「這一間房關掉了它」。
    const saved = await ws9.writeRoom('甲', room, { worldbookOverrides: { [drop]: { enabled: false } } })
    assert.deepEqual(saved.worldbookOverrides, { [drop]: { enabled: false } }, '覆寫存得下去')
    const l1 = await ws9.roomWorldbookPositions('甲', room)
    assert.equal(l1.books.find((b) => b.id === drop).enabled, false, '⚠️ 清單要說得出「關掉了」')
    assert.equal(l1.books.find((b) => b.id === drop).overridden, true, '而且要有被碰過的記號')
    assert.equal(l1.books.find((b) => b.id === keep).enabled, true, '另一本不受影響')
    // ⚠️ 書的檔案**一個字都不可以被改**。
    assert.equal(
      JSON.parse(await readFile(join(root, 'bookover-shop', 'worldbooks', `${drop}.json`), 'utf8')).entries['0'].content,
      'D',
      '⚠️ 房間的覆寫不可以改到書本身',
    )

    // ③ 位置覆寫。
    await ws9.writeRoom('甲', room, { worldbookOverrides: { [keep]: { position: 'system-after' } } })
    const l2 = await ws9.roomWorldbookPositions('甲', room)
    assert.equal(l2.books.find((b) => b.id === keep).position, 'system-after', '位置覆寫生效')
    assert.equal(l2.overrides[keep].position, 'system-after', '而且讀得回原始覆寫')

    // ④ **不認得的書要回報**（打錯一個字會留下一筆永遠不生效的設定）。
    const bad = await ws9.writeRoom('甲', room, { worldbookOverrides: { 不存在的書: { enabled: false } } })
    assert.ok(
      bad.dropped.some((x) => x.includes('沒有這本世界書')),
      '⚠️ 不認得的書要回報：' + JSON.stringify(bad.dropped),
    )
    assert.deepEqual(bad.worldbookOverrides, {}, '而且不可以留下那一筆')

    // ⑤ **不合法的位置**要回報，也不能留半筆。
    const badPos = await ws9.writeRoom('甲', room, { worldbookOverrides: { [keep]: { position: 'nope' } } })
    assert.ok(
      badPos.dropped.some((x) => x.includes(keep)),
      '不合法位置要回報：' + JSON.stringify(badPos.dropped),
    )
    assert.deepEqual(badPos.worldbookOverrides, {}, '不合法就不留那一筆')

    // ⑥ `enabled: true` 與「沒有這一項」意思一樣 ⇒ 不寫進檔案。
    const neutral = await ws9.writeRoom('甲', room, { worldbookOverrides: { [keep]: { enabled: true } } })
    assert.deepEqual(neutral.worldbookOverrides, {}, '⚠️ `enabled: true` 不該留下一筆沒有作用的設定')

    // ⑦ 送 `null` ⇒ 整份清掉。
    await ws9.writeRoom('甲', room, { worldbookOverrides: { [keep]: { enabled: false } } })
    const cleared = await ws9.writeRoom('甲', room, { worldbookOverrides: null })
    assert.deepEqual(cleared.worldbookOverrides, {}, 'null ＝ 全部還原成酒館那一層')

    console.log('22. 房間的逐書覆寫 OK — 存得下去、清單看得到、書不被改到、不認得的書會回報')
  }

  console.log('\n全部通過 ✅')
} finally {
  await rm(root, { recursive: true, force: true })
}
