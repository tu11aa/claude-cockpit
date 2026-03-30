# Claude Code Plugin Setup

## Required Plugins

### superpowers (from official marketplace)
Already installed if you see it in `/plugin` list. Provides:
- Git worktree management
- Parallel agent dispatch
- Plan writing and execution

### claude-mem (persistent memory)
```
/plugin marketplace add thedotmack/claude-mem
/plugin install claude-mem
```
Select "Install for you (user scope)". Restart Claude Code.

### context7 (documentation lookup)
Already in the official marketplace. Install via `/plugin`.

## Required Settings

Agent Teams must be enabled in `~/.claude/settings.json`:
```json
{
  "env": {
    "CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS": "1"
  }
}
```

Or run: `cockpit doctor` to verify.
