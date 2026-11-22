<div align="center">

<p align="center"><b>English</b> | <a href="README.ja.md">日本語</a></p>

<h1 align="center">Lapacks</h1>

<h3 align="center">Manage every @lapius package with one command.</h3>

<p align="center">A management CLI that lists, installs, updates, and removes the <code>@lapius</code> packages (why, sca, laping, clilap, and more) in one place. Run it with no arguments to open a TUI you can drive with the keyboard.</p>

<p align="center">
  <a href="https://github.com/Lapius7/lapacks/releases"><img alt="Release" src="https://img.shields.io/github/v/release/Lapius7/lapacks?label=release&style=flat-square&color=e8833a&logo=github"></a>
  <a href="https://www.npmjs.com/package/@lapius/lapacks"><img alt="npm" src="https://img.shields.io/npm/v/@lapius/lapacks?style=flat-square&color=cb3837&logo=npm"></a>
  <a href="https://nodejs.org/"><img alt="Node.js" src="https://img.shields.io/badge/node.js-18+-339933?style=flat-square&logo=node.js&logoColor=white"></a>
  <a href="LICENSE"><img alt="License" src="https://img.shields.io/github/license/Lapius7/lapacks?style=flat-square&color=97ca00"></a>
  <a href="https://github.com/Lapius7/lapacks/stargazers"><img alt="Stars" src="https://img.shields.io/github/stars/Lapius7/lapacks?style=flat-square&color=e3b341&logo=github"></a>
  <a href="https://github.com/Lapius7/lapacks/commits/main"><img alt="Last commit" src="https://img.shields.io/github/last-commit/Lapius7/lapacks?style=flat-square&color=3b82f6"></a>
</p>

<p align="center">
  <a href="#install">Install</a> ·
  <a href="#usage">Usage</a> ·
  <a href="#how-it-works">How it works</a> ·
  <a href="#development">Development</a>
</p>

</div>

---

## Install

```bash
pnpm add -g @lapius/lapacks
```

> [!IMPORTANT]
> The @lapius packages **assume pnpm**. Installing with both npm and pnpm leaves two copies of each command, so use only `pnpm add -g`.

Node.js 18 or later is required (Linux / macOS / Windows). There are no dependencies.

## Usage

```bash
lapacks                  # open the TUI (same as list when not in a terminal)
lapacks list             # list packages (-i shows only installed ones)
lapacks outdated         # only packages with an update
lapacks info sca         # details (package name or command name)
lapacks install why sca  # install (all installs everything)
lapacks update           # update everything that has an update (including lapacks itself)
lapacks update laping    # update only the named package
lapacks remove clilap    # remove (asks first, -y skips the prompt)
lapacks config           # show settings (config pm npm switches to npm)
lapacks doctor           # diagnose PATH, required tools, and command conflicts
```

| Alias | Command |
|---|---|
| `ls` `l` | `list` |
| `show` | `info` |
| `i` `add` | `install` |
| `up` `upgrade` `u` | `update` |
| `rm` `uninstall` `un` | `remove` |

### Options

| Option | Description |
|---|---|
| `-r`, `--refresh` | Fetch from the registry instead of the cache (the cache lasts 10 minutes) |
| `-f`, `--force` | Reinstall even if already latest |
| `-y`, `--yes` | Skip the removal prompt |
| `-i`, `--installed` | Show only installed packages |
| `--json` | Output JSON (`list` `outdated` `info`) |
| `--no-color` | Disable color (`NO_COLOR` also works) |

### TUI keys

| Key | Action |
|---|---|
| `↑` `↓` / `j` `k` | Move (`PgUp` `PgDn` `g` `G` also work) |
| `space` | Select / deselect (`a` selects all) |
| `/` | Filter (name, command, description) |
| `enter` / `→` | Details |
| `i` | Install |
| `u` | Update |
| `U` | Update everything that has an update |
| `d` / `x` | Remove |
| `r` | Refetch from the registry |
| `l` | Show the output of the last npm run |
| `esc` / `q` | Back / quit |

Actions apply to the selected items, or to the row under the cursor when nothing is selected.

## How it works

- The package list comes from the npm registry, so newly published `@lapius` packages appear automatically. The cache is in `~/.cache/lapacks/` (`%LOCALAPPDATA%\lapacks\` on Windows).
- Install and update simply run `pnpm add -g @lapius/<name>`. The package manager defaults to pnpm. Run `lapacks config pm npm` to change it (saved to the config file; `lapacks config pm --unset` restores the default). The environment variable `LAPACKS_PM=pnpm` / `npm` takes precedence over the config file. Packages installed with the other manager don't appear in the list.
- The config file is `~/.config/lapacks/config.json` (under `XDG_CONFIG_HOME` if set, `%APPDATA%\lapacks\config.json` on Windows). Set `LAPACKS_CONFIG` to change the location.
- After installing, it warns when a required tool (Python, Bun) is missing, or when a shell function or alias hides a command name.

## Development

```bash
node npm/package/bin/lapacks        # run in place
node npm/build.mjs 0.1.0 --pack     # build a .tgz in dist/npm and inspect it
```

Pushing a `v*` tag makes GitHub Actions publish to npm.

## License

MIT
