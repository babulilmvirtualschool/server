# Bab-ul-Ilm backend (`server/`) — agent guide

NestJS 11 API for the Bab-ul-Ilm LMS. Independent Git repo; the Next.js frontend is the
sibling repo `../web/` and talks to this one **only over HTTP** (`/api/v1`). Keep it that way:
no shared packages, no imports across repos, no parent-level repo.

> Written from a full read of the source on 2026-10-08. **Code is the source of truth.**
> `README.md` and `docs/roles/*.md` are partly stale (see §10) — don't trust them over this file or the code.

---

## 1. Stack & commands

- Node 20+ (local machine uses Node 24), TypeScript 5 (`strictNullChecks` on, `noImplicitAny` off), CommonJS.
- NestJS 11, `@nestjs/swagger`, `@nestjs/schedule`, `nestjs-pino` logging, `helmet`.
- Prisma 5.22 + PostgreSQL 16. bcrypt (cost 12). JWT via passport-jwt. Zod for env validation.
- Storage: Cloudflare R2 through `@aws-sdk/client-s3` + presigner (local: S3rver).

| Command | What it does |
|---|---|
| `npm run start:dev` | Nest watch mode on `PORT` (4000) |
| `npm run build` / `npm run start:prod` | compile to `dist/` / run `dist/main.js` |
| `npx prisma migrate dev --name x` (`npm run prisma:migrate`) | create + apply a migration locally |
| `npm run prisma:migrate:deploy` | apply checked-in migrations (CI/prod) |
| `npm run prisma:generate` | regenerate client after schema edits |
| `npm run prisma:seed` | idempotent seed (admin, current year, Grade 10/A, 6 subjects) |
| `npm run prisma:studio` | DB browser |
| `npm run local:setup` / `local:services` / `local:check` | create local `.env` / run embedded PG + S3rver / E2E smoke test |
| `scripts/Start-Local.ps1`, `scripts/Stop-Local.ps1` | Windows one-shot start/stop of DB, storage, API **and** `../web` |

`lint`, `test`, `test:e2e`, `format` scripts exist but are **not functional**: there are no spec
files, no `test/` folder, and ESLint is not installed/configured. Verification today = `npm run build`
+ Swagger + `npm run local:check` (local-only; it refuses non-localhost DB/storage).

Local data/logs live in `.local/` (git-ignored): `postgres/`, `storage/`, `api.log`, `processes.json`.

## 2. Environment (`src/config/env.schema.ts`, validated at boot)

`NODE_ENV` (development|test|production), `PORT`=4000, `APP_URL`, `CORS_ORIGINS` (CSV, no trailing slash;
prod: `https://www.babulilmvirtualschool.com,https://babulilmvirtualschool.com`), `DATABASE_URL`,
`JWT_ACCESS_SECRET`/`JWT_REFRESH_SECRET` (≥16 chars), `JWT_ACCESS_TTL`=15m, `JWT_REFRESH_TTL`=7d,
`R2_ACCOUNT_ID`, `R2_BUCKET`, `R2_ENDPOINT?` (local `http://127.0.0.1:4569`), `R2_ACCESS_KEY_ID?`,
`R2_SECRET_ACCESS_KEY?`, `R2_REGION`=auto, `R2_PRESIGN_EXPIRES_SECONDS`=900, `SEED_ADMIN_*`.
Read config through `AppConfigService` (global), never `process.env` in services.
Adding a var = add to `env.schema.ts` + getter in `app-config.service.ts` + `.env.example`.
`NODE_ENV` must be `production` in prod, otherwise `/auth/forgot-password` leaks `debugToken`.

## 3. Request pipeline (`src/main.ts`)

`setGlobalPrefix('api')` + URI versioning default `v1` → every route is `/api/v1/<controller path>`.
Global, in order: `helmet` → CORS (`credentials:true`) → `ValidationPipe({ whitelist, forbidNonWhitelisted,
transform, enableImplicitConversion })` → `JwtAuthGuard` → `RolesGuard` → `TransformInterceptor` → `AllExceptionsFilter`.

