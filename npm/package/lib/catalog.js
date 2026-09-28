// パッケージの一覧。npm レジストリ（@lapius スコープ）から取り、キャッシュする。
// 下の CATALOG は並び順・カテゴリ・前提条件の補足と、オフライン時の予備。
// ここに無いパッケージも、@lapius で公開されていればレジストリから自動で拾う。
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

const SCOPE = '@lapius';
const SELF = 'lapacks';
const REGISTRY = process.env.LAPACKS_REGISTRY || 'https://registry.npmjs.org';
const TTL = 10 * 60 * 1000;

// needs: 動作に必要なもの（REQS のキー）。末尾が ? なら一部の機能だけで使う
const CATALOG = [
  { name: 'why', cat: 'シェル', short: '失敗したコマンドの原因と対処法を日本語で表示', bin: ['why'] },
  { name: 'password-gl', cat: 'シェル', short: 'パスワード / パスフレーズを1コマンドで生成', bin: ['password-gl', 'pgl'], needs: ['python'] },
  { name: 'laping-lang', cat: '言語', short: 'プログラミング言語 Laping のインタプリタ', bin: ['laping'] },
  { name: 'tssetup', cat: '開発', short: 'Bun + TypeScript のフロントエンド環境を構築', bin: ['tssetup'], needs: ['python', 'bun'] },
  { name: 'tsbuild', cat: '開発', short: 'Bun + TypeScript 開発サーバーをホットリロード付きで起動', bin: ['tsbuild'], needs: ['python', 'bun'] },
  { name: 'go-uuid', cat: '開発', short: 'UUID を返すシンプルな HTTP サーバー', bin: ['go-uuid'] },
  { name: 'clilap', cat: 'Web', short: 'clilap.org（天気・DNS・ハッシュなど）のクライアント', bin: ['clilap'] },
  { name: 'clilap-codepush', cat: 'Web', short: 'codepush.clilap.org にファイルを置いて共有（TUI）', bin: ['codepush'], needs: ['python'] },
  { name: 'sca-cli', cat: 'Web', short: 'chatapp.lapius7.com のチャットをターミナルで', bin: ['sca'], needs: ['python?'] },
  { name: 'bin-cli', cat: 'Web', short: 'bin.lapius7.com（LapBin）のクライアント', bin: ['bin'] },
  { name: 'ohatwikeeper-cli', cat: 'Web', short: 'おはツイKeeper 公式 CLI', bin: ['ohax'] },
  { name: 'cli-othello', cat: 'ゲーム', short: 'ターミナルで遊ぶオセロ（5 段階の AI）', bin: ['othello'], needs: ['python'] },
];

const CATS = ['シェル', '言語', '開発', 'Web', 'ゲーム', 'その他'];

// 公開はしているが作者専用のもの（dela-cli は登録済みの鍵でしか接続できない）。一覧には出さない
const HIDDEN = new Set(['dela-cli']);

// OS/CPU 別のバイナリパッケージ（本体の optionalDependencies）は一覧に出さない
const PLATFORM = /-(linux|darwin|win32|freebsd)-(x64|arm64|ia32|arm)$/;

function cacheFile() {
  const base =
    process.platform === 'win32'
      ? process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local')
      : process.env.XDG_CACHE_HOME || path.join(os.homedir(), '.cache');
  return path.join(base, 'lapacks', 'index.json');
}

function readCache() {
  try {
    return JSON.parse(fs.readFileSync(cacheFile(), 'utf8'));
  } catch {
    return null;
  }
}

function writeCache(idx) {
  try {
    fs.mkdirSync(path.dirname(cacheFile()), { recursive: true });
    fs.writeFileSync(cacheFile(), JSON.stringify(idx));
  } catch {
    // キャッシュが書けなくても動作には困らない
  }
}

