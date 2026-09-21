"use client";

import { useEffect, useMemo, useState } from "react";
import PropTypes from "prop-types";
import { Card, Input, Badge, Button } from "@/shared/components";
import { useCopyToClipboard } from "@/shared/hooks/useCopyToClipboard";

// Owner badge palette — keyed by owned_by so each vendor reads distinctly.
const OWNER_VARIANT = {
  anthr0pic: "warning",
  openai: "success",
  google: "info",
  deepseek: "default",
  zhipu: "default",
  moonshot: "default",
  minimax: "default",
  tencent: "primary",
  bytedance: "default",
};

function formatTokens(n) {
  if (!n) return "—";
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(n % 1_000_000 === 0 ? 0 : 1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(n % 1_000 === 0 ? 0 : 1)}K`;
  return String(n);
}

export default function ModelsPage() {
  const [models, setModels] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [search, setSearch] = useState("");
  const [provider, setProvider] = useState("all");
  const [kind, setKind] = useState("all");

  const load = () => {
    setLoading(true);
    fetch("/api/models/catalog")
      .then((r) => r.json())
      .then((data) => {
        if (data?.error) setError(data.error);
        else {
          setModels(data?.data || []);
          setError(null);
        }
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  };

  useEffect(() => { load(); }, []);

  const providers = useMemo(
    () => [...new Set(models.map((m) => m.providerAlias))].sort(),
    [models],
  );

  // Scope kind counts to the currently-selected provider so pills reflect
  // what actually appears in the table when a provider filter is active.
  const kindCounts = useMemo(() => {
    const scoped = provider === "all" ? models : models.filter((m) => m.providerAlias === provider);
    const c = { all: scoped.length, chat: 0, image: 0, video: 0 };
    for (const m of scoped) {
      const k = m.kind || "chat";
      if (c[k] !== undefined) c[k] += 1;
    }
    return c;
  }, [models, provider]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const rows = models.filter((m) => {
      if (provider !== "all" && m.providerAlias !== provider) return false;
      if (kind !== "all" && (m.kind || "chat") !== kind) return false;
      if (!q) return true;
      return (
        m.id.toLowerCase().includes(q) ||
        m.name.toLowerCase().includes(q) ||
        (m.owned_by || "").toLowerCase().includes(q)
      );
    });
    return rows.sort((a, b) => {
      const oa = a.owned_by || "zzz";
      const ob = b.owned_by || "zzz";
      if (oa !== ob) return oa.localeCompare(ob);
      return a.id.localeCompare(b.id);
    });
  }, [models, search, provider, kind]);

  // Group filtered rows by provider so we can render section headers.
  const grouped = useMemo(() => {
    const byProvider = new Map();
    for (const m of filtered) {
      const key = m.providerAlias;
      if (!byProvider.has(key)) byProvider.set(key, { alias: key, name: m.providerName, models: [] });
      byProvider.get(key).models.push(m);
    }
    return [...byProvider.values()].sort((a, b) => a.name.localeCompare(b.name));
  }, [filtered]);

  const freeModels = useMemo(
    () => models.filter((m) => m.credit_multiplier === 0),
    [models],
  );

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-xs text-text-muted">
            {loading
              ? "Loading catalog…"
              : `${models.length} models available across ${providers.length} ${providers.length === 1 ? "provider" : "providers"}`}
          </p>
        </div>
        <Button variant="secondary" size="sm" icon="refresh" onClick={load} disabled={loading}>
          Refresh
        </Button>
      </div>

      {error && (
        <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-600 dark:text-red-300">
          {error}
        </div>
      )}

      {freeModels.length > 0 && (
        <div className="rounded-lg border border-green-500/30 bg-green-500/5 px-4 py-3">
          <p className="text-xs font-semibold text-green-700 dark:text-green-400">
            🆓 {freeModels.length} model{freeModels.length === 1 ? "" : "s"} free right now (0x credits)
          </p>
          <div className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1 text-xs text-text-muted">
            {freeModels.map((m) => (
              <span key={m.id}>
                <code className="text-green-700 dark:text-green-400">{m.id.split("/")[1] || m.id}</code>
              </span>
            ))}
          </div>
        </div>
      )}

      <div className="relative">
        <span className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-[18px] text-text-muted">search</span>
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search models, owners…"
          className="pl-9"
        />
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <div className="flex flex-wrap items-center gap-1.5">
          {["all", ...providers].map((p) => (
            <FilterPill key={p} active={provider === p} onClick={() => setProvider(p)}>
              {p === "all" ? "All" : p}
            </FilterPill>
          ))}
        </div>
        <span className="text-xs text-text-muted">·</span>
        <div className="flex flex-wrap items-center gap-1.5">
          {["all", "chat", "image", "video"].map((k) => (
            <FilterPill key={k} active={kind === k} onClick={() => setKind(k)}>
              {k === "all" ? "All Kinds" : k[0].toUpperCase() + k.slice(1)} ({kindCounts[k]})
            </FilterPill>
          ))}
        </div>
      </div>

      {filtered.length === 0 && (
        <Card>
          <div className="px-3 py-8 text-center text-xs text-text-muted">
            {loading ? "Loading…" : "No models match"}
          </div>
        </Card>
      )}

      {grouped.map((group) => (
        <Card key={group.alias}>
          <div className="mb-2 flex items-baseline justify-between gap-2">
            <h2 className="text-sm font-semibold text-text-main">{group.name}</h2>
            <span className="text-[10px] uppercase tracking-wider text-text-muted">
              {group.models.length} model{group.models.length === 1 ? "" : "s"} · <code className="rounded bg-black/5 px-1 dark:bg-white/5">{group.alias}/*</code>
            </span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border-subtle text-left text-xs uppercase tracking-wide text-text-muted">
                  <th className="px-3 py-2.5">Model</th>
                  <th className="px-3 py-2.5">Owner</th>
                  <th className="px-3 py-2.5 text-right">Context</th>
                  <th className="px-3 py-2.5 text-right">Output</th>
                  <th className="px-3 py-2.5 text-right">Credits</th>
                  <th className="px-3 py-2.5">Features</th>
                  <th className="px-3 py-2.5 text-right w-8"><span className="sr-only">Copy</span></th>
                </tr>
              </thead>
              <tbody>
                {group.models.map((m) => {
                  const name = m.id.split("/").slice(1).join("/");
                  return (
                    <tr key={m.id} className="border-b border-border-subtle/60 last:border-0 hover:bg-black/[0.02] dark:hover:bg-white/[0.02]">
                      <td className="px-3 py-2">
                        <div className="flex flex-col">
                          <code className="text-sm">{name}</code>
                          {m.name && m.name !== name && (
                            <span className="text-[10px] text-text-muted">{m.name}</span>
                          )}
                        </div>
                      </td>
                      <td className="px-3 py-2">
                        {m.owned_by ? (
                          <Badge variant={OWNER_VARIANT[m.owned_by] || "default"} size="sm">
                            {m.owned_by}
                          </Badge>
                        ) : (
                          <span className="text-xs text-text-muted">—</span>
                        )}
                      </td>
                      <td className="px-3 py-2 text-right font-mono text-xs text-text-muted">
                        {formatTokens(m.max_input_tokens)}
                      </td>
                      <td className="px-3 py-2 text-right font-mono text-xs text-text-muted">
                        {formatTokens(m.max_output_tokens)}
                      </td>
                      <td className="px-3 py-2 text-right font-mono text-xs">
                        {m.credit_multiplier === null ? (
                          <span className="text-text-muted">—</span>
                        ) : m.credit_multiplier === 0 ? (
                          <span className="text-green-600 dark:text-green-400" title="Free — no credits">🆓 0x</span>
                        ) : (
                          <span className="text-text-main">×{m.credit_multiplier}</span>
                        )}
                      </td>
                      <td className="px-3 py-2">
                        <div className="flex flex-wrap items-center gap-1">
                          {m.kind === "image" && <Badge variant="primary" size="sm">Image</Badge>}
                          {m.kind === "video" && <Badge variant="primary" size="sm">Video</Badge>}
                          {(m.modalities || []).includes("image") && (
                            <Badge variant="default" size="sm" title="Accepts image input (multimodal)">Vision</Badge>
                          )}
                          {m.thinking && (
                            <Badge
                              variant="success"
                              size="sm"
                              title={m.thinking_toggle === "canDisable" ? "Reasoning can be disabled" : "Reasoning always on"}
                            >
                              {Array.isArray(m.reasoning_levels) && m.reasoning_levels.length > 0
                                ? `Reasoning · ${m.reasoning_levels.join("/")}`
                                : "Reasoning"}
                            </Badge>
                          )}
                          {m.tool_calls && <Badge variant="default" size="sm" title="Tool calling">Tools</Badge>}
                        </div>
                      </td>
                      <td className="px-3 py-2 text-right">
                        <CopyButton value={m.id} />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>
      ))}

      <p className="text-xs text-text-muted">
        Address a model as{" "}
        <code className="rounded bg-black/5 px-1 py-0.5 dark:bg-white/5">provider/model</code>{" "}
        in your client — e.g.{" "}
        <code className="rounded bg-black/5 px-1 py-0.5 dark:bg-white/5">
          {filtered[0]?.id || "cb/claude-opus-5"}
        </code>
      </p>
    </div>
  );
}

function FilterPill({ active, onClick, children }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-md border px-2.5 py-1 text-xs transition-colors ${
        active
          ? "border-primary/50 bg-primary/10 text-primary"
          : "border-border-subtle text-text-muted hover:bg-black/5 hover:text-text-main dark:hover:bg-white/5"
      }`}
    >
      {children}
    </button>
  );
}

FilterPill.propTypes = {
  active: PropTypes.bool,
  onClick: PropTypes.func.isRequired,
  children: PropTypes.node.isRequired,
};

function CopyButton({ value }) {
  const { copied, copy } = useCopyToClipboard(1500);
  return (
    <button
      type="button"
      onClick={() => copy(value)}
      title={`Copy ${value}`}
      className="rounded p-1 text-text-muted hover:bg-primary/10 hover:text-primary"
    >
      <span className="material-symbols-outlined text-[14px]">
        {copied ? "check" : "content_copy"}
      </span>
    </button>
  );
}

CopyButton.propTypes = {
  value: PropTypes.string.isRequired,
};
