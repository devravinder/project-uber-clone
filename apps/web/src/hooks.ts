import type { GatewayMessage } from "@apps/contracts";
import { useCallback, useEffect, useRef, useState } from "react";

export function usePoll<T>(load: () => Promise<T>, intervalMs: number, deps: unknown[] = []) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const loadRef = useRef(load);
  loadRef.current = load;
  const refresh = useCallback(async () => {
    try {
      setData(await loadRef.current());
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);
  useEffect(() => {
    void refresh();
    const timer = setInterval(() => void refresh(), intervalMs);
    return () => clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [intervalMs, refresh, ...deps]);
  return { data, error, refresh };
}

// Per browser tab, so two tabs can be a rider and a driver.
export function useTabState<T>(key: string, initial: T) {
  const [value, setValue] = useState<T>(() => {
    const raw = sessionStorage.getItem(`ridelab.${key}`);
    return raw ? (JSON.parse(raw) as T) : initial;
  });
  useEffect(() => {
    sessionStorage.setItem(`ridelab.${key}`, JSON.stringify(value));
  }, [key, value]);
  return [value, setValue] as const;
}

export const GATEWAYS = {
  "gateway 1 (7206)": import.meta.env.VITE_GATEWAY_WS as string,
  "gateway 2 (7216)": import.meta.env.VITE_GATEWAY_2_WS as string,
};

// Reconnects with a growing pause, like a phone that loses signal.
export function useGateway(
  url: string,
  user: string,
  role: "rider" | "driver",
  onMessage: (message: GatewayMessage) => void,
) {
  const [state, setState] = useState<{ connected: boolean; instance: string | null }>({
    connected: false,
    instance: null,
  });
  const handler = useRef(onMessage);
  handler.current = onMessage;
  useEffect(() => {
    if (!user || !url) return;
    let socket: WebSocket | null = null;
    let attempt = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let stopped = false;
    const open = () => {
      socket = new WebSocket(`${url}/ws?user=${encodeURIComponent(user)}&role=${role}`);
      socket.onopen = () => {
        attempt = 0;
      };
      socket.onmessage = (event) => {
        const message = JSON.parse(event.data as string) as GatewayMessage;
        if (message.type === "hello") setState({ connected: true, instance: message.instance });
        handler.current(message);
      };
      socket.onclose = () => {
        setState({ connected: false, instance: null });
        if (stopped) return;
        timer = setTimeout(open, Math.min(5000, 500 * 2 ** attempt++));
      };
    };
    open();
    return () => {
      stopped = true;
      clearTimeout(timer);
      socket?.close();
    };
  }, [url, user, role]);
  return state;
}

export function useNow(intervalMs = 500) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(timer);
  }, [intervalMs]);
  return now;
}
