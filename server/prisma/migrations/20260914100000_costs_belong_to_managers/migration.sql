-- Cost and downtime move onto the work order, beside labour.
--
-- They were collected only at the close and written straight into the
-- maintenance record, so they could be set once, by whoever closed, and
-- never again. A manager records them now, at any stage — cost usually
-- arrives on an invoice after the repair is already closed.
ALTER TABLE "WorkOrder" ADD COLUMN "cost" DECIMAL(12,2);
ALTER TABLE "WorkOrder" ADD COLUMN "downtimeHours" INTEGER;

-- Carry across what closed repairs already recorded, so the figures do not
-- appear to vanish from work orders that had them.
UPDATE "WorkOrder" w
SET "cost" = m."cost", "downtimeHours" = m."downtimeHours"
FROM "MaintenanceRecord" m
WHERE w."maintenanceRecordId" = m."id";
