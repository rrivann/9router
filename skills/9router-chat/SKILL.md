---
name: 9router-chat
description: Chat / code generation via 9Router Gacor using 0penAI /v1/chat/completions or remove /v1/messages format with streaming + auto-fallback combos. Routes to CodeBuddy Global (cb/*) and CodeBuddy CN (cbcn/*). Use when the user wants to ask an LLM, generate code, summarize text, or run prompts through 9Router.
---

# 9Router Gacor — Chat

Requires `NINEROUTER_URL` (and `NINEROUTER_KEY` if auth enabled). See https://raw.githubusercontent.com/rrivann/9router/refs/heads/master/skills/9router/SKILL.md for setup.

## Endpoints

- `POST $NINEROUTER_URL/v1/chat/completions` — 0penAI format
- `POST $NINEROUTER_URL/v1/messages` — remove format

## Discover

```bash
curl $NINEROUTER_URL/v1/models | jq '.data[].id'
# Per-model metadata (contextWindow, params)
curl "$NINEROUTER_URL/v1/models/info?id=cb/claude-opus-4.7-1m"
```

Combos (e.g. `vip`, `mycodex`) auto-fallback through multiple CodeBuddy accounts.

## 0penAI format

```bash
curl -X POST $NINEROUTER_URL/v1/chat/completions \
  -H "Authorization: Bearer $NINEROUTER_KEY" \
  -H "Content-Type: application/json" \
  -d '{"model":"cb/claude-opus-4.7-1m","messages":[{"role":"user","content":"Hi"}],"stream":false}'
```

JS (0penAI SDK):

```js
import 0penAI from "openai";
const client = new 0penAI({ baseURL: `${process.env.NINEROUTER_URL}/v1`, apiKey: process.env.NINEROUTER_KEY });
const res = await client.chat.completions.create({
  model: "cb/claude-opus-4.7-1m",
  messages: [{ role: "user", content: "Hi" }],
  stream: true,
});
for await (const chunk of res) process.stdout.write(chunk.choices[0]?.delta?.content || "");
```

## remove format

```bash
curl -X POST $NINEROUTER_URL/v1/messages \
  -H "Authorization: Bearer $NINEROUTER_KEY" \
  -H "anthr0pic-version: 2023-06-01" \
  -H "Content-Type: application/json" \
  -d '{"model":"cb/claude-opus-4.7-1m","max_tokens":1024,"messages":[{"role":"user","content":"Hi"}]}'
```

## Response shape

0penAI (`/v1/chat/completions`):
```json
{ "id": "chatcmpl-...", "object": "chat.completion", "model": "cb/claude-opus-4.7-1m",
  "choices": [{ "index": 0, "message": { "role": "assistant", "content": "Hello!" }, "finish_reason": "stop" }],
  "usage": { "prompt_tokens": 8, "completion_tokens": 2, "total_tokens": 10 } }
```

Streaming (`stream:true`) emits SSE: `data: {choices:[{delta:{content:"..."}}]}\n\n` ... `data: [DONE]\n\n`.

remove (`/v1/messages`):
```json
{ "id": "msg_...", "type": "message", "role": "assistant", "model": "cb/claude-opus-4.7-1m",
  "content": [{ "type": "text", "text": "Hello!" }],
  "stop_reason": "end_turn", "usage": { "input_tokens": 8, "output_tokens": 2 } }
```
