-- CreateEnum
CREATE TYPE "StaffType" AS ENUM ('TEACHING', 'NON_TEACHING');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "MessageTemplateKind" ADD VALUE 'EMERGENCY';
ALTER TYPE "MessageTemplateKind" ADD VALUE 'SECURITY';

-- AlterEnum
ALTER TYPE "Role" ADD VALUE 'STAFF';

-- AlterTable
ALTER TABLE "TeacherApplication" ADD COLUMN     "designation" TEXT,
ADD COLUMN     "staffType" "StaffType" NOT NULL DEFAULT 'TEACHING',
ALTER COLUMN "subjectExpertise" DROP NOT NULL;

-- AlterTable
ALTER TABLE "TeacherProfile" ADD COLUMN     "designation" TEXT,
ADD COLUMN     "documents" JSONB;

