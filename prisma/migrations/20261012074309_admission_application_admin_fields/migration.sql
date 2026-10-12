-- AlterTable
ALTER TABLE "AdmissionApplication" ADD COLUMN     "bloodGroup" TEXT,
ADD COLUMN     "gender" "Gender",
ADD COLUMN     "rollNumber" TEXT,
ADD COLUMN     "sectionId" TEXT;

-- AddForeignKey
ALTER TABLE "AdmissionApplication" ADD CONSTRAINT "AdmissionApplication_sectionId_fkey" FOREIGN KEY ("sectionId") REFERENCES "Section"("id") ON DELETE SET NULL ON UPDATE CASCADE;
