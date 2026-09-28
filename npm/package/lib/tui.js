// 対話画面。lapacks を端末で引数なしに起動したときに開く。
'use strict';

const catalog = require('./catalog');
const sys = require('./system');
const cmd = require('./commands');
const { c, strip, width, truncate, pad, FRAMES, cmpVer, ago, isColor } = require('./ui');

const out = process.stdout;
const w = (s) => out.write(s);

const KEYS = [
  ['↑↓', '移動'],
  ['space', '選択'],
  ['i', '入れる'],
  ['u', '更新'],
  ['d', '消す'],
  ['U', 'すべて更新'],
  ['/', '絞り込み'],
  ['enter', '詳細'],
  ['r', '再取得'],
  ['q', '終了'],
];

async function run() {
  const s = {
    st: await cmd.loadState(),
    cursor: 0,
    top: 0,
    sel: new Set(),
    filter: '',
    filtering: false,
    busy: '',
    frame: 0,
    msg: '',
    msgLevel: 'info',
    confirm: null,
    detail: false,
    log: null,
    showLog: false,
  };

  const enter = () => {
    w('\x1b[?1049h\x1b[?25l');
    process.stdin.setRawMode(true);
    process.stdin.resume();
  };
  const leave = () => {
    w('\x1b[?25h\x1b[?1049l');
    try {
      process.stdin.setRawMode(false);
    } catch {
      // 端末が既に閉じていれば何もしない
    }
    process.stdin.pause();
  };
  process.on('exit', () => w('\x1b[?25h\x1b[?1049l'));
  enter();

  const visible = () => {
    const f = s.filter.toLowerCase();
    return s.st.packages.filter(
      (p) => !f || [p.name, p.cat, p.short, ...p.bin].some((x) => String(x).toLowerCase().includes(f)),
    );
  };
  const current = () => visible()[s.cursor];
  const targets = () => {
    const sel = s.st.packages.filter((p) => s.sel.has(p.name));
    return sel.length ? sel : current() ? [current()] : [];
  };
  const say = (msg, level = 'info') => {
    s.msg = msg;
    s.msgLevel = level;
  };

  function render() {
    const W = out.columns || 80;
    const H = out.rows || 24;
    const L = [];
    const n = { ok: 0, outdated: 0, missing: 0 };
    for (const p of s.st.packages) n[p.status]++;

    // 見出し
    const title = ` ${c.bold(c.accent('lapacks'))} ${c.gray('v' + cmd.VERSION)}  ${c.dim('@lapius パッケージマネージャー')}`;
    const stat =
      `${c.green('✓')} ${n.ok + n.outdated}  ${c.yellow('↑')} ${n.outdated}  ${c.gray('·')} ${n.missing}   ` +
      (s.st.offline ? c.yellow('オフライン') : c.gray(ago(s.st.fetchedAt))) +
      ' ';
    L.push(title + ' '.repeat(Math.max(1, W - width(title) - width(stat))) + stat);
    if (s.st.self && cmpVer(s.st.self, cmd.VERSION) > 0)
      L.push(` ${c.pink('★')} lapacks ${c.bold(s.st.self)} が出ています ${c.gray('（lapacks update lapacks）')}`);
    L.push(c.gray('─'.repeat(W)));

    if (s.showLog) return frame(L.concat(logView(W, H - L.length - 2)), W, H);
    if (s.detail && current()) return frame(L.concat(detailView(current(), W)), W, H);

    // 一覧
    const list = visible();
    const nw = Math.max(8, ...s.st.packages.map((p) => width(p.name)));
    const bw = Math.max(6, ...s.st.packages.map((p) => width(p.bin.join(' '))));
    const vw = 17;
    const cw = 6;
    const fixed = 7 + nw + 2 + cw + 2 + bw + 2 + vw + 2;
    const showBin = W >= 7 + nw + vw + bw + 12;
    const dw = W - fixed - 1;
    const head =
      '       ' + pad('パッケージ', nw) + '  ' + pad('分類', cw) + '  ' + (showBin ? pad('コマンド', bw) + '  ' : '') + pad('版', vw) + (dw > 6 ? '  説明' : '');
    L.push(c.gray(truncate(head, W)));

    const panel = 6;
    const listH = Math.max(3, H - L.length - panel - 2);
    if (s.cursor < s.top) s.top = s.cursor;
    if (s.cursor >= s.top + listH) s.top = s.cursor - listH + 1;
    for (let i = s.top; i < Math.min(list.length, s.top + listH); i++) {
      const p = list[i];
      const on = i === s.cursor;
      const mark = { ok: c.green('✓'), outdated: c.yellow('↑'), missing: c.gray('·') }[p.status];
      const sel = s.sel.has(p.name) ? c.pink('●') : ' ';
      const ver =
        p.status === 'missing'
          ? c.gray(pad('未導入', 8) + (p.latest || ''))
          : p.status === 'outdated'
            ? `${p.installed} ${c.gray('→')} ${c.yellow(p.latest)}`
            : c.green(p.installed) + (p.link ? c.magenta(' link') : '');
      const name = on ? c.bold(pad(p.name, nw)) : p.status === 'missing' ? c.dim(pad(p.name, nw)) : pad(p.name, nw);
      let row =
        ` ${on ? c.accent('❯') : ' '} ${sel} ${mark}  ${name}  ${c.gray(pad(p.cat, cw))}  ` +
        (showBin ? c.cyan(pad(truncate(p.bin.join(' '), bw), bw)) + '  ' : '') +
        pad(ver, vw) +
        (dw > 6 ? '  ' + c.gray(truncate(p.short, dw)) : '');
      row = pad(row, W);
      L.push(on ? (isColor() ? c.bgRow(row) : c.inverse(row)) : row);
    }
    if (!list.length) L.push(c.gray(`   「${s.filter}」に一致するパッケージはありません`));
    while (L.length < H - panel - 2) L.push('');
    const more = list.length > listH ? c.gray(` ${s.top + 1}-${Math.min(list.length, s.top + listH)} / ${list.length}`) : '';

    // 下の詳細欄
    const p = current();
    L.push(c.gray('─'.repeat(Math.max(0, W - width(more)))) + more);
    if (p) {
      L.push(' ' + c.bold(p.full) + '  ' + c.gray(truncate(p.description, W - width(p.full) - 4)));
      const req = p.needs.length
        ? p.needs
            .map((k) => {
              const r = sys.checkReq(k);
              return (r.ok ? c.green('✓ ') : r.optional ? c.yellow('! ') : c.red('✗ ')) + r.label;
            })
            .join('  ')
        : c.gray('Node.js のみ');
      L.push(` ${c.gray('コマンド')} ${p.bin.map((b) => c.cyan(b)).join(' ')}   ${c.gray('必要')} ${req}`);
      L.push(' ' + c.blue(truncate(p.homepage, W - 2)));
    } else L.push('', '', '');
    while (L.length < H - 2) L.push('');
    return frame(L, W, H);
  }

  function frame(L, W, H) {
    while (L.length < H - 2) L.push('');
    L.length = H - 2;
    // 状態行
    let st = '';
    if (s.busy) st = ` ${c.accent(FRAMES[s.frame % FRAMES.length])} ${s.busy}`;
    else if (s.confirm) st = ` ${c.yellow('?')} ${s.confirm.text} ${c.gray('[y/N]')}`;
    else if (s.filtering) st = ` ${c.accent('/')} ${s.filter}${c.inverse(' ')}  ${c.gray('enter 決定 · esc 解除')}`;
    else if (s.msg) st = ' ' + { ok: c.green('✓ '), err: c.red('✗ '), warn: c.yellow('! '), info: '' }[s.msgLevel] + s.msg;
    else if (s.filter) st = ` ${c.gray('絞り込み:')} ${c.accent(s.filter)} ${c.gray('（esc で解除）')}`;
    else if (s.sel.size) st = ` ${c.pink('●')} ${s.sel.size} 件選択中 ${c.gray('（i / u / d でまとめて操作）')}`;
    L.push(truncate(strip(st), W) === strip(st) ? st : truncate(strip(st), W));
    const keys = s.showLog || s.detail
      ? [['esc', '戻る'], ...(s.detail ? [['i', '入れる'], ['u', '更新'], ['d', '消す']] : []), ['q', '終了']]
      : KEYS;
    let help = '';
    for (const [k, v] of keys) {
      const part = `${c.accent(k)} ${c.gray(v)}  `;
      if (width(help + part) > W - 1) break;
      help += part;
    }
    L.push(' ' + help);
    w('\x1b[H' + L.map((l) => l + '\x1b[K').join('\r\n') + '\x1b[J');
  }

  function detailView(p, W) {
    const L = [''];
    const bw = Math.min(W - 2, 80);
    const row = (k, v) => L.push('  ' + c.gray(pad(k, 13)) + v);
    L.push('  ' + c.bold(c.accent(p.full)) + '  ' + c.gray(p.cat));
    L.push('');
    L.push('  ' + truncate(p.description, bw - 2));
    L.push('');
    row('コマンド', p.bin.map((b) => c.cyan(b)).join(c.gray(' / ')));
    row(
      '状態',
      p.status === 'missing'
        ? c.gray('未導入') + (p.latest ? c.gray(`（最新 ${p.latest}）`) : '')
        : p.status === 'outdated'
          ? `${p.installed} ${c.gray('→')} ${c.yellow(c.bold(p.latest))} に更新できます`
          : c.green(`${p.installed} 入っています`) + (p.link ? c.magenta('（npm link）') : ''),
    );
    if (p.needs.length)
      p.needs.forEach((k, i) => {
        const r = sys.checkReq(k);
        row(
          i ? '' : '必要なもの',
          `${r.ok ? c.green('✓') : r.optional ? c.yellow('!') : c.red('✗')} ${r.label}  ${c.gray(r.detail)}${r.optional ? c.gray('（一部の機能のみ）') : ''}`,
        );
        if (!r.ok && r.fix) row('', c.cyan(r.fix));
      });
    else row('必要なもの', c.gray('なし（Node.js だけで動きます）'));
    if (p.deprecated) row('注意', c.yellow(p.deprecated));
    row('リポジトリ', c.blue(p.homepage));
    row('npm', c.blue(`https://www.npmjs.com/package/${p.full}`));
    L.push('');
    if (p.status === 'missing') row('入れるには', c.gray(`npm i -g ${p.full}`));
    else if (p.status === 'outdated') row('更新するには', c.gray(`npm i -g ${p.full}@latest`));
    else row('消すには', c.gray(`npm rm -g ${p.full}`));
    return L;
  }

  function logView(W, H) {
    const L = ['', '  ' + c.bold('npm の出力'), ''];
    const lines = String(s.log || '').split('\n').filter((l) => l.trim());
    for (const l of lines.slice(-Math.max(1, H - 4))) L.push('  ' + c.gray(truncate(l, W - 4)));
    return L;
  }

  async function act(kind, list) {
    let ps;
    if (kind === 'remove') ps = list.filter((p) => p.status !== 'missing');
    else if (kind === 'update') ps = list.filter((p) => p.status === 'outdated');
    else ps = list.filter((p) => p.status === 'missing');
    if (!ps.length) {
      const why = { install: 'すでに入っています', update: '更新できるものはありません', remove: '入っていません' }[kind];
      return say(why, 'info'), render();
    }
    const names = ps.map((p) => p.name).join(', ');
    if (kind === 'remove') {
      s.confirm = { text: `${c.bold(names)} を消しますか？`, then: () => doNpm(kind, ps, names) };
      return render();
    }
    return doNpm(kind, ps, names);
  }

  async function doNpm(kind, ps, names) {
    const verb = { install: 'インストール中', update: '更新中', remove: '削除中' }[kind];
    s.busy = `${verb} ${c.bold(names)}`;
    s.msg = '';
    const timer = setInterval(() => {
      s.frame++;
      render();
    }, 80);
    const t = Date.now();
    const args = kind === 'remove' ? ['rm', '-g', ...ps.map((p) => p.full)] : ['i', '-g', ...ps.map((p) => `${p.full}@latest`)];
    const r = await sys.npm(args, (l) => (s.busy = `${verb} ${c.bold(names)}  ${c.gray(truncate(l, 40))}`));
    clearInterval(timer);
    s.busy = '';
    s.log = r.output;
    const sec = ((Date.now() - t) / 1000).toFixed(1);
    cmd.annotate(s.st.packages);
    for (const p of ps) s.sel.delete(p.name);
    if (r.code !== 0) {
      const e = sys.npmError(r.output);
      say(`npm が失敗しました: ${(e.hint[0] || e.lines[0] || '').slice(0, 80)}  ${c.gray('l で出力を表示')}`, 'err');
    } else {
      const done = { install: '入れました', update: '更新しました', remove: '消しました' }[kind];
      say(`${names} を${done} ${c.gray(`(${sec}s)`)}`, 'ok');
      if (kind !== 'remove') {
        const warn = cmd.shadowWarnings(ps);
        if (warn.length) say(strip(warn[0]), 'warn');
      }
    }
    render();
  }

  async function refresh() {
    s.busy = '情報を取得中';
    render();
    const timer = setInterval(() => {
      s.frame++;
      render();
    }, 80);
    s.st = await cmd.loadState({ refresh: true, quiet: true });
    clearInterval(timer);
    s.busy = '';
    say(s.st.offline ? `取得できませんでした: ${s.st.error}` : '最新の情報を取得しました', s.st.offline ? 'err' : 'ok');
    s.cursor = Math.min(s.cursor, Math.max(0, visible().length - 1));
    render();
  }

  return new Promise((resolve) => {
    const quit = (code = 0) => {
      leave();
      process.stdout.removeListener('resize', render);
      resolve(code);
    };

    process.stdin.on('data', (buf) => {
      const k = buf.toString();
      if (k === '\x03') return quit(130);
      if (s.busy) return;

      if (s.confirm) {
        const cf = s.confirm;
        s.confirm = null;
        if (k === 'y' || k === 'Y') return cf.then();
        say('中止しました');
        return render();
      }

      if (s.filtering) {
        if (k === '\r' || k === '\n') s.filtering = false;
        else if (k === '\x1b') (s.filtering = false), (s.filter = '');
        else if (k === '\x7f' || k === '\b') s.filter = [...s.filter].slice(0, -1).join('');
        else if (!/^[\x00-\x1f]/.test(k)) s.filter += k;
        s.cursor = 0;
        s.top = 0;
        return render();
      }

      const list = visible();
      s.msg = '';
      if (s.showLog || s.detail) {
        if (k === '\x1b' || k === '\r' || k === 'h' || k === '\x1b[D') {
          s.showLog = s.detail = false;
          return render();
        }
        if (k === 'q') return quit();
        if (s.detail && current()) {
          if (k === 'i') return act('install', [current()]);
          if (k === 'u') return act('update', [current()]);
          if (k === 'd') return act('remove', [current()]);
        }
        return render();
      }

      switch (k) {
        case 'q':
          return quit();
        case '\x1b':
          if (s.filter) s.filter = '';
          else if (s.sel.size) s.sel.clear();
          else return quit();
          break;
        case '\x1b[A':
        case 'k':
          s.cursor = Math.max(0, s.cursor - 1);
          break;
        case '\x1b[B':
        case 'j':
          s.cursor = Math.min(list.length - 1, s.cursor + 1);
          break;
        case '\x1b[5~':
          s.cursor = Math.max(0, s.cursor - 10);
          break;
        case '\x1b[6~':
          s.cursor = Math.min(list.length - 1, s.cursor + 10);
          break;
        case 'g':
        case '\x1b[H':
          s.cursor = 0;
          break;
        case 'G':
        case '\x1b[F':
          s.cursor = list.length - 1;
          break;
        case ' ': {
          const p = current();
          if (p) s.sel.has(p.name) ? s.sel.delete(p.name) : s.sel.add(p.name);
          s.cursor = Math.min(list.length - 1, s.cursor + 1);
          break;
        }
        case 'a':
          if (list.every((p) => s.sel.has(p.name))) list.forEach((p) => s.sel.delete(p.name));
          else list.forEach((p) => s.sel.add(p.name));
          break;
        case '/':
          s.filtering = true;
          break;
        case '\r':
        case '\x1b[C':
        case 'l':
          if (k === 'l' && s.log) s.showLog = true;
          else if (current()) s.detail = true;
          break;
        case 'i':
          return act('install', targets());
        case 'u':
          return act('update', targets());
        case 'U':
          return act('update', s.st.packages);
        case 'd':
        case 'x':
          return act('remove', targets());
        case 'r':
          return refresh();
      }
      s.cursor = Math.max(0, Math.min(s.cursor, list.length - 1));
      render();
    });
    process.stdout.on('resize', render);
    render();
  });
}

module.exports = { run };
