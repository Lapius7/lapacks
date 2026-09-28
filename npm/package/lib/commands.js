// サブコマンドの実装（list / info / install / update / remove / doctor）。
'use strict';

const catalog = require('./catalog');
const sys = require('./system');
const path = require('path');
const { c, strip, width, truncate, wrap, pad, columns, box, spinner, cmpVer, ago } = require('./ui');

const VERSION = require('../package.json').version;
const log = (s = '') => process.stdout.write(s + '\n');
const err = (s = '') => process.stderr.write(s + '\n');

// 一覧と、入っている版を突き合わせる
function annotate(packages) {
  const inst = sys.installed();
  for (const p of packages) {
    const i = inst[p.name];
    p.installed = i ? i.version : '';
    p.link = !!(i && i.link);
    p.status = !i ? 'missing' : p.latest && cmpVer(p.latest, i.version) > 0 ? 'outdated' : 'ok';
  }
  return { packages, selfInstalled: inst[catalog.SELF] };
}

async function loadState(opts = {}) {
  const sp = opts.quiet ? null : spinner('パッケージの情報を取得中…');
  try {
    const idx = await catalog.load(opts);
    return { ...idx, ...annotate(idx.packages) };
  } finally {
    if (sp) sp.stop();
  }
}

const MARK = {
  ok: () => c.green('✓'),
  outdated: () => c.yellow('↑'),
  missing: () => c.gray('·'),
};

function counts(pk) {
  const n = { ok: 0, outdated: 0, missing: 0 };
  for (const p of pk) n[p.status]++;
  return n;
}

function header(st) {
  const n = counts(st.packages);
  const info = st.offline
    ? c.yellow(`オフライン（${st.fetchedAt ? ago(st.fetchedAt) + 'の情報' : '版の情報なし'}）`)
    : c.gray(`情報: ${ago(st.fetchedAt)}`);
  log();
  log(`  ${c.bold(c.accent('lapacks'))} ${c.gray('v' + VERSION)}  ${c.dim('@lapius のパッケージを管理します')}`);
  log(
    `  ${c.bold(st.packages.length)} 件   ${c.green('✓')} 入っている ${n.ok + n.outdated}   ` +
      `${c.yellow('↑')} 更新あり ${n.outdated}   ${c.gray('·')} 未導入 ${n.missing}    ${info}`,
  );
  if (st.self && cmpVer(st.self, VERSION) > 0)
    log(`  ${c.pink('★')} lapacks ${c.bold(st.self)} が出ています  ${c.gray('→')} ${c.cyan('lapacks update lapacks')}`);
}

function verCell(p) {
  if (p.status === 'missing') return c.gray('未導入') + (p.latest ? c.gray('  ' + p.latest) : '');
  if (p.status === 'outdated') return `${p.installed} ${c.gray('→')} ${c.yellow(c.bold(p.latest))}`;
  return c.green(p.installed) + (p.link ? c.magenta(' link') : '');
}

function table(pk, { indent = '  ' } = {}) {
  const nw = Math.max(...pk.map((p) => width(p.name)));
  const bw = Math.max(...pk.map((p) => width(p.bin.join(' '))));
  const vw = Math.max(...pk.map((p) => width(verCell(p))));
  const dw = columns() - indent.length - 4 - nw - 2 - bw - 2 - vw - 2;
  let cat = '';
  for (const p of pk) {
    if (p.cat !== cat) {
      cat = p.cat;
      log();
      log(indent + c.bold(c.accent(cat)) + ' ' + c.gray('─'.repeat(Math.max(0, columns() - indent.length - width(cat) - 3))));
    }
    const name = p.status === 'missing' ? c.dim(pad(p.name, nw)) : c.bold(pad(p.name, nw));
    const desc = dw > 8 ? c.gray(truncate(p.short, dw)) : '';
    log(`${indent} ${MARK[p.status]()}  ${name}  ${c.cyan(pad(p.bin.join(' '), bw))}  ${pad(verCell(p), vw)}  ${desc}`);
  }
}

function hints(lines) {
  log();
  log('  ' + lines.map(([k, v]) => `${c.gray(k)} ${c.cyan(v)}`).join(c.gray('   ')));
  log();
}

async function list(o) {
  const st = await loadState(o);
  let pk = st.packages;
  if (o.installed) pk = pk.filter((p) => p.status !== 'missing');
  if (o.outdated) pk = pk.filter((p) => p.status === 'outdated');
  if (o.json) {
    log(
      JSON.stringify(
        pk.map(({ name, full, cat, bin, installed, latest, status, description, homepage }) => ({
          name, full, category: cat, bin, installed: installed || null, latest: latest || null, status, description, homepage,
        })),
        null,
        2,
      ),
    );
    return 0;
  }
  header(st);
  if (!pk.length) {
    log();
    log('  ' + (o.outdated ? c.green('✓ すべて最新です') : c.gray('該当するパッケージはありません')));
    log();
    return 0;
  }
  table(pk);
  const n = counts(st.packages);
  const h = [];
  if (n.outdated) h.push(['更新', 'lapacks update']);
  h.push(['入れる', 'lapacks install <名前>'], ['詳細', 'lapacks info <名前>']);
  if (process.stdout.isTTY) h.push(['画面で操作', 'lapacks']);
  hints(h);
  if (st.offline && !st.fetchedAt) err(c.yellow('  ! ') + st.error);
  return 0;
}

