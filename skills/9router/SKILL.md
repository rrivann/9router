---
name: 9router
description: Entry point for 9Router Gacor — local/remote AI gateway with 0penAI-compatible REST for chat. Routes to CodeBuddy Global (cb/*) and CodeBuddy CN (cbcn/*) with auto-fallback + token savings. Use when the user mentions 9Router, NINEROUTER_URL, or wants AI without writing provider boilerplate.
---

# 9Router Gacor

Local/remote AI gateway exposing 0penAI-compatible REST. One key, two providers (CodeBuddy Global + CodeBuddy CN), auto-fallback across accounts, RTK token compression.

## Setup

```bash
export NINEROUTER_URL="http://localhost:20128"      # or VPS / tunnel URL
export NINEROUTER_KEY="sk-..."                      # from Dashboard → Keys (only if requireApiKey=true)
```

All requests: `${NINEROUTER_URL}/v1/...` with header `Authorization: Bearer ${NINEROUTER_KEY}` (omit if auth disabled).

Verify: `curl $NINEROUTER_URL/api/health` → `{"ok":true}`

## Discover models

```bash
curl $NINEROUTER_URL/v1/models                  # all chat models
```

Use `data[].id` as `model` field. Combos appear with `owned_by:"combo"`.

Response shape:
```json
{ "object": "list", "data": [
  { "id": "cb/claude-opus-4.7-1m", "object": "model", "owned_by": "codebuddy", "created": 1735000000 },
  { "id": "cbcn/glm-5.2", "object": "model", "owned_by": "codebuddy-cn", "created": 1735000000 }
]}
```

## Popular models

| Provider | Model IDs |
|---|---|
| CodeBuddy Global (`cb/*`) | `cb/claude-opus-5`, `cb/claude-opus-4.7-1m`, `cb/claude-sonnet-4.6`, `cb/gpt-6-astra`, `cb/gpt-5.6-sol`, `cb/gemini-3.1-pro`, `cb/deepseek-v4.1-flash`, `cb/glm-5.3`, `cb/kimi-k3` |
| CodeBuddy CN (`cbcn/*`) | `cbcn/glm-5.3`, `cbcn/glm-5.2`, `cbcn/kimi-k3`, `cbcn/kimi-k2.5`, `cbcn/minimax-m3`, `cbcn/deepseek-v4.1-flash`, `cbcn/hunyuan` |

## Capability skills

| Capability | Raw URL |
|---|---|
| Chat / code-gen | https://raw.githubusercontent.com/rrivann/9router/refs/heads/master/skills/9router-chat/SKILL.md |

## Errors

- 401 → set/refresh `NINEROUTER_KEY` (Dashboard → Keys)
- 400 `Invalid model format` → check `model` exists in `/v1/models`
- 503 `All accounts unavailable` → wait `retry-after` or add another CodeBuddy account
