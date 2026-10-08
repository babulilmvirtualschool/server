-- CreateEnum
CREATE TYPE "AttendanceApprovalStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

-- AlterTable
ALTER TABLE "TeacherAttendanceRecord" ADD COLUMN     "approvalStatus" "AttendanceApprovalStatus" NOT NULL DEFAULT 'PENDING',
ADD COLUMN     "reviewNote" TEXT,
ADD COLUMN     "reviewedAt" TIMESTAMP(3),
ADD COLUMN     "reviewedById" TEXT;

-- Records that existed before approvals were introduced were already counted; keep them approved.
UPDATE "TeacherAttendanceRecord" SET "approvalStatus" = 'APPROVED';

-- CreateIndex
CREATE INDEX "TeacherAttendanceRecord_approvalStatus_idx" ON "TeacherAttendanceRecord"("approvalStatus");

-- AddForeignKey
ALTER TABLE "TeacherAttendanceRecord" ADD CONSTRAINT "TeacherAttendanceRecord_reviewedById_fkey" FOREIGN KEY ("reviewedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
