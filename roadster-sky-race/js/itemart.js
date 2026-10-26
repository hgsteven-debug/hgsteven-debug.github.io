// 六種道具的原創圖示。HUD、手機鍵、彈出說明共用同一張 SVG。
export const ITEM_ROLL_MS = 420;
export const ITEM_POP_MS = 680;
export const ITEM_HIT_MS = 720;

const SVG = {
  1: `<svg viewBox="0 0 64 64" aria-hidden="true"><path fill="#ff2d2d" d="M8 26h28L30 14l26 18-26 18-6-12H8z"/><path fill="#7a0c0c" d="M8 30h18v4H8z"/></svg>`,
  2: `<svg viewBox="0 0 64 64" aria-hidden="true"><circle cx="32" cy="32" r="22" fill="none" stroke="#ffe14a" stroke-width="4"/><circle cx="32" cy="32" r="4" fill="#ffe14a"/><path fill="#f5b400" d="M14 30h10l4-8 4 8h8l4-8 4 8h8v6H14z"/><path fill="#1a1a1a" d="M22 34h6v4h-6zm14 0h6v4h-6z"/><path fill="#ffe14a" d="M30 8h4v8h-4zm0 40h4v8h-4zM8 30h8v4H8zm40 0h8v4h-8z"/></svg>`,
  3: `<svg viewBox="0 0 64 64" aria-hidden="true"><ellipse cx="32" cy="40" rx="24" ry="12" fill="#2a1840"/><ellipse cx="28" cy="38" rx="14" ry="7" fill="#120814"/><ellipse cx="40" cy="34" rx="6" ry="3" fill="#6a3cff" opacity=".85"/></svg>`,
  4: `<svg viewBox="0 0 64 64" aria-hidden="true"><path fill="#3ec2ff" d="M32 6l20 8v16c0 14-8 22-20 28C20 52 12 44 12 30V14z"/><path fill="#e8f7ff" d="M32 16l10 4v8c0 7-4 12-10 15-6-3-10-8-10-15v-8z"/></svg>`,
  5: `<svg viewBox="0 0 64 64" aria-hidden="true"><path fill="#ff7a18" d="M36 4L14 36h16l-4 24 26-36H34z"/><path fill="#ffd25a" d="M34 16l-8 14h8l-2 10 12-16h-8z"/></svg>`,
  6: `<svg viewBox="0 0 64 64" aria-hidden="true"><path fill="none" stroke="#5ce1ff" stroke-width="5" stroke-linecap="round" d="M14 18c10 4 14 4 24 0M10 32c12 6 18 6 32 0M16 46c8 4 12 4 22 0"/><path fill="#5ce1ff" d="M44 12l8 6-10 2zM46 40l10 2-8 8z"/></svg>`,
};

export function itemSvg(id) {
  return SVG[id | 0] || '';
}

export function itemColor(id) {
  return ({
    1: 0xff2d2d,
    2: 0xffd000,
    3: 0x3a2060,
    4: 0x3ec2ff,
    5: 0xff7a18,
    6: 0x5ce1ff,
  })[id | 0] || 0xffffff;
}