- **Every route requires a valid access token** unless decorated `@Public()`.
- `@Roles(Role.X, ...)` (method or class level) restricts by role; no decorator = any authenticated user.
- `@CurrentUser()` gives `{ id, role, email, username }` (User.id, *not* profile id). `JwtStrategy.validate`
  re-reads the user each request, so deactivating a user blocks them immediately.
- Unknown body fields → 400 (forbidNonWhitelisted). Every DTO property needs a class-validator decorator.
- Arrays as the top-level body (`exam-papers/:id/results/bulk`, `attempts/:id/grade`) are **not validated**
  by the global pipe; use `new ParseArrayPipe({ items: Dto })` if you touch them.
- Responses: return plain data → `{success:true,data}`; return `{data, meta}` → passed through.
- Errors: throw Nest HTTP exceptions. For per-field form errors throw
  `new BadRequestException({ message, fields: { fieldName: 'msg' } })` — the web forms render `fields`.
  Prisma `P2002`→409, `P2025`→404, `P2003`→400 are mapped automatically.
- Swagger at `/api/docs` (bearer persisted). Health: `GET /health`, `GET /health/db` (public).

## 4. Layout & module conventions

```
src/
  main.ts, app.module.ts            # register every new module in AppModule.imports
  common/  decorators (Public, Roles, CurrentUser) · guards · interceptors · filters
           pagination/pagination.dto.ts (PaginationDto, getSkipTake, paginate) · utils/username.util.ts
  config/  env.schema.ts · app-config.service.ts (global)
  prisma/  PrismaService (global)
  modules/<feature>/  <feature>.module.ts · .controller.ts · .service.ts · dto/*.dto.ts · optional *.util.ts
```

Patterns to copy:
- Controllers are thin: `@ApiTags`, `@ApiBearerAuth`, `@Controller()` (often empty path so routes like
  `courses/:courseId/assignments` can live in the feature module), `@Roles`, delegate to service.
- Services own authorization beyond role: e.g. `assertCourseTeacher(courseId, user)` (ADMIN passes; TEACHER
  must be `course.teacher.userId === user.id`), `ensureParentOf`, enrollment checks via `studentProfile.enrollments`.
  Copy this for any new course-scoped write.
- Update DTOs: `PartialType(CreateDto)` from `@nestjs/swagger`.
- Dates in DTOs: `@IsDateString()`; convert with `new Date(...)` in the service.
- Lists that can grow: extend `PaginationDto`, use `getSkipTake` + `paginate`, run count+findMany in `$transaction([...])`.
- Multi-row writes: `prisma.$transaction(async tx => ...)`; long provisioning uses `{ timeout: 60_000, maxWait: 10_000 }`.
- Global modules (inject anywhere without importing): `PrismaModule`, `AppConfigModule`, `MediaModule`
  (`MediaService`, `R2Service`), `NotificationsModule` (`NotificationsService.push(userId, type, title, body?, data?)`).
- Cross-module reuse: export the service and import the module (e.g. `ApplicationsModule` imports `UsersModule`).
- **New code must select user fields explicitly** (id, firstName, lastName, email, username, phone, avatarKey, role, isActive).
  Don't add more `include: { user: true }` (see Known issues #1).
- Usernames: `^[a-z0-9][a-z0-9._]{2,31}$/i`, stored lower-case. The regex is duplicated in
  `common/utils/username.util.ts`, `users/dto/create-student-with-parents.dto.ts`,
  `applications/dto/update-admission-status.dto.ts`, `update-teacher-status.dto.ts` — keep in sync.

## 5. Data model notes (`prisma/schema.prisma`, 14 sections)

- `User` (cuid id; `email`, `username`, `phone` all optional + unique; at least email or username required by
  service code) with exactly one profile matching `role`. Deleting a user cascades the profile.
