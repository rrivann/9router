// Sudo password helper for tailscale sudo-required commands (Linux/macOS).
// Sourced from env var TUNNEL_SUDO_PASSWORD or the in-memory cache set at first use.
// Returns null on Windows or when unset — callers must tolerate missing password.

function getCachedPassword() {
  return globalThis.__tunnelSudoPassword || process.env.TUNNEL_SUDO_PASSWORD || null;
}

async function loadEncryptedPassword() {
  return getCachedPassword();
}

export { getCachedPassword, loadEncryptedPassword };
