-- Erase an account while keeping the person's name on the record.
--
-- Somebody who signed services cannot be deleted: the services point at
-- their row and every history screen reads the name from it. Erasing keeps
-- the row, removes the account, and marks it here so it drops off the
-- People page.
ALTER TABLE "User" ADD COLUMN "deletedAt" TIMESTAMP(3);
