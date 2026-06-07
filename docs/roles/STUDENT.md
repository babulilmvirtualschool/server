# Student – API Reference

Students consume courses: watch lectures, download docs, attend live classes,
submit assignments, attempt quizzes, see exam results, track attendance,
and view fee invoices.

All requests require `Authorization: Bearer <accessToken>`. Read
`docs/API_OVERVIEW.md` first for the response envelope, media flow, YouTube
embeds, and live-class join rules.

## Suggested app sections

1. **Home** – upcoming live classes, due assignments, open quizzes, new
   announcements.
2. **My Courses** – list → detail with tabs (Lessons · Live · Assignments ·
   Quizzes · Syllabus · Announcements).
3. **Assignments** inbox.
4. **Quizzes** inbox.
5. **Results** – exam results + quiz history.
6. **Attendance** – summary + calendar.
7. **Fees** – invoices and payments.
8. **Notifications**.

## Auth & profile

- `POST /auth/login`, `POST /auth/refresh`, `POST /auth/logout`
- `GET /auth/me` – includes `studentProfile`.
- `POST /auth/change-password`.

## Courses & content

| Method | Path | Description |
|-------|------|-------------|
| GET | `/me/courses` | Courses for my active enrollment. |
| GET | `/courses/:id` | Course overview. |
| GET | `/courses/:courseId/lessons` | Published lesson tree with topics and content items. |
| GET | `/courses/:courseId/syllabus` | Course syllabus. |

Render content items by `type`:

- `VIDEO_YOUTUBE` → embed `https://www.youtube.com/embed/{youtubeId}`.
- `DOCUMENT` → call `GET /media/presign-download?key={documentKey}` then open
  the returned URL in a new tab or PDF viewer.
- `TEXT` → render the `body` string (HTML/Markdown – choose one and stick with it).
- `LINK` → external link; open in new tab.

## Live classes

- `GET /me/live-classes/upcoming`
- `POST /live-classes/:id/join` – returns `{ meetingLink }` only if the class is
  in its join window. Otherwise `403` / `409`. Use this to gate the "Join"
  button and only then `window.open(meetingLink)`.

Join window: `scheduledStart - joinBufferMinutes ≤ now ≤ scheduledEnd`.

## Assignments

- `GET /courses/:courseId/assignments` – shows assignments and my submission
  state (not submitted / submitted / graded).
- `GET /assignments/:id` – full details incl. attachments.
- `POST /assignments/:id/submissions` – body `{ notes?, attachments?: [{key,name,size?,mime?}] }`.
- `PATCH /submissions/:submissionId` – edit while not graded and before cutoff
  (if `allowLate` is false and past due → `403`).

## Quizzes

The quiz flow is designed to be server-authoritative:

1. `GET /courses/:courseId/quizzes` – list published quizzes with my attempt
   summary (`notStarted | inProgress | submitted | graded`).
2. `POST /quizzes/:id/attempts` – starts an attempt. Returns
   `{ attemptId, deadlineAt, questions: [...] }` with questions/options already
   shuffled server-side. Persist `attemptId` + `deadlineAt` client-side; run a
   local countdown off the server deadline (not page-load time).
3. `PATCH /attempts/:attemptId/answers` – upsert one answer
   `{ questionId, selectedOptionIds?, textAnswer? }`. Send on change/throttle.
4. `POST /attempts/:attemptId/violations` – report client anti-cheat events
   (`{ type, detail? }`). If the server exceeds `maxViolations`, the attempt is
   auto-submitted and subsequent reads return `status: "AUTO_SUBMITTED"`.
5. `POST /attempts/:attemptId/submit` – final submit. Returns immediate
   auto-graded score for objective questions. Subjective answers are reviewed
   by a teacher.
6. When allowed (`showResultsAfter`), `GET /attempts/:attemptId/review`
   returns the graded attempt.

### Client-side anti-cheat to report

Report violation `type` values the backend understands:

`TAB_HIDDEN`, `WINDOW_BLUR`, `PASTE`, `COPY`, `RIGHT_CLICK`, `DEVTOOLS_OPEN`,
`FULLSCREEN_EXIT`, `NETWORK_TIMEOUT`.

Recommended detections:

- `document.visibilitychange` → `TAB_HIDDEN`.
- `window.blur` → `WINDOW_BLUR`.
- Block and report `copy` / `paste` / `contextmenu`.
- Enter fullscreen on start; on `fullscreenchange` (exit) → `FULLSCREEN_EXIT`.
- Heuristic devtools detection (window size diff) → `DEVTOOLS_OPEN`.

## Exams

- `GET /me/exam-results` – all published results for the current student.
- `GET /exams/:id/my-result` – a specific exam's result (if published).

## Attendance

- `GET /me/attendance?from=&to=&courseId=` – list of records.
- `GET /me/attendance/summary?academicYearId=` – `{ present, absent, late, excused, total, percentage }`.

## Fees

- `GET /me/fee-invoices` – list invoices with status and remaining balance.
- `GET /fee-invoices/:id` – detailed invoice, components, payments.

Payments are recorded by admin; students only view.

## Announcements & notifications

- `GET /announcements` – scoped by backend to my sections/courses + broadcasts.
- `GET /notifications`, `POST /notifications/:id/read`, `POST /notifications/read-all`.

## UI guidance

- Keep quiz page a single route; on start, lock UI to fullscreen and begin
  heartbeat autosave.
- Show a visible countdown and warning thresholds (5 min, 1 min).
- Show a violation counter out of `maxViolations` so the student understands
  the penalty before auto-submit.
- For YouTube lectures, use `youtube-nocookie.com` if you want to reduce
  tracking; the API returns only the ID, the host is up to you.
