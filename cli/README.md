# 9router-gacor — FREE AI Router & Token Saver

**Never stop coding. Save 20-40% tokens with RTK + auto-fallback across CodeBuddy Global, CodeBuddy CN, and Qwen Cloud accounts.**

Connect any OpenAI/Claude-compatible CLI (Claude Code, Cursor, Codex, Cline, Copilot, OpenClaw, Gemini CLI, Qwen Code, iFlow, Continue, Aider, …) to three curated aggregator providers with quota tracking, credit-exhaust auto-disable, and bulk account management.

[![npm](https://img.shields.io/npm/v/9router-gacor.svg)](https://www.npmjs.com/package/9router-gacor)
[![Downloads](https://img.shields.io/npm/dm/9router-gacor.svg)](https://www.npmjs.com/package/9router-gacor)
[![License](https://img.shields.io/npm/l/9router-gacor.svg)](https://github.com/rrivann/9router/blob/master/LICENSE)

[📖 Docs](https://github.com/rrivann/9router) • [🐛 Issues](https://github.com/rrivann/9router/issues)

---

## 🤔 Why 9router-gacor?

**Stop wasting money, tokens, and hitting limits:**

- ❌ Subscription quota expires unused every month
- ❌ Rate limits stop you mid-coding
- ❌ Tool outputs (git diff, grep, ls…) burn tokens fast
- ❌ Expensive APIs ($20-50/month per provider)

**9router-gacor solves this:**

- ✅ **RTK Token Saver** — Auto-compress `tool_result`, save 20-40% tokens
- ✅ **Bulk account management** — Rotate between hundreds of CodeBuddy / Qwen Cloud accounts
- ✅ **Auto-disable** — Credits exhausted (429/14018), banned (403/11140), access denied → account removed from rotation automatically
- ✅ **Quota tracker** — Live remaining credits per provider (CodeBuddy billing meter, Qwen local aggregation)
- ✅ **Content filter** — Regex-based rewrite/remove rules before request reaches upstream
- ✅ **Thinking control** — max / xhigh / high / medium / low / minimal / auto effort per provider
- ✅ **Universal** — Works with any OpenAI-compatible CLI

---

## ⚡ Quick Start

**Install via npm:**

```bash
npm install -g 9router-gacor
9router-gacor
```

Dashboard opens at `http://localhost:20128`.

**Add accounts:**

Dashboard → Providers → pick one:
- **CodeBuddy Global** (Claude 4.6/4.7, GPT-5.x, Gemini 3.x, DeepSeek, GLM)
- **CodeBuddy CN** (GLM-5.x, Kimi K2.x, MiniMax, DeepSeek, Hunyuan)
- **Qwen Cloud** (GLM-5.2, DeepSeek V4 Pro, Qwen3.7 Max — free tier)

Paste your API keys (bulk-import supported).

**Wire your CLI:**

```
Claude Code / Codex / Cursor / Cline / OpenClaw settings:
  Endpoint: http://localhost:20128/v1
  API Key:  [copy from dashboard]
  Model:    cb/claude-opus-4.7-1m   (or cbcn/glm-5.2, qwc/qwen3.7-max, …)
```

Start coding.

---

## 🚀 CLI Options

```bash
9router-gacor                    # Start with defaults (port 20128)
9router-gacor --port 8080        # Custom port
9router-gacor --no-browser       # Don't open browser
9router-gacor --skip-update      # Skip auto-update check
9router-gacor --help             # Show all options
```

**Dashboard**: `http://localhost:20128/dashboard`
**Gateway (`/v1/*`)**: OpenAI-compatible endpoint for `/chat/completions`, `/messages`, `/responses`, `/models`, `/embeddings`, `/audio/*`, `/images/*`, `/videos/*`, `/search`, `/web/fetch`.

---

## 🛠️ Supported CLI Tools

Claude-Code • OpenClaw • Codex • OpenCode • Cursor • Antigravity • Cline • Continue • Droid • Roo • Copilot • Kilo Code • Gemini CLI • Qwen Code • iFlow • Crush • Aider

Any tool supporting OpenAI/Claude-compatible API works.

---

## 💾 Data Location

- **macOS/Linux**: `~/.9router/db/data.sqlite`
- **Windows**: `%APPDATA%/9router/db/data.sqlite`

(Storage path kept as `9router` for backward compatibility with existing installs.)

Override via `DATA_DIR` env var.

---

## 📚 Documentation

- **GitHub**: https://github.com/rrivann/9router
- **Issues / Feature requests**: https://github.com/rrivann/9router/issues

---

## 🙏 Credits

Based on [9Router](https://github.com/decolua/9router) by decolua. This fork focuses on three OpenAI-compatible aggregator providers (CodeBuddy Global, CodeBuddy CN, Qwen Cloud) with production-grade bulk account management, quota tracking, and thinking-level control ported and refined for high-volume account rotation.

## 📄 License

MIT License — see [LICENSE](LICENSE) for details.