- Profile ids ≠ user ids. `Course.teacherId`, `Section.classTeacherId` → `TeacherProfile.id`;
  `StudentEnrollment.studentId`, `ExamResult.studentId`, `FeeInvoice.studentId` → `StudentProfile.id`.
- Student course access = `StudentEnrollment(studentId, sectionId, academicYearId)`; courses are found by
  `course.sectionId ∈ enrolled sections`. Unique per student per year, and `rollNumber` unique per section.
- `AcademicYear.isCurrent` is kept single by the service (sets others false in a transaction).
- `AttendanceRecord`: `date @db.Date`; `courseId` null = daily homeroom record (needs `sectionId`).
  The unique index includes nullable `courseId`, so uniqueness is enforced in services via `findFirst` → update/create.
- `TimetableSlot.startTime/endTime` are `"HH:mm"` strings; days MONDAY–SATURDAY; overlap checked per section and per teacher.
- JSON columns: `Assignment.attachments`, `AssignmentSubmission.attachments` (`[{key,name,size?,mime?}]`),
  `FeeInvoice.lineItems` (snapshot), salary `allowances/deductions/breakdown`, `QuizAttempt.questionOrder/optionOrder`.
- Money is `Float` (no currency field; PKR assumed by UI).
- Migrations (10) in `prisma/migrations/` — from `20260419003326_initiate` to `20260614120000_timetable_slots`.

## 6. Auth details (`modules/auth`)

- Login: `{email|username, password}` (`password` min 6 on login, min 8 everywhere passwords are set).
  Inactive users get the same "Invalid credentials".
- Access JWT payload `{ sub, role, type:'access' }` signed with `JWT_ACCESS_SECRET`.
- Refresh tokens are random 48-byte hex, stored **sha256-hashed** in `RefreshToken`; `/auth/refresh` revokes the
  old one and issues a new pair (reuse → 401). Change-password and reset-password revoke all refresh tokens.
- Forgot password: always `{success:true}`; creates a 30-min `PasswordResetToken`; returns `debugToken` unless
  `NODE_ENV=production`. **No email sending exists** (TODO in `auth.service.ts`).