async function getJSON(url) {
  const res = await fetch(url, {
    headers: { accept: 'application/json', 'user-agent': 'lapacks' },
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  return res.json();
}

const enc = (name) => `${SCOPE}%2f${name}`;

// レジストリの検索は反映が遅れることがあるので、CATALOG の名前と合わせて使う
async function discover() {
  const names = new Set(CATALOG.map((p) => p.name));
  try {
    const r = await getJSON(`${REGISTRY}/-/v1/search?text=${encodeURIComponent('maintainer:lapius')}&size=250`);
    for (const o of r.objects || []) {
      const n = o.package.name;
      if (n.startsWith(SCOPE + '/') && !PLATFORM.test(n)) names.add(n.slice(SCOPE.length + 1));
    }
  } catch {
    // 検索に失敗しても、CATALOG の分は個別に取れる
  }
  names.delete(SELF);
  for (const n of HIDDEN) names.delete(n);
  return [...names];
}

function fromManifest(m) {
  return {
    version: m.version,
    description: m.description || '',
    bin: m.bin ? Object.keys(typeof m.bin === 'string' ? { [m.name.split('/')[1]]: 1 } : m.bin) : [],
    homepage: m.homepage || '',
    deprecated: m.deprecated || '',
  };
}

async function fetchIndex() {
  const names = await discover();
  const got = await Promise.allSettled([SELF, ...names].map((n) => getJSON(`${REGISTRY}/${enc(n)}/latest`)));
  if (got.every((g) => g.status === 'rejected')) throw new Error('npm レジストリに接続できません');
  const remote = {};
  [SELF, ...names].forEach((n, i) => {
    if (got[i].status === 'fulfilled') remote[n] = fromManifest(got[i].value);
  });
  const idx = { fetchedAt: Date.now(), remote };
  writeCache(idx);
  return idx;
}

// { packages, self, fetchedAt, offline, error }
async function load({ refresh = false } = {}) {
  let idx = readCache();
  let error = '';
  if (refresh || !idx || Date.now() - idx.fetchedAt > TTL) {
    try {
      idx = await fetchIndex();
    } catch (e) {
      error = e.message;
    }
  }
  const remote = (idx && idx.remote) || {};
  const known = new Map(CATALOG.map((p, i) => [p.name, { ...p, order: i }]));
  const names = new Set([...known.keys(), ...Object.keys(remote).filter((n) => n !== SELF && !HIDDEN.has(n))]);
  const packages = [...names].map((name) => {
    const base = known.get(name) || { name, cat: 'その他', order: 1e6 };
    const r = remote[name] || {};
    return {
      name,
      full: `${SCOPE}/${name}`,
      cat: base.cat,
      order: base.order,
      short: base.short || shorten(r.description) || '',
      description: r.description || base.short || '',
      // レジストリの bin を正とし、並びは CATALOG に合わせる
      bin: orderBins(r.bin && r.bin.length ? r.bin : base.bin || [name], base.bin || []),
      needs: base.needs || [],
      homepage: r.homepage || `https://github.com/Lapius7/${name}`,
      latest: r.version || '',
      deprecated: r.deprecated || '',
    };
  });
  packages.sort((a, b) => CATS.indexOf(a.cat) - CATS.indexOf(b.cat) || a.order - b.order || a.name.localeCompare(b.name));
  return {
    packages,
    self: remote[SELF] ? remote[SELF].version : '',
    fetchedAt: idx ? idx.fetchedAt : 0,
    offline: !!error,
    error,
  };
}

function orderBins(bins, pref) {
  return [...pref.filter((b) => bins.includes(b)), ...bins.filter((b) => !pref.includes(b))];
}

// 説明文の末尾の「（要 Python 3.9+）」などを落として短くする
function shorten(d) {
  return String(d || '').replace(/[（(][^）)]*[）)]\s*$/, '').trim();
}

// 名前・@lapius/名前・コマンド名のどれでも引けるようにする
function resolve(packages, q) {
  q = String(q).replace(/^@lapius\//, '').replace(/@[^@]*$/, '').toLowerCase();
  return (
    packages.find((p) => p.name === q) ||
    packages.find((p) => p.bin.includes(q)) ||
    packages.find((p) => p.name === q + '-cli' || p.name === q + '-lang') ||
    null
  );
}

// 見つからない名前に近い候補（編集距離）
function suggest(packages, q) {
  const d = (a, b) => {
    const m = Array.from({ length: a.length + 1 }, (_, i) => [i]);
    for (let j = 1; j <= b.length; j++) m[0][j] = j;
    for (let i = 1; i <= a.length; i++)
      for (let j = 1; j <= b.length; j++)
        m[i][j] = Math.min(m[i - 1][j] + 1, m[i][j - 1] + 1, m[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    return m[a.length][b.length];
  };
  let best = null;
  let bd = 3;
  for (const p of packages)
    for (const n of [p.name, ...p.bin]) {
      const x = d(q, n);
      if (x < bd) (bd = x), (best = p);
    }
  return best;
}

module.exports = { SCOPE, SELF, CATS, load, resolve, suggest };
