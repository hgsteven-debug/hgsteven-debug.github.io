// All player-facing copy lives here.
// Locales reserved for later: en, fr, ja, ko. Missing keys fall back to zh-Hant.

export const LOCALES = ["zh-Hant", "en", "fr", "ja", "ko"];
export const DEFAULT_LOCALE = "zh-Hant";

export const STRINGS = {
  "zh-Hant": {
    "app.title": "車內收納大挑戰",
    "app.brand": "JOWUA",
    "app.tagline": "把雜物放回該在的格子",
    "btn.start": "開始",
    "btn.play": "開始第 1 關",
    "btn.rotate": "旋轉",
    "btn.share": "分享成績",
    "btn.next": "下一關",
    "btn.retry": "再試一次",
    "btn.again": "再玩一次",
    "btn.soundOn": "聲音開",
    "btn.soundOff": "聲音關",
    "howto.title": "怎麼玩",
    "howto.1": "物品會一個一個出現在待收納列。",
    "howto.2": "按住物品，拖到置物格裡，對齊格子後放開。",
    "howto.3": "點一下選中的物品，或按「旋轉」，可以轉 90 度。",
    "howto.4": "重疊或超出格子，都不能放下。",
    "howto.5": "待收納列滿了，或時間到，這局就結束。",
    "howto.6": "放進去有分數。靠著邊緣、塞滿整格，以及剩下的時間，都會加分。",
    "hud.level": "第 {n} 關",
    "hud.score": "分數 {score}",
    "hud.progress": "已收納 {done}/{total}",
    "hud.next": "下一個 {sec} 秒",
    "hud.spawned": "物品都出現了",
    "tray.title": "待收納",
    "tray.empty": "下一個物品即將出現",
    "tray.full": "再塞進來就結束了",
    "zone.console": "中控台置物盤",
    "zone.armrest": "扶手箱",
    "zone.doorL": "左車門置物袋",
    "zone.doorR": "右車門置物袋",
    "zone.seatL": "左椅背收納袋",
    "zone.seatR": "右椅背收納袋",
    "item.phone": "手機",
    "item.bottle": "水壺",
    "item.cable": "充電線",
    "item.sunglasses": "太陽眼鏡",
    "item.coins": "零錢",
    "item.tissues": "紙巾",
    "item.umbrella": "雨傘",
    "item.keys": "鑰匙",
    "item.snack": "零食",
    "item.notebook": "筆記本",
    "item.earbuds": "耳機盒",
    "item.mask": "口罩",
    "item.card": "停車證",
    "item.power": "行動電源",
    "item.wipes": "濕紙巾",
    "item.juice": "果汁",
    "clear.title": "第 {n} 關完成",
    "clear.win": "全部收好了",
    "clear.levelScore": "本關 {score} 分",
    "clear.total": "總分 {score}",
    "clear.place": "放入物品 {n}",
    "clear.tidy": "整齊加分 {n}",
    "clear.full": "滿格加分 {n}",
    "clear.time": "時間加分 {n}",
    "over.tray": "待收納列滿出來了",
    "over.time": "時間到了",
    "over.score": "這次分數 {score}",
    "promo.label": "示範用、非正式優惠",
    "promo.code": "JOWUA-DEMO",
    "share.title": "車內收納大挑戰",
    "share.body": "我在「車內收納大挑戰」得到 {score} 分。示範碼 JOWUA-DEMO（示範用、非正式優惠）",
    "share.copied": "成績已複製",
    "share.manual": "請選取下面的文字再複製",
    "toast.invalid": "這裡放不下",
    "toast.gain": "+{n}",
  },
  en: {},
  fr: {},
  ja: {},
  ko: {},
};

export function createI18n(locale = DEFAULT_LOCALE) {
  const lang = STRINGS[locale] ? locale : DEFAULT_LOCALE;
  return {
    locale: lang,
    t(key, vars) {
      const local = STRINGS[lang]?.[key];
      let text = local != null && local !== "" ? local : STRINGS[DEFAULT_LOCALE][key];
      if (text == null) text = key;
      if (vars) {
        for (const [name, value] of Object.entries(vars)) {
          text = text.split(`{${name}}`).join(String(value));
        }
      }
      return text;
    },
  };
}
