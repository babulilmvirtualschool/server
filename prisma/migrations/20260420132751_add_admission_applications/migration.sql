-- CreateTable
CREATE TABLE "AdmissionApplication" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "firstName" TEXT NOT NULL,
    "lastName" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "city" TEXT NOT NULL,
    "dateOfBirth" DATE,
    "fatherName" TEXT,
    "fatherCnic" TEXT,
    "fatherPhone" TEXT,
    "motherName" TEXT,
    "motherCnic" TEXT,
    "motherPhone" TEXT,
    "guardianName" TEXT,
    "guardianRelation" TEXT,
    "guardianPhone" TEXT,
    "gradeLevel" TEXT NOT NULL,
    "curriculum" TEXT NOT NULL,
    "preferredShift" TEXT NOT NULL,
    "studentBFormNo" TEXT,

    CONSTRAINT "AdmissionApplication_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AdmissionApplication_createdAt_idx" ON "AdmissionApplication"("createdAt" DESC);

-- CreateIndex
CREATE INDEX "AdmissionApplication_email_idx" ON "AdmissionApplication"("email");
