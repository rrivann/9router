import { describe, it, expect, vi, beforeEach } from "vitest";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const repoFile = (rel) => path.join(REPO_ROOT, rel);

// ============================================================
// AUDIT-002 (#1962): API key masking in usage stats
// ============================================================
describe("AUDIT-002: API key masking", () => {
  it("source should contain maskApiKey function", () => {
    const source = fs.readFileSync(
      repoFile("src/lib/db/repos/usageRepo.js"),
      "utf-8"
    );
    expect(source).toContain("function maskApiKey");
  });

  it("getUsageHistory should use apiKeyMasked instead of apiKey", () => {
    const source = fs.readFileSync(
      repoFile("src/lib/db/repos/usageRepo.js"),
      "utf-8"
    );
    // The REST response should use apiKeyMasked
    expect(source).toContain("apiKeyMasked: maskApiKey(r.apiKey)");
    // The return mapping in getUsageHistory should not have raw apiKey
    // (The internal ring buffer still uses apiKey: r.apiKey for internal state - that's fine)
    const historyReturn = source.match(/return rows\.map\(\(r\)\s*=>\s*\(\{[\s\S]*?\}\)\);/);
    expect(historyReturn).not.toBeNull();
    expect(historyReturn[0]).toContain("apiKeyMasked");
    expect(historyReturn[0]).not.toContain("apiKey: r.apiKey");
  });

  it("getUsageStats should use apiKeyMasked in byApiKey entries", () => {
    const source = fs.readFileSync(
      repoFile("src/lib/db/repos/usageRepo.js"),
      "utf-8"
    );
    // Both code paths (daily summary + 24h live) should use apiKeyMasked
    const maskedCount = (source.match(/apiKeyMasked/g) || []).length;
    expect(maskedCount).toBeGreaterThanOrEqual(4); // function def + 3 usage sites

    // The byApiKey stats entries should use apiKeyMasked, not raw apiKey
    // Check the daily summary path
    const dailyPath = source.match(/stats\.byApiKey\[akKey\] = \{[^}]*apiKeyMasked[^}]*\}/);
    expect(dailyPath).not.toBeNull();
    // Check the 24h live path
    const livePath = source.match(/stats\.byApiKey\[akKey\] = \{[^}]*apiKeyMasked[^}]*\}/g);
    expect(livePath).not.toBeNull();
    expect(livePath.length).toBeGreaterThanOrEqual(1);
  });

  it("byApiKey object keys should use masked key, not raw key", () => {
    const source = fs.readFileSync(
      repoFile("src/lib/db/repos/usageRepo.js"),
      "utf-8"
    );
    // The 24h path should use apiKeyMasked in the akKey template
    expect(source).toContain("${apiKeyMasked}|${r.model}|${r.provider");
    // Should NOT use raw r.apiKey in the key
    expect(source).not.toContain("${r.apiKey}|${r.model}|${r.provider");
  });
});

// ============================================================
// AUDIT-003 (#1961): Proxy URL validation
// ============================================================
describe("AUDIT-003: Proxy URL validation", () => {
  beforeEach(() => {
    delete process.env.HTTP_PROXY;
    delete process.env.HTTPS_PROXY;
    delete process.env.ALL_PROXY;
    delete process.env.NINE_ROUTER_PROXY_MANAGED;
    delete process.env.NINE_ROUTER_PROXY_URL;
    delete process.env.NINE_ROUTER_NO_PROXY;
    delete process.env.NO_PROXY;
  });

  it("source should contain validateProxyUrl function", () => {
    const source = fs.readFileSync(
      repoFile("src/lib/network/outboundProxy.js"),
      "utf-8"
    );
    expect(source).toContain("function validateProxyUrl");
    expect(source).toContain("ALLOWED_PROXY_SCHEMES");
  });

  it("should accept valid http proxy URLs", async () => {
    vi.resetModules();
    const { applyOutboundProxyEnv } = await import("../../src/lib/network/outboundProxy.js");
    applyOutboundProxyEnv({
      outboundProxyEnabled: true,
      outboundProxyUrl: "http://proxy.example.com:8080",
    });
    // new URL().href normalizes (adds trailing slash)
    expect(process.env.HTTP_PROXY).toContain("http://proxy.example.com:8080");
    expect(process.env.HTTPS_PROXY).toContain("http://proxy.example.com:8080");
  });

  it("should accept valid https proxy URLs", async () => {
    vi.resetModules();
    const { applyOutboundProxyEnv } = await import("../../src/lib/network/outboundProxy.js");
    applyOutboundProxyEnv({
      outboundProxyEnabled: true,
      outboundProxyUrl: "https://proxy.example.com:443",
    });
    // new URL().href normalizes (drops default port 443, adds trailing slash)
    expect(process.env.HTTP_PROXY).toContain("https://proxy.example.com");
  });

  it("should accept valid socks5 proxy URLs", async () => {
    vi.resetModules();
    const { applyOutboundProxyEnv } = await import("../../src/lib/network/outboundProxy.js");
    applyOutboundProxyEnv({
      outboundProxyEnabled: true,
      outboundProxyUrl: "socks5://proxy.example.com:1080",
    });
    expect(process.env.ALL_PROXY).toBe("socks5://proxy.example.com:1080");
  });

  it("should reject URLs with shell metacharacters (newline)", async () => {
    vi.resetModules();
    const { applyOutboundProxyEnv } = await import("../../src/lib/network/outboundProxy.js");
    applyOutboundProxyEnv({
      outboundProxyEnabled: true,
      outboundProxyUrl: "http://proxy.example.com:8080\nmalicious",
    });
    expect(process.env.HTTP_PROXY).toBeUndefined();
  });

  it("should reject URLs with shell metacharacters (backtick)", async () => {
    vi.resetModules();
    const { applyOutboundProxyEnv } = await import("../../src/lib/network/outboundProxy.js");
    applyOutboundProxyEnv({
      outboundProxyEnabled: true,
      outboundProxyUrl: "http://`whoami`.example.com:8080",
    });
    expect(process.env.HTTP_PROXY).toBeUndefined();
  });

  it("should reject URLs with shell metacharacters (dollar)", async () => {
    vi.resetModules();
    const { applyOutboundProxyEnv } = await import("../../src/lib/network/outboundProxy.js");
    applyOutboundProxyEnv({
      outboundProxyEnabled: true,
      outboundProxyUrl: "http://$(whoami).example.com:8080",
    });
    expect(process.env.HTTP_PROXY).toBeUndefined();
  });

  it("should reject non-allowed schemes (file://)", async () => {
    vi.resetModules();
    const { applyOutboundProxyEnv } = await import("../../src/lib/network/outboundProxy.js");
    applyOutboundProxyEnv({
      outboundProxyEnabled: true,
      outboundProxyUrl: "file:///etc/passwd",
    });
    expect(process.env.HTTP_PROXY).toBeUndefined();
  });

  it("should reject non-allowed schemes (javascript:)", async () => {
    vi.resetModules();
    const { applyOutboundProxyEnv } = await import("../../src/lib/network/outboundProxy.js");
    applyOutboundProxyEnv({
      outboundProxyEnabled: true,
      outboundProxyUrl: "javascript:alert(1)",
    });
    expect(process.env.HTTP_PROXY).toBeUndefined();
  });
});

// AUDIT-001, AUDIT-004, AUDIT-018 covered code paths that were removed with
// the MITM manager and OAuth callback server; their describe blocks were
// dropped rather than re-pointed.
