# lapacks

[![npm](https://img.shields.io/npm/v/@lapius/lapacks?style=flat-square&color=cb3837&logo=npm)](https://www.npmjs.com/package/@lapius/lapacks)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue?style=flat-square)](LICENSE)
[![Node.js](https://img.shields.io/badge/node.js-18+-339933?style=flat-square&logo=node.js&logoColor=white)](https://nodejs.org/)

`@lapius` のパッケージ（why・sca・laping・clilap など）をまとめて一覧・インストール・更新・削除できる管理 CLI。
引数なしで起動すると、キーボードで操作できる TUI が開きます。

```
 lapacks v0.1.0  @lapius パッケージマネージャー           ✓ 11  ↑ 2  · 0   たった今
 ──────────────────────────────────────────────────────────────────────────────
   パッケージ         分類    コマンド           版               説明
 ✓ why               シェル  why                0.1.3            失敗したコマンドの原因…
 ↑ password-gl       シェル  password-gl pgl    2.2.4 → 2.2.5    パスワード / パスフレー…
 ✓ laping-lang       言語    laping             2.1.1            プログラミング言語 Lapi…
 ...
```

## インストール

```bash
npm i -g @lapius/lapacks
```

Node.js 18 以上が必要です（Linux / macOS / Windows）。依存パッケージはありません。

## 使い方

```bash
lapacks                  # TUI を開く（端末でないときは list と同じ）
lapacks list             # 一覧（-i で入っているものだけ）
lapacks outdated         # 更新があるものだけ
lapacks info sca         # 詳しい情報（パッケージ名でもコマンド名でも可）
lapacks install why sca  # 入れる（all ですべて）
lapacks update           # 更新があるものをすべて更新（lapacks 自身も）
lapacks update laping    # 指定したものだけ更新
lapacks remove clilap    # 消す（確認あり、-y で省略）
lapacks doctor           # PATH・前提ツール・コマンドの衝突を診断
```

| 別名 | 元のコマンド |
|---|---|
| `ls` `l` | `list` |
| `show` | `info` |
| `i` `add` | `install` |
| `up` `upgrade` `u` | `update` |
| `rm` `uninstall` `un` | `remove` |

### オプション

| オプション | 説明 |
|---|---|
| `-r`, `--refresh` | キャッシュを使わずレジストリから取り直す（通常は 10 分キャッシュ） |
| `-f`, `--force` | 最新でも入れ直す |
| `-y`, `--yes` | 削除の確認を省く |
| `-i`, `--installed` | 入っているものだけ表示 |
| `--json` | JSON で出力（`list` `outdated` `info`） |
| `--no-color` | 色を付けない（`NO_COLOR` でも可） |

### TUI のキー操作

| キー | 動作 |
|---|---|
| `↑` `↓` / `j` `k` | 移動（`PgUp` `PgDn` `g` `G` も可） |
| `space` | 選択 / 解除（`a` ですべて） |
| `/` | 絞り込み（名前・コマンド・説明） |
| `enter` / `→` | 詳細 |
| `i` | 入れる |
| `u` | 更新 |
| `U` | 更新があるものをすべて更新 |
| `d` / `x` | 消す |
| `r` | レジストリから取り直す |
| `l` | 直前の npm の出力を見る |
| `esc` / `q` | 戻る / 終了 |

選択しているものがあればそれらに、なければカーソルの行に対して実行します。

## しくみ

- パッケージの一覧は npm レジストリから取得します（`@lapius` で新しく公開されたものも自動で出ます）。キャッシュは `~/.cache/lapacks/`（Windows は `%LOCALAPPDATA%\lapacks\`）。
- インストールや更新は内部で `npm i -g @lapius/<名前>` を実行するだけなので、npm で直接入れたものもそのまま管理できます。
- 入れたあとに、前提ツール（Python・Bun・ssh）が足りないときや、シェルの関数・エイリアスがコマンド名を隠しているときは警告します。

## 開発

```bash
node npm/package/bin/lapacks        # その場で実行
node npm/build.mjs 0.1.0 --pack     # dist/npm に .tgz を作って中身を確認
```

`v*` タグを push すると GitHub Actions が npm に公開します。

## ライセンス

MIT
