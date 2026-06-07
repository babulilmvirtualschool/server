# Admin (School Owner) – API Reference

The Admin has full control over users, academic structure, fees, payroll, exams,
and announcements. All endpoints require `Authorization: Bearer <accessToken>`.

Read `docs/API_OVERVIEW.md` first for response envelope and the media upload flow.

## Suggested app sections

1. **Dashboard** – quick counts (users by role, active invoices, upcoming exams,
   unread announcements). Use the individual list endpoints with `limit=1` to
   fetch totals via the `meta.total` field.
2. **People** – Teachers, Students, Parents directories.
3. **Academics** – Academic Years → Classes → Sections → Subjects → Courses → Enrollments.
4. **Content** – browse any course's lessons/topics/content and syllabus.
5. **Assessments** – view quizzes, assignments, exams and results.
6. **Fees** – fee structures, invoices, payments.
7. **Payroll** – salary structures and payments.
8. **Announcements & Notifications**.

## Auth

| Method | Path | Description |
|-------|------|-------------|
| POST | `/auth/login` | Login. |
| POST | `/auth/refresh` | Rotate tokens. |
| POST | `/auth/logout` | Revoke refresh token. |
| GET  | `/auth/me` | Current user profile. |
| POST | `/auth/change-password` | Change own password. |

## Users

| Method | Path | Body / Query |
|-------|------|-------------|
| GET   | `/users` | `?role=&isActive=&search=&page=&limit=` |
| GET   | `/users/:id` | — |
| POST  | `/users/admins` | `CreateAdminDto` |
| POST  | `/users/teachers` | `CreateTeacherDto` |
| POST  | `/users/students` | `CreateStudentDto` |
| POST  | `/users/parents` | `CreateParentDto` (may include `children[]`) |
| POST  | `/users/parents/:userId/children` | `{ studentId, relation, isPrimary? }` |
| DELETE| `/users/parents/:userId/children/:linkId` | — |
| PATCH | `/users/:id` | `UpdateUserDto` |
| POST  | `/users/:id/deactivate` | — |
| POST  | `/users/:id/activate` | — |

### Create payloads

All create DTOs share: `email?`, `username?` (at least one required), `phone?`,
`password` (min 8), `firstName`, `lastName`, `gender?`, `dateOfBirth?`, `avatarKey?`.

Role-specific extras:

- Teacher: `employeeCode` (required), `qualification?`, `specialization?`,
  `joiningDate?`, `bio?`, `cnic?`.
- Student: `admissionNo` (required), `admissionDate?`, `bloodGroup?`, `address?`,
  `emergencyPhone?`.
- Parent: `occupation?`, `cnic?`, `address?`, `children?: [{ studentId, relation, isPrimary? }]`.

`relation` is one of `FATHER | MOTHER | GUARDIAN`.

## Academic structure

| Method | Path | Description |
|-------|------|-------------|
| POST | `/academic-years` | `{ name, startDate, endDate, isCurrent? }` |
| GET  | `/academic-years` | — |
| GET  | `/academic-years/current` | — |
| PATCH / DELETE | `/academic-years/:id` | — |
| POST | `/classes` | `{ academicYearId, name, level }` |
| GET  | `/classes?academicYearId=` | — |
| POST | `/sections` | `{ classId, name, room?, classTeacherId? }` |
| GET  | `/sections?classId=` | — |
| GET  | `/sections/:id` | Includes enrolled students. |
| POST | `/subjects` | `{ name, code? }` |
| GET  | `/subjects` | — |
| POST | `/courses` | `{ subjectId, sectionId, academicYearId, teacherId, description?, coverImageKey? }` |
| GET  | `/courses?sectionId=&teacherId=&academicYearId=&subjectId=` | — |
| GET  | `/courses/:id` | Full course detail. |
| POST | `/enrollments` | `{ studentId, sectionId, academicYearId, rollNumber, status? }` |
| GET  | `/enrollments?sectionId=&academicYearId=` | — |

All entities have matching `PATCH /:id` and `DELETE /:id`.

## Assessments (read/admin control)

- `GET /courses/:courseId/quizzes`, `GET /quizzes/:id`
- `GET /quizzes/:id/attempts`, `GET /attempts/:attemptId/review`
- `GET /courses/:courseId/assignments`, `GET /assignments/:id/submissions`
- `POST /exams`, `POST /exams/:id/papers`
- `POST /exam-papers/:paperId/results/bulk`
- `POST /exam-papers/:paperId/publish`

Admins can also grade and manually mark (same endpoints as teachers).

## Attendance

- `POST /attendance/bulk` – body `{ date, sectionId?, courseId?, entries: [{ studentId, status, remarks? }] }`.
- `GET /sections/:sectionId/attendance?date=YYYY-MM-DD`
- `GET /courses/:courseId/attendance?date=YYYY-MM-DD`

## Fees (record-keeping)

| Method | Path | Body |
|-------|------|------|
| POST | `/fee-structures` | `{ classId, academicYearId, name, components: [{ name, amount, frequency, isOptional? }] }` |
| GET  | `/fee-structures?classId=&academicYearId=` | — |
| DELETE | `/fee-structures/:id` | — |
| POST | `/fee-invoices/generate` | `{ feeStructureId, period, includeFrequencies: [...], dueDate }` – creates one invoice per active student. |
| GET  | `/fee-invoices?status=&studentId=&period=` | — |
| POST | `/fee-invoices/:id/payments` | `{ amount, paidAt, method, reference?, receiptKey? }` |
| POST | `/fee-invoices/:id/cancel` | — |

`FeeFrequency`: `ONE_TIME | MONTHLY | TERMLY | ANNUAL`.

For receipts, first run the media presign flow with `purpose=FEE_RECEIPT`, then
pass the returned `key` as `receiptKey`.

## Payroll

| Method | Path | Body |
|-------|------|------|
| POST | `/salary-structures` | `{ teacherId, baseSalary, allowances?, deductions?, effectiveFrom, effectiveTo? }` |
| GET  | `/teachers/:teacherId/salary-structures` | — |
| POST | `/salary-payments` | `{ teacherId, period, grossAmount, netAmount, breakdown?, paidAt, method, reference?, slipKey? }` |
| GET  | `/teachers/:teacherId/salary-payments` | — |

## Announcements & notifications

- `POST /announcements` – `{ title, body, audience, sectionId?, courseId?, attachments? }`.
- `GET /announcements` – lists announcements visible to the caller.
- `GET /notifications` – per-user inbox. `POST /notifications/:id/read` / `POST /notifications/read-all`.

## Media

- `POST /media/presign-upload` – see `API_OVERVIEW.md`.
- `POST /media/finalize` – commits an uploaded key.
- `GET  /media/presign-download?key=...` – temporary download URL.

## UI guidance

- Prefer tables with server-side pagination (`meta.page/limit/total`).
- Use modals for create/edit flows; refetch the current page on success.
- For destructive actions, confirm with the user and rely on the API's role
  enforcement (the backend rejects unauthorized actions with `403`).
- Keep a global "Academic Year" selector; most admin flows scope to a year.
