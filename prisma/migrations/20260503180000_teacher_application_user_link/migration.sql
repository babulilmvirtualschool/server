-- AlterTable
ALTER TABLE "TeacherApplication" ADD COLUMN "teacherUserId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "TeacherApplication_teacherUserId_key" ON "TeacherApplication"("teacherUserId");

-- AddForeignKey
ALTER TABLE "TeacherApplication" ADD CONSTRAINT "TeacherApplication_teacherUserId_fkey" FOREIGN KEY ("teacherUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