// 名前を解決する。見つからなければ候補を出して null
function pick(st, names) {
  const res = [];
  let bad = false;
  for (const q of names) {
    if (q === catalog.SELF || q === '@lapius/lapacks') {
      res.push({ name: catalog.SELF, full: `${catalog.SCOPE}/${catalog.SELF}`, bin: ['lapacks'], needs: [], latest: st.self, installed: st.selfInstalled ? st.selfInstalled.version : VERSION, self: true });
      continue;
    }
    const p = catalog.resolve(st.packages, q);
    if (p) {
      if (!res.includes(p)) res.push(p);
      continue;
    }
    bad = true;
    const s = catalog.suggest(st.packages, q);
    err(`${c.red('✗')} ${c.bold(q)} というパッケージはありません` + (s ? `  ${c.gray('もしかして:')} ${c.cyan(s.name)}` : ''));
  }
  if (bad) {
    err(c.gray('  一覧: lapacks list'));
    return null;
  }
  return res;
}

function reqLines(p) {
  return p.needs.map((k) => {
    const r = sys.checkReq(k);
    const mark = r.ok ? c.green('✓') : r.optional ? c.yellow('!') : c.red('✗');
    return `${mark} ${r.label}  ${c.gray(r.detail)}${r.optional ? c.gray('（一部の機能のみ）') : ''}`;
  });
}

async function info(o) {
  if (!o.args.length) {
    err('使い方: lapacks info <名前>');
    return 2;
  }
  const st = await loadState(o);
  const ps = pick(st, o.args);
  if (!ps) return 2;
  for (const p of ps) {
    const bw = Math.min(columns() - 2, 78);
    const L = wrap(p.description || p.short, bw - 4);
    L.push('');
    const row = (k, v) => L.push(c.gray(pad(k, 12)) + v);
    row('コマンド', p.bin.map((b) => c.cyan(b)).join(c.gray(' / ')));
    row('カテゴリ', p.cat || '-');
    if (p.status === 'missing') row('状態', c.gray('未導入') + (p.latest ? c.gray(`（最新 ${p.latest}）`) : ''));
    else if (p.status === 'outdated') row('状態', `${p.installed} ${c.gray('→')} ${c.yellow(c.bold(p.latest))} に更新できます`);
    else row('状態', c.green(`${p.installed} 入っています`) + (p.link ? c.magenta('（npm link）') : '') + (p.latest ? c.gray(' 最新') : ''));
    const req = reqLines(p);
    if (req.length) req.forEach((r, i) => row(i ? '' : '必要なもの', r));
    else row('必要なもの', c.gray('なし（Node.js だけで動きます）'));
    if (p.deprecated) row('注意', c.yellow(p.deprecated));
    row('リポジトリ', c.blue(p.homepage));
    row('npm', c.blue(`https://www.npmjs.com/package/${p.full}`));
    log();
    for (const l of box(p.full, L, { w: bw })) log(' ' + l);
    const next =
      p.status === 'missing'
        ? ['入れる', `lapacks install ${p.name}`]
        : p.status === 'outdated'
          ? ['更新', `lapacks update ${p.name}`]
          : ['消す', `lapacks remove ${p.name}`];
    hints([next]);
  }
  return 0;
}

// npm i -g / npm rm -g をスピナー付きで実行する
async function runNpm(args, label) {
  const sp = spinner(label);
  const t = Date.now();
  const r = await sys.npm(args, (l) => sp.set(`${label} ${c.gray(truncate(l, 40))}`));
  sp.stop();
  const sec = ((Date.now() - t) / 1000).toFixed(1);
  if (r.code !== 0) {
    const e = sys.npmError(r.output);
    err(`${c.red('✗')} npm が失敗しました ${c.gray(`(${sec}s, 終了コード ${r.code})`)}`);
    for (const l of e.lines) err('  ' + c.gray(l));
    for (const h of e.hint) err('  ' + c.yellow('→ ') + h);
  }
  return { ok: r.code === 0, sec };
}

