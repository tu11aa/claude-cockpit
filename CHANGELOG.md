# Changelog

All notable changes to claude-cockpit are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.3.0] - 2026-05-05

The thin-redirect release. Cockpit becomes a thin multi-agent orchestration
layer where the captain is disposable, crew are fresh CLI sessions in split
panes (any agent), Command is on-demand, and an auto-poller derives liveness
from cmux pane content so agents don't have to write status.

Umbrella tracking: #40 (closed). Design spec:
[`docs/specs/2026-05-05-cockpit-thin-redirect-design.md`](docs/specs/2026-05-05-cockpit-thin-redirect-design.md).

### Added

- **Crew spawn via split-pane CLI** — `cockpit crew spawn <project> <task>
  [--direction <d>] [--agent claude|codex|gemini|aider]` opens a fresh agent
  CLI in a split pane next to the captain. Replaces Claude-only `TeamCreate`
  / `Agent` tool. Works for any agent (#41, #46).
- **`RuntimeDriver` pane operations** — `newPane`, `closePane`, `sendToPane`,
  `readPaneScreen` so callers reach panes via the existing abstraction (#41).
- **Auto-status poller** — reactor reaction polls captain panes via
  `cockpit runtime read-screen`, classifies state (idle/busy/blocked/errored/
  offline) from the last ~50 lines, writes `{spokeVault}/status.md` with
  state + timestamp + last-activity excerpt. Pure machine, no agent action
  required (#43, #48).
- **Dashboard** — `cockpit dashboard --pane` opens a refreshing sidebar grid
  in cmux; hub Obsidian Dataview page aggregates all spoke `status.md` files.
  Both consume the same auto-derived data (#44, #49).
- **`cockpit command [--task briefing|learnings-review|wiki-aggregate]`** —
  on-demand one-shot Command session in a split pane, instead of an
  always-on persistent Command workspace (#42, #47).
- **Multi-agent template parity** — `captain.generic.md` /
  `crew.generic.md` projected to `~/.codex/AGENTS.md`, `~/.gemini/GEMINI.md`,
  `.cursor/rules/cockpit.mdc` so non-Claude agents have working captain/crew
  contracts (#45, #50).

### Changed

- **Captain templates and `captain-ops` skill** rewritten — no more
  `TeamCreate` / `Agent` / `SendMessage` references; crew spawning routes
  through `cockpit crew spawn`; mandatory write-status-after-every-event
  rule removed (the auto-poller covers liveness).
- **`captain.claude.md`** — added one-line compact-recovery doc note.
  Verified live: role survives `/compact` via `--append-system-prompt-file`,
  so role-amnesia is not a real problem; only work-context loss remains and
  is covered by handoffs.
- **`launch --all`** — no longer auto-launches a Command session. Bare
  `cockpit launch` no longer defaults to Command. Command is opt-in via the
  new `cockpit command` subcommand.
- **Vault discipline** — handoff / wiki / learnings are now opt-in
  (captain writes when meaningful), not nagged on every event. Vault
  becomes a consumer of auto-derived status, not the primary write target.
- **`scripts/spawn-crew-pane.sh`** is now a thin shim that forwards to
  `cockpit crew spawn` (preserved for backward compat).

### Removed

- "Captain MUST write status after every significant event" rule
- "Daily log" requirement (still possible, just opt-in)
- Auto-launched Command session in `--all` flow
- Claude-only `TeamCreate` / `Agent` tool dependence in captain workflow

## [0.2.0] - 2026-05-05

First tagged release. Establishes cockpit as a multi-agent orchestration layer
(Command → Captain → Crew + Reactor) with a pluggable slot architecture and
GitHub-driven automation.

### Added

#### Multi-agent foundation
- Driver model for multi-agent support — Codex, Cursor, Gemini CLI, and Aider
  alongside Claude Code (#16).
- Multi-agent direction statement and Karpathy coding-discipline skill applied
  across captain/crew/direct edits (#32, #33).
- Projection slot V1 — cross-agent config sync so non-Claude agents see the
  same project context (#31, #36).

#### Plugin slot system (#9)
- Phase 1: Runtime slot — abstracts cmux behind a runtime driver (#20).
- Phase 2: Workspace slot — pluggable workspace provisioning (#26).
- Phase 3: Tracker slot — pluggable status/progress tracking (#28).
- Phase 4: Notifier slot — pluggable notification surfaces (#29).

#### Reactor & automation
- Reaction engine — declarative GitHub event polling with rule-based actions
  in a dedicated workspace (#1).
- CI Feedback Reactor — auto-fix CI failures via crew dispatch (#3).
- `cockpit retro` command — weekly/sprint retrospective summaries from daily
  logs and git history (#6).

#### Commands & workflows
- `cockpit launch` and `cockpit shutdown` — bootstrap and tear down the
  Command/Captain/Crew workspace set in cmux.
- `cockpit standup` — daily standup summary from captain logs.
- `cockpit feedback` — capture user feedback into the project record.
- Daily briefing on new day; captain writes daily logs.
- Project groups — sibling repos share context via claude-mem; primary
  repo auto-detected; `--group-role` enforced.
- Auto-discovery of repos under a parent directory with primary/sibling
  identification.
- Auto-generated unique captain names with collision validation on
  `projects add`.
- Session continuity — resume last session by default; `--fresh` flag
  forces a new session; built on `claude -c`.
- Configurable permission modes for command and captain sessions (#21,
  #22) — defaults to `auto`.
- Workspace icons — command, captain, crew — for cmux visual distinction.

#### Knowledge & integrations
- LLM Wiki knowledge compilation system — Karpathy-inspired ingest/query/log
  scripts per spoke vault (#13).
- GSD integration for crew wave-based execution on multi-step tasks (#14).
- Model routing config — Opus for command/captain/review, Sonnet for
  crew/reactor (#12).
- Task Master integration via session handoff files.
- Docs scaffolding for research, specs, and ADRs.
- Project roadmap covering 13 features across P0–P3.

### Changed

- Cockpit roles default to `auto` permission mode at launch (#21, #22).
- `--append-system-prompt-file` used for roles to preserve project CLAUDE.md;
  templates deployed via `cockpit init`.
- Captain writes status on session start and after every task event.
- Command session restricted to delegation-only tools (Bash/Read/Write); no
  Grep/Glob/Edit on project source.
- Switched from manual `git worktree` to Claude Code's built-in worktrees.

### Fixed

- Command-ops freshness gate — validates captain workspace age before reuse,
  preventing stale-session bugs (#37, #38).
- Exact captain-name matching enforced — never reuse similar workspaces.
- Use absolute cmux path everywhere; auto-launch the cmux app if not running.
- Detect external-terminal launches and bring up the cmux app.
- Use `workspace:N` refs (not names) for `cmux select-workspace`.
- Install CLAUDE.md into workspace cwd; navigate to command on launch.
- Brove project path corrected; warn on `projects add` when no `.git` found.
- Strengthened command CLAUDE.md hard rules against doing work directly.
- Correct plugin keys, captain naming, and status display.

### Documentation

- README with install, commands, and architecture.
- Multi-agent direction spec (`docs/specs/2026-04-24-multi-agent-direction.md`).
- P0 roadmap items marked complete; out-of-repo work moved out.

[0.2.0]: https://github.com/tu11aa/claude-cockpit/releases/tag/v0.2.0