- `GET/PATCH /auth/me` = self profile (PATCH can't change role/isActive).

## 7. Endpoint catalogue (all under `/api/v1`; A=ADMIN T=TEACHER S=STUDENT P=PARENT; "auth" = any logged-in role)

**auth** — public: `POST auth/login`, `auth/refresh`, `auth/logout`, `auth/forgot-password`, `auth/reset-password`;
auth: `POST auth/change-password`, `GET auth/me`, `PATCH auth/me`.

**users** (A) — `GET users?role&isActive&search&page&limit` (paginated) · `GET users/teachers/create-suggestions?firstName&lastName`
· `GET users/:id` (adds `parentLinks` for students / `childLinks` for parents) · `GET users/:id/delete-impact`
· `POST users/admins|teachers|students|parents` · `POST users/students/with-parents` (student + father + mother accounts, linked)
· `POST users/parents/:userId/children` · `DELETE users/parents/:userId/children/:linkId` · `PATCH users/:id`
· `PATCH users/:id/password` · `POST users/:id/activate|deactivate` · `DELETE users/:id` (blocked if impact has blockers → 409).
"Staff" in the web UI = users with role ADMIN.

**applications** — public: `POST applications/admissions`, `POST applications/teachers/cv-presign` (pdf/doc/docx ≤10 MB),
`POST applications/teachers`. A: `GET applications/admissions?status&search&page` · `GET applications/admissions/:id/username-suggestions`
· `PATCH applications/admissions/:id` (`{status, studentUsername, fatherUsername, motherUsername, student/father/motherPassword, studentEmail?}`)
· `GET applications/teachers?search&page` · `GET applications/teachers/:id/provision-suggestions` · `GET applications/teachers/:id/cv-download`
· `PATCH applications/teachers/:id` (`{status, teacherUsername, teacherPassword, employeeCode}`). PATCH responses are `{data, meta:{accountsProvisioned}}`.
Approval provisions accounts in one transaction (admission: student `ADM-<year>-<hex>` + father + mother, father primary;
teacher: employee code `TCH00001`…). Re-approving an already provisioned application just sets status.

**academic** — reads: auth; writes: A. `academic-years` (+ `GET academic-years/current`) · `classes?academicYearId` · `sections?classId`
· `GET sections/:id` (with enrollments) · `subjects` · `courses?sectionId&teacherId&academicYearId&subjectId` · `GET courses/:id`
· `GET me/courses?academicYearId` (T: taught courses, S: enrolled sections' courses, others `[]`)
· `enrollments`: POST/PATCH/DELETE A, `GET enrollments?sectionId&academicYearId` A,T. All entities: POST, PATCH `:id`, DELETE `:id`.

**content** — `GET courses/:courseId/lessons` (tree: lessons→topics→contents) and `GET courses/:courseId/syllabus` (auth);
A,T(owner): `POST courses/:courseId/lessons`, `PATCH|DELETE lessons/:id`, `POST lessons/:lessonId/topics`, `PATCH|DELETE topics/:id`,
`POST topics/:topicId/content`, `PATCH|DELETE content/:id`, `PUT courses/:courseId/syllabus` (sections array replaces all).
`VIDEO_YOUTUBE` requires `youtubeUrl` → server derives `youtubeId`; `DOCUMENT` requires `documentKey`; `TEXT` `body`; `LINK` `externalUrl`.

**live-classes** — A,T(owner): `POST courses/:courseId/live-classes`, `PATCH live-classes/:id`, `POST live-classes/:id/cancel`,
`GET live-classes/:id/attendance`; auth: `GET courses/:courseId/live-classes`, `GET me/live-classes/upcoming` (S,T);
S: `POST live-classes/:id/join` → `{meetingLink}` only inside `[start − joinBufferMinutes, end]` and if enrolled; records attendance.

**assignments** — A,T(owner): `POST courses/:courseId/assignments`, `PATCH|DELETE assignments/:id`, `GET assignments/:id/submissions`,
`PATCH submissions/:submissionId/grade` (`{marksObtained:int ≤ maxMarks, feedback?}`); auth: `GET courses/:courseId/assignments`, `GET assignments/:id`;
S: `POST assignments/:id/submissions` (`{textAnswer?, attachments?}`, upsert; late blocked if `allowLate=false`), `GET assignments/:id/my-submission`.

**quizzes** — A,T(owner): `POST courses/:courseId/quizzes`, `PATCH quizzes/:id`, `POST quizzes/:id/publish`, `DELETE quizzes/:id`,
`POST quizzes/:id/questions`, `PATCH|DELETE questions/:qid`, `GET quizzes/:id/attempts`, `GET attempts/:attemptId/review`,
`POST attempts/:attemptId/grade` (body: `[{answerId, marksAwarded, isCorrect?}]`); auth: `GET courses/:courseId/quizzes`,
`GET quizzes/:id` (students get options without `isCorrect`), `GET attempts/:attemptId`;
S: `POST quizzes/:id/attempts` (start or resume; server-side shuffles; `deadlineAt = min(now+duration, endAt)`),
`POST attempts/:attemptId/answers` (`{questionId, selectedOptionIds?, textAnswer?}`), `POST attempts/:attemptId/violations`
(`{type: TAB_SWITCH|WINDOW_BLUR|FULLSCREEN_EXIT|COPY|PASTE|CONTEXTMENU|DEVTOOLS|NETWORK_LOSS, metadata?}`; auto-submit at `maxViolations`),
`POST attempts/:attemptId/submit` (`{answers?}`). Objective questions auto-graded (negative marking supported); any
SHORT/LONG answer leaves status SUBMITTED until manual grade. `totalMarks` is recomputed on question changes.

**exams** — A: `POST exams`, `PATCH|DELETE exams/:id`, `POST exams/:id/papers`, `POST exam-papers/:paperId/publish`;
A,T: `POST exam-papers/:paperId/results`, `POST exam-papers/:paperId/results/bulk` (array), `GET exam-papers/:paperId/results`;
auth: `GET exams?academicYearId`, `GET exams/:id` (with papers); S: `GET me/results` (published only).

**attendance** — A,T: `POST attendance/bulk` (`{date, courseId?|sectionId?, entries:[{studentId,status,remarks?}]}`; T must own course
or be section's class teacher), `GET sections/:sectionId/attendance?date`, `GET courses/:courseId/attendance?date`,
`GET attendance/reports?courseId&date`, `GET courses/:courseId/roster`; A: `GET attendance/sessions?from&to&courseId` (last 200 records grouped);
S: `GET me/attendance?from&to` (`{total, counts, records}`); T: `POST|GET me/teacher-attendance` (no future dates).

**leave** — T: `POST|GET me/teacher-leaves`; S: `POST|GET me/student-leaves`; A: `GET teacher-leaves?status`, `PATCH teacher-leaves/:id`,
`GET student-leaves?status`, `PATCH student-leaves/:id` (`{status: APPROVED|REJECTED, reviewNote?}`; only PENDING can be reviewed).
Approval writes attendance: teacher → `ON_LEAVE` per day; student → `EXCUSED` homeroom + every course of each active enrollment per day.

**fees** — A: `POST fee-structures` (with components), `DELETE fee-structures/:id`, `POST fee-invoices/generate`
(`{feeStructureId, period, includeFrequencies[], dueDate}` → one invoice per ACTIVE enrollment in that class/year; existing student+period kept),
`GET fee-invoices?status&studentId&period`, `POST fee-invoices/:id/payments` (recomputes amountPaid + PAID/PARTIAL/PENDING), `POST fee-invoices/:id/cancel`;
A,T: `GET fee-structures?classId&academicYearId`; S: `GET me/invoices`; P: `GET me/children/invoices`.

**salaries** — A: `POST salary-structures`, `GET teachers/:teacherId/salary-structures`, `POST salary-payments` (upsert per teacher+period),
`GET teachers/:teacherId/salary-payments`; T: `GET me/salary-payments`.

**timetable** — A: `POST timetable-slots`, `PATCH|DELETE timetable-slots/:id`; auth: `GET sections/:sectionId/timetable`;
T,S: `GET me/timetable` → `{role, days, slots}`.

**announcements** — A,T: `POST announcements` (T only `COURSE` with own courseId or `SECTION` where class teacher), `PATCH|DELETE announcements/:id`
(author or A); auth: `GET announcements` (visibility-filtered by role/enrollment/children).

**notifications** — auth: `GET notifications?unread=true` (latest 100), `POST notifications/:id/read`, `POST notifications/read-all`.

**media** — auth: `POST media/presign-upload` (`{purpose: MediaPurpose, mimeType, size ≤500MB, originalName?}` → key `tmp/<prefix>/<userId>/<ts>-<id><ext>`),
`POST media/finalize` (`{key}`; own uploads, A any), `GET media/presign-download?key=`.

**parents** (P, class-level) — `GET me/children` (links with student, user, enrollments), `GET children/:studentId/attendance?from&to`,
`GET children/:studentId/results`, `GET children/:studentId/invoices`. `studentId` = StudentProfile.id; link verified.

## 8. Deployment

`.github/workflows/deploy.yml`: on push to `main` → SSH to droplet (`SERVER_HOST`, `SERVER_USER`, `SSH_PRIVATE_KEY` secrets) →
`cd $HOME/server && git fetch origin main && git reset --hard origin/main && npm install && npx prisma generate && npx prisma migrate deploy &&
NODE_OPTIONS=--max-old-space-size=512 npm run build && pm2 restart nest-backend --update-env`.
So: **every migration committed to `main` runs against production automatically.** Make migrations additive /
backward compatible, and never commit a migration you haven't applied locally. The droplet has little RAM (512 MB heap cap).
The README's EC2/Nginx/"lms-api" section describes an older plan, not the current pipeline.
The droplet checkout is reset to `origin/main` on every deploy (a plain `git pull` used to abort because
`npm install` rewrites `package-lock.json` there) — never hand-edit tracked files on the droplet; untracked `.env` is kept.

## 9. Known issues & risks (verified in code — fix deliberately, not as drive-by edits)

1. **Password hashes leak in API responses.** Many queries use `include: { user: true }` (e.g. `GET courses`,
   `GET courses/:id`, `sections`, `enrollments`, attendance lists/reports/roster, `fee-invoices`, leave lists, quiz attempts,
   live-class attendance, timetable `courseInclude`, `parents.myChildren`). `GET courses` is open to every authenticated role,
   so any student can read teachers' bcrypt hashes. Fix by introducing a shared `publicUserSelect` and replacing these includes.
2. `GET media/presign-download?key=` has no ownership/ACL check — any logged-in user can fetch any object key (incl. CVs) if they know it.
3. Read endpoints are not scoped to ownership: any authenticated user can read any course detail + roster, any assignment,
   any quiz (incl. unpublished, with explanations), all lessons (unpublished too). `GET courses/:courseId/live-classes`
   returns `meetingLink`, bypassing the join window. Teachers can record exam results for any paper.
4. Top-level array bodies are unvalidated (exam results bulk, quiz manual grade).
5. **Date-only timezone drift:** attendance/leave/teacher-attendance normalise with `setHours(0,0,0,0)` in the *server's* local
   timezone. On a UTC server this is correct; on a PKT (UTC+5) dev machine a `YYYY-MM-DD` input becomes the previous day in
   `@db.Date` columns. Prefer UTC-midnight parsing (`new Date(\`${d}T00:00:00.000Z\`)`) in new code; keep server TZ = UTC.
6. Nothing calls `NotificationsService.push`, so the notifications inbox is always empty.
7. No rate limiting on `auth/login` / `auth/forgot-password` / public application endpoints.
8. Quiz `showResultsAfter` is stored but not enforced in `GET attempts/:id` after submission.
9. `GradeSubmissionDto.marksObtained` is `@IsInt` while the column is Float (half marks rejected).
10. `README.md` deployment/env/scripts sections and `docs/roles/*.md` are out of date (see §10).

## 10. Stale docs — trust code instead

- README: env vars are `R2_*` (not `AWS_*`/`S3_*`); scripts are `prisma:migrate:deploy` / `prisma:seed` (not `prisma:deploy` / `seed`);
  deployment is the droplet workflow in §8.
- `docs/roles/STUDENT.md`: real routes are `GET me/results` (not `me/exam-results`), `GET me/invoices` (not `me/fee-invoices`),
  `POST attempts/:id/answers` (not PATCH), submission body uses `textAnswer`; violation enum is as in §7; there is no
  `GET fee-invoices/:id`, `exams/:id/my-result`, `me/attendance/summary`, or `PATCH submissions/:id`.
- `docs/roles/PARENT.md`: real routes are `children/:studentId/{attendance,results,invoices}` and `me/children/invoices`.
- `docs/LOCAL_DEVELOPMENT.md` mentions `E:\Personal\BabulilmServer\`; the actual workspace is `E:\Personal\Babulilm\`.
When you change endpoints, update §7 here (and fix the matching role doc if you touch it).

## 11. Before you finish a backend change

- `npm run build` passes (type errors surface here; there are no tests).
- Schema changed → migration folder committed, `prisma generate` run, seed still idempotent.
- New/changed route visible and correct in Swagger; role + ownership checks in the service.
- If it's a core flow, extend `scripts/check-local.mjs` (it cleans up after itself — keep that property).
- Tell the frontend side what changed (route, body, response shape) and update `../web/src/lib/lms/*Api.js` in the web repo commit.
