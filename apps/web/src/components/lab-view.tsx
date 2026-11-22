import { useEffect, useState } from "react";
import { api, type ServiceName, SERVICES, type Switches } from "../api.js";
import { usePoll } from "../hooks.js";
import { useAction } from "./toast.js";

const SCENARIOS = [
  "Decline or ignore an offer in the Driver tab: the next nearest driver gets it, and the radius grows when nobody is free.",
  "Open the rider and the driver on different gateways: locations still arrive (Redis pub/sub) and so do trip updates (Kafka, one group per gateway).",
  "Set pricing forceSurge to 2, or run `pnpm load:riders` near few drivers: the cell turns orange and quotes go up.",
  "Set matching paused on both instances: requests wait in mt:due; resume and they are offered.",
  "Set trip outboxPaused: trips are created but nobody hears about them until you resume.",
  "Stop driver-service: quotes still work with surge 1.0 (supply unknown) and matching retries.",
  "Set trip transitionDelayMs to 300 and accept from two tabs at once: one wins, the other sees TRIP_ALREADY_MATCHED.",
];

function Health() {
  const health = usePoll(() => Promise.all(SERVICES.map((s) => api.health(s))), 3000);
  return (
    <div className="card">
      <h2 className="mb-2 font-semibold">Services</h2>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {SERVICES.map((s, i) => {
          const h = health.data?.[i];
          const checks = Object.entries(h?.body ?? {}).filter(([, v]) => typeof v === "object") as [
            string,
            { ok: boolean; detail: string },
          ][];
          return (
            <div
              key={s}
              className={`rounded border p-2 text-xs ${h?.ok ? "border-green-300 bg-green-50" : "border-red-300 bg-red-50"}`}
              data-testid={`health-${s}`}
            >
              <div className="font-semibold">{s}</div>
              <div>
                {h
                  ? h.ok
                    ? "up"
                    : h.status === 0 || h.status === 502
                      ? "down"
                      : `HTTP ${h.status}`
                  : "..."}
              </div>
              {checks.map(([name, c]) => (
                <div key={name} className={c.ok ? "text-green-700" : "text-red-700"}>
                  {name}: {c.ok ? "ok" : c.detail}
                </div>
              ))}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function Stats() {
  const stats = usePoll(async () => {
    const pick: ServiceName[] = [
      "driver",
      "matching",
      "matching-2",
      "pricing",
      "trip",
      "gateway",
      "gateway-2",
      "rider",
    ];
    const results = await Promise.all(pick.map((s) => api.stats(s).catch(() => null)));
    const outbox = await api.outbox().catch(() => null);
    return { ...Object.fromEntries(pick.map((s, i) => [s, results[i]])), outbox } as Record<
      string,
      Record<string, unknown> | null
    >;
  }, 2000);
  return (
    <div className="card">
      <h2 className="mb-2 font-semibold">Counters</h2>
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {Object.entries(stats.data ?? {}).map(([name, value]) => (
          <div key={name} className="rounded border border-slate-200 p-2 text-xs">
            <div className="mb-1 font-semibold">{name}</div>
            <pre className="overflow-x-auto whitespace-pre-wrap">
              {value ? JSON.stringify(value, null, 1) : "unreachable"}
            </pre>
          </div>
        ))}
      </div>
    </div>
  );
}

function SwitchesPanel() {
  const run = useAction();
  const [service, setService] = useState<ServiceName>("matching");
  const [values, setValues] = useState<Switches | null>(null);
  const [draft, setDraft] = useState<Switches>({});
  const load = () =>
    void run(() => api.switches(service)).then((s) => {
      setValues(s ?? null);
      setDraft(s ?? {});
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(load, [service]);
  return (
    <div className="card flex flex-col gap-2">
      <h2 className="font-semibold">Switches</h2>
      <select
        className="input"
        value={service}
        onChange={(e) => setService(e.target.value as ServiceName)}
        aria-label="service"
      >
        {SERVICES.map((s) => (
          <option key={s}>{s}</option>
        ))}
      </select>
      {values && Object.keys(values).length === 0 && (
        <div className="text-sm text-slate-500">No switches.</div>
      )}
      {Object.entries(draft).map(([name, value]) => (
        <label key={name} className="flex items-center justify-between gap-2 text-sm">
          {name}
          {typeof value === "boolean" ? (
            <input
              type="checkbox"
              checked={value}
              onChange={(e) => setDraft({ ...draft, [name]: e.target.checked })}
            />
          ) : (
            <input
              className="input w-28"
              value={String(value)}
              onChange={(e) =>
                setDraft({
                  ...draft,
                  [name]:
                    typeof values?.[name] === "number" ? Number(e.target.value) : e.target.value,
                })
              }
            />
          )}
        </label>
      ))}
      <div className="flex gap-2">
        <button
          className="btn flex-1"
          onClick={() =>
            void run(() => api.setSwitches(service, draft), "Switches applied").then(load)
          }
        >
          Apply
        </button>
        <button
          className="btn-light flex-1"
          onClick={() => void run(() => api.resetSwitches(service), "Switches reset").then(load)}
        >
          Reset
        </button>
      </div>
    </div>
  );
}

function Jobs() {
  const jobs = usePoll(() => api.jobs(), 1000);
  return (
    <div className="card">
      <h2 className="mb-2 font-semibold">Open matching jobs</h2>
      {jobs.data?.items.length ? (
        <table className="w-full text-xs">
          <thead>
            <tr className="text-left text-slate-500">
              <th>trip</th>
              <th>offer to</th>
              <th>radius</th>
              <th>declined</th>
              <th>next step in</th>
            </tr>
          </thead>
          <tbody>
            {jobs.data.items.map(({ dueAt, job }) => (
              <tr key={String(job?.tripId)}>
                <td>{String(job?.tripId ?? "").slice(-8)}</td>
                <td>{String(job?.offerDriver ?? "-")}</td>
                <td>{String(job?.radiusKm ?? "")} km</td>
                <td>{(job?.declined as string[] | undefined)?.join(", ") || "-"}</td>
                <td>{Math.max(0, Math.round((dueAt - Date.now()) / 100) / 10)} s</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <div className="text-sm text-slate-500">None. Request a ride in the Rider tab.</div>
      )}
    </div>
  );
}

export function LabView() {
  const run = useAction();
  return (
    <div className="flex flex-col gap-4">
      <Health />
      <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
        <div className="flex flex-col gap-4">
          <Jobs />
          <Stats />
        </div>
        <div className="flex flex-col gap-4">
          <SwitchesPanel />
          <div className="card flex flex-col gap-2">
            <h2 className="font-semibold">Data</h2>
            <button
              className="btn-light"
              onClick={() => void run(() => api.seedRiders(20), "Riders r001..r020 ready")}
            >
              Seed 20 riders
            </button>
            <button
              className="btn-light"
              onClick={() => void run(() => api.seedDrivers(50), "Drivers d001..d050 ready")}
            >
              Seed 50 drivers
            </button>
          </div>
          <div className="card">
            <h2 className="mb-2 font-semibold">Try this</h2>
            <ul className="list-disc space-y-1 pl-4 text-sm">
              {SCENARIOS.map((s) => (
                <li key={s}>{s}</li>
              ))}
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
}
