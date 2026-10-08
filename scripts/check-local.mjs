import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { S3Client, DeleteObjectCommand } from '@aws-sdk/client-s3';

process.loadEnvFile();
const dbUrl = new URL(process.env.DATABASE_URL);
const storageUrl = new URL(process.env.R2_ENDPOINT);
assert.equal(process.env.NODE_ENV, 'development');
assert.ok(['localhost', '127.0.0.1'].includes(dbUrl.hostname));
assert.ok(['localhost', '127.0.0.1'].includes(storageUrl.hostname));
const base = 'http://localhost:4000/api/v1';
const prisma = new PrismaClient();
const suffix = randomBytes(5).toString('hex');
const password = randomBytes(20).toString('hex');
const usernames = ['student', 'father', 'mother', 'teacher'].map((role) => `check_${role}_${suffix}`);
let admissionId, teacherId, courseId, enrollmentId, cvKey;
async function api(path, { method = 'GET', body, token, status } = {}) {
  const response = await fetch(base + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const payload = await response.json();
  if (status) { assert.equal(response.status, status, `${method} ${path}`); return payload; }
  assert.ok(response.ok, `${method} ${path}: ${JSON.stringify(payload)}`);
  return payload.data;
}
try {
  assert.equal((await api('/health/db')).status, 'ok');
  await api('/users', { status: 401 });
  const admin = await api('/auth/login', { method: 'POST', body: { email: process.env.SEED_ADMIN_EMAIL, password: process.env.SEED_ADMIN_PASSWORD } });
  const token = admin.accessToken;
  for (const path of ['/auth/me', '/academic-years', '/classes', '/sections', '/subjects', '/courses', '/users', '/applications/admissions', '/applications/teachers', '/announcements', '/notifications', '/fee-invoices', '/exams']) {
    await api(path, { token });
  }
  console.log('PASS database, admin login, protected APIs and dashboard lists');
  const pdf = Buffer.from('%PDF-1.4\nLocal upload verification\n%%EOF');
  const cv = await api('/applications/teachers/cv-presign', { method: 'POST', body: { mimeType: 'application/pdf', size: pdf.length, originalName: 'local-check.pdf' } });
  cvKey = cv.key;
  const preflight = await fetch(cv.uploadUrl, { method: 'OPTIONS', headers: { Origin: 'http://localhost:3000', 'Access-Control-Request-Method': 'PUT', 'Access-Control-Request-Headers': 'content-type' } });
  assert.ok(['*', 'http://localhost:3000'].includes(preflight.headers.get('access-control-allow-origin')));
  const upload = await fetch(cv.uploadUrl, { method: 'PUT', headers: { 'Content-Type': 'application/pdf' }, body: pdf });
  assert.ok(upload.ok, `CV upload: ${await upload.text()}`);
  const teacherApp = await api('/applications/teachers', { method: 'POST', body: { firstName: 'Local', lastName: 'CheckTeacher', phone: `teacher-${suffix}`, email: `teacher-${suffix}@example.test`, city: 'Local test', cnic: 'TEST-ONLY', subjectExpertise: 'Mathematics', highestQualification: 'Local test', teachingExperience: 'Local test', cvKey, cvOriginalName: 'local-check.pdf' } });
  teacherId = teacherApp.id;
  const download = await api(`/applications/teachers/${teacherId}/cv-download`, { token });
  assert.deepEqual(Buffer.from(await (await fetch(download.url)).arrayBuffer()), pdf);
  await api(`/applications/teachers/${teacherId}`, { method: 'PATCH', token, body: { status: 'APPROVED', teacherUsername: usernames[3], teacherPassword: password, employeeCode: `CHK-${suffix}` } });
  console.log('PASS signed upload/download, upload CORS and teacher application approval');
  const admission = await api('/applications/admissions', { method: 'POST', body: { firstName: 'Local', lastName: 'CheckStudent', phone: `student-${suffix}`, city: 'Local test', gradeLevel: 'Grade 10', curriculum: 'Local test', preferredShift: 'morning', fatherName: 'Check Father', motherName: 'Check Mother' } });
  admissionId = admission.id;
  await api(`/applications/admissions/${admissionId}`, { method: 'PATCH', token, body: { status: 'APPROVED', studentUsername: usernames[0], fatherUsername: usernames[1], motherUsername: usernames[2], studentPassword: password, fatherPassword: password, motherPassword: password } });
  const sessions = [];
  for (const [i, username] of usernames.entries()) {
    const session = await api('/auth/login', { method: 'POST', body: { username, password } });
    assert.equal(session.user.role, ['STUDENT', 'PARENT', 'PARENT', 'TEACHER'][i]);
    sessions.push(session);
    await api('/users', { token: session.accessToken, status: 403 });
    await api('/auth/me', { token: session.accessToken });
  }
  console.log('PASS admissions approval, student/parent/teacher login and role restrictions');
  const year = await api('/academic-years/current', { token });
  const sections = await api('/sections', { token });
  const subjects = await api('/subjects', { token });
  const teacher = await prisma.user.findUniqueOrThrow({ where: { username: usernames[3] }, include: { teacherProfile: true } });
  const student = await prisma.user.findUniqueOrThrow({ where: { username: usernames[0] }, include: { studentProfile: true } });
  const course = await api('/courses', { method: 'POST', token, body: { academicYearId: year.id, sectionId: sections[0].id, subjectId: subjects[0].id, teacherId: teacher.teacherProfile.id, description: 'Temporary local integration check' } });
  courseId = course.id;
  const enrollment = await api('/enrollments', { method: 'POST', token, body: { studentId: student.studentProfile.id, sectionId: sections[0].id, academicYearId: year.id, rollNumber: `CHK-${suffix}` } });
  enrollmentId = enrollment.id;
  const studentCourses = await api('/courses', { token: sessions[0].accessToken });
  assert.ok(studentCourses.some((item) => item.id === courseId));
  const refreshed = await api('/auth/refresh', { method: 'POST', body: { refreshToken: sessions[0].refreshToken } });
  await api('/auth/me', { token: refreshed.accessToken });
  await api('/auth/refresh', { method: 'POST', body: { refreshToken: sessions[0].refreshToken }, status: 401 });
  console.log('PASS course creation, enrollment, student course access and refresh token rotation');
  const recover = await api('/auth/forgot-password', { method: 'POST', body: { email: teacherApp.email } });
  assert.ok(recover.debugToken);
  const newPassword = randomBytes(20).toString('hex');
  await api('/auth/reset-password', { method: 'POST', body: { token: recover.debugToken, newPassword } });
  await api('/auth/login', { method: 'POST', body: { username: usernames[3], password: newPassword } });
  await api('/auth/reset-password', { method: 'POST', body: { token: recover.debugToken, newPassword }, status: 400 });
  console.log('PASS password recovery, reset and single-use reset tokens');
} finally {
  if (enrollmentId) await prisma.studentEnrollment.delete({ where: { id: enrollmentId } });
  if (courseId) await prisma.course.delete({ where: { id: courseId } });
  if (admissionId) await prisma.admissionApplication.delete({ where: { id: admissionId } });
  if (teacherId) await prisma.teacherApplication.delete({ where: { id: teacherId } });
  await prisma.user.deleteMany({ where: { username: { in: usernames } } });
  if (cvKey) {
    const storage = new S3Client({ region: process.env.R2_REGION, endpoint: process.env.R2_ENDPOINT, forcePathStyle: true, credentials: { accessKeyId: process.env.R2_ACCESS_KEY_ID, secretAccessKey: process.env.R2_SECRET_ACCESS_KEY } });
    await storage.send(new DeleteObjectCommand({ Bucket: process.env.R2_BUCKET, Key: cvKey }));
    storage.destroy();
  }
  await prisma.$disconnect();
  console.log('Temporary integration data cleaned up.');
}
