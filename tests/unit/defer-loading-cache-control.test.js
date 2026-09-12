/**
 * Regression: Anthropic rejects a tool that carries BOTH `defer_loading: true`
 * and `cache_control`:
 *
 *   [400] Tool 'mcp__x__y' cannot both defer_loading=true cache_control set.
 *         Tools defer_loading cannot use prompt caching.
 *
 * 9router anchors the 1h cache breakpoint on the LAST tool of the array with
 * no guard. Clients that speak MCP (Claude Code) put deferred tools at the
 * tail, so the anchor lands exactly on a tool that cannot be cached and the
 * request 400s before combo fallback can try the next hop.
 *
 * The fix anchors on the last tool that is NOT deferred, so prompt caching is
 * kept for the tools that can use it instead of being dropped wholesale.
 *
 * See: #3567.
 */

import { describe, it, expect } from "vitest";
import {
  lastCacheableToolIndex,
  prepareClaudeRequest,
} from "../../open-sse/translator/formats/claude.js";

const tool = (name, extra = {}) => ({
  name,
  description: "t",
  input_schema: { type: "object", properties: {} },
  ...extra,
});

describe("lastCacheableToolIndex (#3567)", () => {
  it("returns last index when no tool is deferred", () => {
    expect(lastCacheableToolIndex([tool("a"), tool("b"), tool("c")])).toBe(2);
  });

  it("skips trailing deferred tools to the last non-deferred", () => {
    expect(lastCacheableToolIndex([tool("a"), tool("b"), tool("mcp__x__y", { defer_loading: true })])).toBe(1);
  });

  it("returns -1 when every tool is deferred", () => {
    expect(lastCacheableToolIndex([tool("mcp__a", { defer_loading: true }), tool("mcp__b", { defer_loading: true })])).toBe(-1);
  });

  it("returns -1 for empty or non-array", () => {
    expect(lastCacheableToolIndex([])).toBe(-1);
    expect(lastCacheableToolIndex(null)).toBe(-1);
  });
});

describe("prepareClaudeRequest: deferred tail tool does not get the anchor (#3567)", () => {
  it("anchors on last non-deferred tool when tail is deferred", () => {
    const out = prepareClaudeRequest({
      model: "claude-sonnet-4.5",
      messages: [{ role: "user", content: "hi" }],
      tools: [tool("a"), tool("mcp__x__y", { defer_loading: true })],
    }, "claude");

    expect(out.tools).toHaveLength(2);
    expect(out.tools[1].cache_control).toBeUndefined();
    expect(out.tools[1].defer_loading).toBe(true);
    expect(out.tools[0].cache_control).toEqual({ type: "ephemeral", ttl: "1h" });
  });

  it("does not cache any tool when all are deferred", () => {
    const out = prepareClaudeRequest({
      model: "claude-sonnet-4.5",
      messages: [{ role: "user", content: "hi" }],
      tools: [tool("mcp__a", { defer_loading: true }), tool("mcp__b", { defer_loading: true })],
    }, "claude");

    expect(out.tools.every(t => t.cache_control === undefined)).toBe(true);
  });

  it("unchanged behaviour when no tool is deferred", () => {
    const out = prepareClaudeRequest({
      model: "claude-sonnet-4.5",
      messages: [{ role: "user", content: "hi" }],
      tools: [tool("a"), tool("b")],
    }, "claude");

    expect(out.tools[1].cache_control).toEqual({ type: "ephemeral", ttl: "1h" });
    expect(out.tools[0].cache_control).toBeUndefined();
  });
});
