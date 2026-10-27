-- CreateEnum
CREATE TYPE "QuestionDifficulty" AS ENUM ('EASY', 'MEDIUM', 'HARD');

-- CreateEnum
CREATE TYPE "ConductPeriod" AS ENUM ('WEEKLY', 'HALF_MONTHLY', 'MONTHLY');

-- CreateEnum
CREATE TYPE "ConductRating" AS ENUM ('EXCELLENT', 'GOOD', 'SATISFACTORY', 'NEEDS_IMPROVEMENT');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "BankQuestionType" ADD VALUE 'TRUE_FALSE';
ALTER TYPE "BankQuestionType" ADD VALUE 'TICK_CROSS';
ALTER TYPE "BankQuestionType" ADD VALUE 'MATCHING';
ALTER TYPE "BankQuestionType" ADD VALUE 'SHORT';
ALTER TYPE "BankQuestionType" ADD VALUE 'LONG';

-- AlterTable
ALTER TABLE "BankQuestion" ADD COLUMN     "chapterNo" INTEGER,
ADD COLUMN     "chapterTitle" TEXT,
ADD COLUMN     "className" TEXT,
ADD COLUMN     "createdById" TEXT,
ADD COLUMN     "difficulty" "QuestionDifficulty" NOT NULL DEFAULT 'MEDIUM',
ADD COLUMN     "explanation" TEXT,
ADD COLUMN     "isActive" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "pairs" JSONB,
ADD COLUMN     "parts" JSONB,
ADD COLUMN     "topic" TEXT;

-- CreateTable
CREATE TABLE "PaperPattern" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "subjectId" TEXT NOT NULL,
    "className" TEXT,
    "chapters" INTEGER[],
    "rows" JSONB NOT NULL,
    "header" JSONB,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PaperPattern_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "QuestionPaper" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "schoolName" TEXT,
    "examName" TEXT,
    "subjectId" TEXT NOT NULL,
    "className" TEXT,
    "totalMinutes" INTEGER,
    "totalMarks" DOUBLE PRECISION,
    "instructions" TEXT,
    "chapters" INTEGER[],
    "layout" JSONB,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "examPaperId" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "QuestionPaper_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "QuestionPaperItem" (
    "id" TEXT NOT NULL,
    "paperId" TEXT NOT NULL,
    "questionId" TEXT NOT NULL,
    "orderIndex" INTEGER NOT NULL,
    "marks" DOUBLE PRECISION,

    CONSTRAINT "QuestionPaperItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ConductAssessment" (
    "id" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "sectionId" TEXT NOT NULL,
    "period" "ConductPeriod" NOT NULL,
    "startDate" DATE NOT NULL,
    "endDate" DATE NOT NULL,
    "assessmentDate" DATE NOT NULL,
    "discipline" "ConductRating",
    "regularity" "ConductRating",
    "punctuality" "ConductRating",
    "obedience" "ConductRating",
    "followingInstructions" "ConductRating",
    "homework" "ConductRating",
    "learning" "ConductRating",
    "overall" "ConductRating",
    "remarks" TEXT,
    "assessedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ConductAssessment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PaperPattern_subjectId_idx" ON "PaperPattern"("subjectId");

-- CreateIndex
CREATE UNIQUE INDEX "QuestionPaper_examPaperId_key" ON "QuestionPaper"("examPaperId");

-- CreateIndex
CREATE INDEX "QuestionPaper_subjectId_idx" ON "QuestionPaper"("subjectId");

-- CreateIndex
CREATE INDEX "QuestionPaperItem_questionId_idx" ON "QuestionPaperItem"("questionId");

-- CreateIndex
CREATE UNIQUE INDEX "QuestionPaperItem_paperId_questionId_key" ON "QuestionPaperItem"("paperId", "questionId");

-- CreateIndex
CREATE INDEX "ConductAssessment_sectionId_period_startDate_idx" ON "ConductAssessment"("sectionId", "period", "startDate");

-- CreateIndex
CREATE UNIQUE INDEX "ConductAssessment_studentId_period_startDate_key" ON "ConductAssessment"("studentId", "period", "startDate");

-- CreateIndex
CREATE INDEX "BankQuestion_subjectId_chapterNo_idx" ON "BankQuestion"("subjectId", "chapterNo");

-- AddForeignKey
ALTER TABLE "BankQuestion" ADD CONSTRAINT "BankQuestion_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaperPattern" ADD CONSTRAINT "PaperPattern_subjectId_fkey" FOREIGN KEY ("subjectId") REFERENCES "Subject"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaperPattern" ADD CONSTRAINT "PaperPattern_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuestionPaper" ADD CONSTRAINT "QuestionPaper_subjectId_fkey" FOREIGN KEY ("subjectId") REFERENCES "Subject"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuestionPaper" ADD CONSTRAINT "QuestionPaper_examPaperId_fkey" FOREIGN KEY ("examPaperId") REFERENCES "ExamPaper"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuestionPaper" ADD CONSTRAINT "QuestionPaper_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuestionPaperItem" ADD CONSTRAINT "QuestionPaperItem_paperId_fkey" FOREIGN KEY ("paperId") REFERENCES "QuestionPaper"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuestionPaperItem" ADD CONSTRAINT "QuestionPaperItem_questionId_fkey" FOREIGN KEY ("questionId") REFERENCES "BankQuestion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConductAssessment" ADD CONSTRAINT "ConductAssessment_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "StudentProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConductAssessment" ADD CONSTRAINT "ConductAssessment_sectionId_fkey" FOREIGN KEY ("sectionId") REFERENCES "Section"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConductAssessment" ADD CONSTRAINT "ConductAssessment_assessedById_fkey" FOREIGN KEY ("assessedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- Keep papers already made with the old paper generator (ExamPaperQuestion): copy each into a QuestionPaper linked to its
-- date-sheet paper, same questions in the same order. Only inserts rows; existing rows are not changed.
INSERT INTO "QuestionPaper" ("id", "title", "examName", "subjectId", "className", "totalMinutes", "totalMarks", "chapters", "status", "examPaperId", "createdAt", "updatedAt")
SELECT 'qp' || substr(md5(ep."id" || clock_timestamp()::text), 1, 23),
       COALESCE(ep."title", e."name" || ' — ' || s."name"),
       e."name", c."subjectId", cl."name", ep."durationMinutes", ep."maxMarks", ARRAY[]::INTEGER[], 'FINAL', ep."id",
       CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "ExamPaper" ep
JOIN "Exam" e ON e."id" = ep."examId"
JOIN "Course" c ON c."id" = ep."courseId"
JOIN "Subject" s ON s."id" = c."subjectId"
JOIN "Section" sec ON sec."id" = c."sectionId"
JOIN "Class" cl ON cl."id" = sec."classId"
WHERE EXISTS (SELECT 1 FROM "ExamPaperQuestion" q WHERE q."examPaperId" = ep."id");

INSERT INTO "QuestionPaperItem" ("id", "paperId", "questionId", "orderIndex")
SELECT 'qi' || substr(md5(epq."id" || clock_timestamp()::text), 1, 23), qp."id", epq."questionId", epq."orderIndex"
FROM "ExamPaperQuestion" epq
JOIN "QuestionPaper" qp ON qp."examPaperId" = epq."examPaperId";
