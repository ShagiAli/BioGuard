-- CreateEnum
CREATE TYPE "SweepTrigger" AS ENUM ('SCHEDULED', 'MANUAL');

-- CreateTable
CREATE TABLE "SweepRun" (
    "id" UUID NOT NULL,
    "ranFor" DATE NOT NULL,
    "trigger" "SweepTrigger" NOT NULL DEFAULT 'SCHEDULED',
    "scanned" INTEGER NOT NULL,
    "sent" INTEGER NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),
    "error" TEXT,

    CONSTRAINT "SweepRun_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SweepRun_trigger_startedAt_idx" ON "SweepRun"("trigger", "startedAt");
