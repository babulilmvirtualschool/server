import { Campus, Prisma } from '@prisma/client';
import { campusStorage } from './campus-context';

/**
 * Online / physical school isolation in one place.
 *
 * Models with their own `campus` column are filtered on it (and get it set on create). Every other model is
 * filtered through the relation that leads to one of them (e.g. Section → class → academicYear.campus), so a
 * school admin can't read, change or delete the other school's rows even by id. Applied to top-level queries
 * of requests that carry a campus (see CampusContextInterceptor); public routes, cron and scripts are unscoped.
 */

const DIRECT = new Set([
  'User',
  'AcademicYear',
  'Subject',
  'AdmissionApplication',
  'TeacherApplication',
  'Announcement',
  'MessageTemplate',
  'AttendanceSettings',
  'SchoolClosure',
  'TimetablePeriod',
  'FeeSettings',
  'SiblingDiscountRule',
  'CashCategory',
  'CashEntry',
]);

type Scope = (campus: Campus, userId?: string) => Record<string, unknown>;

/** Users of this campus, plus the logged-in user (an all-schools admin keeps seeing their own account). */
const userScope = (c: Campus, userId?: string) =>
  userId ? { OR: [{ campus: c }, { id: userId }] } : { campus: c };
const year = (c: Campus) => ({ academicYear: { campus: c } });
const course = (c: Campus) => ({ course: year(c) });
const student: Scope = (c, u) => ({ student: { user: userScope(c, u) } });
const teacher: Scope = (c, u) => ({ teacher: { user: userScope(c, u) } });

const VIA: Record<string, Scope> = {
  AdminProfile: (c, u) => ({ user: userScope(c, u) }),
  TeacherProfile: (c, u) => ({ user: userScope(c, u) }),
  StudentProfile: (c, u) => ({ user: userScope(c, u) }),
  ParentProfile: (c, u) => ({ user: userScope(c, u) }),
  ParentStudentLink: student,
  Class: year,
  Section: (c) => ({ class: year(c) }),
  Course: year,
  TimetableSlot: course,
  StudentEnrollment: year,
  Syllabus: course,
  SyllabusSection: (c) => ({ syllabus: course(c) }),
  Lesson: course,
  Topic: (c) => ({ lesson: course(c) }),
  ContentItem: (c) => ({ topic: { lesson: course(c) } }),
  LiveClass: course,
  LiveClassAttendance: (c) => ({ liveClass: course(c) }),
  LiveClassPoll: (c) => ({ liveClass: course(c) }),
  LiveClassPollResponse: (c) => ({ poll: { liveClass: course(c) } }),
  Assignment: course,
  AssignmentSubmission: (c) => ({ assignment: course(c) }),
  AssignmentGrade: (c) => ({ submission: { assignment: course(c) } }),
  Quiz: course,
  Question: (c) => ({ quiz: course(c) }),
  Option: (c) => ({ question: { quiz: course(c) } }),
  QuizAttempt: (c) => ({ quiz: course(c) }),
  QuizAnswer: (c) => ({ attempt: { quiz: course(c) } }),
  QuizViolation: (c) => ({ attempt: { quiz: course(c) } }),
  Exam: year,
  ExamPaper: (c) => ({ exam: year(c) }),
  ExamPaperQuestion: (c) => ({ examPaper: { exam: year(c) } }),
  ExamResult: (c) => ({ examPaper: { exam: year(c) } }),
  AttendanceRecord: student,
  TeacherAttendanceRecord: teacher,
  TeacherLeaveRequest: teacher,
  StudentLeaveRequest: student,
  FeeStructure: year,
  FeeComponent: (c) => ({ feeStructure: year(c) }),
  FeeInvoice: student,
  FeePayment: (c, u) => ({ invoice: student(c, u) }),
  TeacherSalaryStructure: teacher,
  SalaryPayment: teacher,
  SalaryAdvance: teacher,
  SalaryFine: teacher,
  Notification: (c, u) => ({ user: userScope(c, u) }),
  DiaryEntry: course,
  DiarySubmission: (c) => ({ diaryEntry: course(c) }),
  BankQuestion: (c) => ({ subject: { campus: c } }),
  StudentDischarge: student,
  StaffTiming: teacher,
  PeriodAttendance: teacher,
  PeriodLeaveRequest: teacher,
  FeeType: (c) => ({ class: year(c) }),
  FeeDiscount: student,
};

/**
 * Look-ups by an identifier that is unique across BOTH schools (login names, phone, employee code, admission no.)
 * stay global, so "already taken" checks and number allocation see the other school too.
 */
const GLOBAL_KEYS: Record<string, string[]> = {
  User: ['username', 'email', 'phone'],
  TeacherProfile: ['employeeCode'],
  StudentProfile: ['admissionNo'],
};

const READ_OR_WRITE_WITH_WHERE = new Set([
  'findUnique',
  'findUniqueOrThrow',
  'findFirst',
  'findFirstOrThrow',
  'findMany',
  'count',
  'aggregate',
  'groupBy',
  'update',
  'updateMany',
  'delete',
  'deleteMany',
  'upsert',
]);
const LOOKUPS = new Set(['findUnique', 'findUniqueOrThrow', 'findFirst', 'findFirstOrThrow', 'count']);

function addWhere(where: Record<string, unknown> | undefined, filter: Record<string, unknown>) {
  if (!where) return { ...filter };
  const and = where.AND ? (Array.isArray(where.AND) ? where.AND : [where.AND]) : [];
  return { ...where, AND: [...and, filter] };
}

export const campusMiddleware: Prisma.Middleware = async (params, next) => {
  const store = campusStorage.getStore();
  const campus = store?.campus;
  if (!campus || store?.unscoped || !params.model) return next(params);

  const model = params.model;
  const scope: Scope | undefined = DIRECT.has(model)
    ? model === 'User'
      ? (c, u) => userScope(c, u)
      : (c) => ({ campus: c })
    : VIA[model];
  if (!scope) return next(params);

  const args = (params.args ??= {});
  const action = params.action as string;

  if (READ_OR_WRITE_WITH_WHERE.has(action)) {
    const globalKeys = GLOBAL_KEYS[model];
    const isGlobalLookup =
      LOOKUPS.has(action) && globalKeys && args.where && globalKeys.some((k) => k in args.where);
    if (!isGlobalLookup) args.where = addWhere(args.where, scope(campus, store?.userId));
  }

  // New root rows always belong to the request's school (a body can't pick the other one).
  if (DIRECT.has(model)) {
    if (action === 'create') args.data = { ...(args.data ?? {}), campus };
    if (action === 'createMany' && args.data) {
      args.data = (Array.isArray(args.data) ? args.data : [args.data]).map((d: object) => ({ ...d, campus }));
    }
    if (action === 'upsert') args.create = { ...(args.create ?? {}), campus };
  }

  return next(params);
};
