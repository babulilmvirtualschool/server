-- AlterTable
ALTER TABLE "AdmissionApplication" ADD COLUMN "studentUserId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "AdmissionApplication_studentUserId_key" ON "AdmissionApplication"("studentUserId");

-- AddForeignKey
ALTER TABLE "AdmissionApplication" ADD CONSTRAINT "AdmissionApplication_studentUserId_fkey" FOREIGN KEY ("studentUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
