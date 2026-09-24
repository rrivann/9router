// CodeBuddy Global realm resolver — one provider (`codebuddy`) can serve two
// realms because codebuddy.ai and workbuddy.ai share API surface. Tokens are
// realm-bound: a JWT issued for workbuddy must ship `X-Domain: www.workbuddy.ai`
// and hit `https://www.workbuddy.ai`. Explicit per-connection setting wins;
// otherwise we sniff the JWT `iss` claim and fall back to codebuddy.
//
// User-facing toggle lives on the connection: providerSpecificData.realm =
// "codebuddy" | "workbuddy".

import { jwtClaim } from "../utils/jwtSub.js";

export const REALMS = Object.freeze({
  CODEBUDDY: "codebuddy",
  WORKBUDDY: "workbuddy",
});

const REALM_CONFIG = Object.freeze({
  codebuddy: {
    id: "codebuddy",
    baseUrl: "https://www.codebuddy.ai",
    domain: "www.codebuddy.ai",
    userAgent: "CLI/2.144.0 CodeBuddy/2.144.0",
    ideName: "CLI",
    ideType: "CLI",
    ideVersion: "2.144.0",
    extName: "@tencent-ai/codebuddy-code",
    extVersion: "2.144.0",
  },
  workbuddy: {
    id: "workbuddy",
    baseUrl: "https://www.workbuddy.ai",
    domain: "www.workbuddy.ai",
    userAgent: "workbuddy-ai/5.5.2 workbuddy-ai/5.5.2 CLI/2.137.1",
    ideName: "WorkBuddy",
    ideType: "WorkBuddy",
    ideVersion: "5.5.2",
    extName: "workbuddy-desktop",
    extVersion: "5.5.2",
  },
});

// Auto-detect realm from a JWT's `iss` claim. API keys (ck_/pt_) have no iss;
// return null so caller can fall through to the default.
function detectRealmFromToken(token) {
  if (!token) return null;
  const iss = jwtClaim(token, "iss");
  if (!iss) return null;
  if (iss.includes("workbuddy")) return REALMS.WORKBUDDY;
  if (iss.includes("codebuddy")) return REALMS.CODEBUDDY;
  return null;
}

// Resolve realm id from credentials. Precedence:
//   1. explicit providerSpecificData.realm setting
//   2. JWT iss claim of accessToken/apiKey
//   3. legacy providerSpecificData.domain override (workbuddy.ai substring)
//   4. default "codebuddy"
export function resolveRealm(credentials) {
  const explicit = credentials?.providerSpecificData?.realm;
  if (explicit === REALMS.WORKBUDDY || explicit === REALMS.CODEBUDDY) {
    return explicit;
  }
  const token = credentials?.accessToken || credentials?.apiKey || "";
  const fromToken = detectRealmFromToken(token);
  if (fromToken) return fromToken;
  const legacyDomain = credentials?.providerSpecificData?.domain;
  if (typeof legacyDomain === "string" && legacyDomain.includes("workbuddy")) {
    return REALMS.WORKBUDDY;
  }
  return REALMS.CODEBUDDY;
}

// Return the immutable transport config bundle for a realm id.
export function getRealmConfig(realmId) {
  const key = realmId === REALMS.WORKBUDDY ? "workbuddy" : "codebuddy";
  return REALM_CONFIG[key];
}

// Convenience: single-call resolve + config lookup.
export function resolveRealmConfig(credentials) {
  return getRealmConfig(resolveRealm(credentials));
}
