import { describe, it, expect } from "vitest";
import { jwtSub, jwtClaim } from "../../open-sse/utils/jwtSub.js";

// Build a JWT with the given payload (header + payload + fake signature).
function makeJwt(payload) {
  const b64 = (obj) =>
    Buffer.from(JSON.stringify(obj))
      .toString("base64")
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "");
  return `${b64({ alg: "HS512", typ: "JWT" })}.${b64(payload)}.fake-signature`;
}

describe("jwtSub", () => {
  it("returns payload.sub for a valid JWT", () => {
    const token = makeJwt({ sub: "user-12345", iss: "www.codebuddy.ai" });
    expect(jwtSub(token)).toBe("user-12345");
  });

  it("returns empty string for ck_ API key", () => {
    expect(jwtSub("ck_abc123def456")).toBe("");
  });

  it("returns empty string for pt_ API key", () => {
    expect(jwtSub("pt_xyz789")).toBe("");
  });

  it("returns empty string for malformed input", () => {
    expect(jwtSub("not.a.jwt")).toBe("");
    expect(jwtSub("only-one-part")).toBe("");
    expect(jwtSub("")).toBe("");
    expect(jwtSub(null)).toBe("");
    expect(jwtSub(undefined)).toBe("");
  });

  it("returns empty string when sub claim is absent", () => {
    const token = makeJwt({ iss: "www.codebuddy.ai" });
    expect(jwtSub(token)).toBe("");
  });

  it("returns empty string when sub is not a string", () => {
    const token = makeJwt({ sub: 12345 });
    expect(jwtSub(token)).toBe("");
  });
});

describe("jwtClaim", () => {
  it("returns arbitrary claims from payload", () => {
    const token = makeJwt({ sub: "u1", iss: "www.workbuddy.ai", preferred_username: "alice" });
    expect(jwtClaim(token, "iss")).toBe("www.workbuddy.ai");
    expect(jwtClaim(token, "preferred_username")).toBe("alice");
  });

  it("returns empty string for absent claim", () => {
    const token = makeJwt({ sub: "u1" });
    expect(jwtClaim(token, "iss")).toBe("");
  });

  it("returns empty string for non-string claim values", () => {
    const token = makeJwt({ sub: "u1", counts: [1, 2] });
    expect(jwtClaim(token, "counts")).toBe("");
  });

  it("returns empty string for malformed input", () => {
    expect(jwtClaim("ck_abc", "iss")).toBe("");
    expect(jwtClaim("", "sub")).toBe("");
    expect(jwtClaim(null, "sub")).toBe("");
  });
});
