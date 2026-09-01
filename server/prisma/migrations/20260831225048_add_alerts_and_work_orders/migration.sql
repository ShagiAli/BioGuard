-- CreateEnum
CREATE TYPE "Priority" AS ENUM ('EMERGENCY', 'MEDIUM', 'LOW');

-- CreateEnum
CREATE TYPE "AlertStatus" AS ENUM ('OPEN', 'ACKNOWLEDGED', 'ASSIGNED', 'IN_PROGRESS', 'RESOLVED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "WorkOrderStatus" AS ENUM ('INVESTIGATING', 'AWAITING_PARTS', 'IN_REPAIR', 'COMPLETED', 'CLOSED', 'CANCELLED');

-- AlterEnum
ALTER TYPE "Role" ADD VALUE 'HEAD_OF_ALERTS';

-- AlterTable
ALTER TABLE "Notification" ADD COLUMN     "alertId" UUID;

-- CreateTable
CREATE TABLE "Alert" (
    "id" UUID NOT NULL,
    "seq" SERIAL NOT NULL,
    "equipmentId" UUID NOT NULL,
    "raisedById" UUID NOT NULL,
    "description" TEXT NOT NULL,
    "priority" "Priority" NOT NULL,
    "status" "AlertStatus" NOT NULL DEFAULT 'OPEN',
    "openedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "acknowledgedAt" TIMESTAMP(3),
    "acknowledgedById" UUID,
    "assignedToId" UUID,
    "assignedAt" TIMESTAMP(3),
    "resolvedAt" TIMESTAMP(3),
    "cancelledReason" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Alert_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkOrder" (
    "id" UUID NOT NULL,
    "seq" SERIAL NOT NULL,
    "alertId" UUID NOT NULL,
    "equipmentId" UUID NOT NULL,
    "engineerId" UUID NOT NULL,
    "status" "WorkOrderStatus" NOT NULL DEFAULT 'INVESTIGATING',
    "priority" "Priority" NOT NULL,
    "findings" TEXT,
    "diagnosis" TEXT,
    "repairActions" TEXT,
    "finalResolution" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "completedAt" TIMESTAMP(3),
    "closedAt" TIMESTAMP(3),
    "closedById" UUID,
    "maintenanceRecordId" UUID,

    CONSTRAINT "WorkOrder_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Alert_seq_key" ON "Alert"("seq");

-- CreateIndex
CREATE INDEX "Alert_status_priority_idx" ON "Alert"("status", "priority");

-- CreateIndex
CREATE INDEX "Alert_assignedToId_status_idx" ON "Alert"("assignedToId", "status");

-- CreateIndex
CREATE INDEX "Alert_equipmentId_openedAt_idx" ON "Alert"("equipmentId", "openedAt");

-- CreateIndex
CREATE INDEX "Alert_raisedById_openedAt_idx" ON "Alert"("raisedById", "openedAt");

-- CreateIndex
CREATE UNIQUE INDEX "WorkOrder_seq_key" ON "WorkOrder"("seq");

-- CreateIndex
CREATE UNIQUE INDEX "WorkOrder_alertId_key" ON "WorkOrder"("alertId");

-- CreateIndex
CREATE UNIQUE INDEX "WorkOrder_maintenanceRecordId_key" ON "WorkOrder"("maintenanceRecordId");

-- CreateIndex
CREATE INDEX "WorkOrder_status_priority_idx" ON "WorkOrder"("status", "priority");

-- CreateIndex
CREATE INDEX "WorkOrder_engineerId_status_idx" ON "WorkOrder"("engineerId", "status");

-- CreateIndex
CREATE INDEX "WorkOrder_equipmentId_idx" ON "WorkOrder"("equipmentId");

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_alertId_fkey" FOREIGN KEY ("alertId") REFERENCES "Alert"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Alert" ADD CONSTRAINT "Alert_equipmentId_fkey" FOREIGN KEY ("equipmentId") REFERENCES "Equipment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Alert" ADD CONSTRAINT "Alert_raisedById_fkey" FOREIGN KEY ("raisedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Alert" ADD CONSTRAINT "Alert_acknowledgedById_fkey" FOREIGN KEY ("acknowledgedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Alert" ADD CONSTRAINT "Alert_assignedToId_fkey" FOREIGN KEY ("assignedToId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkOrder" ADD CONSTRAINT "WorkOrder_alertId_fkey" FOREIGN KEY ("alertId") REFERENCES "Alert"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkOrder" ADD CONSTRAINT "WorkOrder_equipmentId_fkey" FOREIGN KEY ("equipmentId") REFERENCES "Equipment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkOrder" ADD CONSTRAINT "WorkOrder_engineerId_fkey" FOREIGN KEY ("engineerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkOrder" ADD CONSTRAINT "WorkOrder_closedById_fkey" FOREIGN KEY ("closedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkOrder" ADD CONSTRAINT "WorkOrder_maintenanceRecordId_fkey" FOREIGN KEY ("maintenanceRecordId") REFERENCES "MaintenanceRecord"("id") ON DELETE SET NULL ON UPDATE CASCADE;
