/**
 * 酒館街（註冊表）的測試。
 *
 * 驗證：加入時建立資料夾結構、重複路徑不重複加、切換、改名／圖示、
 * 移除只動清單不刪檔案、壞檔容錯、以及**不會自動冒出酒館**。
 *
 * 用法：node test-registry.mjs
 */
import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { TavernRegistry } from './lib/registry.js'

const home = mkdtempSync(join(tmpdir(), 'tavern-home-'))
const shop = mkdtempSync(join(tmpdir(), 'tavern-shop-'))
const other = mkdtempSync(join(tmpdir(), 'tavern-shop-'))

try {
  const registry = new TavernRegistry(home)

  /* --- 1. 一開始是空的 -------------------------------------------------- */
  {
    const listed = await registry.list()
    assert.deepEqual(listed.taverns, [], '全新環境不應該有任何酒館')
    assert.equal(listed.activeId, '')
    const active = await registry.active()
    assert.equal(active, undefined, '沒有選中任何酒館')
    let message = ''
    try {
      await registry.requireActive()
    } catch (error) {
      message = error.message
    }
    assert.ok(message.includes('酒館街'), '錯誤訊息要可行動：' + message)
    console.log('1. 空清單 OK — 不自動建立，錯誤訊息可行動')
  }

  /* --- 2. 加入＝建立結構 ＋ 預設內容 ------------------------------------ */
  let first
  {
    const result = await registry.add(shop)
    assert.equal(result.created, true)
    // 骨架（四個目錄 ＋ tavern.json ＋ README.txt）之後才是預設內容。
    assert.deepEqual(
      result.skeleton.slice().sort(),
      ['characters/老闆娘.json', 'worldbooks/酒館.json'],
      'skeleton 只回報「這次建立了什麼」，所以是預設內容那兩個檔案',
    )
    for (const part of ['characters', 'worldbooks', 'chats', 'art']) {
      assert.equal(existsSync(join(shop, part)), true, `應該建立 ${part}/`)
    }
    assert.equal(existsSync(join(shop, 'tavern.json')), true)
    assert.equal(existsSync(join(shop, 'README.txt')), true, '說明檔也要建立')
    assert.equal(existsSync(join(shop, 'characters', '老闆娘.json')), true, '要附一張老闆娘')
    assert.equal(existsSync(join(shop, 'worldbooks', '酒館.json')), true, '要附一本世界書')
    const listed = await registry.list()
    assert.equal(listed.taverns.length, 1)
    assert.equal(listed.activeId, listed.taverns[0].id, '加入後自動選中')
    assert.equal(listed.taverns[0].exists, true)
    first = result
    console.log('2. 加入酒館 OK — 骨架已建立、自動選中')
  }

  /* --- 3. 重複路徑 ------------------------------------------------------ */
  {
    const again = await registry.add(shop)
    assert.equal(again.created, false, '同一條路徑不重複加入')
    assert.equal(again.tavern.id, first.tavern.id, '直接切換到既有那筆')
    assert.equal((await registry.list()).taverns.length, 1)
    console.log('3. 重複路徑 OK — 不重複加入，直接切換過去')
  }

  /* --- 4. 兩間酒館的內容互不影響 ---------------------------------------- */
  let second
  {
    second = await registry.add(other)
    const summaryFirst = await registry.byId(first.tavern.id)
    const summarySecond = await registry.byId(second.tavern.id)
    // 新建酒館會附一位老闆娘，所以基準不是 0——用「相對」比對才不會被預設內容綁死。
    const beforeFirst = (await summaryFirst.workspace.listCharacters()).length
    const beforeSecond = (await summarySecond.workspace.listCharacters()).length
    assert.equal(beforeFirst, 1, '第一間應該只有預設的老闆娘')
    assert.equal(beforeSecond, 1, '第二間也應該只有預設的老闆娘')

    writeFileSync(join(shop, 'characters', 'a.json'), '{"name":"a"}', 'utf8')
    assert.equal(
      (await summaryFirst.workspace.listCharacters()).length,
      beforeFirst + 1,
      '加一張卡到第一間 → 第一間多一張',
    )
    assert.equal(
      (await summarySecond.workspace.listCharacters()).length,
      beforeSecond,
      '第二間不受影響',
    )
    console.log('4. 內容隔離 OK — 兩間酒館的角色卡互不影響')
  }

  /* --- 5. 每間酒館自己的設定檔 ------------------------------------------ */
  {
    const found = await registry.byId(first.tavern.id)
    await found.workspace.writeSettings({ name: '鯨落', note: '只有這間' })
    const again = await registry.byId(second.tavern.id)
    assert.equal((await again.workspace.readSettings()).note, '', '第二間沒有被寫到')
    assert.equal(JSON.parse(readFileSync(join(shop, 'tavern.json'), 'utf8')).note, '只有這間')
    console.log('5. 每間酒館自己的設定 OK — 存在資料夾裡的 tavern.json')
  }

  /* --- 6. 移除只動清單 -------------------------------------------------- */
  {
    const removed = await registry.remove(first.tavern.id)
    assert.equal(removed.removed, true)
    assert.equal((await registry.list()).taverns.length, 1)
    assert.equal(existsSync(join(shop, 'characters', 'a.json')), true, '檔案要留著')
    assert.equal(existsSync(join(shop, 'tavern.json')), true)
    console.log('6. 移除只動清單 OK — 資料夾與設定檔都保留')
  }

  /* --- 7. 邊界情況 ------------------------------------------------------ */
  {
    const missing = await registry.remove('no-such-id')
    assert.equal(missing.removed, false, '移除不存在的 id 不會炸掉')
    let failed = false
    try {
      await registry.select('no-such-id')
    } catch {
      failed = true
    }
    assert.equal(failed, true, '選不存在的 id 要丟錯')
    assert.equal(await registry.byId('no-such-id'), undefined)
    console.log('7. 邊界情況 OK — 不存在的 id 不會炸掉註冊表')
  }

  /* --- 8. 改名與圖示 ---------------------------------------------------- */
  {
    await registry.rename(second.tavern.id, '鯨落酒館')
    let listed = await registry.list()
    assert.equal(listed.taverns[0].name, '鯨落酒館')
    assert.equal(listed.taverns[0].path, second.tavern.path, '只改顯示名稱，路徑不動')

    assert.equal(listed.taverns[0].icon, '', '預設圖示是空字串（面板用內建燈籠）')
    await registry.update(second.tavern.id, { icon: '🍺' })
    listed = await registry.list()
    assert.equal(listed.taverns[0].icon, '🍺')
    assert.equal(listed.taverns[0].name, '鯨落酒館', '更新圖示不影響名稱')
    await registry.update(second.tavern.id, { icon: '' })
    assert.equal((await registry.list()).taverns[0].icon, '', '空字串＝回到預設')
    console.log('8. 改名與圖示 OK — 只改註冊表，路徑不動')
  }

  /* --- 9. 壞檔容錯 ------------------------------------------------------ */
  {
    const brokenHome = mkdtempSync(join(tmpdir(), 'tavern-broken-'))
    writeFileSync(join(brokenHome, 'taverns.json'), '{ not json at all', 'utf8')
    const broken = new TavernRegistry(brokenHome)
    assert.deepEqual((await broken.list()).taverns, [], '壞掉的註冊表退化成空清單')
    rmSync(brokenHome, { recursive: true, force: true })
    console.log('9. 壞檔容錯 OK — 註冊表壞掉時退化成空清單')
  }

  /* --- 10. 註冊表檔案 --------------------------------------------------- */
  {
    const raw = JSON.parse(readFileSync(join(home, 'taverns.json'), 'utf8'))
    assert.equal(raw.version, 1, '要帶版本號，方便之後遷移')
    assert.equal(raw.taverns.length, 1)
    assert.equal(raw.taverns[0].path, other, '應存絕對路徑')
    console.log('10. 註冊表格式 OK — version =', raw.version, '/ 清單', raw.taverns.length, '筆')
  }

  console.log('\n全部通過 ✅')
} finally {
  rmSync(home, { recursive: true, force: true })
  rmSync(shop, { recursive: true, force: true })
  rmSync(other, { recursive: true, force: true })
}
