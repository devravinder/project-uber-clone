import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnModuleDestroy,
} from "@nestjs/common";
import type { Offer, OfferClosedReason, Trip } from "@apps/contracts";
import { fail, isUnreachable, sleep, Switches, UpstreamError } from "@apps/kit";
import { DriverClient, TripClient } from "../clients.js";
import { type Job, JobStore } from "./job.store.js";

const TICK_MS = 250;
const BATCH = 20;
const CANDIDATES = 10;
// The driver's hold outlives the offer a little, so it never lapses before we decide.
const HOLD_SLACK_MS = 2000;
const LOCK_WAIT_MS = 2000;

export type MatchStats = {
  jobsCreated: number;
  offers: number;
  accepted: number;
  declined: number;
  expired: number;
  noDrivers: number;
  closedByEvent: number;
  lockBusy: number;
  upstreamRetries: number;
  totalMatchMs: number;
};

@Injectable()
export class MatcherService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(MatcherService.name);
  private timer?: NodeJS.Timeout;
  private running?: Promise<void>;
  readonly stats: MatchStats = {
    jobsCreated: 0,
    offers: 0,
    accepted: 0,
    declined: 0,
    expired: 0,
    noDrivers: 0,
    closedByEvent: 0,
    lockBusy: 0,
    upstreamRetries: 0,
    totalMatchMs: 0,
  };

  constructor(
    @Inject(JobStore) private readonly jobs: JobStore,
    @Inject(DriverClient) private readonly drivers: DriverClient,
    @Inject(TripClient) private readonly trips: TripClient,
    @Inject(Switches) private readonly switches: Switches,
  ) {}

  private n(name: string): number {
    return this.switches.get<number>(name);
  }

  onApplicationBootstrap(): void {
    this.timer = setInterval(() => {
      if (this.switches.get<boolean>("paused")) return;
      this.running ??= this.tick().finally(() => {
        this.running = undefined;
      });
    }, TICK_MS);
  }

  async onModuleDestroy(): Promise<void> {
    clearInterval(this.timer);
    await this.running;
  }

  // A trip older than the match timeout is a replay; never match it now.
  async startJob(trip: Trip): Promise<boolean> {
    if (trip.status !== "requested") return false;
    if (Date.now() - Date.parse(trip.requestedAt) > this.n("matchTimeoutMs")) return false;
    const keepMs = this.n("matchTimeoutMs") + 5 * 60_000;
    const created = await this.jobs.create(trip, Date.now(), this.n("startRadiusKm"), keepMs);
    if (created) this.stats.jobsCreated++;
    return created;
  }

  // Runs fn under the trip lock; waits briefly, as accept and ticker may collide.
  async withLock<T>(tripId: string, fn: () => Promise<T>, waitMs = LOCK_WAIT_MS): Promise<T> {
    const deadline = Date.now() + waitMs;
    for (;;) {
      const token = await this.jobs.tryLock(tripId);
      if (token) {
        try {
          return await fn();
        } finally {
          await this.jobs.unlock(tripId, token).catch(() => undefined);
        }
      }
      if (Date.now() >= deadline) {
        this.stats.lockBusy++;
        return fail(409, "TRIP_BUSY", `trip ${tripId} is being handled; try again`);
      }
      await sleep(50);
    }
  }

  private async tick(): Promise<void> {
    let ids: string[];
    try {
      ids = await this.jobs.due(Date.now(), BATCH);
    } catch (error) {
      this.logger.warn(`cannot read due jobs: ${String(error)}`);
      return;
    }
    for (const tripId of ids) {
      const token = await this.jobs.tryLock(tripId).catch(() => null);
      // Another instance holds it; the next tick will see the new due time.
      if (!token) continue;
      try {
        await this.process(tripId);
      } catch (error) {
        this.logger.warn(`job ${tripId} failed, retrying later: ${String(error)}`);
        await this.jobs
          .schedule(tripId, Date.now() + this.n("retryDelayMs"))
          .catch(() => undefined);
      } finally {
        await this.jobs.unlock(tripId, token).catch(() => undefined);
      }
    }
  }

  private async process(tripId: string): Promise<void> {
    const job = await this.jobs.get(tripId);
    if (!job) {
      await this.jobs.remove(tripId, null);
      return;
    }
    const now = Date.now();
    if (job.offerDriver) {
      if (now < job.offerUntil) {
        await this.jobs.schedule(tripId, job.offerUntil);
        return;
      }
      if (await this.closeIfTripMoved(job)) return;
      await this.endOffer(job, "expired");
      this.stats.expired++;
      job.declined.push(job.offerDriver);
      job.offerDriver = null;
    }
    if (now - job.createdAt > this.n("matchTimeoutMs")) {
      await this.giveUp(job);
      return;
    }
    await this.offerNext(job);
  }

  // Before acting on a timeout, ask trip-service; a missed event must not mislead.
  private async closeIfTripMoved(job: Job): Promise<boolean> {
    const trip = await this.trips.get(job.tripId);
    if (trip.status === "requested") return false;
    if (job.offerDriver && trip.driverId !== job.offerDriver) {
      await this.drivers.release(job.offerDriver, job.tripId);
    }
    await this.jobs.remove(job.tripId, job.offerDriver);
    this.stats.closedByEvent++;
    return true;
  }

  private async offerNext(job: Job): Promise<void> {
    const pickup = { lat: job.pickupLat, lng: job.pickupLng };
    const candidates = await this.drivers.nearby(pickup, job.radiusKm, CANDIDATES);
    const offerMs = this.n("offerTimeoutMs");
    for (const candidate of candidates) {
      if (job.declined.includes(candidate.driverId)) continue;
      if (!(await this.drivers.reserve(candidate.driverId, job.tripId, offerMs + HOLD_SLACK_MS)))
        continue;
      const until = Date.now() + offerMs;
      await this.jobs.update(job.tripId, {
        offerDriver: candidate.driverId,
        offerUntil: until,
        offerDistanceKm: candidate.distanceKm,
        attempt: job.attempt + 1,
        declined: job.declined,
      });
      await this.jobs.setOffer(candidate.driverId, job.tripId, offerMs + HOLD_SLACK_MS);
      await this.jobs.schedule(job.tripId, until);
      const offer = this.toOffer(
        { ...job, offerDriver: candidate.driverId, offerUntil: until, attempt: job.attempt + 1 },
        candidate.distanceKm,
      );
      await this.jobs.publish(candidate.driverId, { type: "offer", offer });
      this.stats.offers++;
      return;
    }
    // Nobody free in this circle: widen it and look again shortly.
    const radiusKm = Math.min(job.radiusKm + this.n("radiusStepKm"), this.n("maxRadiusKm"));
    await this.jobs.update(job.tripId, {
      radiusKm,
      declined: job.declined,
      offerDriver: null,
      offerUntil: 0,
    });
    await this.jobs.schedule(job.tripId, Date.now() + this.n("retryDelayMs"));
  }

  private async giveUp(job: Job): Promise<void> {
    try {
      await this.trips.noDrivers(job.tripId);
      this.stats.noDrivers++;
    } catch (error) {
      // 409: already cancelled or matched; the job is done either way.
      if (!(error instanceof UpstreamError && error.status === 409)) throw error;
    }
    await this.jobs.remove(job.tripId, null);
  }

  private async endOffer(job: Job, reason: OfferClosedReason): Promise<void> {
    if (!job.offerDriver) return;
    await this.drivers.release(job.offerDriver, job.tripId);
    await this.jobs.clearOffer(job.offerDriver, job.tripId);
    await this.jobs.publish(job.offerDriver, { type: "offer-closed", tripId: job.tripId, reason });
  }

  toOffer(job: Job, distanceToPickupKm = job.offerDistanceKm): Offer {
    return {
      tripId: job.tripId,
      driverId: job.offerDriver!,
      riderId: job.riderId,
      pickup: { lat: job.pickupLat, lng: job.pickupLng },
      dropoff: { lat: job.dropoffLat, lng: job.dropoffLng },
      fareMinor: job.fareMinor,
      currency: job.currency,
      distanceToPickupKm,
      attempt: job.attempt,
      expiresAt: new Date(job.offerUntil).toISOString(),
    };
  }

  async accept(tripId: string, driverId: string): Promise<Trip> {
    return this.withLock(tripId, async () => {
      const job = await this.jobs.get(tripId);
      if (!job || job.offerDriver !== driverId) {
        fail(409, "OFFER_NOT_FOUND", `no open offer of trip ${tripId} for ${driverId}`);
      }
      if (Date.now() > job.offerUntil)
        fail(409, "OFFER_EXPIRED", `the offer of trip ${tripId} expired`);
      let trip: Trip;
      try {
        if (!(await this.drivers.assign(driverId, tripId))) {
          await this.declineLocked(job, "expired");
          fail(409, "DRIVER_NOT_AVAILABLE", `driver ${driverId} no longer holds trip ${tripId}`);
        }
        trip = await this.trips.assign(tripId, driverId);
      } catch (error) {
        if (error instanceof UpstreamError && error.status === 409) {
          // The trip was cancelled meanwhile: free the driver and drop the job.
          await this.drivers.release(driverId, tripId);
          await this.jobs.remove(tripId, driverId);
          fail(409, "TRIP_GONE", `trip ${tripId} can no longer be accepted: ${error.code}`);
        }
        if (isUnreachable(error)) {
          // Keep the offer: a retry of accept is idempotent on both sides.
          this.stats.upstreamRetries++;
          fail(503, "UPSTREAM_UNAVAILABLE", (error as Error).message);
        }
        throw error;
      }
      await this.jobs.remove(tripId, driverId);
      await this.jobs.publish(driverId, { type: "offer-closed", tripId, reason: "accepted" });
      this.stats.accepted++;
      this.stats.totalMatchMs += Date.now() - job.createdAt;
      return trip;
    });
  }

  async decline(tripId: string, driverId: string): Promise<{ declined: true }> {
    return this.withLock(tripId, async () => {
      const job = await this.jobs.get(tripId);
      if (!job || job.offerDriver !== driverId) {
        fail(409, "OFFER_NOT_FOUND", `no open offer of trip ${tripId} for ${driverId}`);
      }
      await this.declineLocked(job, "declined");
      this.stats.declined++;
      return { declined: true as const };
    });
  }

  private async declineLocked(job: Job, reason: OfferClosedReason): Promise<void> {
    await this.endOffer(job, reason);
    job.declined.push(job.offerDriver!);
    await this.jobs.update(job.tripId, {
      declined: job.declined,
      offerDriver: null,
      offerUntil: 0,
    });
    await this.jobs.schedule(job.tripId, Date.now());
  }

  // Trip moved on elsewhere (cancelled, reaped, matched): drop the job, keep the matched driver.
  async closeByEvent(trip: Trip, reason: OfferClosedReason): Promise<void> {
    await this.withLock(trip.id, async () => {
      const tripId = trip.id;
      const job = await this.jobs.get(tripId);
      if (!job) return;
      if (job.offerDriver && job.offerDriver !== trip.driverId) await this.endOffer(job, reason);
      await this.jobs.remove(tripId, job.offerDriver);
      this.stats.closedByEvent++;
    });
  }

  async currentOffer(driverId: string): Promise<Offer | null> {
    const tripId = await this.jobs.currentOfferTrip(driverId);
    if (!tripId) return null;
    const job = await this.jobs.get(tripId);
    if (!job || job.offerDriver !== driverId || Date.now() > job.offerUntil) return null;
    return this.toOffer(job);
  }
}
