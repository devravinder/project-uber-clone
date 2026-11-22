import { createContext, type ReactNode, useCallback, useContext, useState } from "react";
import { ApiError } from "../api.js";

type Toast = { id: number; text: string; kind: "ok" | "error" };
const ToastContext = createContext<(text: string, kind?: Toast["kind"]) => void>(() => undefined);

let nextId = 1;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const dismiss = useCallback(
    (id: number) => setToasts((list) => list.filter((t) => t.id !== id)),
    [],
  );
  const show = useCallback(
    (text: string, kind: Toast["kind"] = "ok") => {
      const id = nextId++;
      setToasts((list) => [...list, { id, text, kind }]);
      // Errors stay longer, since they carry a code worth reading.
      setTimeout(() => dismiss(id), kind === "error" ? 8000 : 4000);
    },
    [dismiss],
  );
  return (
    <ToastContext.Provider value={show}>
      {children}
      <div className="fixed right-4 bottom-4 flex w-80 flex-col gap-2" role="status">
        {toasts.length > 1 && (
          <button
            className="self-end rounded bg-white/90 px-2 py-0.5 text-xs text-slate-600 shadow hover:bg-white"
            onClick={() => setToasts([])}
          >
            Clear all
          </button>
        )}
        {toasts.map((t) => (
          <div
            key={t.id}
            className={`flex items-start gap-2 rounded-md px-3 py-2 text-sm text-white shadow ${t.kind === "error" ? "bg-red-600" : "bg-slate-800"}`}
          >
            <span className="flex-1">{t.text}</span>
            <button
              className="-mr-1 rounded px-1 leading-none text-white/70 hover:bg-white/20 hover:text-white"
              aria-label="close notification"
              onClick={() => dismiss(t.id)}
            >
              ×
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export const useToast = () => useContext(ToastContext);

// Every click that calls an API shows the error code instead of failing silently.
export function useAction() {
  const toast = useToast();
  return useCallback(
    async <T,>(run: () => Promise<T>, done?: string): Promise<T | undefined> => {
      try {
        const result = await run();
        if (done) toast(done);
        return result;
      } catch (error) {
        const text =
          error instanceof ApiError ? `${error.code}: ${error.message}` : (error as Error).message;
        toast(text, "error");
        return undefined;
      }
    },
    [toast],
  );
}
