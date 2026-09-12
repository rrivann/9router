// #3795 — a proxy must not dispatch more cache_control blocks than Anthropic
// accepts, and must not lose turns that use single-object content (#3567 interplay).
//
// Fork-adapted: fork does not have anchorClaudeCache as a separate function —
// cache logic is inline in prepareClaudeRequest, which strips all client markers
// in Pass 1 and re-anchors system last + tool last + last assistant (max 3).
// The budget guard (capCacheControlBlocks) protects against cases where client
// markers survive normalization (e.g. via normalizeClaudePassthrough path).
// Tests that upstream runs against anchorClaudeCache directly are adapted to
// test the contract via prepareClaudeRequest, with expectations adjusted to
// the fork's strip-and-reanchor model.
import { describe, it, expect } from "vitest";
import {
  normalizeClaudePassthrough,
  prepareClaudeRequest,
} from "../../open-sse/translator/formats/claude.js";
import { claudeToOpenAIRequest } from "../../open-sse/translator/request/claude-to-openai.js";

const CC = { type: "ephemeral" };
const text = (t, extra = {}) => ({ type: "text", text: t, ...extra });
const tool = (name, extra = {}) => ({ name, description: "d", input_schema: {}, ...extra });

function countMarkers(body) {
  let n = 0;
  if (Array.isArray(body.system)) for (const b of body.system) if (b?.cache_control) n++;
  if (Array.isArray(body.tools)) for (const t of body.tools) if (t?.cache_control) n++;
  if (Array.isArray(body.messages)) for (const m of body.messages) {
    if (Array.isArray(m?.content)) {
      for (const b of m.content) if (b?.cache_control) n++;
    } else if (m?.content && typeof m.content === "object" && m.content.cache_control) n++;
  }
  return n;
}

