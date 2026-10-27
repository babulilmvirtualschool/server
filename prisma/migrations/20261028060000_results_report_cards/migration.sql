-- CreateEnum
CREATE TYPE "ResultTermStatus" AS ENUM ('DRAFT', 'COMPILED', 'LOCKED');

-- CreateTable
CREATE TABLE "GradeScale" (
    "id" TEXT NOT NULL,
    "campus" "Campus" NOT NULL DEFAULT 'ONLINE',
    "name" TEXT NOT NULL,
    "academicYearId" TEXT,
    "passPercent" DOUBLE PRECISION NOT NULL DEFAULT 33,
    "bands" JSONB NOT NULL,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GradeScale_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ResultTerm" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "academicYearId" TEXT NOT NULL,
    "gradeScaleId" TEXT,
    "categories" JSONB NOT NULL,
    "fromDate" DATE,
    "toDate" DATE,
    "includeAttendance" BOOLEAN NOT NULL DEFAULT false,
    "attendanceWeight" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "status" "ResultTermStatus" NOT NULL DEFAULT 'DRAFT',
    "compiledAt" TIMESTAMP(3),
    "lockedAt" TIMESTAMP(3),
    "publishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ResultTerm_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ResultEntry" (
    "id" TEXT NOT NULL,
    "termId" TEXT NOT NULL,
    "courseId" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "marks" JSONB NOT NULL,
    "grace" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "percent" DOUBLE PRECISION,
    "grade" TEXT,
    "gradePoint" DOUBLE PRECISION,
    "passed" BOOLEAN,
    "remarks" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ResultEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ResultSummary" (
    "id" TEXT NOT NULL,
    "termId" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "sectionId" TEXT NOT NULL,
    "subjects" INTEGER NOT NULL DEFAULT 0,
    "percent" DOUBLE PRECISION,
    "grade" TEXT,
    "gradePoint" DOUBLE PRECISION,
    "passed" BOOLEAN,
    "sectionPosition" INTEGER,
    "classPosition" INTEGER,
    "schoolPosition" INTEGER,
    "attendanceDays" INTEGER,
    "attendancePresent" INTEGER,
    "attendanceAbsent" INTEGER,
    "attendancePercent" DOUBLE PRECISION,
    "teacherRemarks" TEXT,
    "principalRemarks" TEXT,
    "coCurricular" JSONB,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ResultSummary_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReportCardSettings" (
    "id" TEXT NOT NULL,
    "campus" "Campus" NOT NULL DEFAULT 'ONLINE',
    "template" TEXT NOT NULL DEFAULT 'STANDARD',
    "schoolName" TEXT,
    "principalName" TEXT,
    "logoKey" TEXT,
    "signatureKey" TEXT,
    "footerNote" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ReportCardSettings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ResultEntry_courseId_idx" ON "ResultEntry"("courseId");

-- CreateIndex
CREATE UNIQUE INDEX "ResultEntry_termId_courseId_studentId_key" ON "ResultEntry"("termId", "courseId", "studentId");

-- CreateIndex
CREATE INDEX "ResultSummary_sectionId_idx" ON "ResultSummary"("sectionId");

-- CreateIndex
CREATE UNIQUE INDEX "ResultSummary_termId_studentId_key" ON "ResultSummary"("termId", "studentId");

-- CreateIndex
CREATE UNIQUE INDEX "ReportCardSettings_campus_key" ON "ReportCardSettings"("campus");

-- AddForeignKey
ALTER TABLE "GradeScale" ADD CONSTRAINT "GradeScale_academicYearId_fkey" FOREIGN KEY ("academicYearId") REFERENCES "AcademicYear"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ResultTerm" ADD CONSTRAINT "ResultTerm_academicYearId_fkey" FOREIGN KEY ("academicYearId") REFERENCES "AcademicYear"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ResultTerm" ADD CONSTRAINT "ResultTerm_gradeScaleId_fkey" FOREIGN KEY ("gradeScaleId") REFERENCES "GradeScale"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ResultEntry" ADD CONSTRAINT "ResultEntry_termId_fkey" FOREIGN KEY ("termId") REFERENCES "ResultTerm"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ResultEntry" ADD CONSTRAINT "ResultEntry_courseId_fkey" FOREIGN KEY ("courseId") REFERENCES "Course"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ResultEntry" ADD CONSTRAINT "ResultEntry_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "StudentProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ResultSummary" ADD CONSTRAINT "ResultSummary_termId_fkey" FOREIGN KEY ("termId") REFERENCES "ResultTerm"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ResultSummary" ADD CONSTRAINT "ResultSummary_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "StudentProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ResultSummary" ADD CONSTRAINT "ResultSummary_sectionId_fkey" FOREIGN KEY ("sectionId") REFERENCES "Section"("id") ON DELETE CASCADE ON UPDATE CASCADE;

