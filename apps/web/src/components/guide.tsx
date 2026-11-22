import type { ReactNode } from "react";
import { useTabState } from "../hooks.js";

export type Step = { label: ReactNode; done: boolean; hint?: ReactNode };

// A checklist that highlights the first step not done yet.
export function Guide({ id, title, steps }: { id: string; title: string; steps: Step[] }) {
  const [open, setOpen] = useTabState(`guide.${id}`, true);
  const next = steps.findIndex((s) => !s.done);
  return (
    <div className="card border-sky-300 bg-sky-50" data-testid={`guide-${id}`}>
      <button
        className="flex w-full items-center justify-between text-left font-semibold"
        onClick={() => setOpen(!open)}
      >
        {title}
        <span className="text-xs font-normal text-sky-700">{open ? "hide" : "show"}</span>
      </button>
      {open && (
        <ol className="mt-2 flex flex-col gap-1 text-sm">
          {steps.map((s, i) => (
            <li
              key={i}
              className={`flex gap-2 ${i === next ? "font-semibold text-sky-900" : s.done ? "text-slate-500" : "text-slate-700"}`}
            >
              <span className="w-5 shrink-0">{s.done ? "✓" : `${i + 1}.`}</span>
              <span>
                {s.label}
                {i === next && s.hint && (
                  <span className="block font-normal text-sky-800">{s.hint}</span>
                )}
              </span>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
