-- CreateEnum
CREATE TYPE "AttendanceMode" AS ENUM ('DEFAULT', 'SHIFTS');

-- CreateEnum
CREATE TYPE "SchoolShift" AS ENUM ('MORNING', 'EVENING');

-- AlterTable
ALTER TABLE "AttendanceRecord" ADD COLUMN     "arrivalTime" TEXT;

-- AlterTable
ALTER TABLE "Section" ADD COLUMN     "shift" "SchoolShift";

-- AlterTable
ALTER TABLE "TeacherAttendanceRecord" ADD COLUMN     "arrivalTime" TEXT;

-- CreateTable
CREATE TABLE "AttendanceSettings" (
    "id" TEXT NOT NULL,
    "campus" "Campus" NOT NULL DEFAULT 'ONLINE',
    "mode" "AttendanceMode" NOT NULL DEFAULT 'DEFAULT',
    "lateThresholdMinutes" INTEGER NOT NULL DEFAULT 25,
    "schedules" JSONB NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AttendanceSettings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StaffTiming" (
    "id" TEXT NOT NULL,
    "teacherId" TEXT NOT NULL,
    "shift" "SchoolShift",
    "lateThresholdMinutes" INTEGER,
    "days" JSONB NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StaffTiming_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SchoolClosure" (
    "id" TEXT NOT NULL,
    "campus" "Campus" NOT NULL DEFAULT 'ONLINE',
    "name" TEXT NOT NULL,
    "appliesTo" TEXT[],
    "fromDate" DATE NOT NULL,
    "toDate" DATE NOT NULL,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SchoolClosure_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "AttendanceSettings_campus_key" ON "AttendanceSettings"("campus");

-- CreateIndex
CREATE UNIQUE INDEX "StaffTiming_teacherId_key" ON "StaffTiming"("teacherId");

-- CreateIndex
CREATE INDEX "SchoolClosure_campus_fromDate_idx" ON "SchoolClosure"("campus", "fromDate");

-- AddForeignKey
ALTER TABLE "StaffTiming" ADD CONSTRAINT "StaffTiming_teacherId_fkey" FOREIGN KEY ("teacherId") REFERENCES "TeacherProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

