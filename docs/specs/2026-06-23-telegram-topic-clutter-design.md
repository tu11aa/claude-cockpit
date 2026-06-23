# Telegram layered notification design (v0.11.0)

**Date:** 2026-06-23
**Status:** Design proposal — **v0.11.0 release is held pending this** (per captain)
**Supersedes:** the earlier "buildup cleanup" draft in this same file (coalesce/digest/prune). See the **Redesign verdict** below for why that machinery is dropped.
**Builds on:** PR #406 / `79aca2d` — per-project notification gate (already merged to develop).

---

## What already shipped (#406) — build ON this, don't re-litigate

- `TelegramState.notify: Record<project, boolean>` — **absent/false = MUTED (default).**
- `isNotifyActive` / `setNotify` in `state.ts`.
- `deliverOutbound` (`bridge.ts:54`) early-returns when a project is muted — no topic create, no send.
- Auto-unmute on inbound message; fail-closed `/mute` `/unmute` (TG) + `squadrant telegram notify <project> on|off` (CLI).

**Key reframe:** the merged boolean `notify[project]` *is* the **`active` axis** of the layered model the user asked for. The gate shipped dimension 1 of 3. This spec adds the remaining two (`cap`, `crew`) plus a global scope — purely additively.

---

## The layered model

Three independent dimensions, two scopes (global default + per-project override):

```
                 active            cap                crew
GLOBAL    │  master kill-switch │ captain msgs on/off │ all|alert_only|done_only|none
PROJECT   │  the #406 gate      │ captain msgs on/off │ all|alert_only|done_only|none
```

The two channels map exactly onto the two existing outbound code paths — so each is one filter at a seam that already exists:

| Dimension | Gates | Code seam |
|-----------|-------|-----------|
| `active` | everything for the project | `deliverOutbound` (#406, already there) + new global check |
| `crew` | daemon crew-lifecycle pushes | `deliverOutbound` event filter (**new**) |
| `cap` | captain's own conversational pushes | the `squadrant telegram send` path (**new**) |

### Crew tiers (nested, quietest → loudest)

| `crew` | Crew events delivered |
|--------|-----------------------|
| `none` | — |
| `done_only` | `task.done`, `task.failed` (terminal outcomes — finished or failed) |
| `alert_only` *(default)* | done_only **+** `task.blocked`, `task.approval.requested`, `task.input.requested`, `task.timeout` |
| `all` | alert_only **+** `task.started`, `task.progress`, `task.idle`, `task.delta`, `task.turn.*`, `heartbeat` |

---

## Resolution semantics

For project `P` and an outbound item:

1. **`active` = AND gate** — `global.active` (default `true`) `&&` `state.notify[P]` (default `false`, the #406 gate). If false → drop. Global is the master kill-switch; per-project is the muted-by-default gate that auto-unmutes on inbound. They compose: muted until you engage, killable globally in one switch.
2. **Route by channel:**
   - **crew event** → tier = `state.notifyCrew[P] ?? global.crew`; drop if the event type isn't in that tier's set.
   - **captain message** → allowed = `state.notifyCap[P] ?? global.cap`; drop if false.

**`cap`/`crew` resolution = project-overrides-global** (option A): global is the default for projects that haven't set their own; a per-project value wins. `active` already provides the hard global ceiling, so a separate "ceiling" semantic for cap/crew isn't needed. *(This is one of the two reversible decisions — see bottom.)*

`cap=false` while `active=true` is a valid combo: "send me crew alerts but not the captain's chatter."

---

## Schema changes — additive, **zero migration**

**State** (`telegram-state.json`) — `notify` field **unchanged** (#406 keeps working). Add two optional maps; absent ⇒ inherit global:

```ts
export interface TelegramState {
  offset: number;
  topics: Record<string, number>;
  notify: Record<string, boolean>;              // #406 — the `active` axis (unchanged)
  notifyCap?: Record<string, boolean>;          // NEW — per-project cap override
  notifyCrew?: Record<string, CrewTier>;        // NEW — per-project crew override
}
```
`loadState` adds `?? {}` for the two new maps. Old state files load identically.

**Config** (`TelegramConfig`) — new optional global block; absent ⇒ built-in defaults:

```ts
notify?: {
  active?: boolean;                              // default true (master switch)
  cap?: boolean;                                 // default true
  crew?: "all" | "alert_only" | "done_only" | "none";  // default "alert_only"
};
```
Old configs load identically (defaults apply).

**`deliverOutbound`** — after the existing `isNotifyActive` gate, add the global-active check and the crew-tier filter:
```
if (!global.active) return;            // master kill (new)
if (!isNotifyActive(P)) return;        // #406 gate (unchanged)
const tier = notifyCrew[P] ?? global.crew;
if (!tierIncludes(tier, ev.type)) return;   // crew filter (new)
```

**`cap` seam** — gate the captain's `squadrant telegram send` path on `notifyCap[P] ?? global.cap`.

**Surfaces** — extend existing CLI/TG controls:
- CLI: `squadrant telegram notify <project> crew <tier>` and `... cap on|off` (alongside the merged `on|off` which sets `active`).
- TG: `/notify crew <tier>` / `/notify cap on|off` (alongside `/mute` `/unmute`).

---

## Redesign verdict: DROP the buildup-cleanup machinery

The original ask was "topics fill with a wall of lifecycle messages over days." The conversation converged on a better answer than cleanup: **the layered filter prevents the wall from forming.** With the default `crew: "alert_only"`, a project topic only ever receives failures, blocks, permission asks, and terminal outcomes — inherently low-volume. The captain conversation (`cap`) carries everything else, in the captain's words.

Therefore I recommend **NOT** building coalesce-into-edited-status-message, daily digest, or retention-prune for v0.11.0:

- **It's redundant** once filtering is in — there's no wall to clean.
- **The API fights it** — `deleteMessage` only works on messages <48h old, so retroactive multi-day cleanup is structurally impossible; a retention job can never reach "old days."
- **It adds cost** — coalesce needs per-message `message_id` capture (today discarded) + new state + a new edit-failure mode, for marginal benefit.

**Migration impact of dropping it:** none — none of it was built. If a power user runs `crew: "all"` and still feels buildup, revisit **coalesce-via-`editMessageText`** as an isolated follow-up. It composes with this design (it would edit only already-`active` topics) and can be added later without touching this schema. I'd file it as a deferred issue, not block v0.11.0.

---

## Two reversible decisions (flag for the user before cutting v0.11.0)

1. **`cap`/`crew` cross-layer resolution:** I chose **(A) project overrides global**. Alternative **(B) global is a ceiling** (effective = more restrictive). `active` already gives the hard global kill, so A is simpler and matches "global default + per-project base level." Flip is a one-line change in the resolver.
2. **`done_only` membership:** I bundled `task.failed` with `task.done` (so it means "terminal: finished *or* failed"). Alternative: literally just `task.done`. Trivial to change in the tier→set map.

Everything else is locked and additive. This is ~1 crew task (one package's worth of filter + two CLI/TG verbs + tests), off the daemon hot path.
