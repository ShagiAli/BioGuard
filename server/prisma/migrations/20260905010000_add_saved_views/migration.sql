-- CreateTable
CREATE TABLE "SavedView" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "resource" TEXT NOT NULL,
    "query" TEXT NOT NULL,
    "ownerId" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SavedView_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SavedView_ownerId_resource_idx" ON "SavedView"("ownerId", "resource");

-- CreateIndex
CREATE UNIQUE INDEX "SavedView_ownerId_resource_name_key" ON "SavedView"("ownerId", "resource", "name");

-- AddForeignKey
ALTER TABLE "SavedView" ADD CONSTRAINT "SavedView_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
