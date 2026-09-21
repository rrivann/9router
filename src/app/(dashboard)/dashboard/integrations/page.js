"use client";

import { useEffect, useMemo, useState } from "react";
import PropTypes from "prop-types";
import { Card, Button, Input, Badge, Modal } from "@/shared/components";
import { useCopyToClipboard } from "@/shared/hooks/useCopyToClipboard";

const ICONS = {
  claude: "smart_toy",
  cowork: "groups",
  openclaw: "raven",
  opencode: "code",
  hermes: "hub",
  codex: "terminal",
};

export default function IntegrationsPage() {
  const [integrations, setIntegrations] = useState(null);
  const [gateway, setGateway] = useState({ baseUrl: "", apiKey: "" });
  const [active, setActive] = useState(null);
  const [models, setModels] = useState([]);
  const [error, setError] = useState("");

  useEffect(() => {
    fetch("/api/integrations")
      .then((r) => r.json())
      .then((data) => {
        if (data.error) setError(data.error);
        else {
          setIntegrations(data.integrations || []);
          setGateway(data.gateway || { baseUrl: "", apiKey: "" });
        }
      })
      .catch((e) => setError(e.message));

    fetch("/api/v1/models")
      .then((r) => r.json())
      .then((data) => setModels((data?.data || []).map((m) => m.id)))
      .catch(() => setModels([]));
  }, []);

  return (
    <div className="flex flex-col gap-4">
      <GatewayCard gateway={gateway} />

      {error && (
        <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-600 dark:text-red-300">
          {error}
        </div>
      )}

      {!integrations ? (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {[0, 1, 2, 3, 4, 5].map((i) => (
            <div
              key={i}
              className="h-[140px] animate-pulse rounded-[14px] border border-border-subtle bg-surface"
            />
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {integrations.map((t) => (
            <ToolCard key={t.key} tool={t} onConnect={() => setActive(t)} />
          ))}
        </div>
      )}

      {active && (
        <ConnectModal
          tool={active}
          gateway={gateway}
          allModels={models}
          onClose={() => setActive(null)}
        />
      )}
    </div>
  );
}

function GatewayCard({ gateway }) {
  const { copy, copied } = useCopyToClipboard(1500);
  const [reveal, setReveal] = useState(false);
  const shownKey = gateway.apiKey
    ? reveal
      ? gateway.apiKey
      : `${gateway.apiKey.slice(0, 8)}…${gateway.apiKey.slice(-4)}`
    : "no active key — create one in Endpoint & Key";

  return (
    <Card>
      <div className="flex items-center gap-2 mb-3">
        <span className="material-symbols-outlined text-primary">terminal</span>
        <h2 className="text-sm font-semibold">Your gateway endpoint</h2>
      </div>
      <div className="grid gap-2 sm:grid-cols-2">
        <Field label="Base URL" value={`${gateway.baseUrl}/v1`} onCopy={copy} copied={copied} />
        <Field
          label="API Key"
          value={shownKey}
          secret
          reveal={reveal}
          onReveal={() => setReveal((v) => !v)}
          onCopy={() => gateway.apiKey && copy(gateway.apiKey)}
          copied={copied}
        />
      </div>
      <p className="mt-2 text-xs text-text-muted">
        Connecting a tool means copying its config from the modal — nothing is
        written on your machine.
      </p>
    </Card>
  );
}

function Field({ label, value, secret, reveal, onReveal, onCopy, copied }) {
  return (
    <div className="flex items-center gap-2 rounded-lg border border-border-subtle bg-surface-2/50 px-2.5 py-1.5">
      <span className="shrink-0 text-xs text-text-muted">{label}</span>
      <code className="flex-1 truncate font-mono text-xs">{value}</code>
      {secret && (
        <button
          onClick={onReveal}
          className="shrink-0 text-xs text-text-muted hover:text-primary"
          type="button"
        >
          {reveal ? "hide" : "show"}
        </button>
      )}
      <button
        onClick={onCopy}
        className="shrink-0 rounded p-0.5 text-text-muted hover:bg-primary/10 hover:text-primary"
        type="button"
      >
        <span className="material-symbols-outlined text-[16px]">
          {copied ? "check" : "content_copy"}
        </span>
      </button>
    </div>
  );
}

Field.propTypes = {
  label: PropTypes.string.isRequired,
  value: PropTypes.string.isRequired,
  secret: PropTypes.bool,
  reveal: PropTypes.bool,
  onReveal: PropTypes.func,
  onCopy: PropTypes.func,
  copied: PropTypes.bool,
};

GatewayCard.propTypes = {
  gateway: PropTypes.shape({
    baseUrl: PropTypes.string,
    apiKey: PropTypes.string,
  }).isRequired,
};

function ToolCard({ tool, onConnect }) {
  const icon = ICONS[tool.key] || "extension";
  return (
    <Card>
      <div className="flex items-start gap-2.5">
        <span className="flex size-10 items-center justify-center rounded-xl bg-gradient-to-br from-brand-500 to-brand-700 text-white shadow-[var(--shadow-warm)]">
          <span className="material-symbols-outlined text-[22px]">{icon}</span>
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold">{tool.name}</p>
          <code className="text-[10px] text-text-muted">{tool.binary}</code>
        </div>
      </div>
      <div className="mt-2 flex flex-wrap gap-1">
        {tool.multiModel && (
          <Badge variant="default" size="sm">multi-model</Badge>
        )}
        {tool.configPaths.slice(0, 1).map((p) => (
          <code
            key={p}
            className="max-w-full truncate rounded bg-black/5 px-1 py-0.5 font-mono text-[10px] text-text-muted dark:bg-white/5"
            title={p}
          >
            {p}
          </code>
        ))}
      </div>
      <div className="mt-3">
        <Button size="sm" icon="link" onClick={onConnect} fullWidth>
          Connect
        </Button>
      </div>
    </Card>
  );
}

ToolCard.propTypes = {
  tool: PropTypes.shape({
    key: PropTypes.string.isRequired,
    name: PropTypes.string.isRequired,
    binary: PropTypes.string,
    multiModel: PropTypes.bool,
    configPaths: PropTypes.arrayOf(PropTypes.string).isRequired,
  }).isRequired,
  onConnect: PropTypes.func.isRequired,
};

function ConnectModal({ tool, gateway, allModels, onClose }) {
  const [selected, setSelected] = useState([]);
  const [query, setQuery] = useState("");
  const [snippets, setSnippets] = useState(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (q ? allModels.filter((m) => m.toLowerCase().includes(q)) : allModels).slice(0, 60);
  }, [allModels, query]);

  const toggle = (m) => {
    setSnippets(null);
    setSelected((s) => {
      if (tool.multiModel) {
        return s.includes(m) ? s.filter((x) => x !== m) : [...s, m];
      }
      return [m];
    });
  };

  const generate = async () => {
    if (selected.length === 0) {
      setErr("Pick at least one model.");
      return;
    }
    setBusy(true);
    setErr("");
    try {
      const r = await fetch(`/api/integrations/${tool.key}/snippet`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          baseUrl: gateway.baseUrl,
          apiKey: gateway.apiKey,
          models: selected,
        }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || "Failed to generate");
      setSnippets(data.snippets || []);
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal isOpen title={`Connect ${tool.name}`} onClose={onClose} size="lg">
      <div className="flex flex-col gap-3">
        <p className="text-xs text-text-muted">
          {tool.multiModel
            ? "Pick one or more models — the snippet will register all of them."
            : "Pick one model — it'll be the default in the snippet."}
        </p>

        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search models…"
          className="text-xs"
        />

        <div className="max-h-52 overflow-auto rounded-lg border border-border-subtle bg-surface-2/40 p-1.5">
          {filtered.length === 0 ? (
            <div className="p-2 text-xs text-text-muted">No models found.</div>
          ) : (
            filtered.map((m) => {
              const on = selected.includes(m);
              return (
                <button
                  key={m}
                  onClick={() => toggle(m)}
                  className={`flex w-full items-center gap-2 rounded px-2 py-1 text-left text-xs transition-colors ${
                    on
                      ? "bg-primary/10 text-primary"
                      : "text-text-main hover:bg-black/5 dark:hover:bg-white/5"
                  }`}
                  type="button"
                >
                  <span
                    className={`flex size-3.5 items-center justify-center rounded ${
                      on ? "bg-primary text-white" : "border border-border"
                    }`}
                  >
                    {on && (
                      <span className="material-symbols-outlined text-[10px]">check</span>
                    )}
                  </span>
                  <code className="flex-1 truncate font-mono">{m}</code>
                </button>
              );
            })
          )}
        </div>

        {err && (
          <p className="text-xs text-red-500">{err}</p>
        )}

        <Button
          onClick={generate}
          disabled={busy || selected.length === 0}
          icon={busy ? "progress_activity" : "code_blocks"}
          fullWidth
        >
          {busy ? "Generating…" : "Generate config snippet"}
        </Button>

        {snippets && snippets.length > 0 && (
          <div className="flex flex-col gap-2">
            {snippets.map((s) => (
              <SnippetBlock key={s.path} snippet={s} />
            ))}
          </div>
        )}
      </div>
    </Modal>
  );
}

ConnectModal.propTypes = {
  tool: PropTypes.shape({
    key: PropTypes.string.isRequired,
    name: PropTypes.string.isRequired,
    multiModel: PropTypes.bool,
  }).isRequired,
  gateway: PropTypes.shape({
    baseUrl: PropTypes.string,
    apiKey: PropTypes.string,
  }).isRequired,
  allModels: PropTypes.arrayOf(PropTypes.string).isRequired,
  onClose: PropTypes.func.isRequired,
};

function SnippetBlock({ snippet }) {
  const { copy, copied } = useCopyToClipboard(1500);
  return (
    <div className="rounded-lg border border-border-subtle bg-surface-2/40">
      <div className="flex items-center justify-between border-b border-border-subtle px-2.5 py-1.5">
        <code className="truncate text-[10px] text-text-muted" title={snippet.path}>
          {snippet.path}
        </code>
        <div className="flex items-center gap-1.5">
          <Badge variant="default" size="sm">{snippet.format}</Badge>
          <button
            onClick={() => copy(snippet.content)}
            className="flex items-center gap-1 rounded bg-primary/10 px-1.5 py-0.5 text-[10px] text-primary hover:bg-primary/20"
            type="button"
          >
            <span className="material-symbols-outlined text-[12px]">
              {copied ? "check" : "content_copy"}
            </span>
            {copied ? "Copied" : "Copy"}
          </button>
        </div>
      </div>
      <pre className="max-h-56 overflow-auto px-2.5 py-1.5 text-[11px] leading-snug text-text-main">
        {snippet.content}
      </pre>
    </div>
  );
}

SnippetBlock.propTypes = {
  snippet: PropTypes.shape({
    path: PropTypes.string.isRequired,
    format: PropTypes.string,
    content: PropTypes.string.isRequired,
  }).isRequired,
};
