-- CreateEnum
CREATE TYPE "trip_status" AS ENUM ('requested', 'matched', 'arrived', 'in_progress', 'completed', 'cancelled', 'no_drivers');

-- CreateEnum
CREATE TYPE "cancelled_by" AS ENUM ('rider', 'driver', 'system');

-- CreateTable
CREATE TABLE "trips" (
    "id" TEXT NOT NULL,
    "rider_id" TEXT NOT NULL,
    "driver_id" TEXT,
    "status" "trip_status" NOT NULL DEFAULT 'requested',
    "pickup_lat" DOUBLE PRECISION NOT NULL,
    "pickup_lng" DOUBLE PRECISION NOT NULL,
    "dropoff_lat" DOUBLE PRECISION NOT NULL,
    "dropoff_lng" DOUBLE PRECISION NOT NULL,
    "distance_km" DOUBLE PRECISION NOT NULL,
    "fare_minor" INTEGER NOT NULL,
    "currency" TEXT NOT NULL,
    "surge" DOUBLE PRECISION NOT NULL,
    "quote_id" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 0,
    "cancel_reason" TEXT,
    "cancelled_by" "cancelled_by",
    "requested_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "matched_at" TIMESTAMPTZ(3),
    "arrived_at" TIMESTAMPTZ(3),
    "started_at" TIMESTAMPTZ(3),
    "ended_at" TIMESTAMPTZ(3),
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "trips_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "outbox" (
    "id" TEXT NOT NULL,
    "topic" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "payload" TEXT NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "next_attempt_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "locked_until" TIMESTAMPTZ(3),
    "sent_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "outbox_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "trips_quote_id_key" ON "trips"("quote_id");

-- CreateIndex
CREATE INDEX "trips_rider_id_id_idx" ON "trips"("rider_id", "id");

-- CreateIndex
CREATE INDEX "trips_driver_id_id_idx" ON "trips"("driver_id", "id");

-- One active trip per rider and per driver; the database stops double bookings.
CREATE UNIQUE INDEX "trips_one_active_per_rider" ON "trips"("rider_id")
  WHERE "status" IN ('requested', 'matched', 'arrived', 'in_progress');
CREATE UNIQUE INDEX "trips_one_active_per_driver" ON "trips"("driver_id")
  WHERE "driver_id" IS NOT NULL AND "status" IN ('matched', 'arrived', 'in_progress');

-- The relay scans only unsent rows.
CREATE INDEX "outbox_pending_idx" ON "outbox"("next_attempt_at") WHERE "sent_at" IS NULL;
