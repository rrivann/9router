import { describe, it, expect } from "vitest";
import {
  REALMS,
  resolveRealm,
  getRealmConfig,
  resolveRealmConfig,
} from "../../open-sse/providers/realmResolver.js";

function makeJwt(payload) {
  const b64 = (obj) =>
    Buffer.from(JSON.stringify(obj))
      .toString("base64")
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "");
  return `${b64({ alg: "HS512", typ: "JWT" })}.${b64(payload)}.sig`;
}

describe("resolveRealm — precedence", () => {
  it("prefers __realmOverride (global setting) over everything else", () => {
    const creds = {
      __realmOverride: "workbuddy",
      providerSpecificData: { realm: "codebuddy" },
      accessToken: makeJwt({ iss: "www.codebuddy.ai" }),
    };
    expect(resolveRealm(creds)).toBe(REALMS.WORKBUDDY);
  });

  it("__realmOverride='codebuddy' forces codebuddy even for workbuddy JWT", () => {
    const creds = {
      __realmOverride: "codebuddy",
      accessToken: makeJwt({ iss: "www.workbuddy.ai" }),
    };
    expect(resolveRealm(creds)).toBe(REALMS.CODEBUDDY);
  });

  it("ignores unknown __realmOverride values (e.g. 'auto') and falls through", () => {
    const creds = {
      __realmOverride: "auto",
      accessToken: makeJwt({ iss: "www.workbuddy.ai" }),
    };
    expect(resolveRealm(creds)).toBe(REALMS.WORKBUDDY);
  });

  it("prefers explicit providerSpecificData.realm", () => {
    const creds = {
      providerSpecificData: { realm: "workbuddy" },
      accessToken: makeJwt({ iss: "www.codebuddy.ai" }),
    };
    expect(resolveRealm(creds)).toBe(REALMS.WORKBUDDY);
  });

  it("prefers explicit codebuddy realm over workbuddy JWT iss", () => {
    const creds = {
      providerSpecificData: { realm: "codebuddy" },
      accessToken: makeJwt({ iss: "www.workbuddy.ai" }),
    };
    expect(resolveRealm(creds)).toBe(REALMS.CODEBUDDY);
  });

  it("ignores unknown explicit realm and falls through to JWT sniff", () => {
    const creds = {
      providerSpecificData: { realm: "notarealm" },
      accessToken: makeJwt({ iss: "www.workbuddy.ai" }),
    };
    expect(resolveRealm(creds)).toBe(REALMS.WORKBUDDY);
  });

  it("auto-detects workbuddy realm from JWT iss", () => {
    const creds = { accessToken: makeJwt({ iss: "www.workbuddy.ai" }) };
    expect(resolveRealm(creds)).toBe(REALMS.WORKBUDDY);
  });

  it("auto-detects codebuddy realm from JWT iss", () => {
    const creds = { accessToken: makeJwt({ iss: "www.codebuddy.ai" }) };
    expect(resolveRealm(creds)).toBe(REALMS.CODEBUDDY);
  });

  it("checks apiKey field if accessToken absent", () => {
    const creds = { apiKey: makeJwt({ iss: "www.workbuddy.ai" }) };
    expect(resolveRealm(creds)).toBe(REALMS.WORKBUDDY);
  });

  it("honors legacy providerSpecificData.domain workbuddy substring", () => {
    const creds = { providerSpecificData: { domain: "www.workbuddy.ai" } };
    expect(resolveRealm(creds)).toBe(REALMS.WORKBUDDY);
  });

  it("defaults to codebuddy when nothing indicates otherwise", () => {
    expect(resolveRealm({})).toBe(REALMS.CODEBUDDY);
    expect(resolveRealm(null)).toBe(REALMS.CODEBUDDY);
    expect(resolveRealm({ apiKey: "ck_notajwt" })).toBe(REALMS.CODEBUDDY);
  });
});

describe("getRealmConfig", () => {
  it("returns codebuddy config with correct base URL + domain + UA", () => {
    const cfg = getRealmConfig(REALMS.CODEBUDDY);
    expect(cfg.baseUrl).toBe("https://www.codebuddy.ai");
    expect(cfg.domain).toBe("www.codebuddy.ai");
    expect(cfg.userAgent).toContain("CLI/2.144.0");
    expect(cfg.ideName).toBe("CLI");
    expect(cfg.extName).toBe("@tencent-ai/codebuddy-code");
  });

  it("returns workbuddy config with correct base URL + domain + UA", () => {
    const cfg = getRealmConfig(REALMS.WORKBUDDY);
    expect(cfg.baseUrl).toBe("https://www.workbuddy.ai");
    expect(cfg.domain).toBe("www.workbuddy.ai");
    expect(cfg.userAgent).toContain("workbuddy-ai/5.5.2");
    expect(cfg.ideName).toBe("WorkBuddy");
    expect(cfg.extName).toBe("workbuddy-desktop");
  });

  it("defaults unknown realm to codebuddy config", () => {
    const cfg = getRealmConfig("bogus");
    expect(cfg.id).toBe("codebuddy");
  });
});

describe("resolveRealmConfig — one-call convenience", () => {
  it("resolves + looks up in one call", () => {
    const cfg = resolveRealmConfig({
      accessToken: makeJwt({ iss: "www.workbuddy.ai" }),
    });
    expect(cfg.id).toBe("workbuddy");
    expect(cfg.baseUrl).toBe("https://www.workbuddy.ai");
  });
});
