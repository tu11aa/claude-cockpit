# claude-cockpit

Multi-project agent orchestration for Claude Code. One command session controls everything.

## How It Works

```
cockpit launch → Command session (Claude Code in cmux)
                    ├── brove-captain (Agent Teams + worktrees)
                    │   ├── crew-pvp (worktree: feat/pvp)
                    │   └── crew-bridge (worktree: fix/bridge)
                    └── scaffold-captain
                        └── crew-migration
```

1. **`cockpit init`** — first-time setup
2. **`cockpit launch`** — starts the command workspace in cmux
3. **Talk to the command session** — "brove has a UI task" → it spawns a captain → captain spawns crew
4. **`cockpit status`** — quick status check without Claude

## Install

```bash
npm install -g claude-cockpit
cockpit init
cockpit doctor
```

## Prerequisites

- [Claude Code](https://claude.ai/code) >= 2.1.32
- [cmux](https://cmux.dev) (macOS terminal for coding agents)
- [Obsidian](https://obsidian.md) (status tracking)
- Node.js >= 18

### Claude Code Plugins

```
/plugin marketplace add thedotmack/claude-mem
/plugin install claude-mem
```

See `core/plugins.md` for full plugin setup.

### Obsidian Plugins

See `obsidian/plugins.md` for Dataview, Templater setup.

## Commands

| Command | Description |
|---------|-------------|
| `cockpit init` | First-time setup — config, hub vault, scripts |
| `cockpit launch` | Start the command workspace |
| `cockpit launch <project>` | Start a specific project captain |
| `cockpit status` | Show all project status (no Claude needed) |
| `cockpit doctor` | Health check — verify dependencies |
| `cockpit projects list` | List registered projects |
| `cockpit projects add <name> <path>` | Register a project |
| `cockpit projects remove <name>` | Unregister a project |
| `cockpit shutdown [project]` | Graceful shutdown |
| `cockpit feedback` | Open opt-in feedback issue |

## Architecture

### Roles

- **Command** — overseer, monitors all projects, spawns captains
- **Captain** — project leader, uses Agent Teams + git worktrees
- **Crew** — worker in a worktree, can spawn subagents for parallel work

### Obsidian Vaults (Hub-and-Spoke)

- **Hub vault** (`~/cockpit-hub`) — cross-project dashboard
- **Spoke vaults** (`{project}/.cockpit-vault/`) — per-project status

### Self-Enhancement

Agents record learnings. The command session reviews them, identifies patterns, and proposes improvements. Changes only apply after user approval.

## Config

`~/.config/cockpit/config.json`

```json
{
  "commandName": "command",
  "hubVault": "~/cockpit-hub",
  "projects": {
    "brove": {
      "path": "~/projects/brove",
      "captainName": "brove-captain",
      "spokeVault": "~/projects/.cockpit-vault",
      "host": "local"
    }
  },
  "defaults": {
    "maxCrew": 5,
    "worktreeDir": ".worktrees",
    "teammateMode": "in-process"
  }
}
```

## License

MIT
