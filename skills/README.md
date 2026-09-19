# 9Router Gacor — Agent Skills

Drop-in skills for any AI agent (CL4ude, Cursor, ChatGPT, custom SDK). Just **copy a link** below and paste it to your AI — it will fetch the skill and use 9Router Gacor for you.

> Tip: start with the **9router** entry skill — it covers setup and points at the chat skill.

## Skills

| Capability | Copy link below and paste to your AI |
|---|---|
| **Entry / Setup** (start here) | https://raw.githubusercontent.com/rrivann/9router/refs/heads/master/skills/9router/SKILL.md |
| Chat / code-gen | https://raw.githubusercontent.com/rrivann/9router/refs/heads/master/skills/9router-chat/SKILL.md |

## How to use

Paste to your AI (CL4ude, Cursor, ChatGPT, …):

```
Read this skill and use it: https://raw.githubusercontent.com/rrivann/9router/refs/heads/master/skills/9router/SKILL.md
```

Then ask normally — coding, refactoring, code review, etc.

## Configure your shell once

```bash
export NINEROUTER_URL="http://localhost:20128"   # local default, or your VPS / tunnel URL
export NINEROUTER_KEY="sk-..."                   # from Dashboard → Keys (only if requireApiKey=true)
```

Verify: `curl $NINEROUTER_URL/api/health` → `{"ok":true}`.

## Available providers

This fork ships two chat providers only:

- **CodeBuddy Global** (`cb/*`) — CL4ude 4.6/4.7/5, GPT-5.x/6, Gemini 3.x, DeepSeek, GLM, Kimi
- **CodeBuddy CN** (`cbcn/*`) — GLM-5.x, Kimi K2.x/K3, MiniMax, DeepSeek, Hunyuan

## Links

- Source: https://github.com/rrivann/9router
- Upstream: https://github.com/decolua/9router
