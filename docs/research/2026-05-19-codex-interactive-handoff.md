# Handoff: "Interactive Codex" — brainstorm before building

**Date:** 2026-05-19 · **Status:** pre-brainstorm problem brief (do AFTER compact) · **Context:** PR #85 (control-plane) merged to develop; codex one-shot works in prod.

## Why this doc

User wants codex to be usable *interactively* in cockpit and asked to **brainstorm feasibility first — "make sure codex can work" before investing in building it.** This brief frames the real question so the post-compact brainstorm starts from truth, not the muddled state that caused friction today.

## Current truth (no spin)

- **Codex in cockpit is ALWAYS one-shot `codex exec --json`** — both legacy `cockpit crew spawn --agent codex` and control-plane `cockpit crew dispatch --provider codex`. There is **no live interactive codex** anywhere today.
- The only **live interactive** crew is **Claude** (legacy `cockpit crew spawn`, a chat session in a cmux tab).
- The control-plane's `--mode interactive` is **unimplemented (deferred)** and now **fails loud** (red-team #4 fix) — it does not mean "interactive works."
- Control-plane codex one-shot is **solid and proven in prod**: `--skip-git-repo-check` + `--sandbox workspace-write` + per-task `--cwd` all landed; codex did real read+write implementation work.

## The reframe (the key insight from today)

"Interactive codex" is **two different things**. Separate them in the brainstorm:

**(A) Multi-turn *iterative* codex work — ALREADY WORKS.** The oneplan captain ran a sophisticated chained pipeline entirely via control-plane one-shot dispatches: design-spec → pilot fix → read-only review → implement (cwd=worktree) → re-review → iterate 2 → final review, all `provider=codex`, almost all `done`, real commits to PR #52. Each turn is a fresh `codex exec`; the *captain* carries continuity by feeding each task the prior result's `resultRef`. This is effectively "interactive codex" at the orchestration level and it is reliable **now**. Conclusion: if the need is "codex iterates on work with review loops," **it already works — no new build required.**

**(B) Live human↔codex back-and-forth in a tab — DOES NOT EXIST.** A person watching/poking a codex session like a Claude crew. Codex's only interactive surface is its full-screen TUI (`codex` with no subcommand). This is the actual gap. **The brainstorm's job: decide if (B) is genuinely needed given (A) works, and if so whether codex can even do it reliably.**

## Feasibility options to evaluate (with experiments to RUN during brainstorm)

**Option C — codex protocol/server mode (investigate FIRST; highest potential).**
`pgrep` showed `codex app-server` running (the VSCode codex extension uses it). Codex may expose a programmatic, stateful, multi-turn server protocol — analogous to `opencode serve`. If so, this is the clean reliable "interactive codex" path: cockpit drives codex over a protocol, not a scraped TUI, with real turn/done signals — fits the control-plane model exactly.
- Experiment: `codex app-server --help`; inspect its protocol (stdin/JSON-RPC? socket?); can a client open a session, send a turn, get a structured response, send another turn? Is it documented/stable in codex-cli 0.130.0?

**Option B — multi-turn via `codex exec resume` over the control-plane (reliable, aligned, partial-built).**
`codex exec resume <thread_id> [PROMPT]` continues a prior codex session. Combined with the spec's already-designed `blocked → reply → working` state-machine loop + the `reply` CLI + the `deps.launchInteractive` forward-hook (already stubbed in `daemon.ts`), this gives **structured stateful multi-turn** (not live chat, but resumable conversation through the daemon with real completion signals). This is closest to what the captain already does manually — formalizing it is low-risk and on-architecture.
- Experiment: dispatch a codex task, capture its `thread_id` (it's in the result JSONL: `{"type":"thread.started","thread_id":"…"}`); run `codex exec resume <thread_id> "follow-up"` — does it retain context? Does `--json` still work with `resume`? Wire `reply` → `codex exec resume` in the adapter.

**Option A — drive codex's interactive TUI in a cmux tab via send-keys/read-screen (likely REJECT).**
This is exactly the terminal-scraping model the control-plane was built to *replace*. Codex's TUI is a ratatui full-screen app — scraping it for "is it done / what did it say" is the unreliable pattern that started this whole project (#64). Document as the fallback only if B and C both fail; default expectation = reject.

## What already exists to build on

- Control-plane codex one-shot: `src/control/headless/codex.ts` (skip-git/sandbox/cwd done), reliable `dispatch`+`status`.
- `deps.launchInteractive?` forward-hook in `src/control/daemon.ts` (stubbed; interactive dispatch currently fails loud — red-team #4).
- `blocked → reply → working` state machine + `cockpit crew reply` CLI (delivery unwired = the deferred "interactive-wiring spec").
- Design spec `docs/specs/2026-05-17-cockpit-control-plane-design.md` (the deferred interactive section), plan `docs/plans/2026-05-17-cockpit-control-plane.md`.
- Open issues: #86 (orphan-on-restart — relevant: any long codex session dies if the daemon restarts), #87 (protocol schema validation), #88 (write amplification).

## Recommended brainstorm flow (post-compact)

1. **Decide if (B) live human↔codex is even required**, given (A) iterative codex already works in prod. If the real need was "codex does iterative implementation with review loops" — that's done; close the request.
2. If live/interactive is genuinely wanted: **run the Option C experiment first** (`codex app-server` protocol). A protocol-driven codex is the only path that's both interactive *and* reliable (no scraping).
3. If C is unavailable/unstable: **Option B** (`codex exec resume` + the deferred interactive-wiring loop) — structured multi-turn, reliable, on-architecture. Accept it's not live-chat.
4. Treat **Option A (TUI scraping) as reject-by-default** — it reintroduces the exact unreliability this whole project eliminated.
5. Whatever path: it depends on **issue #86 (graceful daemon restart / don't orphan in-flight sessions)** being addressed, or a long interactive codex session dies on any daemon bounce.

## One-line problem statement for the brainstorm

> Codex iterative work already works reliably via control-plane chained dispatch (proven: oneplan Task 3 / PR #52). The open question is whether *live human-in-the-loop codex* is needed and, if so, whether codex's `app-server` protocol (Option C) or `exec resume` multi-turn (Option B) can deliver it **without** falling back to TUI scraping (Option A) — the pattern the control-plane exists to kill.
