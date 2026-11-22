import { CITY } from "@apps/contracts";
import { DriverView } from "./components/driver-view.js";
import { LabView } from "./components/lab-view.js";
import { RiderView } from "./components/rider-view.js";
import { useTabState } from "./hooks.js";

const TABS = { rider: "Rider", driver: "Driver", lab: "Lab" } as const;
type Tab = keyof typeof TABS;

export function App() {
  const [tab, setTab] = useTabState<Tab>("tab", "rider");
  return (
    <div className="mx-auto max-w-6xl p-4">
      <header className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-2xl font-bold">Ridelab</h1>
          <p className="text-sm text-slate-500">
            Ride-hailing learning demo in {CITY.name}. Open a second browser tab for the other side
            of the trip.
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
      {tab === "rider" && <RiderView />}
      {tab === "driver" && <DriverView />}
      {tab === "lab" && <LabView />}
    </div>
  );
}
