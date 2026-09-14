-- What the reviewer adds when they accept a repair.
--
-- Three fields rather than one box, because each has a different reader:
-- the engineer who did the work, the record of the check itself, and
-- whoever opens this device at some service nobody has scheduled yet.
ALTER TABLE "WorkOrder" ADD COLUMN "engineerFeedback" TEXT;
ALTER TABLE "WorkOrder" ADD COLUMN "reviewChecks" TEXT;
ALTER TABLE "WorkOrder" ADD COLUMN "watchFor" TEXT;