// 入れたあとの確認: 前提ツールと、コマンドが別のものに隠されていないか
function afterCheck(ps) {
  const warn = [];
  for (const p of ps)
    for (const k of p.needs || []) {
      const r = sys.checkReq(k);
      if (!r.ok && !r.optional) warn.push(`${c.bold(p.name)} には ${r.label} が必要です（${r.detail}）` + (r.fix ? `\n      ${c.cyan(r.fix)}` : ''));
    }
  warn.push(...shadowWarnings(ps));
  if (warn.length) {
    log();
    for (const w of warn) log(`  ${c.yellow('!')} ${w}`);
  }
}

function shadowWarnings(ps) {
  const bin = sys.globalBin();
  const cmds = ps.flatMap((p) => p.bin);
  const sh = sys.shellShadows(cmds);
  const res = [];
  for (const cmd of cmds) {
    if (sh[cmd]) {
      res.push(`${c.cyan(cmd)} は シェルの${sh[cmd] === 'function' ? '関数' : 'エイリアス'}が優先されます。シェルの設定ファイルから消すか名前を変えてください`);
      continue;
    }
    const found = sys.which(cmd);
    if (found.length && !sys.sameDir(path.dirname(found[0]), bin))
      res.push(`${c.cyan(cmd)} は ${c.gray(found[0])} が優先されます（pip など別の方法で入れたものかもしれません）`);
    else if (!found.length) res.push(`${c.cyan(cmd)} が PATH に見つかりません。${c.gray(bin)} を PATH に加えてください`);
  }
  return res;
}

async function install(o) {
  if (!o.args.length) {
    err('使い方: lapacks install <名前...>   すべてなら lapacks install all');
    return 2;
  }
  const st = await loadState({ ...o, refresh: true });
  const all = o.args.includes('all');
  const ps = all ? st.packages.filter((p) => p.status !== 'ok') : pick(st, o.args);
  if (!ps) return 2;
  const todo = ps.filter((p) => o.force || p.status !== 'ok');
  for (const p of ps.filter((x) => !todo.includes(x))) log(`${c.green('✓')} ${c.bold(p.name)} ${p.installed} はすでに最新です ${c.gray('（入れ直すなら --force）')}`);
  if (!todo.length) {
    if (all) log(c.green('✓ すべて入っていて最新です'));
    return 0;
  }
  return apply(todo, 'install');
}

async function update(o) {
  const st = await loadState({ ...o, refresh: true });
  let ps;
  if (o.args.length) {
    ps = pick(st, o.args);
    if (!ps) return 2;
    for (const p of ps.filter((x) => !x.self && x.status === 'missing')) {
      err(`${c.yellow('!')} ${c.bold(p.name)} は入っていません ${c.gray('→')} ${c.cyan('lapacks install ' + p.name)}`);
    }
    ps = ps.filter((p) => (p.self ? cmpVer(p.latest, VERSION) > 0 : p.status === 'outdated'));
  } else {
    ps = st.packages.filter((p) => p.status === 'outdated');
    if (st.self && cmpVer(st.self, VERSION) > 0) ps.push(...pick(st, [catalog.SELF]));
  }
  if (!ps.length) {
    const n = st.packages.filter((p) => p.status !== 'missing').length;
    log(`${c.green('✓')} すべて最新です ${c.gray(`（入っている ${n} 件）`)}`);
    return 0;
  }
  log();
  for (const p of ps) log(`  ${c.yellow('↑')} ${pad(c.bold(p.name), 20)} ${p.installed} ${c.gray('→')} ${c.yellow(c.bold(p.latest))}`);
  log();
  return apply(ps, 'update');
}

async function apply(ps, kind) {
  const specs = ps.map((p) => `${p.full}@latest`);
  const label = `${kind === 'install' ? 'インストール中' : '更新中'} ${c.bold(ps.map((p) => p.name).join(', '))}`;
  const r = await runNpm(['i', '-g', ...specs], label);
  if (!r.ok) return 1;
  const inst = sys.installed();
  for (const p of ps) {
    const v = inst[p.name] ? inst[p.name].version : '?';
    const what =
      !p.installed ? `${c.green(v)} を入れました`
      : p.installed !== v ? `${p.installed} ${c.gray('→')} ${c.green(v)} に更新しました`
      : `${c.green(v)} を入れ直しました`;
    log(`${c.green('✓')} ${c.bold(p.name)} ${what}  ${c.gray('コマンド:')} ${p.bin.map((b) => c.cyan(b)).join(' ')}`);
  }
  log(c.gray(`  ${r.sec} 秒`));
  afterCheck(ps.filter((p) => !p.self));
  return 0;
}

async function ask(q) {
  if (!process.stdin.isTTY) return false;
  const rl = require('readline').createInterface({ input: process.stdin, output: process.stdout });
  const a = await new Promise((r) => rl.question(q, r));
  rl.close();
  return /^y(es)?$/i.test(a.trim());
}

