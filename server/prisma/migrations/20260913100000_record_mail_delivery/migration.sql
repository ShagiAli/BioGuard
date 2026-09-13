-- Record what happened to a message, not only that it was written.
--
-- The outbox proved intent and nothing else, so a message that never
-- left the building was indistinguishable from one sitting in somebody's
-- spam folder. Both are a row plus a log line nobody reads.
ALTER TABLE "SentEmail" ADD COLUMN "deliveredAt" TIMESTAMP(3);
ALTER TABLE "SentEmail" ADD COLUMN "deliveryError" TEXT;
