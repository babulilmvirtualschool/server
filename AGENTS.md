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
- **Never `include: { user: true }`** — it returns `passwordHash`. Use `user: { select: publicUserSelect }`
  (`common/utils/public-user.select.ts`, every column except the hash) or a narrower explicit select.
  `TransformInterceptor` also strips `passwordHash`/`tokenHash`/`issuedPasswordEnc` from every response as a safety net — don't rely on it alone.
- Usernames: `^[a-z0-9][a-z0-9._]{2,31}$/i`, stored lower-case. The regex is duplicated in
  `common/utils/username.util.ts`, `users/dto/create-student-with-parents.dto.ts`,
  `applications/dto/update-admission-status.dto.ts`, `update-teacher-status.dto.ts` — keep in sync.

## 4b. Online / physical school isolation (`src/common/campus/`, since 2026-10-12)

- `enum Campus { ONLINE PHYSICAL }` column on `User`, `AcademicYear`, `Subject`, `AdmissionApplication`, `TeacherApplication`,
  `Announcement` (existing rows ONLINE; year/subject names unique per campus). Nobody belongs to both schools.
- `CampusContextInterceptor` (global) runs every authenticated request inside an AsyncLocalStorage store: the user's own campus,
  or for a **main admin** (`AdminProfile.allCampuses`) the `X-Campus: ONLINE|PHYSICAL` header (else their own campus).
