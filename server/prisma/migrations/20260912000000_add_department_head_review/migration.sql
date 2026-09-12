-- A finished repair is now reviewed before it closes.

-- The reviewer. Scoped by departmentId: a head answers for the devices
-- in their own department and has no say over anybody else's.
ALTER TYPE "Role" ADD VALUE 'HEAD_OF_DEPARTMENT';

-- Why a repair was sent back, and who sent it. On the work order and not
-- only in the audit log, because the engineer has to read it to act on
-- it.
ALTER TABLE "WorkOrder" ADD COLUMN "rejectionReason" TEXT;
ALTER TABLE "WorkOrder" ADD COLUMN "rejectedAt" TIMESTAMP(3);
ALTER TABLE "WorkOrder" ADD COLUMN "rejectedById" UUID;

ALTER TABLE "WorkOrder"
  ADD CONSTRAINT "WorkOrder_rejectedById_fkey"
  FOREIGN KEY ("rejectedById") REFERENCES "User"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
