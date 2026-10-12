-- CreateEnum
CREATE TYPE "Campus" AS ENUM ('ONLINE', 'PHYSICAL');

-- DropIndex
DROP INDEX "AcademicYear_name_key";

-- DropIndex
DROP INDEX "Subject_code_key";

-- DropIndex
DROP INDEX "Subject_name_key";

-- AlterTable
ALTER TABLE "AcademicYear" ADD COLUMN     "campus" "Campus" NOT NULL DEFAULT 'ONLINE';

-- AlterTable
ALTER TABLE "AdminProfile" ADD COLUMN     "allCampuses" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "AdmissionApplication" ADD COLUMN     "campus" "Campus" NOT NULL DEFAULT 'ONLINE';

-- AlterTable
ALTER TABLE "Announcement" ADD COLUMN     "campus" "Campus" NOT NULL DEFAULT 'ONLINE';

-- AlterTable
ALTER TABLE "Subject" ADD COLUMN     "campus" "Campus" NOT NULL DEFAULT 'ONLINE';

-- AlterTable
ALTER TABLE "TeacherApplication" ADD COLUMN     "campus" "Campus" NOT NULL DEFAULT 'ONLINE';

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "campus" "Campus" NOT NULL DEFAULT 'ONLINE';

-- CreateIndex
CREATE UNIQUE INDEX "AcademicYear_campus_name_key" ON "AcademicYear"("campus", "name");

-- CreateIndex
CREATE INDEX "Announcement_campus_idx" ON "Announcement"("campus");

-- CreateIndex
CREATE UNIQUE INDEX "Subject_campus_name_key" ON "Subject"("campus", "name");

-- CreateIndex
CREATE UNIQUE INDEX "Subject_campus_code_key" ON "Subject"("campus", "code");

-- CreateIndex
CREATE INDEX "User_campus_idx" ON "User"("campus");


-- Data: every existing record belongs to the online school (column defaults above).
-- Existing admins are the main admins and keep access to both schools.
UPDATE "AdminProfile" SET "allCampuses" = true;
