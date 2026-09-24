// JWT payload accessors — base64url-decode middle segment safely.
// Used to derive `X-User-Id` (sub) and realm (iss) for CodeBuddy accounts.
// API keys with `ck_`/`pt_` prefix are NOT JWTs — helpers return "" for those.

function decodePayload(token) {
  const parts = (token || "").split(".");
  if (parts.length !== 3) return null;
  try {
    const b64 = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    return JSON.parse(Buffer.from(b64, "base64").toString("utf8"));
  } catch {
    return null;
  }
}

export function jwtSub(token) {
  const payload = decodePayload(token);
  return (payload && typeof payload.sub === "string") ? payload.sub : "";
}

export function jwtClaim(token, claim) {
  const payload = decodePayload(token);
  if (!payload || typeof claim !== "string") return "";
  const value = payload[claim];
  return typeof value === "string" ? value : "";
}
