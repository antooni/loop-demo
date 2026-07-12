# Loop Engineering Demo

OpenCode selects the active role from `opencode.json`. Role prompts live in `agents/`;
do not infer a different role from the repository name or runtime artifacts.

## Project Decisions

- OpenCode is the coding-agent runtime; OpenRouter is the initial API provider. Full
  `provider/model` IDs remain configurable per role.
- Do not build a custom coding-agent loop with the OpenRouter Agent SDK. Reuse
  OpenCode's tools, permissions, sessions and JSON event stream.
- Deterministic code owns lifecycle, waiting, retries, timestamps, timeouts, budgets
  and terminal failures. LLM sessions never poll one another.
- `.loop` is the runtime protocol boundary. Status JSON is strict and atomic; malformed
  data is surfaced as an error, never repaired with regex.
- There is no `claude -p` compatibility backend. Automated tests make no paid calls.
