// 端末表示の部品。色・全角文字の表示幅・枠・スピナー。
'use strict';

const out = process.stdout;

let colorOn = !process.env.NO_COLOR && process.env.TERM !== 'dumb' && !!out.isTTY;
function setColor(on) {
  colorOn = on;
}

const sgr = (open, close) => (s) => (colorOn ? `\x1b[${open}m${s}\x1b[${close}m` : String(s));
const c = {
  bold: sgr('1', '22'),
  dim: sgr('2', '22'),
  italic: sgr('3', '23'),
  red: sgr('31', '39'),
  green: sgr('32', '39'),
  yellow: sgr('33', '39'),
  blue: sgr('34', '39'),
  magenta: sgr('35', '39'),
  cyan: sgr('36', '39'),
  gray: sgr('90', '39'),
  accent: sgr('38;5;81', '39'),
  pink: sgr('38;5;212', '39'),
  bgRow: sgr('48;5;237', '49'),
  inverse: sgr('7', '27'),
};

const ANSI = /\x1b\[[0-9;?]*[A-Za-z]/g;
const strip = (s) => String(s).replace(ANSI, '');

// 東アジアの全角文字・絵文字は 2 桁として数える
function charWidth(cp) {
  if (cp < 32 || (cp >= 0x7f && cp < 0xa0)) return 0;
  if ((cp >= 0x300 && cp <= 0x36f) || cp === 0x200d || (cp >= 0xfe00 && cp <= 0xfe0f)) return 0;
  if (
    (cp >= 0x1100 && cp <= 0x115f) ||
    (cp >= 0x2e80 && cp <= 0x303e) ||
    (cp >= 0x3041 && cp <= 0x33ff) ||
    (cp >= 0x3400 && cp <= 0x4dbf) ||
    (cp >= 0x4e00 && cp <= 0x9fff) ||
    (cp >= 0xa000 && cp <= 0xa4cf) ||
    (cp >= 0xac00 && cp <= 0xd7a3) ||
    (cp >= 0xf900 && cp <= 0xfaff) ||
    (cp >= 0xfe30 && cp <= 0xfe4f) ||
    (cp >= 0xff00 && cp <= 0xff60) ||
    (cp >= 0xffe0 && cp <= 0xffe6) ||
    (cp >= 0x1f300 && cp <= 0x1f64f) ||
    (cp >= 0x1f900 && cp <= 0x1f9ff) ||
    (cp >= 0x20000 && cp <= 0x3fffd)
  )
    return 2;
  return 1;
}

function width(s) {
  let w = 0;
  for (const ch of strip(s)) w += charWidth(ch.codePointAt(0));
  return w;
}

// 表示幅 n に収める。色付き文字列は途中で切ると色が崩れるので、色を付ける前の文字列に使う
function truncate(s, n) {
  s = String(s);
  if (width(s) <= n) return s;
  if (n <= 0) return '';
  let w = 0;
  let r = '';
  for (const ch of s) {
    const cw = charWidth(ch.codePointAt(0));
    if (w + cw > n - 1) break;
    r += ch;
    w += cw;
  }
  return r + '…';
}

// 表示幅 n ごとに折り返す（色を付ける前の文字列に使う）
function wrap(s, n) {
  const res = [];
  let line = '';
  for (const ch of String(s)) {
    if (width(line + ch) > n) {
      res.push(line);
      line = '';
    }
    line += ch;
  }
  if (line || !res.length) res.push(line);
  return res;
}

const pad = (s, n) => s + ' '.repeat(Math.max(0, n - width(s)));
const padStart = (s, n) => ' '.repeat(Math.max(0, n - width(s))) + s;

const columns = () => Math.max(40, out.columns || Number(process.env.COLUMNS) || 80);

// 角の丸い枠。lines は色付きでもよい
function box(title, lines, { w, color = c.gray } = {}) {
  w = w || Math.min(columns() - 2, Math.max(width(title) + 6, ...lines.map((l) => width(l) + 4)));
  const inner = w - 4;
  const res = [
    title
      ? color('╭─ ') + c.bold(title) + ' ' + color('─'.repeat(Math.max(0, w - 5 - width(title))) + '╮')
      : color('╭' + '─'.repeat(w - 2) + '╮'),
  ];
  for (const l of lines) {
    const t = width(l) > inner ? truncate(strip(l), inner) : l;
    res.push(color('│') + ' ' + pad(t, inner) + ' ' + color('│'));
  }
  res.push(color('╰' + '─'.repeat(w - 2) + '╯'));
  return res;
}

const FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];

// 標準エラーにスピナーを出す（端末でなければ何もしない）
function spinner(text) {
  const tty = process.stderr.isTTY;
  let i = 0;
  let timer = null;
  const draw = () => process.stderr.write(`\r\x1b[2K ${c.accent(FRAMES[i++ % FRAMES.length])} ${text}`);
  if (tty) {
    process.stderr.write('\x1b[?25l');
    draw();
    timer = setInterval(draw, 80);
  }
  return {
    set(t) {
      text = t;
    },
    stop() {
      if (!tty) return;
      clearInterval(timer);
      process.stderr.write('\r\x1b[2K\x1b[?25h');
    },
  };
}

// 版番号の比較（a が新しければ正）
function cmpVer(a, b) {
  const pa = String(a).split(/[.-]/).map((x) => parseInt(x, 10) || 0);
  const pb = String(b).split(/[.-]/).map((x) => parseInt(x, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] || 0) - (pb[i] || 0);
    if (d) return d;
  }
  return 0;
}

function ago(ms) {
  const s = Math.round((Date.now() - ms) / 1000);
  if (s < 60) return 'たった今';
  if (s < 3600) return `${Math.floor(s / 60)} 分前`;
  if (s < 86400) return `${Math.floor(s / 3600)} 時間前`;
  return `${Math.floor(s / 86400)} 日前`;
}

module.exports = { c, setColor, isColor: () => colorOn, strip, width, truncate, wrap, pad, padStart, columns, box, spinner, FRAMES, cmpVer, ago };
