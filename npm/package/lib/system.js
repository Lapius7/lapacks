// パッケージマネージャ（pnpm / npm）のグローバル領域と、PATH・前提ツールの確認。
'use strict';

const fs = require('fs');
const path = require('path');
const { spawn, spawnSync } = require('child_process');
const { SCOPE, CATALOG } = require('./catalog');

const WIN = process.platform === 'win32';
// Windows の npm は npm.cmd なので shell 経由で起動する
const npmOpts = WIN ? { shell: true } : {};

let rootCache = null;
let pmCache = null;

function hasCmd(cmd) {
  return spawnSync(cmd, ['-v'], { encoding: 'utf8', ...npmOpts }).status === 0;
}

// 使うパッケージマネージャ。LAPACKS_PM（npm / pnpm）> lapacks 自身の置き場所 > pnpm があれば pnpm、なければ npm
function pm() {
  if (pmCache) return pmCache;
  const env = process.env.LAPACKS_PM;
  if (env === 'npm' || env === 'pnpm') return (pmCache = env);
  const self = path.resolve(__dirname, '..');
  if (path.basename(path.dirname(self)) === SCOPE) pmCache = /[\\/]\.?pnpm[\\/]/i.test(self) ? 'pnpm' : 'npm';
  else pmCache = hasCmd('pnpm') ? 'pnpm' : 'npm';
  return pmCache;
}

// 入れる・消すときの引数
function cmdArgs(kind, specs) {
  if (pm() === 'pnpm') return [kind === 'remove' ? 'remove' : 'add', '-g', ...specs];
  return [kind === 'remove' ? 'rm' : 'i', '-g', ...specs];
}

// 案内に出す手動コマンド
function cmdText(kind, spec) {
  return `${pm()} ${cmdArgs(kind, [spec]).join(' ')}`;
}

// npm のグローバル node_modules。lapacks 自身が <root>/@lapius/lapacks にあればそこから求める
// （npm を起動しない分速い）。開発中などで当てはまらなければ npm root -g を使う
function globalRoot() {
  if (rootCache) return rootCache;
  const self = path.resolve(__dirname, '..');
  if (path.basename(path.dirname(self)) === SCOPE && !process.env.LAPACKS_NPM_ROOT) {
    rootCache = path.dirname(path.dirname(self));
  } else {
    const r = spawnSync('npm', ['root', '-g'], { encoding: 'utf8', ...npmOpts });
    rootCache = process.env.LAPACKS_NPM_ROOT || (r.stdout || '').trim();
  }
  return rootCache;
}

// グローバルで入れたコマンドの置き場所
function globalBin() {
  if (pm() === 'pnpm') {
    const r = spawnSync('pnpm', ['bin', '-g'], { encoding: 'utf8', ...npmOpts });
    const b = (r.stdout || '').trim();
    if (b) return b;
  }
  const root = globalRoot();
  return WIN ? path.dirname(root) : path.join(path.dirname(path.dirname(root)), 'bin');
}

// 入っている @lapius パッケージ → { version, link }
function installed() {
  if (pm() === 'pnpm') return installedPnpm();
  const dir = path.join(globalRoot(), SCOPE);
  const res = {};
  let names = [];
  try {
    names = fs.readdirSync(dir);
  } catch {
    names = [];
  }
  const items = names.map((n) => [n, path.join(dir, n)]);
  for (const x of CATALOG) if (x.pkg) items.push([x.name, path.join(globalRoot(), ...x.pkg.split('/'))]);
  for (const [n, p] of items) {
    try {
      const pkg = JSON.parse(fs.readFileSync(path.join(p, 'package.json'), 'utf8'));
      res[n] = { version: pkg.version, link: fs.lstatSync(p).isSymbolicLink() };
    } catch {
      // package.json が無いものは壊れた残骸なので数えない
    }
  }
  return res;
}

