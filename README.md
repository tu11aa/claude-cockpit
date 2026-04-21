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
- Node.js >= 22

### Required Integrations

```bash
# Claude Memory — cross-session continuity
/plugin marketplace add thedotmack/claude-mem
/plugin install claude-mem

# Task Master — PRD decomposition (works via Max subscription)
npm install -g task-master-ai

# GSD — wave-based execution for crew (fresh context per step)
npx get-shit-done-cc@latest --claude --global
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
| `cockpit launch --all` | Launch command + reactor + all captains |
| `cockpit status` | Show all project status (no Claude needed) |
| `cockpit standup` | Daily standup summary (zero LLM tokens) |
| `cockpit doctor` | Health check — verify dependencies |
| `cockpit projects list` | List registered projects |
| `cockpit projects add <name> <path>` | Register a project |
| `cockpit projects remove <name>` | Unregister a project |
| `cockpit reactor check` | Run one reactor poll cycle |
| `cockpit reactor status` | Show reactor state |
| `cockpit runtime status <project>` | Check if a project's captain workspace is running |
| `cockpit runtime send <project> <msg>` | Send a message to a captain workspace (auto-Enter) |
| `cockpit runtime list` | List all workspaces from the active runtime |
| `cockpit shutdown [project]` | Graceful shutdown |
| `cockpit feedback` | Open opt-in feedback issue |

## Architecture

### Roles

- **Command** (Opus) — overseer, monitors all projects, spawns captains
- **Captain** (Opus) — project leader, uses Agent Teams + git worktrees
- **Crew** (Sonnet) — worker in a worktree, uses GSD for complex tasks
- **Reactor** (Sonnet) — always-on GitHub event poller, auto-delegates to captains (incl. auto-fix on CI failure, with escalation after max retries)

### Model Routing

Each role runs on the optimal model for cost/quality tradeoff. Configured in `config.json`:
- Command/Captain/Review: Opus (coordination + quality)
- Crew/Reactor: Sonnet (execution)
- Exploration: Haiku (cheap lookups)

### Runtime Abstraction

Workspaces run on a pluggable **runtime driver** (currently only `cmux`). Each project may override the global default via its `runtime` field. Bash scripts call `cockpit runtime <op>` to talk to the configured runtime instead of any specific binary. New runtimes (tmux, Docker, SSH) are added as driver files in `src/runtimes/` — see `docs/specs/2026-04-20-plugin-system-runtime-design.md`.

### Obsidian Vaults (Hub-and-Spoke)

- **Hub vault** (`~/cockpit-hub`) — cross-project dashboard + hub wiki
- **Spoke vaults** — per-project status, learnings, and wiki

### Knowledge System

- **Learnings** — raw observations recorded by captains after tasks
- **Wiki** — compiled, indexed knowledge pages in spoke vaults (`wiki/pages/`)
- **Hub Wiki** — cross-project knowledge aggregated by command
- Scripts: `wiki-ingest.sh`, `wiki-query.sh`, `wiki-log.sh`

### Session Continuity

- **Handoff files** — captain writes context on shutdown, reads on startup
- **Session freshness** — auto-detects new day or template changes, forces fresh context
- **claude-mem** — cross-session memory via MCP plugin

## Config

`~/.config/cockpit/config.json`

```json
{
  "commandName": "command",
  "hubVault": "~/cockpit-hub",
  "runtime": "cmux",
  "projects": {
    "brove": {
      "path": "~/projects/brove",
      "captainName": "brove-captain",
      "spokeVault": "~/cockpit-hub/spokes/brove",
      "host": "local",
      "runtime": "cmux"
    }
  },
  "defaults": {
    "maxCrew": 5,
    "worktreeDir": ".worktrees",
    "teammateMode": "in-process",
    "permissions": {
      "command": "default",
      "captain": "acceptEdits"
    },
    "models": {
      "command": "opus",
      "captain": "opus",
      "crew": "sonnet",
      "reactor": "sonnet",
      "exploration": "haiku",
      "review": "opus"
    }
  }
}
```

## License

MIT
