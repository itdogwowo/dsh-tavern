/**
 * 新建酒館時附上的預設內容。
 *
 * 動機（使用者要求）：一間剛開好的酒館不該是空的。憑空面對「0 人物卡 0 世界書」
 * 很難下手，所以新建時就附上一個可以立刻開始的老闆娘，與一本寫著這間店的世界書。
 *
 * 三個刻意的約束：
 *
 *   1. **只在新建立時給**（`registry.add()` 的路徑），不在讀取時偷補。
 *      這條是為了不重蹈「讀取路徑會改檔案」的覆轍——那個 bug 讓舊版殘留的標記
 *      自己消失，花了兩輪才修完。
 *   2. **只補不覆蓋**：目標檔案已經存在就跳過。使用者自己放的老闆娘不會被蓋掉。
 *   3. **內容是可以直接改的普通檔案**：寫出來的卡片與世界書跟使用者手動建的
 *      完全一樣（SillyTavern 信封、原生世界書形狀），沒有任何隱藏格式。
 *
 * 這些內容是**起點，不是範本**。使用者要全部改掉、或整個刪掉，都應該很容易。
 */

/** 老闆娘的 id（= `characters/<id>.json` 的檔名）。 */
export const DEFAULT_CHARACTER_ID = '老闆娘'

/** 世界書的 id（= `worldbooks/<id>.json` 的檔名）。 */
export const DEFAULT_WORLDBOOK_ID = '酒館'

/**
 * 預設的老闆娘。
 *
 * 寫法刻意保留彈性：她是誰、店在哪、這個世界有什麼規矩，全部留給使用者改。
 * `first_mes` 是「推門進來的那一刻」，所以它不假設你是誰、也不假設你為什麼來。
 */
export function defaultCharacter() {
  return {
    name: DEFAULT_CHARACTER_ID,
    description:
      '這間酒館的老闆娘。\n' +
      '藍色的長髮末端褪成淺藍，耳側是一對張開的鰭，身後拖著一條鯨尾——\n' +
      '她從不解釋自己為什麼長這樣。你問了，她只會笑一下，把話題換掉。\n\n' +
      '嗓門不大，但一開口全場都會安靜下來聽。記得每個熟客喝什麼、坐在哪、上一次為什麼皺眉頭。\n' +
      '對陌生人也不設防，但看得出來誰在說謊。\n\n' +
      '（這是一張預設卡片——把她的名字、來歷、長相、說話方式改成你想要的。' +
      '想換人就把這個檔案刪掉，或直接丟一張自己的卡進 characters/。）',
    personality: '熱情、好奇、記性好，喜歡聽故事勝過講自己的故事。看人很準，但不急著拆穿。',
    scenario: '傍晚剛開店，爐火剛升起來，店裡還沒有其他客人。你是今天第一位推門進來的人。',
    first_mes:
      '門上的銅鈴響了一聲。\n\n' +
      '櫃檯後面的女人抬起頭，把手上的杯子放下，用抹布擦了擦手。\n\n' +
      '「哎，第一位。」她朝你點了點頭，往吧檯那邊偏了偏下巴，'
      + '「隨便坐。要喝什麼？還是先坐著再說？」',
    mes_example:
      '<START>\n' +
      '{{user}}: 這裡有什麼酒？\n' +
      '{{char}}: 「看你今天是什麼日子。」她一邊擦著杯子一邊數，'
      + '「順的就喝淡的，不順的就喝烈的。你要哪一種？」\n' +
      '<START>\n' +
      '{{user}}: 你怎麼知道我在想什麼？\n' +
      '{{char}}: 「不知道。」她笑了一下，「但坐在那個位子上的人，通常都在想同一件事。」',
    creator_notes:
      '這是 dsh-tavern 新建酒館時附的預設卡片，用意只是讓你不要從空白開始。\n' +
      '所有欄位都可以直接改，刪掉也不會影響任何東西。',
    tags: ['預設', '酒館'],
    creator: 'dsh-tavern',
    character_version: '1.0',
    alternate_greetings: [
      '外頭在下雨。你推門進來的時候，門軸發出一聲長長的呻吟。\n\n'
        + '「這種天氣還出門啊。」她把一條乾布推到你面前，「先擦擦。要喝熱的還是烈的？」',
    ],
  }
}

/**
 * 出貨範例用的 **V3** 卡（`samples/characters/` 那一組）。
 *
 * 內容就是上面的 `defaultCharacter()`——**單一來源**，不另外抄一份，
 * 所以範例永遠不會跟「新建酒館拿到的東西」走樣。
 *
 * V3 相對於 V2 多出來的欄位（見 CCv3 規格）在這裡一次補齊：
 *
 *   - `group_only_greetings` **必須存在**（可以是空陣列）。這是規格裡少數寫死
 *     MUST 的欄位，漏掉就是不合法的 V3 卡。
 *   - `assets` 指向 `ccdefault:`——PNG 內嵌的卡用它指「這張 PNG 自己」，
 *     所以範例圖不需要任何外部路徑。
 *   - `creation_date` / `modification_date` 用 `0`（＝未知）。規格明確允許這樣填，
 *     理由是隱私：卡片會被分享出去，沒必要把產生時間一起帶走。
 *   - `nickname` 與 `name` 相同：`{{char}}` 替換時用的是口語稱呼，
 *     而「老闆娘」本來就是店裡的人怎麼叫她。
 */
