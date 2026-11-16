import { useState } from "react";

import { getNetCheck, type NetCheck } from "@/lib/aero/api";

/**
 * "Check connection": shows which online services the computer running the API can reach, and
 * whether the OpenAQ key is set. A blocked network and a missing key look the same on screen
 * ("no data"), so this tells them apart.
 */
export function ConnectionCheck({ className }: { className?: string }) {
  const [result, setResult] = useState<NetCheck | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run() {
    setBusy(true);
    setError(null);
    try {
      setResult(await getNetCheck());
    } catch {
      setResult(null);
      setError(
        "The AeroHealth API on this computer is not answering. Make sure the backend is running (uvicorn on port 8000) and that VITE_API_URL points to it.",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={className}>
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => void run()}
          disabled={busy}
          className="press rounded-lg border border-hairline px-2 py-1 text-[10px] text-foreground transition-colors hover:bg-primary/10 disabled:opacity-60"
        >
          {busy ? "checking…" : "Check connection"}
        </button>
        <span className="num text-[9px] text-muted-foreground">
          shows which online services this network lets through
        </span>
      </div>
      {error ? <p className="mt-2 text-[11px] text-amber-300">{error}</p> : null}
      {result ? (
        <ul className="mt-2 space-y-1 text-[11px]">
          {result.config ? (
            <li className="flex flex-wrap items-baseline gap-x-2">
              <span className={result.config.openaq_key ? "text-emerald-400" : "text-red-400"}>
                {result.config.openaq_key ? "✓" : "✕"}
              </span>
              <span className="text-foreground">OpenAQ API key</span>
              <span className="num text-[9px] text-muted-foreground">
                {result.config.openaq_key
                  ? "set"
                  : "not set on the API: copy .env.example to .env in aerohealth-api, add the key, restart the API"}
              </span>
            </li>
          ) : null}
          {result.services.map((service) => (
            <li key={service.host} className="flex flex-wrap items-baseline gap-x-2">
              <span className={service.ok ? "text-emerald-400" : "text-red-400"}>
                {service.ok ? "✓" : "✕"}
              </span>
              <span className="text-foreground">{service.name}</span>
              <span className="num text-[9px] text-muted-foreground">
                {service.host} · {service.detail}
                {service.ok ? ` · ${service.ms} ms` : ""}
              </span>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
