-- CreateEnum
CREATE TYPE "SalaryStatus" AS ENUM ('UNPAID', 'PARTIAL', 'PAID');

-- CreateEnum
CREATE TYPE "CashEntryType" AS ENUM ('EXPENSE', 'INCOME');

-- AlterTable
ALTER TABLE "SalaryPayment" ADD COLUMN     "paidAmount" DOUBLE PRECISION NOT NULL DEFAULT 0,
ADD COLUMN     "slipNo" TEXT,
ADD COLUMN     "status" "SalaryStatus" NOT NULL DEFAULT 'UNPAID',
ALTER COLUMN "paidAt" DROP NOT NULL,
ALTER COLUMN "method" DROP NOT NULL,
ALTER COLUMN "paidById" DROP NOT NULL;

-- CreateTable
CREATE TABLE "SalaryAdvance" (
    "id" TEXT NOT NULL,
    "teacherId" TEXT NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL,
    "givenOn" DATE NOT NULL,
    "monthlyDeduction" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "recovered" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "method" "PaymentMethod" NOT NULL DEFAULT 'CASH',
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SalaryAdvance_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SalaryFine" (
    "id" TEXT NOT NULL,
    "teacherId" TEXT NOT NULL,
    "period" TEXT NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL,
    "reason" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SalaryFine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CashCategory" (
    "id" TEXT NOT NULL,
    "campus" "Campus" NOT NULL DEFAULT 'ONLINE',
    "type" "CashEntryType" NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CashCategory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CashEntry" (
    "id" TEXT NOT NULL,
    "campus" "Campus" NOT NULL DEFAULT 'ONLINE',
    "type" "CashEntryType" NOT NULL,
    "categoryId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL,
    "title" TEXT NOT NULL,
    "party" TEXT,
    "method" "PaymentMethod" NOT NULL DEFAULT 'CASH',
    "reference" TEXT,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CashEntry_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SalaryAdvance_teacherId_idx" ON "SalaryAdvance"("teacherId");

-- CreateIndex
CREATE INDEX "SalaryFine_teacherId_period_idx" ON "SalaryFine"("teacherId", "period");

-- CreateIndex
CREATE UNIQUE INDEX "CashCategory_campus_type_name_key" ON "CashCategory"("campus", "type", "name");

-- CreateIndex
CREATE INDEX "CashEntry_campus_type_date_idx" ON "CashEntry"("campus", "type", "date");

-- CreateIndex
CREATE INDEX "CashEntry_categoryId_idx" ON "CashEntry"("categoryId");

-- CreateIndex
CREATE UNIQUE INDEX "SalaryPayment_slipNo_key" ON "SalaryPayment"("slipNo");

-- AddForeignKey
ALTER TABLE "SalaryAdvance" ADD CONSTRAINT "SalaryAdvance_teacherId_fkey" FOREIGN KEY ("teacherId") REFERENCES "TeacherProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SalaryFine" ADD CONSTRAINT "SalaryFine_teacherId_fkey" FOREIGN KEY ("teacherId") REFERENCES "TeacherProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CashEntry" ADD CONSTRAINT "CashEntry_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "CashCategory"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Existing salary records were recorded as paid in full.
UPDATE "SalaryPayment" SET "status" = 'PAID', "paidAmount" = "netAmount";