// pnpm はパッケージごとに別の場所へ入るので、pnpm ls -g の結果から読む
function installedPnpm() {
  const res = {};
  const r = spawnSync('pnpm', ['ls', '-g', '--depth=0', '--json'], { encoding: 'utf8', ...npmOpts });
  let list = [];
  try {
    list = JSON.parse(r.stdout || '[]');
  } catch {
    list = [];
  }
  for (const proj of list) {
    for (const [full, info] of Object.entries(proj.dependencies || {})) {
      const item = CATALOG.find((x) => x.pkg === full);
      if (full.startsWith(SCOPE + '/')) res[full.slice(SCOPE.length + 1)] = { version: info.version, link: false };
      else if (item) res[item.name] = { version: info.version, link: false };
    }
  }
  return res;
}

// pm（pnpm / npm）を実行して { code, output } を返す。onLine で進捗の行を受け取れる
function run(args, onLine) {
  return new Promise((resolve) => {
    const flags = pm() === 'pnpm' ? ['--reporter=append-only'] : ['--no-fund', '--no-audit', '--loglevel=error'];
    const child = spawn(pm(), [...args, ...flags], {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, npm_config_update_notifier: 'false' },
      ...npmOpts,
    });
    let output = '';
    const feed = (b) => {
      output += b;
      if (onLine) for (const l of String(b).split('\n')) if (l.trim()) onLine(l.trim());
    };
    child.stdout.on('data', feed);
    child.stderr.on('data', feed);
    child.on('error', (e) => resolve({ code: 127, output: e.message }));
    child.on('close', (code) => resolve({ code, output }));
  });
}

// pm のエラー出力から、原因が分かる行だけを取り出す
function npmError(output) {
  const lines = String(output)
    .split('\n')
    .map((l) => l.replace(/^(npm (ERR!|error)|ERR_PNPM_\w+)\s*/, '').trim())
    .filter((l) => l && !/^(A complete log|Log files were|\/.*debug.*\.log$)/.test(l));
  const hint = [];
  const all = lines.join('\n');
  if (/EACCES|permission denied/i.test(all))
    hint.push('グローバル領域に書き込めません。sudo ではなく、mise / nvm などユーザー領域の Node を使うのがおすすめです');
  if (/ENOTFOUND|ETIMEDOUT|ECONNRESET|EAI_AGAIN/.test(all)) hint.push('ネットワークに接続できません');
  if (/E404/.test(all)) hint.push('パッケージが見つかりません（公開直後なら数分待ってください）');
  if (/EBUSY|EPERM/.test(all) && WIN) hint.push('コマンドが実行中の可能性があります。閉じてからやり直してください');
  return { lines: lines.slice(0, 6), hint };
}

// PATH から実行ファイルを探す（見つかった順にすべて）
function which(cmd) {
  const exts = WIN ? (process.env.PATHEXT || '.EXE;.CMD;.BAT;.PS1').split(';').concat(['']) : [''];
  const found = [];
  for (const dir of (process.env.PATH || '').split(path.delimiter)) {
    if (!dir) continue;
    for (const e of exts) {
      const f = path.join(dir, cmd + e.toLowerCase());
      try {
        const st = fs.statSync(f);
        if (st.isFile() && (WIN || st.mode & 0o111) && !found.includes(f)) found.push(f);
      } catch {
        // なければ次へ
      }
    }
  }
  return found;
}

function versionOf(cmd, args, re) {
  const r = spawnSync(cmd, args, { encoding: 'utf8', timeout: 4000, ...(WIN ? { shell: true } : {}) });
  if (r.status !== 0 && !r.stdout) return '';
  const m = ((r.stdout || '') + (r.stderr || '')).match(re);
  return m ? m[1] : '';
}

// コマンドがあるかだけを見る前提ツール（ytdlpdownloader 用）
function cmdReq(label, cmd, args, re, fix, min) {
  return {
    label,
    check() {
      if (WIN) return { ok: false, detail: 'Windows は非対応（WSL で使う）' };
      const v = versionOf(cmd, args, re);
      if (!v) return { ok: false, detail: '見つかりません', fix };
      const low = min && v.split('.').map(Number).reduce((d, n, i) => d || n - (min[i] ?? 0), 0) < 0;
      return low ? { ok: false, detail: `${cmd} ${v}（古い）`, fix } : { ok: true, detail: `${cmd} ${v}` };
    },
  };
}

