-- CreateEnum
CREATE TYPE "ExamPaperMode" AS ENUM ('MANUAL', 'ONLINE');

-- AlterEnum
ALTER TYPE "QuestionType" ADD VALUE 'FILE_UPLOAD';

-- AlterTable
ALTER TABLE "ExamPaper" ADD COLUMN     "instructions" TEXT,
ADD COLUMN     "invigilatorId" TEXT,
ADD COLUMN     "mode" "ExamPaperMode" NOT NULL DEFAULT 'MANUAL',
ADD COLUMN     "paperCode" TEXT,
ADD COLUMN     "paperFileKey" TEXT,
ADD COLUMN     "paperFileName" TEXT,
ADD COLUMN     "passingPercent" DOUBLE PRECISION,
ADD COLUMN     "title" TEXT,
ADD COLUMN     "weightage" DOUBLE PRECISION;

-- AlterTable
ALTER TABLE "QuizAnswer" ADD COLUMN     "attachments" JSONB;

-- AddForeignKey
ALTER TABLE "ExamPaper" ADD CONSTRAINT "ExamPaper_invigilatorId_fkey" FOREIGN KEY ("invigilatorId") REFERENCES "TeacherProfile"("id") ON DELETE SET NULL ON UPDATE CASCADE;

