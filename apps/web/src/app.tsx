import { CITY } from "@apps/contracts";
import { useEffect, useState } from "react";
import { api } from "./api.js";
import { DriverView } from "./components/driver-view.js";
import { LabView } from "./components/lab-view.js";
import { RiderView } from "./components/rider-view.js";
import { useToast } from "./components/toast.js";
import { useTabState } from "./hooks.js";

const TABS = { rider: "I am a rider", driver: "I am a driver", lab: "Lab" } as const;
type Tab = keyof typeof TABS;

// Empty databases on the first visit: create demo people, no script needed.
function useDemoData() {
  const toast = useToast();
  const [ready, setReady] = useState(false);
  useEffect(() => {
    void (async () => {
      try {
        const [riders, drivers] = await Promise.all([api.riders(), api.drivers()]);
        if (riders.items.length === 0) await api.seedRiders(20);
        if (drivers.items.length === 0) await api.seedDrivers(50);
        if (riders.items.length === 0 || drivers.items.length === 0) {
          toast("Created demo riders r001-r020 and drivers d001-d050");
        }
      } catch {
        toast("Services are not reachable: run pnpm start:services", "error");
      }
      setReady(true);
    })();
  }, [toast]);
  return ready;
}

export function App() {
  const [tab, setTab] = useTabState<Tab>("tab", "rider");
  const ready = useDemoData();
  return (
    <div className="mx-auto max-w-6xl p-4">
      <header className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-2xl font-bold">Ridelab</h1>
          <p className="text-sm text-slate-500">
            Ride-hailing demo in {CITY.name}. Use two browser tabs: one as the rider, one as the
            driver.
          </p>
        </div>
        <nav className="flex gap-1 rounded-lg bg-white p-1 shadow-sm" aria-label="views">
          {(Object.keys(TABS) as Tab[]).map((t) => (
            <button
              key={t}
              className={`rounded-md px-3 py-1.5 text-sm font-medium ${tab === t ? "bg-slate-900 text-white" : "hover:bg-slate-100"}`}
              onClick={() => setTab(t)}
              aria-pressed={tab === t}
            >
              {TABS[t]}
            </button>
          ))}
        </nav>
      </header>
      {!ready && <div className="text-sm text-slate-500">Loading...</div>}
      {ready && tab === "rider" && <RiderView />}
      {ready && tab === "driver" && <DriverView />}
      {ready && tab === "lab" && <LabView />}
    </div>
  );
}
