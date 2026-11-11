/**
 * 店面（`<酒館>/shop.json`）。
 *
 * 這一層只管「街上看到的那張臉」：招牌字、一句話、招牌樣式、店面樣式、
 * 遮陽棚、燈籠。**顏色不在這裡**——顏色跟 `theme.json`（室內裝修）走，
 * 所以換房間的色盤，店面會跟著換；街道本身仍然是 DSH 原生色。
 *
 * 刻意保持純資料／純函式（零依賴、可單獨測）：宿主讀寫、client 只負責畫。
 */

/** 檔名。 */
export const SHOP_FILE = 'shop.json'

/** 版本。 */
export const SHOP_VERSION = 1

/** 招牌樣式：吊牌／門楣／直幡。 */
export const SHOP_SIGN_STYLES = ['hanging', 'plaque', 'banner', 'projecting', 'marquee']

/** 店面樣式：經典（門＋兩窗）／暖簾／開放櫃檯。 */
export const SHOP_FACADES = ['classic', 'noren', 'counter']

/** 遮陽棚：條紋／素面／不要。 */
export const SHOP_AWNINGS = ['stripes', 'solid', 'none']

/** 燈籠：暖光／冷光／不要。 */
export const SHOP_LANTERNS = ['warm', 'cool', 'none']

/** 框架：規矩（卡內）／越界（招牌可以伸出卡外）。 */
export const SHOP_FRAMES = ['normal', 'break']

/** 卡片邊框形狀。 */
export const SHOP_FRAME_SHAPES = ['rounded', 'sharp', 'arch', 'soft']

/** 屋簷：不要／伸出的屋簷。 */
export const SHOP_ROOFS = ['none', 'eaves']

/** 門口植物：不要／一盆／一叢。 */
export const SHOP_PLANTS = ['none', 'pot', 'bush']

/** 窗：十字窗格／素面／不要。 */
export const SHOP_WINDOWS = ['cross', 'plain', 'none']

/** 門：拱門／方門。 */
export const SHOP_DOORS = ['arch', 'square']

const SIGN_MAX = 24
const TAGLINE_MAX = 40

const oneOf = (value, allowed, fallback) =>
  typeof value === 'string' && allowed.indexOf(value) >= 0 ? value : fallback

/**
 * 去掉控制字元、壓掉多餘空白、按字元（不是 code unit）截長。
 * 招牌是使用者自己寫的，但會進 DOM；長度與控制字元要在宿主先收斂。
 */
function cleanText(value, max) {
  if (typeof value !== 'string') return ''
  const text = value
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  return Array.from(text).slice(0, max).join('')
}

/** 預設店面：沒有 `shop.json` 時的樣子。 */
export function defaultShop() {
  return {
    version: SHOP_VERSION,
    sign: '',
    tagline: '',
    signStyle: 'hanging',
    facade: 'classic',
    awning: 'stripes',
    lantern: 'warm',
    frame: 'normal',
    frameShape: 'rounded',
    roof: 'none',
    plant: 'none',
    windows: 'cross',
    door: 'arch',
  }
}

/**
 * 把一份（可能不完整／壞掉的）店面正規化成固定形狀。
 * 不認得的欄位直接丟掉——`shop.write` 是整份寫入，不能讓壞 key 留在檔案裡。
 */
export function normalizeShop(patch) {
  const source = patch !== null && typeof patch === 'object' && !Array.isArray(patch) ? patch : {}
  return {
    version: SHOP_VERSION,
    sign: cleanText(source.sign, SIGN_MAX),
    tagline: cleanText(source.tagline, TAGLINE_MAX),
    signStyle: oneOf(source.signStyle, SHOP_SIGN_STYLES, 'hanging'),
    facade: oneOf(source.facade, SHOP_FACADES, 'classic'),
    awning: oneOf(source.awning, SHOP_AWNINGS, 'stripes'),
    lantern: oneOf(source.lantern, SHOP_LANTERNS, 'warm'),
    frame: oneOf(source.frame, SHOP_FRAMES, 'normal'),
    frameShape: oneOf(source.frameShape, SHOP_FRAME_SHAPES, 'rounded'),
    roof: oneOf(source.roof, SHOP_ROOFS, 'none'),
    plant: oneOf(source.plant, SHOP_PLANTS, 'none'),
    windows: oneOf(source.windows, SHOP_WINDOWS, 'cross'),
    door: oneOf(source.door, SHOP_DOORS, 'arch'),
  }
}

export default {
  SHOP_FILE,
  SHOP_VERSION,
  defaultShop,
  normalizeShop,
  SHOP_SIGN_STYLES,
  SHOP_FACADES,
  SHOP_AWNINGS,
  SHOP_LANTERNS,
  SHOP_FRAMES,
  SHOP_FRAME_SHAPES,
  SHOP_ROOFS,
  SHOP_PLANTS,
  SHOP_WINDOWS,
  SHOP_DOORS,
}
