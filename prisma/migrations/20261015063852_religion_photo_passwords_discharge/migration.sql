-- AlterTable
ALTER TABLE "AdmissionApplication" ADD COLUMN     "religion" TEXT;

-- AlterTable
ALTER TABLE "StudentProfile" ADD COLUMN     "dischargedAt" TIMESTAMP(3),
ADD COLUMN     "religion" TEXT;

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "issuedPasswordEnc" TEXT;

-- CreateTable
CREATE TABLE "StudentDischarge" (
    "id" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "certificateNo" TEXT NOT NULL,
    "leavingDate" DATE NOT NULL,
    "reason" TEXT NOT NULL,
    "conduct" TEXT,
    "remarks" TEXT,
    "classAtLeaving" TEXT,
    "rollNumber" TEXT,
    "dischargedById" TEXT,
    "readmittedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StudentDischarge_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "StudentDischarge_certificateNo_key" ON "StudentDischarge"("certificateNo");

-- CreateIndex
CREATE INDEX "StudentDischarge_studentId_idx" ON "StudentDischarge"("studentId");

-- AddForeignKey
ALTER TABLE "StudentDischarge" ADD CONSTRAINT "StudentDischarge_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "StudentProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