async function remove(o) {
  if (!o.args.length) {
    err('使い方: lapacks remove <名前...>');
    return 2;
  }
  const st = await loadState(o);
  const ps0 = pick(st, o.args);
  if (!ps0) return 2;
  const ps = ps0.filter((p) => p.self || p.status !== 'missing');
  for (const p of ps0.filter((x) => !ps.includes(x))) log(`${c.gray('·')} ${p.name} は入っていません`);
  if (!ps.length) return 0;
  if (!o.yes) {
    if (!process.stdin.isTTY) {
      err('確認できないため中止しました（-y で確認を省略）');
      return 1;
    }
    const names = ps.map((p) => c.bold(p.name)).join(', ');
    if (!(await ask(`${names} を消します。よろしいですか？ ${c.gray('[y/N]')} `))) {
      log(c.gray('中止しました'));
      return 1;
    }
  }
  const r = await runNpm(['rm', '-g', ...ps.map((p) => p.full)], `削除中 ${c.bold(ps.map((p) => p.name).join(', '))}`);
  if (!r.ok) return 1;
  for (const p of ps) log(`${c.green('✓')} ${c.bold(p.name)} を消しました`);
  return 0;
}

async function doctor(o) {
  const st = await loadState({ ...o, refresh: true });
  const sp = spinner('環境を確認中…');
  const res = [];
  let problems = 0;
  let warns = 0;
  const add = (sec, level, text, fix) => {
    if (level === 'ng') problems++;
    if (level === 'warn') warns++;
    res.push({ sec, level, text, fix });
  };

  const [maj] = process.versions.node.split('.').map(Number);
  add('環境', maj >= 18 ? 'ok' : 'ng', `Node.js ${process.versions.node}`, maj >= 18 ? '' : 'Node.js 18 以降が必要です');
  const npmv = require('child_process').spawnSync('npm', ['-v'], { encoding: 'utf8', ...(sys.WIN ? { shell: true } : {}) });
  add('環境', npmv.status === 0 ? 'ok' : 'ng', npmv.status === 0 ? `npm ${npmv.stdout.trim()}` : 'npm が見つかりません');
  const bin = sys.globalBin();
  const onPath = (process.env.PATH || '').split(path.delimiter).some((d) => d && sys.sameDir(d, bin));
  add('環境', onPath ? 'ok' : 'ng', `グローバルの bin ${c.gray(bin)}`, onPath ? '' : 'このディレクトリを PATH に加えてください');

  const inst = st.packages.filter((p) => p.status !== 'missing');
  for (const key of ['python', 'bun']) {
    const users = st.packages.filter((p) => p.needs.some((n) => n.replace(/\?$/, '') === key));
    const using = users.filter((p) => p.status !== 'missing');
    const r = sys.checkReq(key);
    const who = users.map((p) => (p.status === 'missing' ? c.gray(p.name) : p.name)).join(c.gray(' · '));
    const onlyOptional = using.length && using.every((p) => p.needs.includes(key + '?'));
    const level = r.ok ? 'ok' : !using.length ? 'skip' : onlyOptional ? 'warn' : 'ng';
    add('前提ツール', level, `${r.ok ? r.detail : r.label + ' ' + c.gray(r.detail)}  ${who}`, r.ok || !using.length ? '' : r.fix);
  }

  for (const w of shadowWarnings(inst)) add('コマンド', 'warn', w);
  if (inst.length && !res.some((r) => r.sec === 'コマンド')) add('コマンド', 'ok', `入っている ${inst.length} 件のコマンドはすべて使えます`);
  if (!inst.length) add('コマンド', 'skip', 'まだ何も入っていません');

  add(
    'npm レジストリ',
    st.offline ? 'ng' : 'ok',
    st.offline ? `接続できません ${c.gray(st.error)}` : `接続できます（${st.packages.length} 件）`,
  );
  sp.stop();

  const icon = { ok: c.green('✓'), warn: c.yellow('!'), ng: c.red('✗'), skip: c.gray('-') };
  let sec = '';
  log();
  log(`  ${c.bold(c.accent('lapacks doctor'))}`);
  for (const r of res) {
    if (r.sec !== sec) {
      sec = r.sec;
      log();
      log('  ' + c.bold(sec));
    }
    log(`   ${icon[r.level]} ${r.level === 'skip' ? c.gray(strip(r.text)) : r.text}`);
    if (r.fix) log(`      ${c.cyan(r.fix)}`);
  }
  log();
  if (problems) log(`  ${c.red('✗')} 問題 ${problems} 件` + (warns ? `、注意 ${warns} 件` : ''));
  else if (warns) log(`  ${c.yellow('!')} 注意 ${warns} 件`);
  else log(`  ${c.green('✓ 問題は見つかりませんでした')}`);
  log();
  return problems ? 1 : 0;
}

module.exports = { VERSION, loadState, annotate, list, info, install, update, remove, doctor, pick, shadowWarnings };