describe("cache marker budget and single-block content", () => {
  it("never emits more than four markers when the client already spent its budget", () => {
    const out = prepareClaudeRequest({
      model: "claude-sonnet-5", max_tokens: 100,
      system: [text("s1"), text("s2", { cache_control: CC })],
      tools: [tool("t1"), tool("t2", { cache_control: CC })],
      messages: [
        { role: "user", content: text("u1", { cache_control: CC }) },
        { role: "assistant", content: text("a1", { cache_control: CC }) },
        { role: "user", content: [text("q")] },
      ],
    }, "claude");
    expect(countMarkers(out)).toBeLessThanOrEqual(4);
  });

  it("normalizes a single-object turn in passthrough and anchors it", () => {
    const body = {
      messages: [
        { role: "user", content: [text("u1")] },
        { role: "assistant", content: text("a1") },
        { role: "user", content: [text("q")] },
      ],
    };
    normalizeClaudePassthrough(body);
    const assistant = body.messages.find(m => m.role === "assistant");
    expect(assistant).toBeDefined();
    expect(Array.isArray(assistant.content)).toBe(true);
    expect(assistant.content).toHaveLength(1);
    const out = prepareClaudeRequest({ ...body, model: "claude-sonnet-5", max_tokens: 100 }, "claude");
    expect(countMarkers(out)).toBe(1);
  });

  it("keeps a turn whose content is a single object and strips its marker", () => {
    const out = prepareClaudeRequest({
      model: "claude-sonnet-5", max_tokens: 100,
      system: [text("s1")],
      messages: [
        { role: "user", content: text("u1", { cache_control: CC }) },
        { role: "assistant", content: [text("a1")] },
        { role: "user", content: [text("q")] },
      ],
    }, "claude");
    const kept = out.messages.filter(m => JSON.stringify(m.content).includes("u1"));
    expect(kept.length).toBe(1);
    expect(kept[0].content).toHaveLength(1);
    expect(kept[0].content[0].cache_control).toBeUndefined();
  });

  it("drops no conversation turn when content is a single text object", () => {
    const out = prepareClaudeRequest({
      model: "claude-sonnet-5", max_tokens: 100,
      messages: [
        { role: "user", content: text("u1") },
        { role: "assistant", content: text("a1") },
        { role: "user", content: [text("q")] },
      ],
    }, "claude");
    expect(out.messages.length).toBe(3);
    expect(Array.isArray(out.messages[0].content)).toBe(true);
  });

  it("re-anchors the last assistant turn even when it uses single-object content", () => {
    const out = prepareClaudeRequest({
      model: "claude-sonnet-5", max_tokens: 100,
      messages: [
        { role: "user", content: [text("u1")] },
        { role: "assistant", content: text("a1") },
        { role: "user", content: [text("q")] },
      ],
    }, "claude");
    expect(countMarkers(out)).toBe(1);
  });

  it("keeps single-object turns on the claude-to-openai leg", () => {
    const out = claudeToOpenAIRequest("m", {
      messages: [
        { role: "user", content: text("u1") },
        { role: "assistant", content: { type: "image", source: { type: "base64", media_type: "image/png", data: "iVBORw0KGgo=" } } },
      ],
    }, false);
    expect(out.messages.some(m => JSON.stringify(m.content).includes("u1"))).toBe(true);
    const img = out.messages.find(m => m.role === "assistant");
    expect(JSON.stringify(img.content)).toContain("image_url");
  });

  it("keeps a bare-object user turn folded with a mid-conversation system message", () => {
    const body = {
      messages: [
        { role: "user", content: text("u1") },
        { role: "system", content: [text("reminder")] },
        { role: "user", content: [text("q")] },
      ],
    };
    normalizeClaudePassthrough(body);
    // After normalizeClaudePassthrough: system messages are hoisted to body.system,
    // and bare-object content is wrapped as array. The user message should still
    // contain "u1" text.
    const hasU1 = body.messages.some(m =>
      JSON.stringify(m.content).includes("u1")
    );
    expect(hasU1).toBe(true);
    // System reminder should be hoisted to body.system
    const hasReminder = JSON.stringify(body.system || "").includes("reminder");
    expect(hasReminder).toBe(true);
  });

  // Fork model: prepareClaudeRequest strips all client markers in Pass 1,
  // re-anchors to system last + tool last + last assistant (max 3).
  // Budget guard ensures it never exceeds 4 even with surviving markers.
  it("never exceeds four markers after re-anchor", () => {
    const out = prepareClaudeRequest({
      model: "claude-sonnet-5", max_tokens: 100,
      system: [text("s1", { cache_control: CC }), text("s2", { cache_control: CC })],
      tools: [tool("t1", { cache_control: CC }), tool("t2", { cache_control: CC })],
      messages: [
        { role: "user", content: [text("u1", { cache_control: CC })] },
        { role: "assistant", content: [text("a1", { cache_control: CC })] },
        { role: "user", content: [text("q")] },
      ],
    }, "claude");
    expect(countMarkers(out)).toBeLessThanOrEqual(4);
  });

  it("keeps the 1h head anchors when the client spent the whole budget", () => {
    const out = prepareClaudeRequest({
      model: "claude-sonnet-5", max_tokens: 100,
      system: [text("s1"), text("s2", { cache_control: CC })],
      tools: [tool("t1", { cache_control: CC }), tool("t2")],
      messages: [
        { role: "user", content: [text("u1", { cache_control: CC })] },
        { role: "assistant", content: [text("a1", { cache_control: CC })] },
        { role: "user", content: [text("q")] },
      ],
    }, "claude");
    expect(countMarkers(out)).toBeLessThanOrEqual(4);
    expect(out.system.at(-1).cache_control?.ttl).toBe("1h");
    expect(out.tools.at(-1).cache_control?.ttl).toBe("1h");
  });

  it("keeps the 1h head anchors on an over-budget body", () => {
    const out = prepareClaudeRequest({
      model: "claude-sonnet-5", max_tokens: 100,
      system: [text("s1", { cache_control: CC })],
      tools: [tool("t1", { cache_control: CC }), tool("t2")],
      messages: [
        { role: "user", content: [text("u1", { cache_control: CC })] },
        { role: "assistant", content: [text("a1", { cache_control: CC })] },
        { role: "user", content: [text("u2", { cache_control: CC })] },
        { role: "assistant", content: [text("a2", { cache_control: CC })] },
        { role: "user", content: [text("q")] },
      ],
    }, "claude");
    expect(countMarkers(out)).toBeLessThanOrEqual(4);
    expect(out.system.at(-1).cache_control?.ttl).toBe("1h");
    expect(out.tools.at(-1).cache_control?.ttl).toBe("1h");
  });

  it("strips a marker from a deferred tool even when the budget is spent", () => {
    const out = prepareClaudeRequest({
      model: "claude-sonnet-5", max_tokens: 100,
      system: [text("s1", { cache_control: CC })],
      tools: [tool("t1", { cache_control: CC, defer_loading: true })],
      messages: [
        { role: "user", content: [text("u1", { cache_control: CC })] },
        { role: "assistant", content: [text("a1", { cache_control: CC })] },
        { role: "user", content: [text("q")] },
      ],
    }, "claude");
    expect(countMarkers(out)).toBeLessThanOrEqual(4);
    const deferred = out.tools.find(t => t.defer_loading);
    expect(deferred?.cache_control).toBeUndefined();
  });

  it("keeps a bare-object system reminder on the claude-to-openai leg", () => {
    const out = claudeToOpenAIRequest("m", {
      messages: [
        { role: "user", content: "hi" },
        { role: "system", content: text("be brief") },
      ],
    }, false);
    expect(JSON.stringify(out.messages)).toContain("be brief");
  });
});