- `campus.middleware.ts` (Prisma `$use`, registered in `PrismaService`) filters **every** top-level query — reads, `update`/`delete`
  by id, counts — on the campus column or through the relation path to it (map `VIA`), and stamps new root rows with the request's
  campus (a body can't choose the other school). The logged-in user's own User row stays visible. Look-ups by globally unique
  identifiers (`username`/`email`/`phone`, `employeeCode`, `admissionNo`) stay global so "already taken" checks still work.
  **Adding a model:** give it a `campus` column (add to `DIRECT`) or add its relation path to `VIA`, or it won't be isolated.
- No store = unscoped: public routes, login/JwtStrategy, cron, seed, scripts. `runUnscoped(fn)` / `runInCampus(c, fn)` for deliberate
  cross-school work — always `await` Prisma calls inside (queries are lazy). Public website applications pass `campus` in the body.
- `$use` is deprecated in Prisma 5 and removed in 6 — when upgrading, port the middleware to a client extension.
- Admission numbers: serial per school `ON-<year>-0001` / `PH-<year>-0001` (older `ADM-<year>-<hex>` kept).
  `GET users/campus-totals` (main admin) = per-school + combined counts; `POST users/admins` takes `allCampuses` (main admins only).
  Migration `20261012103330_campus_online_physical` also made all existing admins main admins.

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
- Migrations (29) in `prisma/migrations/` — from `20260419003326_initiate` to the Day 10 `20261027060000_question_bank_paper_generator_conduct`.
- Day 1 (2026-10-15, migration `20261015063852_religion_photo_passwords_discharge`, additive): `StudentProfile.religion` /
  `AdmissionApplication.religion` (Islam | Christianity | Hinduism | Sikhism | Other, optional); `User.issuedPasswordEnc` = the password an
  admin issued, AES-256-GCM sealed by `common/utils/password-vault.ts` (key derived from `JWT_REFRESH_SECRET` — rotating that secret makes
  stored copies unreadable, logins are unaffected); cleared when the user changes or resets their own password. `StudentProfile.dischargedAt`
  + `StudentDischarge` (one row per leaving: certificate no. `ON-/PH-LC-<year>-0001`, leaving date, reason, conduct, remarks, class/roll at
  leaving, `readmittedAt`). Discharge blocks the student (isActive=false, refresh tokens revoked, ACTIVE enrollment WITHDRAWN) and each parent
  with no other current child; re-admission reverses it and enrolls into a section + roll. Deleting a user also deletes the AVATAR uploads they made.
- Website uploads (2026-10-16, migration `20261016112221_application_uploads_documents_photos`, additive): `AdmissionApplication.documents` /
  `StudentProfile.documents` (Json `[{kind, key, name}]`, kinds STUDENT_PHOTO, B_FORM, LEAVING_CERTIFICATE, FATHER/MOTHER_CNIC_FRONT/BACK) and
  `TeacherApplication.photoKey`. Files live under `applications/uploads/<kind>/` (not MediaAssets, like the CV); approval sets the student's
  `avatarKey` from STUDENT_PHOTO and copies the other documents to `StudentProfile.documents`; faculty approval sets the teacher's `avatarKey`.
- Day 2 (2026-10-16, migration `..._promote_graduated_message_templates`, additive): `StudentProfile.graduatedAt` (set by Promote → Graduated,
  whose enrollments become `GRADUATED`); `MessageTemplate` (campus column → in the middleware `DIRECT` set; `kind` = ABSENCE | LATE | LEAVE |
  ATTENDANCE_ALERT | GENERAL_NOTICE | EMERGENCY | SECURITY, name, body with {student} {class} {date} {percent} {period} {absent} {school}).
- Day 3 (2026-10-17, migration `20261017103145_attendance_settings_closures`, additive): `AttendanceSettings` (one per school, campus `@unique`, in `DIRECT`: mode DEFAULT|SHIFTS,
  `lateThresholdMinutes` (25), `schedules` Json {DEFAULT, MORNING, EVENING: Day[7]} with Day = {day, open, start "HH:mm", end}); until saved the
  service returns defaults (Mon–Sat 08:00–14:00, Sunday closed). `Section.shift` (MORNING|EVENING|null) picks the shift timings in Shifts mode.
  `StaffTiming` (per teacher, VIA teacher: shift?, own threshold?, days Day[7]). `SchoolClosure` (DIRECT: name, appliesTo STUDENT|TEACHER|STAFF[],
  fromDate/toDate `@db.Date`, note). `AttendanceRecord.arrivalTime` / `TeacherAttendanceRecord.arrivalTime` ("HH:mm"). Rules live in
  `attendance/attendance-rules.service.ts`: student marking (bulk, homeroom or period) and staff marking (admin bulk, teacher self) are refused on
  closed weekdays and closures for their group (staff ON_LEAVE still allowed); with an arrival time, PRESENT/LATE is decided by start + threshold.
- Day 4 (2026-10-19, migration `20261019074622_non_teaching_staff_alerts`, additive): `Role.STAFF` = **non-teaching staff** (accounts, office,
  guards…). They use a `TeacherProfile` (employee code `STF00001…`, `designation` = job title) so staff attendance, per-staff timings, closures,
  leave and salary work exactly like teachers'; course/class-teacher pickers stay teacher-only (they list `role=TEACHER`). `TeacherProfile.documents`
  (Json `[{key, name, fileName, mimeType, uploadedAt}]`) = **certificates** the admin uploads (media purpose OTHER, PDF/JPG/PNG/WebP ≤10 MB, max 30).
  `TeacherApplication.staffType` (TEACHING | NON_TEACHING, default TEACHING) + `designation`; `subjectExpertise` is now nullable (required for
  teaching only). Approving a NON_TEACHING application creates a STAFF user. School closures "STAFF" apply to role STAFF, "TEACHER" to teachers
  (`AttendanceRulesService.staffDays`). `MessageTemplateKind` gained EMERGENCY and SECURITY (Emergency alerts quick templates).
- Day 5 (2026-10-20, migration `20261020062527_academic_setup_periods_substitutes`, additive): `AcademicYear.code` + `status` (ACTIVE | ARCHIVED; the
  current year can't be archived, end after start), `Section.capacity` (room already existed), `Subject.type` (THEORY | PRACTICAL), `category`
  (CORE | ELECTIVE), `totalMarks` / `passingMarks` (passing ≤ total), `Course.weeklyHours` (weekly credit hours = periods per week).
  `TimetablePeriod` (DIRECT campus: name, start/end, isBreak, orderIndex = start minutes; no overlaps; changing its time moves its slots) and
  `TimetableSlot.periodId` (times copied from the period; room double-booking is refused like teacher/section clashes). **Auto-Generate**
  (`TimetableService.autoGenerate`): courses' weekly hours over the open days (attendance settings DEFAULT) × non-break periods, at most
  ceil(hours/days) per day, never two classes for a teacher or room (other classes' slots count as busy); preview, then apply replaces those
  classes' slots (same course+day+start reused, old slots with period attendance/leave are deactivated, others deleted).
  `PeriodAttendance` (VIA teacher: slot + date unique, scheduled teacher, status = TeacherAttendanceStatus, substitute, remarks) and
  `PeriodLeaveRequest` (VIA teacher: slot, date, reason, status, substitute, reviewNote) — `timetable/period-attendance.service.ts`: a period
  without a mark takes its status from the teacher's approved day record (Late → Present); a substitute must be another active teacher who is
  not off / absent / on leave that day, has no own class and no other substitution then. `Lesson.progress` / `Topic.progress`
  (ContentProgress PENDING | IN_PROGRESS | COMPLETE): teacher's lesson-plan buttons; `GET courses` and `me/courses` add
  `progress {lessons, items, complete, inProgress, pending, percent}` (topics, or lessons without topics).
- Day 6 (2026-10-21, migration `20261021063000_fees_settings_types_discounts_challans`, additive) — finance, `modules/finance/`: `FeeSettings`
  (one per school, campus `@unique`, DIRECT: currency, sessionStartMonth, dueDay, late fee on/amount, voucher instructions / hideDiscount /
  voucherCopies 1-3, blockDefaulters + defaulterGraceDays (stored only — the block itself is Day 7), siblingPolicyEnabled / siblingMonthlyOnly;
  GET returns defaults with `saved:false` until saved). `FeeType` (VIA class: name unique per class, frequency MONTHLY | ANNUAL | ONE_TIME, amount,
  isActive). `FeeDiscount` (VIA student: fee type, frequency, AMOUNT | PERCENT ≤ 100, appliedCount / lastAppliedPeriod — Monthly applies every
  challan, Yearly once per session year, One-time once). `SiblingDiscountRule` (DIRECT: childNumber unique per school, AMOUNT | PERCENT); families =
  students sharing a parent (union-find), eldest by date of birth is child 1, a rule for N applies to N and every younger child until a higher rule.
  **Challans are `FeeInvoice` rows** with new columns `voucherNo` (unique, `ON-V-000001` / `PH-V-…`), `familyVoucherNo` (`ON-FV-000001`),
  `sectionId`, `classLabel`, `prevBalance`, `discountTotal`, `lateFee`, `reminderDate`; `lineItems` snapshot =
  `[{feeTypeId, name, frequency, amount, discount, discountIds, siblingDiscount, net}]`; `feeStructureId` stays null for them. Monthly types go
  on every challan, Annual ones only in the session start month (or when chosen), One-time only when chosen. One challan per student per period
  (others are skipped with a reason). `FeePayment.slipNo` (`ON-R-000001`) groups one collection: money goes to the oldest open challans first
  (period ≤ the collected one), the late fee is added once when collected after the due date (if enabled), over-payment is refused (400).
  A paid / part-paid challan can't be regenerated or deleted (409); deleting reverts the discount usage. The old fee-structure / fee-invoice
  endpoints still work (unused by the new admin pages; reports still read `fee-invoices`).
- Day 7 (2026-10-23, migration `20261023060000_salaries_advances_fines_expenses`, additive): **salaries** — `SalaryPayment` is now the month's
  salary record: `status` (SalaryStatus UNPAID | PARTIAL | PAID), `paidAmount`, `slipNo` (unique `ON-S-000001` / `PH-S-…`), `paidAt` / `method` /
  `paidById` nullable until paid; `breakdown` = `{base, allowances[], deductions[], fines[{id,reason,amount}], advances[{id,amount}], …Total}`
  (existing rows were set PAID with paidAmount = net). `TeacherSalaryStructure` = the assigned salary (a new one closes the previous one the day
  before). `SalaryAdvance` (VIA teacher: amount, givenOn, monthlyDeduction (0 = all at once), recovered) and `SalaryFine` (VIA teacher: period,
  amount, reason). Generating a month (`SalariesService.generate`) = latest structure effective by month end, that month's fines, advance recovery
  oldest first, never below zero; skips people already generated or without a salary. A paid / part-paid salary is locked (regenerate / delete / fine
  changes 409); adding or deleting a fine for an unpaid generated month rebuilds it (same slip no.). **Expense manager** (`modules/cashbook`) —
  `CashCategory` (DIRECT: type EXPENSE | INCOME, name unique per school+type; the 7 PDF income categories are created the first time Other income
  is opened) and `CashEntry` (DIRECT: type, category (Restrict), date `@db.Date`, amount, title, party, method, reference, note). Profit & loss =
  fee payments by `paidAt` + other income − expenses − salary `paidAmount` by salary month. **Fee reports / register / ledger / defaulter block** live in
  `finance/fee-reports.service.ts`; the session = 12 months from the fee-settings start month, the one containing the academic year's start.
  `FeeDefaulterInterceptor` (APP_INTERCEPTOR in FinanceModule, runs its own query in the user's campus): with `blockDefaulters` on, a STUDENT /
  PARENT with a challan unpaid `defaulterGraceDays` after its due date gets 403 `code: FEE_DEFAULTER` on every route except `/auth/*`,
  `me/fee-challans`, `me/fee-status`; 60 s per-user cache (`fee-defaulter.cache.ts`) cleared on every collection and settings save. The exception
  filter now passes `code` from HTTP exception bodies.
- Day 8 (2026-10-25, migration `20261025060000_assignments_diary_homework_live_polls`, additive): `Assignment.isPublished` (default true, existing ones
  stay published) + `publishedAt`; students / parents never see drafts (list, get and submit → 404). `AssignmentGrade.marksObtained` is now
  nullable, plus `stars` (1–5) and `emoji` (one of `GRADE_EMOJIS` in the DTO) — a grade needs at least one of marks / stars / emoji; the growth
  report averages only grades with marks. Teacher attachments must be the teacher's own finalized `ASSIGNMENT_ATTACHMENT` uploads (shared helper
  `common/utils/own-uploads.ts`, also used for submissions and diary homework). `DiarySubmission` (VIA diaryEntry → course: diary entry + student
  unique, text, attachments = own `ASSIGNMENT_SUBMISSION` uploads, `checked` / `checkedAt` / `checkedById`, `grade` text, `stars` 1–5, `remarks`;
  the student can replace it until it is checked). `LiveClass.platform` (LiveClassPlatform GOOGLE_MEET | ZOOM | OTHER; worked out from the link
  when not given, a chosen platform must match the link's host — existing rows were set from their link). `LiveClassPoll` (VIA liveClass: question,
  options Json string[2–6], `correctOption?`, `durationSeconds` 30–600 (default 120), `openedAt` / `closesAt` — open while closesAt > now) and
  `LiveClassPollResponse` (VIA poll → liveClass: poll + student unique, option). The correct option is shown to students only after the poll closes.
- Day 9 (2026-10-26, migration `20261026060000_exam_setup_online_tests`, additive): **exam / online test setup** (PDF1 10.1 / 10.2) on `ExamPaper`:
  `title` (default "Exam name — Subject"), `mode` (ExamPaperMode MANUAL | ONLINE, default MANUAL), `passingPercent`, `weightage` (% for the final result),
  `paperCode`, `invigilatorId` (→ TeacherProfile, SetNull; teachers or non-teaching staff), `instructions`, `paperFileKey` / `paperFileName` (the
  creator's own CONTENT_DOCUMENT upload). An ONLINE paper owns a `Quiz` (`isExam`, 1 attempt, results AFTER_END, open exactly start → start + duration,
  pass marks from passing %, unpublished until the teacher publishes it); rescheduling / renaming / instructions keep it in sync, switching to MANUAL
  deletes it (409 once taken), deleting the paper deletes it (409 once taken or with results). `QuestionType.FILE_UPLOAD` (answer = the student's own
  ASSIGNMENT_SUBMISSION uploads in `QuizAnswer.attachments`, max 5, marked by hand like SHORT/LONG). Teachers may add exam sessions and create /
  edit / delete / duplicate papers of **their own courses** (PDF2 Teacher 3); publishing or editing a session stays admin-only. Student / parent
  quiz lists hide unpublished quizzes, and `GET attempts/:id` now follows `showResultsAfter` (score, marks, correct options hidden until allowed).
  **Staff alerts**: `POST notifications/staff-alert` creates `EMERGENCY_ALERT | SECURITY_ALERT | NOTICE_ALERT` notifications for active teachers and / or
  non-teaching staff (the web shows them in the bell and as a banner).
- Exam question bank: `BankQuestion` (subjectId, `type: BankQuestionType` — deliberately separate from quiz `QuestionType`, text, marks;
  `options` Json `[{text,isCorrect}]` for MCQ (2–6, exactly one correct), `answer` for FILL_BLANK (text must contain `___`)).
  `ExamPaperQuestion` (examPaperId, questionId → BankQuestion **Restrict**, orderIndex) = the **old** generated paper (legacy since Day 10; its rows were
  copied into `QuestionPaper` by the Day 10 migration, `GET exam-papers/:paperId` / `PUT …/questions` still work but the web no longer calls them).
- Day 10 (2026-10-27, migration `20261027060000_question_bank_paper_generator_conduct`, additive + one data copy): **question bank completed** (PDF1 11.1) —
  `BankQuestionType` + TRUE_FALSE | TICK_CROSS (`answer` "TRUE" | "FALSE") | MATCHING (`pairs` Json `[{left,right}]` in the right order, 2–10; text defaults to
  "Match Column A with Column B.") | SHORT | LONG (`answer` = optional solution key, `parts` Json `[{text, marks?, answer?}]` = (a)(b)(c)); new columns
  `className` (text, so the bank outlives academic years), `chapterNo`, `chapterTitle`, `topic`, `difficulty` (QuestionDifficulty EASY | MEDIUM | HARD,
  default MEDIUM), `explanation` (hints), `isActive`, `createdById` (→ User, SetNull). Teachers use the bank of the subjects they teach (any course with
  that subject) and change only their own questions; admins everything. **Paper generator** (PDF1 12.1–12.3, `question-bank/question-papers.*`):
  `PaperPattern` (VIA subject: name, className, chapters Int[], `rows` Json `[{chapterNo?, type, difficulty?, count, marks}]`, `header` Json
  {schoolName, examName, totalMinutes, totalMarks, instructions}, createdById), `QuestionPaper` (VIA subject: title, schoolName, examName, className,
  totalMinutes, totalMarks, instructions, chapters, `layout` {numbering ALPHA | ROMAN, options ROW | GRID}, status DRAFT | FINAL, optional `examPaperId`
  @unique → ExamPaper SetNull, createdById) and `QuestionPaperItem` (VIA paper → subject: question → BankQuestion **Restrict**, orderIndex, marks override).
  Automatic generation picks random **active** questions per row (chapter = the row's or the paper's chapters; class = the paper's or none); a bank question on
  any paper can't be deleted (409 — make it inactive). The migration copied the old generated papers (ExamPaperQuestion) into QuestionPaper rows linked to
  their exam paper (status FINAL). **Character & conduct** (PDF2 Admin 1, `modules/conduct`): `ConductAssessment` (VIA student: section, period
  ConductPeriod WEEKLY | HALF_MONTHLY | MONTHLY, startDate / endDate / assessmentDate `@db.Date`, discipline, regularity, punctuality, obedience,
  followingInstructions, homework, learning, overall = ConductRating EXCELLENT | GOOD | SATISFACTORY | NEEDS_IMPROVEMENT (each optional), remarks,
  assessedById; unique student + period + startDate). Teachers rate classes they teach a subject in or are class teacher of; students / parents read only.
- `DiaryEntry` (courseId, `date @db.Date`, content, authorId?): one per course per day (`@@unique([courseId, date])`); dates are
  parsed as UTC midnight (`YYYY-MM-DD`), so they are timezone-safe.
- `TeacherAttendanceRecord.approvalStatus` (PENDING|APPROVED|REJECTED): teacher self-submissions are PENDING and only count once an
  admin approves; days created by an approved teacher leave are APPROVED `ON_LEAVE`.

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

**users** (A) — `GET users?role&isActive&search&page&limit&sort&gender&minAge&maxAge&hasPhoto` (paginated; `sort` = newest|oldest|name_asc|name_desc,
age from date of birth, `hasPhoto` = true|false on `avatarKey`; search also matches `admissionNo`)
· `GET users/students/export` (same filters + optional `sectionId` = actively enrolled there, no paging, max 5000: admission no., class/section/roll, contacts, father/mother/guardian
with phone + CNIC — feeds the All Students downloads and the Strength report) · `GET users/teachers/create-suggestions?firstName&lastName`
· `GET users/:id` (adds `parentLinks` for students / `childLinks` for parents) · `GET users/:id/delete-impact`
· `POST users/staff` (non-teaching: `{firstName, lastName, username|email, password, designation, employeeCode? (auto STF…), phone?, cnic?, city?,
qualification?, joiningDate?, teachingExperience?, bio?}` → role STAFF) · `POST users/:id/certificates` A (`{key, name}`) · `DELETE users/:id/certificates?key=` A
· `GET users/me/certificates` STAFF,T · `GET users/teachers/create-suggestions?…&staff=true` suggests an STF code
· `GET users/login-slips?role&search&sectionId` A (active users of one role, issued passwords, class/roll/adm no. or code/job title or children; max 1000)
· `POST users/admins|teachers|students|parents` (teachers also take `city`, `teachingExperience`, `currentWorkplace`, `cvKey` +
`cvOriginalName` — the online faculty-form fields, stored on `TeacherProfile` since migration `20261011104901_teacher_profile_application_fields`;
approving a faculty application copies them, plus the application CV, instead of writing them into `bio`)
· `POST users/students/with-parents` (student + father + mother accounts, linked;
optional `sectionId` + `rollNumber` enrolls the student in the same transaction — both or neither, roll must be free → 409 `fields`).
`GET users?role=STUDENT` rows also carry `avatarKey`, `studentProfile.id`, father name (`parents[0]`) and the current-year ACTIVE
enrollment (class/section/roll) for the All Students table.
· `PUT users/students/:id/record` (Edit student: the whole record — user, `StudentProfile` admission fields, father/mother through the
student's links (name/phone/CNIC), current-year class/section + roll created or moved; 409 roll clash / 400 phone in use)
· `POST users/students/with-parents` and `POST applications/admissions/manual` accept `siblingOfStudentId` (StudentProfile id): the
sibling's father/mother are linked instead of creating parent accounts (no parent names/logins needed); `GET users/:id` adds `siblings`.
Admission details live in `StudentProfile.appliedClass/curriculum/preferredShift/bFormNo/guardian*` (migration
`20261012114324_student_record_fields_siblings` moved them out of `address`, which now holds the city).
· `GET users/:id/login` (username/email/role/active + `password` = the issued password while the user hasn't set their own, else null with
`passwordSetByUser: true`) · `PATCH users/:id/photo` A and `PATCH users/me/photo` S (`{avatarKey | null}`; the key must be the caller's own
finalized AVATAR upload, jpeg/png/webp ≤ 5 MB) · `POST users/students/discharge` (`{studentIds: User ids (1–200), leavingDate, reason, conduct?,
remarks?}`; 409 if one is already discharged) · `GET users/students/discharged?search&page` (paginated, latest leaving record + father)
· `POST users/students/:id/readmit` (`{sectionId, rollNumber}`, current year; roll clash 409) · `GET users/students/:id/discharges`
(leaving-certificate data). `GET users` / export also take `religion` and `discharged=true|false`; every admin-issued password
(create admin/teacher/student/parent, with-parents, approvals, `PATCH users/:id/password`) is stored viewable.
· `POST users/parents/:userId/children` · `DELETE users/parents/:userId/children/:linkId` · `PATCH users/:id`
· `PATCH users/:id/password` · `POST users/:id/activate|deactivate` · `DELETE users/:id` (blocked if impact has blockers → 409).
"Admins" in the web UI = users with role ADMIN (the page was called "Staff" before Day 4); "Non-teaching staff" = role STAFF.

**applications** — public: `POST applications/admissions` (optional `documents`, one per kind, keys from their own upload folder),
`POST applications/uploads/presign` (`{kind, mimeType, size, originalName?}`; photos jpeg/png/webp ≤5 MB, documents also pdf ≤10 MB),
`POST applications/teachers/cv-presign` (pdf/doc/docx ≤10 MB), `POST applications/teachers` (optional `photoKey` from the teacher-photo folder). A: `GET applications/admissions?status&search&page` · `GET applications/admissions/:id/username-suggestions`
· `POST applications/admissions/manual` (Add student → "Pending Enrolled": the online fields + `gender`, `bloodGroup`, `sectionId` + `rollNumber`;
father/mother names and date of birth required; class/roll validated like Add student; no accounts yet)
· `PATCH applications/admissions/:id` (`{status, studentUsername, fatherUsername, motherUsername, student/father/motherPassword, studentEmail?}`;
approval keeps gender/blood group/class-curriculum-shift-guardian lines and, when the application has a class/section + roll, enrolls the
student in the same transaction — roll taken meanwhile → 409, nothing created; columns added by `20261012074309_admission_application_admin_fields`)
· `POST applications/teachers/manual` (Add teacher → "Pending Enrolled": the faculty-form fields (CV via `teachers/cv-presign`) + `gender`,
`dateOfBirth`, `joiningDate`, `bio`; approval copies them to the user/profile — migration `20261012075038_teacher_application_admin_fields`)
· `GET applications/teachers?search&page&staffType=TEACHING|NON_TEACHING&status=PENDING|APPROVED|REJECTED` (website form sends `staffType` + `designation` for non-teaching) · `GET applications/teachers/:id/provision-suggestions` · `GET applications/teachers/:id/cv-download`
· `PATCH applications/teachers/:id` (`{status, teacherUsername, teacherPassword, employeeCode}`). PATCH responses are `{data, meta:{accountsProvisioned}}`.
Approval provisions accounts in one transaction (admission: student `ADM-<year>-<hex>` + father + mother, father primary;
teacher: employee code `TCH00001`…). Re-approving an already provisioned application just sets status.

**academic** — public: `GET public/classes?campus=ONLINE|PHYSICAL` (current-year class names, website admission form).
Reads: auth; writes: A (except `POST courses` A,T — a teacher always adds the course for themselves; delete stays A). `academic-years` (`code`, `status`; + `GET academic-years/current`) · `classes?academicYearId` · `sections?classId`
· `GET sections/:id` (with enrollments) · `subjects` · `courses?sectionId&teacherId&academicYearId&subjectId` · `GET courses/:id`
· `GET courses/:id/delete-impact` A (`{counts, canDelete, blockers}`) · `DELETE courses/:id` refused (409) while the course has attendance,
submissions, test attempts or exam papers; `PATCH courses/:id` checks `teacherId` (400 `fields.teacherId`)
· `GET me/courses?academicYearId` (T: taught courses, S: enrolled sections' courses, others `[]`)
· `POST enrollments/promote` A (`{fromSectionId, studentIds (the ticked ones), toSectionId | graduate:true}`; same year → enrollment moves,
  another year → new enrollment there; roll numbers kept; 400 not active in the class / no target, 409 roll clash or already enrolled in that year)
· `POST enrollments/shift` A (`{studentIds: StudentProfile ids, sectionId}`; moves their enrollment in that section's year; all-or-nothing:
  400 if someone is not enrolled that year, 409 naming roll-number clashes) → `{moved, alreadyThere}`.
· `enrollments`: POST/PATCH/DELETE A, `GET enrollments?sectionId&academicYearId&studentId` A,T. POST/PATCH check the section belongs
  to the academic year (400), one enrollment per student per year (409) and a free roll number in the section (409 with
  `fields.rollNumber`). **Students only see courses/content of sections they are enrolled in** — they get enrolled by
  Add student / an approved admission when a class/section + roll was given, on the student page, or by "Shift class". All entities: POST, PATCH `:id`, DELETE `:id`.

**content** — `GET courses/:courseId/lessons` (tree: lessons→topics→contents) and `GET courses/:courseId/syllabus` (auth);
A,T(owner): `POST courses/:courseId/lessons`, `PATCH|DELETE lessons/:id`, `POST lessons/:lessonId/topics`, `PATCH|DELETE topics/:id`,
`POST topics/:topicId/content`, `PATCH|DELETE content/:id`, `PUT courses/:courseId/syllabus` (sections array replaces all).
`PATCH lessons/:id` / `topics/:id` also take `progress` (PENDING | IN_PROGRESS | COMPLETE).
`VIDEO_YOUTUBE` requires `youtubeUrl` → server derives `youtubeId`; `DOCUMENT` requires `documentKey`; `TEXT` `body`; `LINK` `externalUrl`.

**live-classes** — A,T(owner): `POST courses/:courseId/live-classes` (optional `platform` GOOGLE_MEET | ZOOM; must match the link, 400 `fields.meetingLink`),
`PATCH live-classes/:id`, `POST live-classes/:id/cancel`,
`GET live-classes/:id/attendance`; auth: `GET courses/:courseId/live-classes`, `GET me/live-classes/upcoming` (S,T);
S: `POST live-classes/:id/join` → `{meetingLink}` only inside `[start − joinBufferMinutes, end]` and if enrolled; records attendance.
**End-of-lesson polls** (`live-polls.service.ts`) — A,T(owner): `GET|POST live-classes/:id/polls` (`{question, options[2–6], correctOption?, durationSeconds?, start?}`
→ the class's polls with `counts[]`, `answered`, `students`, `correct`, `responses`, status DRAFT | OPEN | CLOSED), `POST live-polls/:id/open` (starts again for
its duration, answers kept), `POST live-polls/:id/close`, `DELETE live-polls/:id`; T: `GET me/live-classes/recent` (own classes ended in the last 72 h,
`_count.polls`); S: `GET me/live-polls` (open polls + closed in the last 72 h with `myAnswer` and, once closed, `correctOption`),
`POST live-polls/:id/answer` (`{option}`; enrolled, open, once → 409 on a second answer, 400 when closed).

**assignments** — A,T(owner): `POST courses/:courseId/assignments` (`isPublished` default true = publish now, false = draft; `attachments` = own
`ASSIGNMENT_ATTACHMENT` uploads, max 10; `lessonId` ties it to a content module), `PATCH|DELETE assignments/:id` (PATCH `isPublished` publishes / unpublishes),
`GET assignments/:id/submissions`, `GET assignments/:id/roster` (every actively enrolled student: ON_TIME | LATE | MISSING + submission + grade, counts),
`PATCH submissions/:submissionId/grade` (`{marksObtained? ≤ maxMarks (halves allowed), stars? 1–5, emoji?, feedback?}` — at least one of the first three);
A,T: `GET me/assignments?courseId&sectionId&subjectId&createdFrom&createdTo&dueFrom&dueTo&status=DRAFT|PUBLISHED` (T own courses, A all; class / subject
label + `counts {students, submitted, late, graded}`); auth: `GET courses/:courseId/assignments`, `GET assignments/:id` (both hide drafts from S/P);
S: `POST assignments/:id/submissions` (`{textAnswer?, attachments?}`, upsert; late blocked if `allowLate=false`; attachments must be the
student's own finalized `ASSIGNMENT_SUBMISSION` uploads (max 10, no duplicates) and their name/size/mime are taken from `MediaAsset`;
needs text or ≥1 file; refused once graded), `GET assignments/:id/my-submission`.

**quizzes** — A,T(owner): `POST courses/:courseId/quizzes`, `PATCH quizzes/:id`, `POST quizzes/:id/publish`, `DELETE quizzes/:id`,
`POST quizzes/:id/questions`, `PATCH|DELETE questions/:qid`, `GET quizzes/:id/attempts`, `GET attempts/:attemptId/review`,
`POST attempts/:attemptId/grade` (body: `[{answerId, marksAwarded, isCorrect?}]`); auth: `GET courses/:courseId/quizzes`,
`GET quizzes/:id` (students get options without `isCorrect`), `GET attempts/:attemptId`;
S: `POST quizzes/:id/attempts` (start or resume; server-side shuffles; `deadlineAt = min(now+duration, endAt)`),
`POST attempts/:attemptId/answers` (`{questionId, selectedOptionIds?, textAnswer?}`), `POST attempts/:attemptId/violations`
(`{type: TAB_SWITCH|WINDOW_BLUR|FULLSCREEN_EXIT|COPY|PASTE|CONTEXTMENU|DEVTOOLS|NETWORK_LOSS, metadata?}`; auto-submit at `maxViolations`),
`POST attempts/:attemptId/submit` (`{answers?}`). Objective questions auto-graded (negative marking supported); any
SHORT/LONG/FILE_UPLOAD answer leaves status SUBMITTED until manual grade. `totalMarks` is recomputed on question changes.
Day 9: `GET courses/:courseId/quizzes` hides drafts from S/P; `POST attempts/:attemptId/answers` also takes `attachments: [{key, name}]` (own
ASSIGNMENT_SUBMISSION uploads, ≤5); `GET attempts/:attemptId` adds `resultsVisible`, `totalMarks`, answer `attachments` and (when visible)
`marksAwarded` / `isCorrect` — results follow `showResultsAfter` (IMMEDIATELY / AFTER_SUBMISSION, AFTER_END = after `endAt`, MANUAL = once GRADED);
T,S: `GET me/quizzes` (T: own courses' quizzes with `examPaper` + `_count`; S: published quizzes of my classes with `attemptsUsed` and
`lastAttempt`, score hidden by the same rule).

**exams** — A,T: `POST exams` (teachers too since Day 9); A: `PATCH|DELETE exams/:id` (`published` = date sheet visible to students);
A,T(own course): `POST exams/:id/papers` (course must be in the exam's year; 409 if the subject already has a paper; Day 9 fields `title, mode
MANUAL|ONLINE, passingPercent, weightage, paperCode, invigilatorId, instructions, paperFile {key,name}` — see §5 Day 9), `PATCH|DELETE
exam-papers/:paperId` (PATCH `paperFile: null` removes the file, `invigilatorId: ""` clears; DELETE refused with 409 once results exist or the online
test was taken), `POST exam-papers/:paperId/duplicate` (`{courseId, examId?, scheduledAt?}`, copies the online test questions);
A,T: `GET exam-papers?academicYearId&examId&courseId&sectionId&classId&examType&mode&status=UPCOMING|ACTIVE|COMPLETED&from&to&mine=true`
(rows with `endAt`, `status`, `classLabel`, `invigilator`, `quiz` counts, `canEdit`), `GET exams/:id/conflicts` (papers of the year overlapping this
exam's papers: same class, same room (case-insensitive) or same invigilator → `{conflicts:[{type CLASS|ROOM|INVIGILATOR, detail, papers}]}`),
`GET exam-invigilators` (active teachers + non-teaching staff `{id, name, employeeCode, kind, designation}`); S: `GET me/exams` (published sessions of my
classes; `paperFileKey`, `instructions` only from the start time; `quiz` + `myAttempt` with the score once the test is over);
A: `GET exam-papers/:paperId` (generated paper with ordered bank questions + `questionMarks`), `PUT exam-papers/:paperId/questions` (`{questionIds}` in order, same subject only),
`POST exam-papers/:paperId/publish`;
A,T: `POST exam-papers/:paperId/results`, `POST exam-papers/:paperId/results/bulk` (array), `GET exam-papers/:paperId/results`;
auth: `GET exams?academicYearId`, `GET exams/:id` (papers ordered by `scheduledAt`, with `_count.questions`); S: `GET me/results` (published only).

**question-bank** (A,T — teachers: subjects they teach, edit / delete own questions only) — `GET question-bank?subjectId&type&difficulty&className&chapterNo&search&isActive`
(search = question, topic or chapter title; with `subject`, `createdBy`, `_count.paperQuestions/paperItems`; max 5000), `GET question-bank/subjects`
(`{subjects:[{id,name,code,classNames}], classNames}`), `POST question-bank`, `POST question-bank/bulk` (`{subjectId, rows[≤500]}` → `{created, errors:[{row, message}]}`,
nothing saved when a row is invalid), `PATCH question-bank/:id` (subject fixed; a type change drops the old type's fields), `POST question-bank/:id/duplicate`,
`DELETE question-bank/:id` (409 while on a paper). Validation errors return `fields`.

**paper generator** (A,T — teachers: own papers + the paper of their own classes' exam papers) — `GET|POST paper-patterns(?subjectId)`, `PATCH|DELETE
paper-patterns/:id` (creator or A); `GET question-papers?subjectId&className&status&search` (+ `questionCount`, `itemsMarks`), `POST question-papers`
(header + layout), `GET|PATCH|DELETE question-papers/:id` (GET = items in order with the full question, `itemsMarks`), `PUT question-papers/:id/items`
(`{items:[{questionId, marks?}]}` in order, same subject, no duplicates), `POST question-papers/:id/generate` (`{rows, append?}` → `{paper, shortfalls:[{row,
wanted, found}]}`), `POST exam-papers/:paperId/question-paper` (A, T own course: the exam paper's question paper, created from the exam details the first time).

**conduct** — A,T: `GET conduct-sheet/classes` (current-year sections the user may assess), `GET conduct-sheet?sectionId&period&startDate` (active students +
their record), `PUT conduct-sheet` (`{sectionId, period, startDate, endDate, assessmentDate, rows:[{studentId, <8 ratings>?, remarks?}]}` → `{saved, removed}`;
an empty row removes that student's record), `GET conduct-assessments?sectionId&classId&studentId&period&from&to` (periods overlapping the dates),
`DELETE conduct-assessments/:id`; S: `GET me/conduct`; P: `GET children/:studentId/conduct` (link verified).

**attendance** — A,T: `POST attendance/bulk` (`{date, courseId?|sectionId?, entries:[{studentId,status,remarks?}]}`; T must own course
or be section's class teacher), `GET sections/:sectionId/attendance?date`, `GET courses/:courseId/attendance?date`,
`GET attendance/reports?courseId&date`, `GET courses/:courseId/roster`; A: `GET attendance/sessions?from&to&courseId` (last 200 records grouped);
S: `GET me/attendance?from&to` (`{total, counts, records}`); T,STAFF: `POST|GET me/teacher-attendance` (no future dates; POST = submit for approval,
status PRESENT|LATE|ABSENT only, 400 if that day is already approved; GET → `{total, counts}` of APPROVED days + `pending` + all `records`);
A: `POST teacher-attendance/bulk` (`{date, entries:[{teacherId, status, remarks?}]}` — admin marks staff, stored APPROVED),
`GET attendance/day-overview?date` A (every current-year class: `{sectionId, label, students, marked, complete, rule}`; closed days count as complete),
`GET attendance/month?month=YYYY-MM&sectionId` A (monthly grid: `{month, label, dates, rules, students:[{studentId, name, avatarKey, rollNumber,
records:{date:{status, arrivalTime}}}]}`, current-year active students, whole-day records), `GET attendance/staff-month?month` A (`{month, dates,
staff:[{teacherId, name, role, designation, employeeCode, rules:[{closed, lateAfter}], records:{date:{status, arrivalTime, approvalStatus}}}]}`, teachers first;
the web grid saves changed cells per day through `attendance/bulk` / `teacher-attendance/bulk`),
`GET attendance/day-info?date&sectionId?` A,T (`{closed, start, end, lateThresholdMinutes, lateAfter}`), `GET attendance/staff-day-info?date` A
(TeacherProfile.id → same), `GET attendance/summary?from&to&sectionId?` (whole-day records per student: counts, total, `percent` = (Present+Late)/marked, class/roll,
father/mother name + phone; lowest % first — feeds the WhatsApp % alert), `GET attendance/records?from&to&sectionId&courseId&studentId&kind=DAILY|PERIOD` (flattened student records with roll number,
class label and subject; max 5000; feeds the admin combined report),
`GET teacher-attendance?approvalStatus&teacherId&from&to` (`{total, counts, records}`, max 1000), `PATCH teacher-attendance/:id`
(`{status: APPROVED|REJECTED, reviewNote?}`; only PENDING).

**leave** — T,STAFF: `POST|GET me/teacher-leaves`; T:, `GET me/class-student-leaves?status&page` (leave of students actively enrolled in sections the
teacher teaches or is class teacher of); S: `POST|GET me/student-leaves`; A: `GET teacher-leaves?status`, `PATCH teacher-leaves/:id`,
`GET student-leaves?status`, `PATCH student-leaves/:id` (`{status: APPROVED|REJECTED, reviewNote?}`; only PENDING can be reviewed).
Approval writes attendance: teacher → `ON_LEAVE` per day; student → `EXCUSED` homeroom + every course of each active enrollment per day —
only on open days (closed weekdays, the teacher's own off days and closures are skipped, via `AttendanceRulesService`).

**fees** — A: `POST fee-structures` (with components), `DELETE fee-structures/:id`, `POST fee-invoices/generate`
(`{feeStructureId, period, includeFrequencies[], dueDate}` → one invoice per ACTIVE enrollment in that class/year; existing student+period kept),
`GET fee-invoices?status&studentId&period`, `POST fee-invoices/:id/payments` (recomputes amountPaid + PAID/PARTIAL/PENDING), `POST fee-invoices/:id/cancel`;
A,T: `GET fee-structures?classId&academicYearId`; S: `GET me/invoices`; P: `GET me/children/invoices`.

**finance** (Day 6, all A) — `GET|PUT fee-settings`; `GET fee-types?classId`, `POST fee-types`, `PATCH|DELETE fee-types/:id`;
`GET fee-discounts?search&classId`, `POST fee-discounts` (`{studentIds[], feeTypeId, frequency, valueType, value, note?}` → one per student),
`PATCH|DELETE fee-discounts/:id`; `GET|PUT sibling-rules` (PUT replaces all: `{rules:[{childNumber, valueType, value}]}`); `GET fee-families?search`;
`GET fee-assign/preview?studentId&period&feeTypeIds` (lines with discount / sibling / net, arrears = `prevBalance`, payable);
`POST fee-challans/generate` (`{period, scope: STUDENT|CLASS|ALL, studentId?, sectionId?, feeTypeIds?, dueDate?}` → `{created, challanIds, skipped[]}`);
`POST fee-challans/family` (`{period, studentId, feeTypeIds?, dueDate?}` → one family voucher no. over the brothers/sisters' challans);
`GET fee-challans?page&limit&search&sectionId&status=PAID|UNPAID|PARTIAL&feeTypeId&period&remindersDue` (paginated, `meta.totals {total, paid, balance}`;
rows: voucherNo, period, dueDate, reminderDate, status, lines, total, paid, balance, prevRemaining, student, father, mother, payments);
`GET fee-challans/missing?period&sectionId`, `GET fee-challans/family/:familyVoucherNo`, `GET fee-challans/:id` (both add `settings` for printing),
`POST fee-challans/:id/regenerate`, `PATCH fee-challans/:id/reminder` (`{reminderDate | null}`), `DELETE fee-challans/:id`,
`POST fee-challans/:id/collect` (`{amount, paidAt, method, reference?}` → `{slipNo, allocations[], challan}`), `GET fee-slips/:slipNo`.
S,P: `GET me/fee-challans` (own / children's challans, newest first, max 120 → `{challans, totalDue, openCount, settings}`) — the portal Fees page.
Day 7 (A): `GET fee-reports?kind=DAILY|MONTHLY|OUTSTANDING|BY_TYPE&date&month&sectionId&studentId&family=true` (daily = payments of the day grouped by
slip + by method; monthly = that month's challans per class + `collectedThisMonth`; outstanding = open balance per student with unpaid months;
by type = fee lines of the month per fee type), `GET fee-register?academicYearId&sessionStartMonth&sectionId&status=PAID|UNPAID|PARTIAL|DISCHARGED|REMITTED`
(challans of the session; Remitted = with a discount), `GET fee-ledger?academicYearId&sectionId&search&sort=ROLL|ADMISSION|NAME` (enrolled students:
father, mobile, opening balance = open balance before the session, `months{period:{total,paid,balance,status}}`, balance); S,P: `GET me/fee-status`
(`{blocked, blockEnabled, graceDays, overdueCount, overdueAmount, currency}`).

**salaries** (teachers + non-teaching staff, TeacherProfile ids) — A: `GET salary-staff` (active staff with current salary, monthly net, advance balance),
`POST salary-structures` (assign: `{teacherId, baseSalary, allowances[{name,amount}], deductions[], effectiveFrom}`), `GET teachers/:teacherId/salary-structures`,
`POST salaries/generate` (`{period, teacherIds?}` → `{created, skipped[{teacherId,name,reason}]}`), `GET salaries?period&teacherId&status` (`{rows, totals, currency}`),
`GET salaries/annual?year` (staff × 12 months), `POST salaries/:id/pay` (`{amount ≤ pending, paidAt, method, reference?}` → slip), `POST salaries/:id/regenerate`,
`DELETE salaries/:id` (both only before any payment; recovered advance is given back), `GET salaries/:id/slip`, `GET|POST salary-advances`
(`?teacherId&from&to&status=OPEN|RECOVERED`; body `{teacherId, amount, givenOn, monthlyDeduction?, method?, note?}`), `DELETE salary-advances/:id` (409 once
recovered), `GET|POST salary-fines` (`?period&teacherId`; body `{teacherId, period, amount, reason}`), `DELETE salary-fines/:id`,
`GET teachers/:teacherId/salary-payments`; T,STAFF: `GET me/pay` (`{salary, salaries, fines, advances, totals{monthlyPay, received, pending, fines,
advanceBalance}}`), `GET me/salary-slips/:id` (own only, 403 otherwise), `GET me/salary-payments`. (`POST salary-payments` was removed — no caller.)

**expenses** (`modules/cashbook`, A) — `GET cash-categories?type=EXPENSE|INCOME`, `POST cash-categories` (`{type, name}`; duplicate name 409),
`PATCH cash-categories/:id` (`{name}`), `DELETE cash-categories/:id` (409 while it has entries); `GET cash-entries?type&categoryId&from&to&search`
(`{rows, total, currency}`, max 2000), `POST cash-entries` (`{type, categoryId, date, amount, title, party?, method?, reference?, note?}`; category must be
of that type), `PATCH|DELETE cash-entries/:id`; `GET profit-loss?from&to&categoryId` (≤ 36 months: `months[{month, fees, otherIncome, income, salaries,
expenses, expense, net}]`, `income[]` / `expenses[]` by category incl. "Fee collection" and "Staff salaries", `totals`; a category leaves fees and salaries out).

**timetable** — A: `POST timetable-slots`, `PATCH|DELETE timetable-slots/:id` (optional `periodId`, room clash 400); `GET timetable-periods` A,T,
`POST|PATCH|DELETE timetable-periods(/:id)` A (`{name, startTime, endTime, isBreak?}`); `POST timetable/auto-generate` A (`{sectionIds, days?, apply?}` →
preview `{plan, unplaced, warnings, summary}` or applied `{created, updated, removed, deactivated, …}`);
**period attendance** — A: `GET period-attendance?date` (every period of the date: status/source AUTO|MARKED, substitute, leave, `freeTeachers`),
`POST period-attendance/bulk` (`{date, entries:[{slotId, status, substituteTeacherId?, remarks?}]}`; substitute only for Absent/Leave),
`GET period-attendance/report?from&to&teacherId&sectionId&periodId` (≤ 62 days; rows + per-teacher totals), `GET period-leaves?status`,
`PATCH period-leaves/:id` (`{status: APPROVED, substituteTeacherId}` | `{status: REJECTED, reviewNote}`; can be changed again later — rejecting an
approved one removes its Leave mark); T: `POST|GET me/period-leaves` (`{slotId, date ≥ today, reason}`; own period, weekday must match),
`GET me/substitutions?from&to` (default today + 14 days); auth: `GET sections/:sectionId/timetable`;
T,S: `GET me/timetable` → `{role, days, slots}`. A slot has no teacher of its own: its teacher is always the course's teacher
(`slot.course.teacher`), which the admin editor shows read-only once a subject is picked.

**diary** (`modules/diary`) — A,T(owner): `POST diary` (`{courseId, date: YYYY-MM-DD, content}`; upsert per course+day),
`DELETE diary/:id`, `GET courses/:courseId/diary?from&to` (newest first, max 60); S: `GET me/diary?date` (all subjects of the student's
active sections; each entry carries `mySubmission`); P: `GET children/:studentId/diary?date` (link verified; same `mySubmission` for the child).
Homework (Day 8): S: `POST diary/:id/homework` (`{text?, attachments?}`; own class only, refused once checked), `GET me/diary-homework?from&to` (date, subject,
grade, stars, remarks); A,T(owner): `GET diary/:id/homework` (every student of the class + submission, counts), `PATCH diary-homework/:id` (`{checked?
(default true), grade?, stars? 1–5, remarks?}`); `GET courses/:courseId/diary` adds `homework {submitted, checked}` per entry.

**announcements** — A,T: `POST announcements` (T only `COURSE` with own courseId or `SECTION` where class teacher), `PATCH|DELETE announcements/:id`
(author or A); auth: `GET announcements` (visibility-filtered by role/enrollment/children).

**attendance-settings** (A) — `GET|PUT attendance-settings` (`{mode, lateThresholdMinutes 0–240, schedules}`; 7 days each, start < end on open days),
`GET|PUT attendance-settings/shifts` (`{sections:[{sectionId, shift|null}]}`), `GET staff-timings`, `PUT|DELETE staff-timings/:teacherId`
(`{shift?, lateThresholdMinutes?, days}`), `GET school-closures?from&to` (A,T), `POST school-closures` (`{name, appliesTo[], fromDate, toDate, note?}`),
`DELETE school-closures/:id`. `attendance/bulk`, `teacher-attendance/bulk` entries and `me/teacher-attendance` take optional `arrivalTime`.

**reports** (A) — `GET reports/student-growth/:studentId?months=6` (StudentProfile id; attendance per month, exam results per exam with subjects,
graded-assignment and quiz averages).

**message-templates** (A) — `GET message-templates`, `POST` (`{kind, name ≤80, body ≤1500}`), `PATCH :id`, `DELETE :id` — WhatsApp
click-to-chat wording per school (`modules/messages`).

**notifications** — auth: `GET notifications?unread=true` (latest 100), `POST notifications/:id/read`, `POST notifications/read-all`;
A: `POST notifications/staff-alert` (`{kind EMERGENCY|SECURITY|NOTICE, audience ALL_STAFF|TEACHERS|NON_TEACHING, title? ≤120, body ≤2000}` → `{sent}`).

**media** — auth: `POST media/presign-upload` (`{purpose: MediaPurpose, mimeType, size ≤500MB, originalName?}` → key `tmp/<prefix>/<userId>/<ts>-<id><ext>`),
`POST media/finalize` (`{key}`; own uploads, A any), `GET media/presign-download?key=`.

**parents** (P, class-level) — `GET me/children` (links with student, user, enrollments), `PATCH children/:studentId/photo` (own AVATAR upload, link verified), `GET children/:studentId/attendance?from&to`,
`GET children/:studentId/leaves`, `GET children/:studentId/results`, `GET children/:studentId/invoices`. `studentId` = StudentProfile.id; link verified.

## 8. Deployment

`.github/workflows/deploy.yml`: on push to `main` → SSH to droplet (`SERVER_HOST`, `SERVER_USER`, `SSH_PRIVATE_KEY` secrets) →
`cd $HOME/server && git fetch origin main && git reset --hard origin/main && npm install && npx prisma generate && npx prisma migrate deploy &&
NODE_OPTIONS=--max-old-space-size=512 npm run build && pm2 restart nest-backend --update-env`.
So: **every migration committed to `main` runs against production automatically.** Make migrations additive /
backward compatible, and never commit a migration you haven't applied locally. The droplet has little RAM (512 MB heap cap): since 2026-10-27 `npm run build` is plain `tsc -p tsconfig.build.json` (same JS as `nest build`, which
needed > 512 MB with its CLI overhead and failed the Day 10 deploy after `prebuild` had already emptied `dist`). tsc itself needs ~450–512 MB today, so the
margin is small — watch the deploy result after big additions.
The README's EC2/Nginx/"lms-api" section describes an older plan, not the current pipeline.
The droplet checkout is reset to `origin/main` on every deploy (a plain `git pull` used to abort because
`npm install` rewrites `package-lock.json` there) — never hand-edit tracked files on the droplet; untracked `.env` is kept.

## 9. Known issues & risks (verified in code — fix deliberately, not as drive-by edits)

1. ~~Password hashes leaked in API responses~~ — **fixed 2026-10-08**: all `user: true` includes now use `publicUserSelect`,
   and `TransformInterceptor.stripSensitive` removes `passwordHash`/`tokenHash` from every response. Verified on 59 GET
   endpoints across all roles: responses unchanged apart from the removed field.
2. `GET media/presign-download?key=` has no ownership/ACL check — any logged-in user can fetch any object key (incl. CVs) if they know it.
3. Read endpoints are not scoped to ownership: any authenticated user can read any course detail + roster, any assignment,
   any quiz (incl. unpublished, with explanations), all lessons (unpublished too). `GET courses/:courseId/live-classes`
   returns `meetingLink`, bypassing the join window. Teachers can record exam results for any paper.
4. Top-level array bodies are unvalidated (exam results bulk, quiz manual grade).
5. **Date-only timezone drift:** attendance/leave/teacher-attendance normalise with `setHours(0,0,0,0)` in the *server's* local
   timezone. On a UTC server this is correct; on a PKT (UTC+5) dev machine a `YYYY-MM-DD` input becomes the previous day in
   `@db.Date` columns. Prefer UTC-midnight parsing (`new Date(\`${d}T00:00:00.000Z\`)`) in new code; keep server TZ = UTC.
6. Only staff alerts (`POST notifications/staff-alert`, Day 9) create notifications; nothing else calls `NotificationsService.push` yet.
7. No rate limiting on `auth/login` / `auth/forgot-password` / public application endpoints.
8. ~~Quiz `showResultsAfter` not enforced~~ — fixed 2026-10-26 (Day 9): `GET attempts/:id` and `me/quizzes` hide results until the policy allows.
9. ~~`GradeSubmissionDto.marksObtained` is `@IsInt`~~ — fixed 2026-10-25 (Day 8): marks are `@IsNumber` (halves allowed) and optional.
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
