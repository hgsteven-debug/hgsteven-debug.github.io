// 五種語言的字串必須齊，而且語言選擇的優先順序要固定。
import { DICTS, LOCALES, pickLocale, canonicalLocale, t, setLocale, getLocale } from '../js/i18n.js';
import * as sync from '../js/sync.js';

const fails = [];
const ok = (name) => console.log('PASS', name);
const bad = (name, err) => { console.error('FAIL', name, err && err.stack ? err.stack : err); fails.push(name); };

function assert(cond, msg) {
  if (!cond) throw new Error(msg || 'assertion failed');
}

try {
  const base = Object.keys(DICTS['zh-TW']);
  assert(base.length > 100, 'too few keys ' + base.length);
  for (const loc of LOCALES) {
    const keys = Object.keys(DICTS[loc]);
    assert(keys.length === base.length, loc + ' count ' + keys.length + ' vs ' + base.length);
    for (const key of base) {
      const value = DICTS[loc][key];
      assert(typeof value === 'string' && value.trim() !== '', loc + ' missing ' + key);
      assert(keys.includes(key), loc + ' extra check ' + key);
    }
    for (const key of keys) assert(base.includes(key), loc + ' extra ' + key);
  }
  assert(DICTS['zh-TW']['touch.gas'] === '加速', DICTS['zh-TW']['touch.gas']);
  assert(DICTS['zh-TW']['touch.brake'] === '煞車');
  assert(DICTS['zh-TW']['hud.off'] === '離開路面');
  assert(DICTS['zh-TW']['toast.offroad'] === '偏離賽道');
  assert(DICTS.en['touch.gas'] === 'GAS');
  assert(DICTS.fr['touch.brake'].length <= 8, DICTS.fr['touch.brake']);
  ok('every key in five locales');
} catch (e) { bad('every key in five locales', e); }

try {
  assert(canonicalLocale('zh-Hant-TW') === 'zh-TW');
  assert(canonicalLocale('EN') === 'en');
  assert(canonicalLocale('fr-CA') === 'fr');
  assert(canonicalLocale('ja_JP') === 'ja');
  assert(canonicalLocale('ko-KR') === 'ko');
  assert(pickLocale({ saved: 'en', param: 'fr', nav: 'ja' }) === 'en');
  assert(pickLocale({ saved: '', param: 'fr', nav: 'ja' }) === 'fr');
  assert(pickLocale({ saved: 'nope', param: '', nav: 'ko-KR' }) === 'ko');
  assert(pickLocale({ saved: '', param: '', nav: 'de-DE' }) === 'zh-TW');
  assert(pickLocale({}) === 'zh-TW');
  const url = sync.joinUrl('AB2CDE', { hostname: '127.0.0.1', origin: 'http://127.0.0.1:8137', pathname: '/' }, { index: 1, epoch: 0 }, 'ja');
  assert(url.endsWith('&lang=ja'), url);
  assert(url.includes('relay=1'));
  setLocale('en');
  assert(getLocale() === 'en');
  assert(t('menu.start') === 'Start');
  setLocale('zh-TW');
  assert(t('menu.start') === '開始遊戲');
  ok('locale precedence and join link');
} catch (e) { bad('locale precedence and join link', e); }

if (fails.length) {
  console.error('FAILED', fails.join(', '));
  process.exit(1);
}
console.log('ALL PASS');
