-- AlterTable
ALTER TABLE "AdmissionApplication" ADD COLUMN     "siblingOfStudentId" TEXT;

-- AlterTable
ALTER TABLE "StudentProfile" ADD COLUMN     "appliedClass" TEXT,
ADD COLUMN     "bFormNo" TEXT,
ADD COLUMN     "curriculum" TEXT,
ADD COLUMN     "guardianName" TEXT,
ADD COLUMN     "guardianPhone" TEXT,
ADD COLUMN     "guardianRelation" TEXT,
ADD COLUMN     "preferredShift" TEXT;

-- AddForeignKey
ALTER TABLE "AdmissionApplication" ADD CONSTRAINT "AdmissionApplication_siblingOfStudentId_fkey" FOREIGN KEY ("siblingOfStudentId") REFERENCES "StudentProfile"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- Data: admission details used to be appended to StudentProfile.address as
-- "<city>\n\nClass: ..\nCurriculum: ..\nShift: <x> shift\nB-Form: ..\nGuardian: <name> (<relation>) · <phone>".
-- Move them into their own columns and keep only the city in address.
UPDATE "StudentProfile" SET
  "appliedClass"     = NULLIF(btrim(substring("address" from E'\nClass: ([^\n]*)')), ''),
  "curriculum"       = NULLIF(btrim(substring("address" from E'\nCurriculum: ([^\n]*)')), ''),
  "preferredShift"   = NULLIF(lower(btrim(substring("address" from E'\nShift: ([^\n]*?) shift'))), ''),
  "bFormNo"          = NULLIF(btrim(substring("address" from E'\nB-Form: ([^\n]*)')), ''),
  "guardianName"     = NULLIF(btrim(substring("address" from E'\nGuardian: ([^\n(·]*)')), ''),
  "guardianRelation" = NULLIF(btrim(substring("address" from E'\nGuardian: [^\n(]*[(]([^)\n]*)[)]')), ''),
  "guardianPhone"    = NULLIF(btrim(substring("address" from E'\nGuardian: [^\n]*· ([^\n]*)')), ''),
  "address"          = btrim(split_part("address", E'\n\n', 1))
WHERE "address" LIKE E'%\n\nClass: %';
