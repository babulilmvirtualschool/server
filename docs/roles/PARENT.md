# Parent – API Reference

Parents have read-only access to data about their linked children. A parent is
linked to one or more students by an Admin via the `ParentStudentLink` model.

All requests require `Authorization: Bearer <accessToken>`. Read
`docs/API_OVERVIEW.md` for the response envelope and media download flow.

## Suggested app sections

1. **Home** – a child picker (if multiple), unread notifications, outstanding
   invoices, next upcoming live class for the picked child.
2. **Attendance** – calendar view.
3. **Results** – published exam results + quiz scores.
4. **Fees** – invoice list, payment history, downloadable receipts.
5. **Announcements & Notifications**.
6. **Profile** – change password.

## Auth & profile

- `POST /auth/login`, `POST /auth/refresh`, `POST /auth/logout`
- `GET /auth/me` – returns `parentProfile` with `links: [{ student, relation, isPrimary }]`.
- `POST /auth/change-password`.

## Children

- `GET /me/children` – list of students linked to me with basic profile + current enrollment.

All other endpoints take `:studentId` and the backend verifies that the student
is actually linked to the authenticated parent (else `403`).

## Attendance

- `GET /me/children/:studentId/attendance?from=&to=&courseId=` – attendance records.
- `GET /me/children/:studentId/attendance/summary?academicYearId=` –
  `{ present, absent, late, excused, total, percentage }`.

## Academic performance

- `GET /me/children/:studentId/exam-results` – published exam results.
- `GET /me/children/:studentId/quiz-history` – graded / submitted quiz attempts
  with marks and status.

## Fees

- `GET /me/children/:studentId/fee-invoices?status=` – invoices.
- `GET /fee-invoices/:id` – the backend permits access when the invoice belongs
  to a linked student.
- For receipts, call `GET /media/presign-download?key={receiptKey}`.

## Announcements & notifications

- `GET /announcements` – scoped to the parent's linked children's sections and
  courses + broadcasts.
- `GET /notifications`, `POST /notifications/:id/read`.

## UI guidance

- If a parent has multiple children, show a child-selector chip at the top of
  every screen and pass the chosen `studentId` through.
- Cache `GET /me/children` at login; re-fetch when the parent pulls to refresh.
- Fees screen: group by `academicYear` and show balance-due prominently.
- Absolutely no write endpoints for parents; hide any edit affordances.
