# 9Router Tests

Unit + translator tests for the CodeBuddy-focused fork.

## Setup

Vitest must be installed globally or in `/tmp/node_modules` (due to npm workspace hoisting from the root Next.js project):

```bash
cd /tmp && npm install vitest
```

## Running Tests

```bash
cd tests/
NODE_PATH=/tmp/node_modules /tmp/node_modules/.bin/vitest run --reporter=verbose --config ./vitest.config.js
```

Or using the package script (from the `tests/` directory):

```bash
npm test
```

## Layout

| Path | Purpose |
|------|---------|
| `unit/` | Fine-grained unit tests for CodeBuddy (Global + CN), combos, capabilities, DB, translator concerns, and shared utilities. |
| `translator/` | Format-conversion tests exercising the surviving OpenAI ↔ Claude ↔ Responses paths. |
| `translator/registerAll.js` | Imports the surviving translators so `register()` side-effects run under ESM/vitest. |

Provider-specific tests for the pruned providers (Kiro, Codex, Cursor, xAI, Antigravity, Gemini/GeminiCLI, Ollama, CommandCode, Kimchi, Mimo-Free, Opencode, Perplexity, Alicode, GitHub, Grok-CLI, MiniMax TTS, HF, Nvidia, Qoder, Venice, SearxNG) were removed together with their executors and translators.
