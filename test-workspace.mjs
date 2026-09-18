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
import { SUBDIRS, TavernWorkspace, requireId, resolveDshHome, segmentFromName } from './lib/workspace.js'
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

  /* --- 5. 對話紀錄 ------------------------------------------------------ */
  {
    const created = await ws.createChat('測試劍士', '初次見面')
    assert.equal(created.file, '初次見面.jsonl')
    const listed = await ws.listChats()
    assert.equal(listed.length, 1)
    assert.equal(listed[0].character, '測試劍士')
    const raw = (await readFile(join(root, 'chats', '測試劍士', '初次見面.jsonl'), 'utf8')).trim()
    const header = JSON.parse(raw)
    assert.equal(typeof header.chat_metadata, 'object', '第一行要是 SillyTavern 聊天標頭')
    assert.equal(header.user_name, 'unused')

    const again = await ws.createChat('測試劍士', '初次見面')
    assert.equal(again.file, '初次見面-2.jsonl', '撞名要自動編號，不覆蓋')
    const anonymous = await ws.createChat('測試劍士')
    assert.ok(anonymous.file.endsWith('.jsonl'), '沒給名字時用時間戳')
    console.log('5. 對話 OK — SillyTavern 標頭、撞名編號、時間戳')
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
    assert.equal(summary.counts.chats, 3, '初次見面、初次見面-2、時間戳那一份')
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
    assert.deepEqual(
      created.sort(),
      ['characters/老闆娘.json', 'worldbooks/酒館.json'],
      '應該回報實際建立了這兩樣：' + created.join(', '),
    )

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
    assert.equal((await seedWs.listWorldbooks()).length, 1, '世界書清單要有那一本')

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
    await ws.createChat('老闆娘', '夜晚')
    await ws.createChat('酒保', '打烊後')

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
    const stamped = await ws.stampChatSessionId('老闆娘', '夜晚', SID)
    assert.equal(stamped, true, '第一次要真的改到東西')
    assert.equal(await ws.stampChatSessionId('老闆娘', '夜晚', SID), false, '已經一樣就不重寫')
    assert.equal(await ws.readChatSessionId('老闆娘', '夜晚'), SID, '讀得回來')
    assert.equal(await ws.readChatSessionId('老闆娘', '不存在'), null, '不存在的對話回 null')

    // 標頭改到了，但訊息一則都不能少。
    const raw = await readFile(join(root, 'sessions-shop', 'chats', '老闆娘', '夜晚.jsonl'), 'utf8')
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
    assert.equal(await ws.readChatSessionId('老闆娘', '夜晚'), SID)

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
    await ws.createChat('老闆娘', '要刪的')
    await ws.createChat('老闆娘', '要留的')

    const SID = 'session-delete-0000-1111-2222-333344445555'
    await ws.bindSession(SID, { character: '老闆娘', chat: '要刪的' })
    await ws.stampChatSessionId('老闆娘', '要刪的', SID)

    // 這份對話自己的插圖
    const artDir = join(root, 'delete-shop', 'art', 'chats', '老闆娘', '要刪的')
    await mkdir(artDir, { recursive: true })
    await writeFile(join(artDir, '場景.png'), 'not really a png')

    const before = (await ws.listChats()).map((item) => item.name).sort()
    assert.deepEqual(before, ['要刪的', '要留的'], '兩份都在')

    const removed = await ws.deleteChat('老闆娘', '要刪的')
    assert.equal(removed.chat, '要刪的')
    assert.deepEqual(removed.unbound, [SID], '要順手解掉綁在這份對話上的 session')

    const after = (await ws.listChats()).map((item) => item.name)
    assert.deepEqual(after, ['要留的'], '只刪掉指定的那一份')

    // 對照表是「關於這份對話」的中繼資料 → 一起清掉（不然之後同名對話會繼承舊綁定）
    assert.equal(await ws.readSession(SID), null, '對話沒了，綁定也不該留著')

    // 但**不做連帶清理**：插圖留著（跟刪角色／刪世界書同一個規矩）
    assert.equal(
      existsSync(join(artDir, '場景.png')),
      true,
      '刪對話不刪插圖——這是「刪除只刪那個東西本身」的既有規矩',
    )

    // 刪不存在的 → 明確報錯（不然「刪掉了」跟「本來就沒有」在畫面上長得一樣）
    await assert.rejects(() => ws.deleteChat('老闆娘', '不存在'), /找不到這份對話/, '不存在的對話要明確報錯')
    await assert.rejects(() => ws.deleteChat('老闆娘', ''), /對話名稱/, '空名稱要拒絕')
    await assert.rejects(() => ws.deleteChat('../escape', 'x'), /角色 id/, '路徑跳脫要擋下')

    console.log('14. 刪除對話 OK — 只刪那一份、解掉綁定、不連帶刪插圖、不存在時明確報錯')
  }

  /* --------------------- 15. 對話訊息的追加與讀取 ------------------------- */

  {
    const ws = new TavernWorkspace(join(root, 'messages-shop'))
    await ws.ensure()
    await ws.createChat('老闆娘', '夜晚')
    const file = join(root, 'messages-shop', 'chats', '老闆娘', '夜晚.jsonl')

    assert.deepEqual(await ws.readChatMessages('老闆娘', '夜晚'), [], '剛開好的對話沒有訊息')

    const written = await ws.appendChatMessages('老闆娘', '夜晚', [
      { name: '阿明', isUser: true, text: '今天有什麼酒？' },
      { name: '老闆娘', isUser: false, text: '自己看板子。' },
    ])
    assert.equal(written, 2, '兩則都要寫進去')

    const messages = await ws.readChatMessages('老闆娘', '夜晚')
    assert.equal(messages.length, 2)
    assert.equal(messages[0].text, '今天有什麼酒？')
    assert.equal(messages[0].isUser, true)
    assert.equal(messages[0].name, '阿明')
    assert.equal(messages[1].isUser, false)
    assert.equal(messages[1].name, '老闆娘')
    assert.equal(typeof messages[0].sendDate, 'string', '要有時間戳')

    // ⚠️ 追加，不是改寫：既有的訊息一則都不能少
    await ws.appendChatMessages('老闆娘', '夜晚', [{ name: '阿明', isUser: true, text: '再一杯。' }])
    assert.equal((await ws.readChatMessages('老闆娘', '夜晚')).length, 3, '追加不能蓋掉前面的')

    // 標頭行要還在，而且沒有被當成訊息
    const raw = await readFile(file, 'utf8')
    const lines = raw.split('\n').filter((line) => line !== '')
    assert.equal(lines.length, 4, '一行標頭 ＋ 三則訊息')
    assert.equal(JSON.parse(lines[0]).character_name, 'unused', '標頭還是標頭')
    assert.equal(JSON.parse(lines[1]).mes, '今天有什麼酒？')

    // 空訊息、壞輸入 → 不寫，也不要丟錯
    assert.equal(await ws.appendChatMessages('老闆娘', '夜晚', [{ name: 'x', text: '' }]), 0, '空字串不寫')
    assert.equal(await ws.appendChatMessages('老闆娘', '夜晚', []), 0, '空陣列不寫')
    assert.equal(await ws.appendChatMessages('老闆娘', '夜晚', null), 0, '不是陣列也不丟錯')
    assert.equal((await ws.readChatMessages('老闆娘', '夜晚')).length, 3, '上面三次都沒寫進東西')

    // 對話不存在 → 明確報錯（不准憑空生一份沒有標頭的檔案）
    await assert.rejects(
      () => ws.appendChatMessages('老闆娘', '不存在', [{ name: 'x', text: 'y' }]),
      /找不到這份對話/,
      '對不存在的對話追加要報錯',
    )

    // 壞掉的一行 → 跳過那一行，其他照讀（不要讓一行壞資料毀掉整份對話）
    await writeFile(file, raw + '{ 這不是 JSON\n' + JSON.stringify({ name: 'x', is_user: true, mes: '好的' }) + '\n')
    const survived = await ws.readChatMessages('老闆娘', '夜晚')
    assert.equal(survived.length, 4, '壞行跳過，好的那則還是要讀到')
    assert.equal(survived[3].text, '好的')

    console.log('15. 對話訊息 OK — 追加不覆蓋、空輸入不寫、壞行跳過、不存在時報錯')
  }

  /* ------------------------------- 16. 對話改名 ------------------------------- */

  {
    // 一份對話的**身分**是「哪個角色的哪一份對話」，四處都記著同一個名字：
    // 檔名、`.sessions` 對照表、插圖資料夾、`tavern.json` 的主圖 key。
    // 所以改名一定要四處一起搬，否則會留下半套狀態（插圖變孤兒、綁定指向空氣）。
    const ws = new TavernWorkspace(join(root, 'rename-shop'))
    await ws.createChat('老闆娘', '夜晚')
    await ws.appendChatMessages('老闆娘', '夜晚', [
      { name: '你', isUser: true, text: '今天有什麼酒？' },
      { name: '老闆娘', isUser: false, text: '有剛到的麥酒。' },
    ])
    const session = await ws.bindSession('session-rename-0001', { character: '老闆娘', chat: '夜晚' })

    // 插圖資料夾（用正規化過的 assetId）＋ 主圖設定（用原始對話名當 key）
    const artDir = join(root, 'rename-shop', 'art', 'chats', '老闆娘', '夜晚')
    await mkdir(artDir, { recursive: true })
    await writeFile(join(artDir, '微笑.png'), 'x')
    await ws.writeSettings({ assets: { 'chat:老闆娘/夜晚': '微笑.png' } })

    const renamed = await ws.renameChat('老闆娘', '夜晚', '初次見面')
    assert.equal(renamed.name, '初次見面', '回傳新的名字')
    assert.equal(renamed.previous, '夜晚')
    assert.equal(renamed.file, '初次見面.jsonl')

    // 1. 內容原樣搬到新檔名，舊檔消失
    const moved = await readFile(join(root, 'rename-shop', 'chats', '老闆娘', '初次見面.jsonl'), 'utf8')
    assert.equal(moved.split('\n').length, 4, '一行標頭 ＋ 兩則訊息，原樣搬過去')
    assert.equal(JSON.parse(moved.split('\n')[2]).mes, '有剛到的麥酒。')
    assert.equal(
      await stat(join(root, 'rename-shop', 'chats', '老闆娘', '夜晚.jsonl')).then(() => true, () => false),
      false,
      '舊檔要真的不見',
    )

    // 2. 對照表跟著搬（不然那份對話會失去它的 session）
    assert.deepEqual(renamed.sessionIds, [session.sessionId], '要回報跟著搬的綁定')
    // ⚠️ `.sessions` 是**一個 session 一個檔**、檔名就是 session id，
    // 所以「跟著搬」是改那個檔裡記的對話名，不是換一個檔名。
    assert.equal((await ws.readSession(session.sessionId)).chat, '初次見面', '綁定要指向新的對話名')

    // 3. 插圖資料夾與主圖 key 一起搬
    assert.equal(
      await stat(join(root, 'rename-shop', 'art', 'chats', '老闆娘', '初次見面', '微笑.png')).then(() => true, () => false),
      true,
      '插圖資料夾要跟著改名',
    )
    const settings = await ws.readSettings()
    assert.equal(settings.assets['chat:老闆娘/初次見面'], '微笑.png', '主圖 key 要跟著改')
    assert.equal(settings.assets['chat:老闆娘/夜晚'], undefined, '舊的 key 要清掉')

    // 4. 改回去也成立（再搬一次）
    const back = await ws.renameChat('老闆娘', '初次見面', '夜晚')
    assert.equal(back.name, '夜晚', '沒有撞名時就用送進來的名字')

    // 5. 撞名**不覆蓋**：先開一份叫「初次見面」的，再把「夜晚」改成同一個名字。
    //    回傳的 `name` 才是真的名字——呼叫端一定要用它（用自己送進來的會指向錯的檔案）。
    await ws.createChat('老闆娘', '初次見面')
    const collided = await ws.renameChat('老闆娘', '夜晚', '初次見面')
    assert.notEqual(collided.name, '初次見面', '撞名時要換一個名字')
    assert.equal(collided.name, '初次見面-2', '撞名的編號規則跟開新對話一致')
    const kept = await readFile(join(root, 'rename-shop', 'chats', '老闆娘', '初次見面.jsonl'), 'utf8')
    assert.equal(kept.split('\n').length, 2, '被撞到的那一份不可以被蓋掉（還是「只有標頭」的新檔）')

    // 6. 錯誤路徑：不存在的對話、空名字、名字沒變（沒變要當成功，呼叫端常常是「按了 Enter 但沒改」）
    await assert.rejects(() => ws.renameChat('老闆娘', '不存在', '隨便'), /找不到這份對話/, '不存在的對話要報錯')
    await assert.rejects(() => ws.renameChat('老闆娘', '初次見面-2', '  '), /新的對話名稱不可為空/, '空名字要報錯')
    const same = await ws.renameChat('老闆娘', '初次見面-2', '初次見面-2')
    assert.equal(same.name, '初次見面-2', '名字沒變時當成功，不動任何檔案')

    console.log('16. 對話改名 OK — 檔案／綁定／插圖資料夾／主圖 key 一起搬，撞名不覆蓋')
  }

  /* --------------------------- 17. 思考（reasoning）無損往返 --------------------------- */

  {
    // 思考放在訊息的 `extra.reasoning`——那是 SillyTavern 本來就有的自由欄位，
    // 所以帶著走的 `.jsonl` 裡思考不會丟，別的軟體也讀得懂那一則訊息。
    const ws = new TavernWorkspace(join(root, 'think-shop'))
    await ws.createChat('老闆娘', '想一下')
    await ws.appendChatMessages('老闆娘', '想一下', [
      { name: '你', isUser: true, text: '今天有什麼酒？' },
      { name: '老闆娘', isUser: false, text: '有麥酒。', reasoning: '他問的是酒。\n先看庫存。' },
    ])
    const read = await ws.readChatMessages('老闆娘', '想一下')
    assert.equal(read.length, 2, '兩則')
    assert.equal(read[0].reasoning, '', '使用者那一則沒有思考，要回空字串（呼叫端不必再判 null）')
    assert.equal(read[1].reasoning, '他問的是酒。\n先看庫存。', '思考要原樣讀回來（含換行）')
    assert.equal(read[1].text, '有麥酒。', '思考不可以混進正文')

    // 檔案形狀：`extra.reasoning`，而且**沒有思考的訊息不該長出空的 extra**
    const raw = await readFile(join(root, 'think-shop', 'chats', '老闆娘', '想一下.jsonl'), 'utf8')
    const lines = raw.trim().split('\n')
    assert.equal(JSON.parse(lines[2]).extra.reasoning, '他問的是酒。\n先看庫存。', '寫成 extra.reasoning')
    assert.equal(JSON.parse(lines[1]).extra, undefined, '沒有思考的訊息不該有空的 extra')

    // 壞行與缺欄位照舊要能讀（既有行為不能被這一條弄壞）
    await writeFile(
      join(root, 'think-shop', 'chats', '老闆娘', '想一下.jsonl'),
      raw + JSON.stringify({ name: 'x', is_user: false, mes: '沒有 extra' }) + '\n{ 壞行\n',
    )
    const survived = await ws.readChatMessages('老闆娘', '想一下')
    assert.equal(survived.length, 3, '壞行跳過，缺 extra 的那一則照讀')
    assert.equal(survived[2].reasoning, '', '缺 extra 時 reasoning 是空字串')

    console.log('17. 思考往返 OK — extra.reasoning 原樣往返，不混進正文、不留空的 extra')
  }

  console.log('\n全部通過 ✅')
} finally {
  await rm(root, { recursive: true, force: true })
}