// 前提ツール。check() は { ok, detail } を返す
const REQS = {
  zsh: cmdReq('zsh', 'zsh', ['--version'], /zsh (\d+\.\d+(?:\.\d+)?)/, 'sudo apt install zsh'),
  'yt-dlp': cmdReq('yt-dlp', 'yt-dlp', ['--version'], /(\d+\.\d+\.\d+)/, 'pipx install yt-dlp'),
  fzf: cmdReq('fzf 0.63+', 'fzf', ['--version'], /(\d+\.\d+(?:\.\d+)?)/, 'https://github.com/junegunn/fzf#installation', [0, 63]),
  ffmpeg: cmdReq('FFmpeg', 'ffmpeg', ['-version'], /ffmpeg version n?(\d+(?:\.\d+)*)/, 'sudo apt install ffmpeg'),
  jq: cmdReq('jq', 'jq', ['--version'], /jq-(\d+\.\d+(?:\.\d+)?)/, 'sudo apt install jq'),
  python: {
    label: 'Python 3.9+',
    check() {
      for (const cmd of WIN ? ['python', 'py'] : ['python3', 'python']) {
        const v = versionOf(cmd, ['--version'], /Python (\d+\.\d+(?:\.\d+)?)/);
        if (v) {
          const [ma, mi] = v.split('.').map(Number);
          return { ok: ma > 3 || (ma === 3 && mi >= 9), detail: `Python ${v}` };
        }
      }
      return { ok: false, detail: '見つかりません', fix: 'https://www.python.org/downloads/' };
    },
  },
  bun: {
    label: 'Bun',
    check() {
      const v = versionOf('bun', ['--version'], /(\d+\.\d+\.\d+)/);
      return v
        ? { ok: true, detail: `Bun ${v}` }
        : {
            ok: false,
            detail: '見つかりません',
            fix: WIN ? 'powershell -c "irm bun.sh/install.ps1 | iex"' : 'curl -fsSL https://bun.sh/install | bash',
          };
    },
  },
};

const reqCache = {};
function checkReq(key) {
  const k = key.replace(/\?$/, '');
  if (!reqCache[k]) reqCache[k] = { label: REQS[k].label, ...REQS[k].check() };
  return { ...reqCache[k], optional: key.endsWith('?') };
}

// 対話シェルで、コマンド名が関数やエイリアスに隠されていないか調べる（zsh / bash のみ）。
// 設定ファイルの読み込みで余計な出力が出ても拾わないよう、目印付きの行だけを読む
function shellShadows(cmds) {
  const shell = process.env.SHELL || '';
  const name = path.basename(shell);
  if (WIN || !cmds.length || !['zsh', 'bash'].includes(name)) return {};
  const q = cmds.map((x) => `'${x}'`).join(' ');
  const script =
    name === 'zsh'
      ? `for c in ${q}; do print -r -- "@@lapacks $c $(whence -w $c 2>/dev/null | awk '{print $NF}')"; done`
      : `for c in ${q}; do echo "@@lapacks $c $(type -t $c 2>/dev/null)"; done`;
  const r = spawnSync(shell, ['-ic', script], { encoding: 'utf8', timeout: 8000, stdio: ['ignore', 'pipe', 'ignore'] });
  const res = {};
  for (const l of (r.stdout || '').split('\n')) {
    const m = l.match(/^@@lapacks (\S+) (\S*)/);
    if (m && ['function', 'alias'].includes(m[2])) res[m[1]] = m[2];
  }
  return res;
}

// シンボリックリンク（mise の node/26 → 26.10.0 など）を解いて同じ場所か比べる
function sameDir(a, b) {
  const real = (d) => {
    try {
      return fs.realpathSync(d);
    } catch {
      return path.resolve(d);
    }
  };
  const x = real(a);
  const y = real(b);
  return WIN ? x.toLowerCase() === y.toLowerCase() : x === y;
}

module.exports = { WIN, sameDir, globalRoot, globalBin, installed, pm, cmdArgs, cmdText, run, npm: run, npmError, which, checkReq, shellShadows };
