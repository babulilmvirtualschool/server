-- AlterTable
ALTER TABLE "AdmissionApplication" ADD COLUMN     "documents" JSONB;

-- AlterTable
ALTER TABLE "StudentProfile" ADD COLUMN     "documents" JSONB;

-- AlterTable
ALTER TABLE "TeacherApplication" ADD COLUMN     "photoKey" TEXT;

