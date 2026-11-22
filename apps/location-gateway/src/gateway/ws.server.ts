import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnModuleDestroy,
} from "@nestjs/common";
import { HttpAdapterHost } from "@nestjs/core";
import { type Trip, USER_ID_PATTERN } from "@apps/contracts";
import { type BaseConfig, callJson, SERVICE_CONFIG } from "@apps/kit";
import type { IncomingMessage, Server } from "node:http";
import { type WebSocket, WebSocketServer } from "ws";
import type { GatewayConfig } from "../config.js";
import { type Role, Sessions } from "./sessions.js";

const PING_MS = 20_000;
// Close code for a missing or bad caller (ADR-025: browsers cannot set headers).
const POLICY_VIOLATION = 1008;

type Alive = WebSocket & { alive?: boolean };

@Injectable()
export class WsServer implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(WsServer.name);
  private wss?: WebSocketServer;
  private pinger?: NodeJS.Timeout;

  constructor(
    @Inject(HttpAdapterHost) private readonly adapterHost: HttpAdapterHost,
    @Inject(SERVICE_CONFIG) private readonly config: GatewayConfig & BaseConfig,
    @Inject(Sessions) private readonly sessions: Sessions,
  ) {}

  onApplicationBootstrap(): void {
    const server = this.adapterHost.httpAdapter.getHttpServer() as Server;
    this.wss = new WebSocketServer({ server, path: "/ws" });
    this.wss.on("connection", (socket, request) => void this.connect(socket as Alive, request));
    // Pings find sockets whose network vanished without a close frame.
    this.pinger = setInterval(() => {
      for (const socket of this.wss?.clients ?? []) {
        const s = socket as Alive;
        if (s.alive === false) {
          s.terminate();
          continue;
        }
        s.alive = false;
        s.ping();
      }
    }, PING_MS);
  }

  async onModuleDestroy(): Promise<void> {
    clearInterval(this.pinger);
    for (const socket of this.wss?.clients ?? []) socket.close(1001, "server shutting down");
    await new Promise<void>((resolve) => (this.wss ? this.wss.close(() => resolve()) : resolve()));
  }

  private async connect(socket: Alive, request: IncomingMessage): Promise<void> {
    const url = new URL(request.url ?? "/", "http://gateway");
    const user = url.searchParams.get("user") ?? "";
    const role = url.searchParams.get("role") as Role | null;
    if (!USER_ID_PATTERN.test(user) || (role !== "rider" && role !== "driver")) {
      socket.close(POLICY_VIOLATION, "need ?user=<id>&role=rider|driver");
      return;
    }
    socket.alive = true;
    socket.on("pong", () => (socket.alive = true));
    socket.on("close", () => void this.sessions.leave(role, user, socket));
    socket.on("error", () => undefined);
    await this.sessions.join(role, user, socket);
    this.sessions.send(role, user, {
      type: "hello",
      user,
      role,
      instance: this.config.SERVICE_NAME,
    });
    await this.sendActiveTrip(role, user);
  }

  // A new connection gets the current trip now, not at the next event.
  private async sendActiveTrip(role: Role, user: string): Promise<void> {
    try {
      const path = `${role === "rider" ? "riders" : "drivers"}/${encodeURIComponent(user)}/active-trip`;
      const { trip } = await callJson<{ trip: Trip | null }>(
        "trip-service",
        `${this.config.TRIP_URL}/${path}`,
        { timeoutMs: 1500 },
      );
      if (trip) await this.sessions.onTrip(trip);
    } catch (error) {
      this.logger.warn(`no initial trip for ${role} ${user}: ${String(error)}`);
    }
  }
}
