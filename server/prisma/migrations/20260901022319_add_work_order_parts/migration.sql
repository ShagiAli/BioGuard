-- CreateEnum
CREATE TYPE "PartStatus" AS ENUM ('REQUIRED', 'REQUESTED', 'ORDERED', 'RECEIVED', 'INSTALLED', 'CANCELLED');

-- CreateTable
CREATE TABLE "WorkOrderPart" (
    "id" UUID NOT NULL,
    "workOrderId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "partNumber" TEXT,
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "status" "PartStatus" NOT NULL DEFAULT 'REQUIRED',
    "notes" TEXT,
    "requestedAt" TIMESTAMP(3),
    "orderedAt" TIMESTAMP(3),
    "receivedAt" TIMESTAMP(3),
    "installedAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WorkOrderPart_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "WorkOrderPart_workOrderId_status_idx" ON "WorkOrderPart"("workOrderId", "status");

-- AddForeignKey
ALTER TABLE "WorkOrderPart" ADD CONSTRAINT "WorkOrderPart_workOrderId_fkey" FOREIGN KEY ("workOrderId") REFERENCES "WorkOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;
