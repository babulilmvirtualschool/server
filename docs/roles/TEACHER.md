# Teacher – API Reference

Teachers manage the courses assigned to them: content, live classes, assignments,
quizzes, attendance, and grading. Admin creates the user and assigns courses;
the teacher then operates via the endpoints below.

All requests require `Authorization: Bearer <accessToken>`. Read
`docs/API_OVERVIEW.md` for the media upload flow.

## Suggested app sections

1. **Dashboard** – `GET /me/courses`, upcoming live classes, unread
   notifications, pending submissions/unreviewed attempts.
2. **My Courses** – drill into a course ⇒ Lessons · Live Classes · Assignments ·
   Quizzes · Attendance · Exams · Roster.
3. **Grading inbox** – submissions and subjective quiz answers awaiting review.
4. **Announcements** – post to my courses / sections.
5. **Profile & payroll** – read-only salary payments.

## Auth & profile

- `POST /auth/login`, `POST /auth/refresh`, `POST /auth/logout`
- `GET /auth/me` – returns profile including `teacherProfile`.
- `POST /auth/change-password`.

## Courses

- `GET /me/courses` – every `Course` where the teacher is assigned.
- `GET /courses/:id` – includes enrolled students of the section.

## Lessons / topics / content

| Method | Path | Body |
|-------|------|------|
| POST  | `/courses/:courseId/lessons` | `{ title, description?, orderIndex, isPublished? }` |
| GET   | `/courses/:courseId/lessons` | tree with topics + content |
| PATCH / DELETE | `/lessons/:id` | — |
| POST  | `/lessons/:lessonId/topics` | `{ title, summary?, orderIndex }` |
| PATCH / DELETE | `/topics/:id` | — |
| POST  | `/topics/:topicId/content` | see below |
| PATCH / DELETE | `/content/:id` | — |

### ContentItem payloads

`type` is one of `VIDEO_YOUTUBE | DOCUMENT | TEXT | LINK`.

```json
// YouTube lecture
{
  "type": "VIDEO_YOUTUBE",
  "title": "Newton's laws - intro",
  "orderIndex": 0,
  "youtubeUrl": "https://youtu.be/dQw4w9WgXcQ"
}

// PDF / doc
{ "type": "DOCUMENT", "title": "Chapter 1 notes", "orderIndex": 1,
  "documentKey": "tmp/content/<uploader>/...pdf",
  "documentName": "chapter-1.pdf" }

// Rich text
{ "type": "TEXT", "title": "Formula sheet", "orderIndex": 2, "body": "<markdown or html>" }

// External resource
{ "type": "LINK", "title": "Khan Academy", "orderIndex": 3,
  "externalUrl": "https://khanacademy.org/..." }
```

The backend validates and normalizes `youtubeUrl` into `youtubeId`.

## Syllabus

- `GET /courses/:courseId/syllabus`
- `PUT /courses/:courseId/syllabus` – upsert `{ title, overview?, documentKey?, sections?: [{ title, body?, orderIndex }] }`.

## Live classes

- `POST /courses/:courseId/live-classes` – `{ title, description?, meetingLink, scheduledStart, scheduledEnd, joinBufferMinutes? }`.
- `GET /courses/:courseId/live-classes`
- `GET /me/live-classes/upcoming`
- `PATCH /live-classes/:id`, `POST /live-classes/:id/cancel`
- `GET /live-classes/:id/attendance` – who clicked Join.

No external integration; teacher pastes the Zoom / Meet / Teams link.

## Assignments

- `POST /courses/:courseId/assignments` – `{ title, description?, lessonId?, topicId?, maxMarks, dueDate, allowLate?, attachments? }`.
- `GET /courses/:courseId/assignments`
- `GET /assignments/:id/submissions`
- `PATCH /submissions/:submissionId/grade` – `{ marksObtained, feedback? }`.

`attachments` is an array of `{ key, name, size?, mime? }` produced by the
presign upload flow (purpose `ASSIGNMENT_ATTACHMENT`).

## Quizzes (incl. anti-cheat)

| Method | Path | Body |
|-------|------|------|
| POST  | `/courses/:courseId/quizzes` | `CreateQuizDto` |
| PATCH | `/quizzes/:id` | `UpdateQuizDto` |
| POST  | `/quizzes/:id/publish` | — |
| DELETE| `/quizzes/:id` | — |
| POST  | `/quizzes/:id/questions` | question + options |
| PATCH / DELETE | `/questions/:qid` | — |
| GET   | `/quizzes/:id/attempts` | list student attempts |
| GET   | `/attempts/:attemptId/review` | full attempt view with violations |
| POST  | `/attempts/:attemptId/grade` | `[{ answerId, marksAwarded, isCorrect? }, ...]` manual grading for subjective answers |

Anti-cheat knobs on a quiz: `antiCheatEnabled`, `maxViolations`, `shuffleQuestions`,
`shuffleOptions`, `showResultsAfter`.

## Exams

- Admins create the `Exam` + `ExamPaper`. Teachers record results:
  - `POST /exam-papers/:paperId/results` – single result.
  - `POST /exam-papers/:paperId/results/bulk` – array.
  - Admin publishes with `POST /exam-papers/:paperId/publish`.

## Attendance

- `POST /attendance/bulk` – `{ date, sectionId?, courseId?, entries: [{ studentId, status, remarks? }] }`.
- If you are the class teacher of a Section you can mark daily attendance
  (omit `courseId`). For subject-period attendance, include `courseId`.

## Announcements & notifications

- `POST /announcements` – audience must be `COURSE` (with your `courseId`) or
  `SECTION` (your homeroom section). Admins can post broader audiences.
- `GET /announcements`, `GET /notifications`, `POST /notifications/:id/read`.

## Payroll

- `GET /me/salary-payments` – read-only.

## UI guidance

- Course-detail page should use tabs (Lessons, Live, Assignments, Quizzes,
  Attendance, Roster, Announcements).
- Grading inbox: fetch submissions/attempts across your courses client-side and
  surface "needs review" rows with a quick-open drawer.
- Attendance: render a grid `students × statuses`, submit with one bulk call.
- Quiz builder: separate "Draft" vs "Published" (a quiz cannot be started by
  students until `isPublished: true`).
