import { createContext, type ReactNode, useCallback, useContext, useState } from "react";
import { ApiError } from "../api.js";

type Toast = { id: number; text: string; kind: "ok" | "error" };
const ToastContext = createContext<(text: string, kind?: Toast["kind"]) => void>(() => undefined);

let nextId = 1;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const show = useCallback((text: string, kind: Toast["kind"] = "ok") => {
    const id = nextId++;
    setToasts((list) => [...list, { id, text, kind }]);
    setTimeout(() => setToasts((list) => list.filter((t) => t.id !== id)), 4000);
  }, []);
  return (
    <ToastContext.Provider value={show}>
      {children}
      <div className="fixed right-4 bottom-4 flex w-80 flex-col gap-2" role="status">
        {toasts.map((t) => (
          <div
            key={t.id}
            className={`rounded-md px-3 py-2 text-sm text-white shadow ${t.kind === "error" ? "bg-red-600" : "bg-slate-800"}`}
          >
            {t.text}
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