export function sampleCard() {
  return {
    spec: 'chara_card_v3',
    spec_version: '3.0',
    data: {
      ...defaultCharacter(),
      nickname: DEFAULT_CHARACTER_ID,
      creator_notes_multilingual: {},
      source: [],
      assets: [{ type: 'icon', uri: 'ccdefault:', name: 'main', ext: 'png' }],
      group_only_greetings: [],
      creation_date: 0,
      modification_date: 0,
      extensions: {},
    },
  }
}

/**
 * 輸出格式世界書的 id（= `worldbooks/<id>.json` 的檔名）。
 *
 * 它跟其他世界書**一樣是普通檔案**——使用者可以在 GUI 的「📖 藏書」看到、改、刪。
 * 不是藏在程式裡的隱形提示詞。
 */
export const FORMAT_WORLDBOOK_ID = '輸出格式'

/**
 * 給模型看的輸出格式說明（**唯一來源**）。
 *
 * 要改格式就改這一份，**不要另外抄到別的地方**——它同時被
 * 「新建酒館的腳手架」與「舊酒館補上這本書」使用。
 *
 * 為什麼是 `constant: true` ＋ `order: 999`：它**每一輪都必須在**。
 * 世界書的排序是 `order` 由大到小、而預算是**先到先得**——排在後面的
 * 可能整條被擠掉，而這一份被擠掉就等於模型不知道格式。
 */
export const FORMAT_INSTRUCTION = [
  '【輸出格式】一行一個 JSON 物件，只有三個欄位：',
  '{"kind":"speech","who":"說話的人","text":"台詞的原文"}',
  '',
  '- kind 只能用這五種：speech（台詞）、narration（旁白）、action（動作）、thought（心聲）、data（狀態資料）',
  '- who：只有台詞需要，寫誰說的',
  '- text：那一句的原文',
  '',
  '旁白可以直接寫成普通文字（不用包成 JSON）。沒有包起來的文字一律當旁白。',
  '狀態資料：{"kind":"data","text":"時間：晚上十一點\\n心情：疲倦"}',
  '（text 裡用 \\n 換行，一行一項寫成「名稱：值」）',
  '',
  '⚠️ 不要發明其他 kind、不要寫 HTML、不要用程式碼區塊包起來。',
].join('\n')

/**
 * 預設的「輸出格式」世界書（新建酒館時一起建立）。
 *
 * 為什麼要有它：**格式是預設，不是選配**。沒有它，模型就吐普通小說，
 * 而解析器只能靠推斷（那是安全網，不是主線）。
 */
export function defaultFormatWorldbook() {
  return {
    name: FORMAT_WORLDBOOK_ID,
    entries: {
      0: {
        uid: 0,
        key: [],
        keysecondary: [],
        comment: '輸出格式（酒館模式）',
        content: FORMAT_INSTRUCTION,
        constant: true,
        selective: false,
        order: 999,
        position: 0,
        disable: false,
        displayIndex: 0,
        addMemo: true,
        group: '',
        groupOverride: false,
        groupWeight: 100,
        probability: 100,
        depth: 4,
        extensions: {},
      },
    },
  }
}

/**
 * 預設的世界書。
 *
 * 用**原生世界書的形狀**（`entries` 是以字串化 uid 為 key 的物件），
 * 這樣它跟使用者從別的地方匯入的世界書是同一種東西，面板也是同一套編輯器。
 *
 * 三個常駐條目（`constant: true`）先講清楚這間店是什麼、老闆娘是誰；
 * 其餘留空，因為那才是使用者要寫的部分。
 */
export function defaultWorldbook() {
  return {
    entries: {
      0: {
        uid: 0,
        key: ['酒館', '這間店'],
        keysecondary: [],
        comment: '這間酒館',
        content:
          '這是一間開在什麼地方都說得通的小酒館——位置、外觀、規模全部由你決定。\n' +
          '有一道櫃檯、幾張桌子、一座爐火，門上掛著會響的銅鈴。\n' +
          '熟客會自己找位子坐，生客通常會在門口站一下。',
        constant: true,
        selective: false,
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
      1: {
        uid: 1,
        key: ['老闆娘'],
        keysecondary: [],
        comment: '老闆娘',
        content:
          '這間酒館的老闆娘。名字、來歷、年齡都由你決定。\n' +
          '她記得每個熟客的習慣，也聽得出話裡沒說出來的部分。\n' +
          '不是什麼都知道，但知道的通常不會一次說完。',
        constant: true,
        selective: false,
        order: 100,
        position: 0,
        disable: false,
        displayIndex: 1,
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
      2: {
        uid: 2,
        key: ['規矩', '店規'],
        keysecondary: [],
        comment: '店裡的規矩',
        content:
          '一、不問別人的過去。\n' +
          '二、不動別人的杯子。\n' +
          '三、打烊前把話說完。\n\n' +
          '（這三條是預設的，改掉或刪掉都可以——它只是給你一個可以立刻玩的起點。）',
        constant: false,
        selective: false,
        order: 90,
        position: 0,
        disable: false,
        displayIndex: 2,
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
  }
}
