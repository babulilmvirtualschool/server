-- CreateEnum
CREATE TYPE "MessageTemplateKind" AS ENUM ('ABSENCE', 'LATE', 'LEAVE', 'ATTENDANCE_ALERT', 'GENERAL_NOTICE');

-- AlterTable
ALTER TABLE "StudentProfile" ADD COLUMN     "graduatedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "MessageTemplate" (
    "id" TEXT NOT NULL,
    "campus" "Campus" NOT NULL DEFAULT 'ONLINE',
    "kind" "MessageTemplateKind" NOT NULL,
    "name" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MessageTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "MessageTemplate_campus_kind_idx" ON "MessageTemplate"("campus", "kind");

