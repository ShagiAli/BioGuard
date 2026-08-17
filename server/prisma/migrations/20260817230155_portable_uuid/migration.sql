-- AlterTable
ALTER TABLE "AuditLog" ALTER COLUMN "id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "Building" ALTER COLUMN "id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "Department" ALTER COLUMN "id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "Equipment" ALTER COLUMN "id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "EquipmentCategory" ALTER COLUMN "id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "MaintenanceRecord" ALTER COLUMN "id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "Manufacturer" ALTER COLUMN "id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "Notification" ALTER COLUMN "id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "NotificationDispatch" ALTER COLUMN "id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "PasswordResetToken" ALTER COLUMN "id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "Room" ALTER COLUMN "id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "Session" ALTER COLUMN "id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "User" ALTER COLUMN "id" DROP DEFAULT;
