# Per-project layered config — design

**Date:** 2026-06-23
**Status:** Design approved (brainstorming side-session) — ready for implementation planning
**First tenant:** Telegram notification (active/cap/crew). Future tenants: per-project effort, per-project crew model routing.
**Builds on:** PR #406 / `79aca2d` (per-project notification gate) and the layered notification design in `docs/specs/2026-06-23-telegram-layered-notification-design.md`.
**Holds:** v0.11.0 release is gated on the telegram-notification slice landing on top of this mechanism.

---

## Problem

Today all per-project tuning lives in a single `config.json`. As more integrations land (Telegram now; effort and crew-model routing next), the single file balloons and there's no clean global-default → project-override layering. We want each project to have its own config file, with a global default underneath it.

## Decisions (locked in brainstorming)

1. **Location:** runtime-central, one file per project at `~/.config/squadrant/projects/<name>.json`. Keeps user repos clean; the daemon already reads `~/.config/squadrant/`.
2. **Layering:** global default → per-project override, **per-key deep merge** (overriding one key never resets its siblings).
3. **Config vs. state split:** config files hold what *you* deliberately set (persistent prefs); `telegram-state.json` holds what the *system* tracks at runtime (ephemeral live toggles). `/unmute` flips live state, it does **not** rewrite your config file.
4. **Scope:** build the resolver + per-project file layer + migrate telegram notification onto it. Reserve (don't build) per-project effort and crew model. Don't move registration; no custom event sets; no GUI.

---

## 1. File layout

```
~/.config/squadrant/
  config.json               ← global defaults (existing) + project registration (existing)
  projects/
    squadrant.json          ← per-project overrides (NEW; all keys optional)
    brove.json
  telegram-state.json       ← live system-tracked state (existing, #406; role unchanged)
```

The per-project file is a **settings-override layer**: it mirrors the global settings schema with every key optional. Whatever is global-settable is project-overridable.

**Registration stays in `config.json`.** The `projects.<name>` block (repo path, group membership) is operational, not a tunable, and the registration/group code already depends on it. Per-project info is therefore split: registration in `config.json`, *settings overrides* in `projects/<name>.json`. Folding registration into the per-project file is a possible future cleanup, explicitly out of scope here to keep the change additive.

## 2. Resolution — one pure function

`resolveProjectConfig(project)` returns the fully-merged effective config, merging per key (deep) in precedence order:

```
built-in default  →  global config.json  →  projects/<name>.json  →  live state (only where applicable)
```

- Pure function over the input files — no side effects. The daemon and CLI both call it.
- Deep merge: setting `telegram.notify.crew` in the project file keeps the inherited `telegram.notify.cap` from global.
- The "live state" layer applies **only** to settings that are runtime-toggleable (currently just `telegram.notify.active`). All other settings resolve at the project-file layer.

## 3. Config vs. state — the rule that generalizes

| Principle | Home | Written by |
|---|---|---|
| What **you** deliberately set | config file (global or per-project) | you / CLI / deliberate TG command |
| What the **system** tracks at runtime | `telegram-state.json` | daemon (auto-unmute, `/mute`, `/unmute`) |

Applied to the telegram tenant:

| Setting | Lives in | Written by |
|---|---|---|
| `notify.active` **default** (muted) | config | you / CLI |
| `notify.active` **live** (this session) | state | daemon: auto-unmute on inbound, `/mute`, `/unmute` |
| `notify.cap`, `notify.crew` tiers | config | you / CLI / `/notify crew <tier>` |

So `/mute` and `/unmute` are **session** controls (write live state); `/notify crew all` is a **preference** change (writes the per-project config file). The resolver takes the live `active` if present, else the config default. This auto-vs-deliberate distinction is the general rule: automatic system tracking → state; deliberate user choice → config file.

## 4. Schema

**Global `config.json`** (existing top-level fields are the global defaults):
```json
{
  "telegram": { "notify": { "active": false, "cap": true, "crew": "alert_only" } },
  "effort": "low",
  "models": { "crew": "..." },
  "projects": { "squadrant": { "path": "...", "group": "..." } }
}
```

**Per-project `projects/squadrant.json`** (all keys optional, same shape as the global layerable settings):
```json
{ "telegram": { "notify": { "crew": "all" } } }
```
This overrides only `crew`; `active` and `cap` are inherited from global.

**Future tenants** slot into the same per-project file with no resolver change — only each consumer must be wired to read the resolved value:
```json
{ "telegram": { "notify": { "crew": "all" } },
  "effort": "max",
  "models": { "crew": "opus" } }
```

`crew` tier values: `all | alert_only | done_only | none` (see the layered-notification design for the event-type mapping).

## 5. Migration — additive, zero-risk

- Absent `projects/<name>.json` ⇒ behaves exactly as today (global defaults apply).
- `telegram-state.json` untouched — #406 gate keeps working as the live `active` layer.
- Global `config.json` gains the optional `telegram.notify` block (already additive per the layered-notification design); old configs load with built-in defaults.
- The `projects/` directory is created lazily on the first per-project override.
- No data migration; existing installs work unchanged.

## 6. Surfaces

- **CLI:**
  - `squadrant config set <project> telegram.notify.crew all` — extends the existing `config get|set` (v0.10) to write per-project files via dotted key paths.
  - `squadrant config get <project>` — shows the **resolved/effective** config (what actually applies after merge), with an optional `--raw` to show only the project-file layer.
- **Telegram:**
  - `/mute` / `/unmute` — session live-state toggles (existing).
  - `/notify crew <tier>` / `/notify cap on|off` — persistent preference, writes the per-project config file.

## 7. Testing

- **Resolver:** precedence (built-in → global → project → state), deep-merge correctness, missing-file fallbacks, unknown-key handling.
- **Telegram tenant:** `active` resolution (config default vs. live state override), `cap`/`crew` inheritance, crew-tier event filtering.
- **Migration:** absent project file ⇒ identical behavior to pre-change; old `config.json` / `telegram-state.json` load unchanged.

## 8. Scope (YAGNI)

- **Build now:** the `resolveProjectConfig` resolver + per-project file read/write layer + migrate telegram notification (active/cap/crew) onto it + CLI/TG surfaces above.
- **Design-for, don't build:** per-project effort and crew model — the schema reserves the keys and the resolver is already generic; each is a small later wiring task.
- **Don't build:** moving registration into per-project files, custom/arbitrary event sets, any GUI.

---

## Open items carried from the layered-notification design (decide before v0.11.0)

1. `cap`/`crew` cross-layer resolution: **(A) project overrides global** [recommended] vs (B) global-as-ceiling.
2. `done_only` membership: `{done, failed}` [recommended] vs literally just `done`.

Both are one-line changes in the resolver / tier→set map.
