-- CreateEnum
CREATE TYPE "DiscountValueType" AS ENUM ('AMOUNT', 'PERCENT');

-- AlterTable
ALTER TABLE "FeeInvoice" ADD COLUMN     "classLabel" TEXT,
ADD COLUMN     "discountTotal" DOUBLE PRECISION NOT NULL DEFAULT 0,
ADD COLUMN     "familyVoucherNo" TEXT,
ADD COLUMN     "lateFee" DOUBLE PRECISION NOT NULL DEFAULT 0,
ADD COLUMN     "prevBalance" DOUBLE PRECISION NOT NULL DEFAULT 0,
ADD COLUMN     "reminderDate" DATE,
ADD COLUMN     "sectionId" TEXT,
ADD COLUMN     "voucherNo" TEXT;

-- AlterTable
ALTER TABLE "FeePayment" ADD COLUMN     "slipNo" TEXT;

-- CreateTable
CREATE TABLE "FeeSettings" (
    "id" TEXT NOT NULL,
    "campus" "Campus" NOT NULL DEFAULT 'ONLINE',
    "currencySymbol" TEXT NOT NULL DEFAULT 'Rs.',
    "sessionStartMonth" INTEGER NOT NULL DEFAULT 4,
    "dueDay" INTEGER NOT NULL DEFAULT 10,
    "lateFeeEnabled" BOOLEAN NOT NULL DEFAULT false,
    "lateFeeAmount" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "printInstructions" BOOLEAN NOT NULL DEFAULT true,
    "instructions" TEXT,
    "hideDiscount" BOOLEAN NOT NULL DEFAULT false,
    "blockDefaulters" BOOLEAN NOT NULL DEFAULT false,
    "defaulterGraceDays" INTEGER NOT NULL DEFAULT 30,
    "voucherCopies" INTEGER NOT NULL DEFAULT 3,
    "siblingPolicyEnabled" BOOLEAN NOT NULL DEFAULT false,
    "siblingMonthlyOnly" BOOLEAN NOT NULL DEFAULT true,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FeeSettings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FeeType" (
    "id" TEXT NOT NULL,
    "classId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "frequency" "FeeFrequency" NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FeeType_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FeeDiscount" (
    "id" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "feeTypeId" TEXT NOT NULL,
    "frequency" "FeeFrequency" NOT NULL,
    "valueType" "DiscountValueType" NOT NULL,
    "value" DOUBLE PRECISION NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "note" TEXT,
    "appliedCount" INTEGER NOT NULL DEFAULT 0,
    "lastAppliedPeriod" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FeeDiscount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SiblingDiscountRule" (
    "id" TEXT NOT NULL,
    "campus" "Campus" NOT NULL DEFAULT 'ONLINE',
    "childNumber" INTEGER NOT NULL,
    "valueType" "DiscountValueType" NOT NULL,
    "value" DOUBLE PRECISION NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SiblingDiscountRule_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "FeeSettings_campus_key" ON "FeeSettings"("campus");

-- CreateIndex
CREATE INDEX "FeeType_classId_idx" ON "FeeType"("classId");

-- CreateIndex
CREATE UNIQUE INDEX "FeeType_classId_name_key" ON "FeeType"("classId", "name");

-- CreateIndex
CREATE INDEX "FeeDiscount_studentId_idx" ON "FeeDiscount"("studentId");

-- CreateIndex
CREATE INDEX "FeeDiscount_feeTypeId_idx" ON "FeeDiscount"("feeTypeId");

-- CreateIndex
CREATE UNIQUE INDEX "SiblingDiscountRule_campus_childNumber_key" ON "SiblingDiscountRule"("campus", "childNumber");

-- CreateIndex
CREATE UNIQUE INDEX "FeeInvoice_voucherNo_key" ON "FeeInvoice"("voucherNo");

-- CreateIndex
CREATE INDEX "FeeInvoice_familyVoucherNo_idx" ON "FeeInvoice"("familyVoucherNo");

-- AddForeignKey
ALTER TABLE "FeeType" ADD CONSTRAINT "FeeType_classId_fkey" FOREIGN KEY ("classId") REFERENCES "Class"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FeeDiscount" ADD CONSTRAINT "FeeDiscount_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "StudentProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FeeDiscount" ADD CONSTRAINT "FeeDiscount_feeTypeId_fkey" FOREIGN KEY ("feeTypeId") REFERENCES "FeeType"("id") ON DELETE CASCADE ON UPDATE CASCADE;

