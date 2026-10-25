-- CreateEnum
CREATE TYPE "LiveClassPlatform" AS ENUM ('GOOGLE_MEET', 'ZOOM', 'OTHER');

-- AlterTable
ALTER TABLE "Assignment" ADD COLUMN     "isPublished" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "publishedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "AssignmentGrade" ADD COLUMN     "emoji" TEXT,
ADD COLUMN     "stars" INTEGER,
ALTER COLUMN "marksObtained" DROP NOT NULL;

-- AlterTable
ALTER TABLE "LiveClass" ADD COLUMN     "platform" "LiveClassPlatform" NOT NULL DEFAULT 'OTHER';

-- CreateTable
CREATE TABLE "DiarySubmission" (
    "id" TEXT NOT NULL,
    "diaryEntryId" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "text" TEXT,
    "attachments" JSONB,
    "submittedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "checked" BOOLEAN NOT NULL DEFAULT false,
    "checkedAt" TIMESTAMP(3),
    "checkedById" TEXT,
    "grade" TEXT,
    "stars" INTEGER,
    "remarks" TEXT,

    CONSTRAINT "DiarySubmission_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LiveClassPoll" (
    "id" TEXT NOT NULL,
    "liveClassId" TEXT NOT NULL,
    "question" TEXT NOT NULL,
    "options" JSONB NOT NULL,
    "correctOption" INTEGER,
    "durationSeconds" INTEGER NOT NULL DEFAULT 120,
    "openedAt" TIMESTAMP(3),
    "closesAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LiveClassPoll_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LiveClassPollResponse" (
    "id" TEXT NOT NULL,
    "pollId" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "option" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LiveClassPollResponse_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "DiarySubmission_studentId_idx" ON "DiarySubmission"("studentId");

-- CreateIndex
CREATE UNIQUE INDEX "DiarySubmission_diaryEntryId_studentId_key" ON "DiarySubmission"("diaryEntryId", "studentId");

-- CreateIndex
CREATE INDEX "LiveClassPoll_liveClassId_idx" ON "LiveClassPoll"("liveClassId");

-- CreateIndex
CREATE UNIQUE INDEX "LiveClassPollResponse_pollId_studentId_key" ON "LiveClassPollResponse"("pollId", "studentId");

-- AddForeignKey
ALTER TABLE "DiarySubmission" ADD CONSTRAINT "DiarySubmission_diaryEntryId_fkey" FOREIGN KEY ("diaryEntryId") REFERENCES "DiaryEntry"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DiarySubmission" ADD CONSTRAINT "DiarySubmission_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "StudentProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LiveClassPoll" ADD CONSTRAINT "LiveClassPoll_liveClassId_fkey" FOREIGN KEY ("liveClassId") REFERENCES "LiveClass"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LiveClassPollResponse" ADD CONSTRAINT "LiveClassPollResponse_pollId_fkey" FOREIGN KEY ("pollId") REFERENCES "LiveClassPoll"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LiveClassPollResponse" ADD CONSTRAINT "LiveClassPollResponse_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "StudentProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Existing live classes: platform from their link.
UPDATE "LiveClass" SET "platform" = 'GOOGLE_MEET' WHERE "meetingLink" ILIKE '%meet.google.com%';
UPDATE "LiveClass" SET "platform" = 'ZOOM' WHERE "meetingLink" ILIKE '%zoom.us%';
