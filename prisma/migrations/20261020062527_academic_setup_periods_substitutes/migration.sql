-- CreateEnum
CREATE TYPE "AcademicYearStatus" AS ENUM ('ACTIVE', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "SubjectType" AS ENUM ('THEORY', 'PRACTICAL');

-- CreateEnum
CREATE TYPE "SubjectCategory" AS ENUM ('CORE', 'ELECTIVE');

-- CreateEnum
CREATE TYPE "ContentProgress" AS ENUM ('PENDING', 'IN_PROGRESS', 'COMPLETE');

-- AlterTable
ALTER TABLE "AcademicYear" ADD COLUMN     "code" TEXT,
ADD COLUMN     "status" "AcademicYearStatus" NOT NULL DEFAULT 'ACTIVE';

-- AlterTable
ALTER TABLE "Course" ADD COLUMN     "weeklyHours" INTEGER;

-- AlterTable
ALTER TABLE "Lesson" ADD COLUMN     "progress" "ContentProgress" NOT NULL DEFAULT 'PENDING';

-- AlterTable
ALTER TABLE "Section" ADD COLUMN     "capacity" INTEGER;

-- AlterTable
ALTER TABLE "Subject" ADD COLUMN     "category" "SubjectCategory" NOT NULL DEFAULT 'CORE',
ADD COLUMN     "passingMarks" INTEGER,
ADD COLUMN     "totalMarks" INTEGER,
ADD COLUMN     "type" "SubjectType" NOT NULL DEFAULT 'THEORY';

-- AlterTable
ALTER TABLE "TimetableSlot" ADD COLUMN     "periodId" TEXT;

-- AlterTable
ALTER TABLE "Topic" ADD COLUMN     "progress" "ContentProgress" NOT NULL DEFAULT 'PENDING';

-- CreateTable
CREATE TABLE "TimetablePeriod" (
    "id" TEXT NOT NULL,
    "campus" "Campus" NOT NULL DEFAULT 'ONLINE',
    "name" TEXT NOT NULL,
    "startTime" TEXT NOT NULL,
    "endTime" TEXT NOT NULL,
    "isBreak" BOOLEAN NOT NULL DEFAULT false,
    "orderIndex" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TimetablePeriod_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PeriodAttendance" (
    "id" TEXT NOT NULL,
    "slotId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "teacherId" TEXT NOT NULL,
    "status" "TeacherAttendanceStatus" NOT NULL,
    "substituteTeacherId" TEXT,
    "remarks" TEXT,
    "recordedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PeriodAttendance_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PeriodLeaveRequest" (
    "id" TEXT NOT NULL,
    "teacherId" TEXT NOT NULL,
    "slotId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "reason" TEXT NOT NULL,
    "status" "LeaveRequestStatus" NOT NULL DEFAULT 'PENDING',
    "substituteTeacherId" TEXT,
    "reviewNote" TEXT,
    "reviewedById" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PeriodLeaveRequest_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "TimetablePeriod_campus_idx" ON "TimetablePeriod"("campus");

-- CreateIndex
CREATE INDEX "PeriodAttendance_date_idx" ON "PeriodAttendance"("date");

-- CreateIndex
CREATE INDEX "PeriodAttendance_teacherId_idx" ON "PeriodAttendance"("teacherId");

-- CreateIndex
CREATE INDEX "PeriodAttendance_substituteTeacherId_idx" ON "PeriodAttendance"("substituteTeacherId");

-- CreateIndex
CREATE UNIQUE INDEX "PeriodAttendance_slotId_date_key" ON "PeriodAttendance"("slotId", "date");

-- CreateIndex
CREATE INDEX "PeriodLeaveRequest_teacherId_status_idx" ON "PeriodLeaveRequest"("teacherId", "status");

-- CreateIndex
CREATE INDEX "PeriodLeaveRequest_status_idx" ON "PeriodLeaveRequest"("status");

-- CreateIndex
CREATE INDEX "PeriodLeaveRequest_date_idx" ON "PeriodLeaveRequest"("date");

-- AddForeignKey
ALTER TABLE "TimetableSlot" ADD CONSTRAINT "TimetableSlot_periodId_fkey" FOREIGN KEY ("periodId") REFERENCES "TimetablePeriod"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PeriodAttendance" ADD CONSTRAINT "PeriodAttendance_slotId_fkey" FOREIGN KEY ("slotId") REFERENCES "TimetableSlot"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PeriodAttendance" ADD CONSTRAINT "PeriodAttendance_teacherId_fkey" FOREIGN KEY ("teacherId") REFERENCES "TeacherProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PeriodAttendance" ADD CONSTRAINT "PeriodAttendance_substituteTeacherId_fkey" FOREIGN KEY ("substituteTeacherId") REFERENCES "TeacherProfile"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PeriodAttendance" ADD CONSTRAINT "PeriodAttendance_recordedById_fkey" FOREIGN KEY ("recordedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PeriodLeaveRequest" ADD CONSTRAINT "PeriodLeaveRequest_teacherId_fkey" FOREIGN KEY ("teacherId") REFERENCES "TeacherProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PeriodLeaveRequest" ADD CONSTRAINT "PeriodLeaveRequest_slotId_fkey" FOREIGN KEY ("slotId") REFERENCES "TimetableSlot"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PeriodLeaveRequest" ADD CONSTRAINT "PeriodLeaveRequest_substituteTeacherId_fkey" FOREIGN KEY ("substituteTeacherId") REFERENCES "TeacherProfile"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PeriodLeaveRequest" ADD CONSTRAINT "PeriodLeaveRequest_reviewedById_fkey" FOREIGN KEY ("reviewedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

