-- CreateEnum
CREATE TYPE "BankQuestionType" AS ENUM ('MCQ', 'FILL_BLANK');

-- CreateTable
CREATE TABLE "BankQuestion" (
    "id" TEXT NOT NULL,
    "subjectId" TEXT NOT NULL,
    "type" "BankQuestionType" NOT NULL,
    "text" TEXT NOT NULL,
    "options" JSONB,
    "answer" TEXT,
    "marks" DOUBLE PRECISION NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BankQuestion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExamPaperQuestion" (
    "id" TEXT NOT NULL,
    "examPaperId" TEXT NOT NULL,
    "questionId" TEXT NOT NULL,
    "orderIndex" INTEGER NOT NULL,

    CONSTRAINT "ExamPaperQuestion_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "BankQuestion_subjectId_type_idx" ON "BankQuestion"("subjectId", "type");

-- CreateIndex
CREATE INDEX "ExamPaperQuestion_questionId_idx" ON "ExamPaperQuestion"("questionId");

-- CreateIndex
CREATE UNIQUE INDEX "ExamPaperQuestion_examPaperId_questionId_key" ON "ExamPaperQuestion"("examPaperId", "questionId");

-- AddForeignKey
ALTER TABLE "BankQuestion" ADD CONSTRAINT "BankQuestion_subjectId_fkey" FOREIGN KEY ("subjectId") REFERENCES "Subject"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExamPaperQuestion" ADD CONSTRAINT "ExamPaperQuestion_examPaperId_fkey" FOREIGN KEY ("examPaperId") REFERENCES "ExamPaper"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExamPaperQuestion" ADD CONSTRAINT "ExamPaperQuestion_questionId_fkey" FOREIGN KEY ("questionId") REFERENCES "BankQuestion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
