import { CITY, type LatLng, type OnlineDriver, type SurgeCell } from "@apps/contracts";
import type { MouseEvent, ReactNode } from "react";

const SIZE = 1000;
const GRID_DEG = 0.02;

const x = (lng: number) => ((lng - CITY.minLng) / (CITY.maxLng - CITY.minLng)) * SIZE;
const y = (lat: number) => ((CITY.maxLat - lat) / (CITY.maxLat - CITY.minLat)) * SIZE;

const STATUS_COLOR: Record<string, string> = {
  available: "#16a34a",
  offered: "#d97706",
  on_trip: "#2563eb",
  offline: "#94a3b8",
};

export type MapProps = {
  drivers?: OnlineDriver[];
  cells?: SurgeCell[];
  pickup?: LatLng | null;
  dropoff?: LatLng | null;
  // The driver a rider is watching, or the driver's own position.
  tracked?: LatLng | null;
  trackedLabel?: string;
  onPick?: (at: LatLng) => void;
  hint?: string;
};

export function CityMap({
  drivers = [],
  cells = [],
  pickup,
  dropoff,
  tracked,
  trackedLabel,
  onPick,
  hint,
}: MapProps) {
  const click = (event: MouseEvent<SVGSVGElement>) => {
    if (!onPick) return;
    const box = event.currentTarget.getBoundingClientRect();
    const fx = (event.clientX - box.left) / box.width;
    const fy = (event.clientY - box.top) / box.height;
    onPick({
      lat: Number((CITY.maxLat - fy * (CITY.maxLat - CITY.minLat)).toFixed(5)),
      lng: Number((CITY.minLng + fx * (CITY.maxLng - CITY.minLng)).toFixed(5)),
    });
  };
  const lines: number[] = [];
  for (let d = GRID_DEG; d < CITY.maxLat - CITY.minLat; d += GRID_DEG) lines.push(d);
  return (
    <div className="relative">
      <svg
        viewBox={`0 0 ${SIZE} ${SIZE}`}
        className={`aspect-square w-full rounded-lg border border-slate-300 bg-slate-50 ${onPick ? "cursor-crosshair" : ""}`}
        onClick={click}
        role="img"
        aria-label={`map of ${CITY.name}`}
      >
        {lines.map((d) => (
          <g key={d} stroke="#e2e8f0" strokeWidth={1}>
            <line x1={0} x2={SIZE} y1={y(CITY.maxLat - d)} y2={y(CITY.maxLat - d)} />
            <line y1={0} y2={SIZE} x1={x(CITY.minLng + d)} x2={x(CITY.minLng + d)} />
          </g>
        ))}
        {cells.map((c) => (
          <g key={c.cell}>
            <rect
              x={x(c.minLng)}
              y={y(c.maxLat)}
              width={x(c.maxLng) - x(c.minLng)}
              height={y(c.minLat) - y(c.maxLat)}
              fill="#f97316"
              fillOpacity={Math.min(0.45, 0.08 + (c.surge - 1) * 0.2)}
              stroke="#f97316"
              strokeOpacity={0.4}
            />
            <text x={x(c.minLng) + 6} y={y(c.maxLat) + 22} fontSize={20} fill="#9a3412">
              x{c.surge.toFixed(1)} ({c.demand}/{c.supply ?? "?"})
            </text>
          </g>
        ))}
        {pickup && dropoff && (
          <line
            x1={x(pickup.lng)}
            y1={y(pickup.lat)}
            x2={x(dropoff.lng)}
            y2={y(dropoff.lat)}
            stroke="#0f172a"
            strokeDasharray="8 6"
            strokeWidth={3}
          />
        )}
        {drivers.map((d) => (
          <circle
            key={d.driverId}
            cx={x(d.lng)}
            cy={y(d.lat)}
            r={7}
            fill={STATUS_COLOR[d.status] ?? "#64748b"}
            fillOpacity={0.8}
          >
            <title>
              {d.driverId} {d.status}
            </title>
          </circle>
        ))}
        {drivers.length <= 20 &&
          drivers.map((d) => (
            <text
              key={`${d.driverId}-label`}
              x={x(d.lng) + 10}
              y={y(d.lat) - 8}
              fontSize={16}
              fill="#334155"
            >
              {d.driverId}
            </text>
          ))}
        {pickup && <Pin at={pickup} color="#16a34a" label="P" />}
        {dropoff && <Pin at={dropoff} color="#dc2626" label="D" />}
        {tracked && (
          <g>
            <circle
              cx={x(tracked.lng)}
              cy={y(tracked.lat)}
              r={16}
              fill="#2563eb"
              stroke="white"
              strokeWidth={4}
            />
            <text
              x={x(tracked.lng) + 20}
              y={y(tracked.lat) + 6}
              fontSize={22}
              fontWeight={600}
              fill="#1e3a8a"
            >
              {trackedLabel}
            </text>
          </g>
        )}
      </svg>
      {hint && (
        <div className="pointer-events-none absolute top-2 left-2 rounded bg-white/90 px-2 py-1 text-xs text-slate-600">
          {hint}
        </div>
      )}
      <div
        className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 rounded-md bg-white p-2 text-xs text-slate-600 sm:grid-cols-3"
        data-testid="legend"
      >
        <Legend color={STATUS_COLOR.available!}>small green dot: driver online and free</Legend>
        <Legend color={STATUS_COLOR.offered!}>small amber dot: driver deciding on an offer</Legend>
        <Legend color={STATUS_COLOR.on_trip!}>small blue dot: driver on a trip</Legend>
        <Legend color="#2563eb" big>
          {trackedLabel ? `big blue dot: ${trackedLabel}` : "big blue dot: you or your driver"}
        </Legend>
        <Legend color="#16a34a" text="P">
          pickup
        </Legend>
        <Legend color="#dc2626" text="D">
          dropoff
        </Legend>
        <span className="col-span-full">
          Orange squares: surge areas, labelled x(multiplier) (requests / free drivers). Hover a dot
          to see the driver id.
        </span>
      </div>{" "}
    </div>
  );
}

function Legend({
  color,
  big,
  text,
  children,
}: {
  color: string;
  big?: boolean;
  text?: string;
  children: ReactNode;
}) {
  return (
    <span className="flex items-center gap-1.5">
      <span
        className={`inline-flex shrink-0 items-center justify-center rounded-full text-[9px] font-bold text-white ${big ? "h-3.5 w-3.5 ring-2 ring-white" : text ? "h-3.5 w-3.5" : "h-2 w-2"}`}
        style={{ background: color }}
      >
        {text}
      </span>
      {children}
    </span>
  );
}

function Pin({ at, color, label }: { at: LatLng; color: string; label: string }) {
  return (
    <g>
      <circle cx={x(at.lng)} cy={y(at.lat)} r={14} fill={color} />
      <text
        x={x(at.lng)}
        y={y(at.lat) + 7}
        fontSize={20}
        fill="white"
        textAnchor="middle"
        fontWeight={700}
      >
        {label}
      </text>
    </g>
  );
}
