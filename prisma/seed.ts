import { PrismaClient, Role } from '@prisma/client';
import * as bcrypt from 'bcrypt';

const prisma = new PrismaClient();

async function main() {
  const email = process.env.SEED_ADMIN_EMAIL ?? 'admin@babulilm.local';
  const password = process.env.SEED_ADMIN_PASSWORD ?? 'ChangeMe123!';
  const firstName = process.env.SEED_ADMIN_FIRST_NAME ?? 'School';
  const lastName = process.env.SEED_ADMIN_LAST_NAME ?? 'Admin';

  const existing = await prisma.user.findUnique({ where: { email } });
  if (!existing) {
    const passwordHash = await bcrypt.hash(password, 12);
    await prisma.user.create({
      data: {
        email,
        username: 'admin',
        passwordHash,
        role: Role.ADMIN,
        firstName,
        lastName,
        adminProfile: { create: { title: 'Principal' } },
      },
    });
    console.log(`Seeded admin: ${email} / ${password}`);
  } else {
    console.log(`Admin ${email} already exists, skipping.`);
  }

  const now = new Date();
  const yearName = `${now.getFullYear()}-${now.getFullYear() + 1}`;
  const year = await prisma.academicYear.upsert({
    where: { name: yearName },
    update: {},
    create: {
      name: yearName,
      startDate: new Date(now.getFullYear(), 7, 1),
      endDate: new Date(now.getFullYear() + 1, 5, 30),
      isCurrent: true,
    },
  });
  console.log(`Ensured academic year: ${year.name}`);

  const demoClass = await prisma.class.upsert({
    where: { academicYearId_name: { academicYearId: year.id, name: 'Grade 10' } },
    update: {},
    create: {
      academicYearId: year.id,
      name: 'Grade 10',
      level: 10,
    },
  });

  await prisma.section.upsert({
    where: { classId_name: { classId: demoClass.id, name: 'A' } },
    update: {},
    create: { classId: demoClass.id, name: 'A', room: 'Room 101' },
  });

  for (const s of [
    { name: 'Mathematics', code: 'MATH' },
    { name: 'Physics', code: 'PHY' },
    { name: 'Chemistry', code: 'CHEM' },
    { name: 'English', code: 'ENG' },
    { name: 'Urdu', code: 'URD' },
    { name: 'Islamiat', code: 'ISL' },
  ]) {
    await prisma.subject.upsert({
      where: { name: s.name },
      update: {},
      create: s,
    });
  }

  console.log('Seed complete.');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
