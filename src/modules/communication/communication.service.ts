import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { ComplaintStatus, EnrollmentStatus, Prisma, Role } from '@prisma/client';
import type { AuthUser } from '../../common/decorators/current-user.decorator';
import { PrismaService } from '../../prisma/prisma.service';
import { ChatPairQueryDto, CreateComplaintDto, ListComplaintsDto, RateTeacherDto, SendChatDto, UpdateComplaintDto } from './dto/communication.dto';

const name = (u?: { firstName: string; lastName: string } | null) => (u ? [u.firstName, u.lastName].filter((x) => x && x !== '.').join(' ') : '');
const userSel = { id: true, firstName: true, lastName: true, avatarKey: true, role: true } satisfies Prisma.UserSelect;
type Contact = { userId: string; name: string; avatarKey: string | null; role: Role; detail: string };

/**
 * PDF1 7 Communication (client 15 Oct): teacher <-> student chat inside the portal (admin can read every conversation; since 2 Nov an admin also
 * chats one-on-one with any student or teacher of the school, who reply once that admin has written to them), parent and student
 * complaints / suggestions to the admin with status All | Open | In-Progress | Resolved | Closed, and parents' star marks for teachers (admin only).
 */
@Injectable()
export class CommunicationService {
  constructor(private readonly prisma: PrismaService) {}

  // ---------------- chat ----------------

  /** Admins who have written to this student or teacher: they can reply. */
  private async adminsWhoWrote(userId: string): Promise<Contact[]> {
    const rows = await this.prisma.chatMessage.findMany({
      where: { recipientId: userId, sender: { role: Role.ADMIN } },
      distinct: ['senderId'],
      select: { sender: { select: userSel } },
    });
    return rows.map(({ sender: u }) => ({ userId: u.id, name: name(u), avatarKey: u.avatarKey, role: u.role, detail: 'School administration' }));
  }

  /** An admin's contacts: the active teachers, then the active students, of the school; or just one of them. */
  private async adminContacts(onlyUserId?: string): Promise<Contact[]> {
    const users = await this.prisma.user.findMany({
      where: { role: { in: [Role.TEACHER, Role.STUDENT] }, isActive: true, ...(onlyUserId ? { id: onlyUserId } : {}) },
      select: {
        ...userSel,
        studentProfile: {
          select: {
            enrollments: {
              where: { status: EnrollmentStatus.ACTIVE, academicYear: { isCurrent: true } },
              select: { rollNumber: true, section: { select: { name: true, class: { select: { name: true } } } } },
              take: 1,
            },
          },
        },
      },
    });
    const detail = (u: (typeof users)[number]) => {
      if (u.role === Role.TEACHER) return 'Teacher';
      const e = u.studentProfile?.enrollments[0];
      return e ? `${e.section.class.name} · ${e.section.name}${e.rollNumber ? ` · Roll ${e.rollNumber}` : ''}` : 'Student';
    };
    return users
      .map((u): Contact => ({ userId: u.id, name: name(u), avatarKey: u.avatarKey, role: u.role, detail: detail(u) }))
      .sort((a, b) => Number(b.role === Role.TEACHER) - Number(a.role === Role.TEACHER) || a.detail.localeCompare(b.detail) || a.name.localeCompare(b.name));
  }

  /** People this user may chat with: a student's teachers (subjects + class teacher) / a teacher's students (current year), plus admins who wrote to them. */
  async contacts(user: AuthUser): Promise<Contact[]> {
    if (user.role === Role.ADMIN) return this.adminContacts();
    if (user.role === Role.STUDENT) {
      const s = await this.prisma.studentProfile.findUnique({ where: { userId: user.id }, select: { id: true } });
      if (!s) throw new ForbiddenException();
      const enr = await this.prisma.studentEnrollment.findMany({
        where: { studentId: s.id, status: EnrollmentStatus.ACTIVE, academicYear: { isCurrent: true } },
        select: {
          section: {
            select: {
              classTeacher: { select: { user: { select: userSel } } },
              courses: { select: { subject: { select: { name: true } }, teacher: { select: { user: { select: userSel } } } } },
            },
          },
        },
      });
      const map = new Map<string, Contact & { parts: string[] }>();
      const add = (u: Prisma.UserGetPayload<{ select: typeof userSel }> | undefined, part: string) => {
        if (!u) return;
        const c = map.get(u.id) ?? { userId: u.id, name: name(u), avatarKey: u.avatarKey, role: u.role, detail: '', parts: [] };
        if (!c.parts.includes(part)) c.parts.push(part);
        map.set(u.id, c);
      };
      for (const e of enr) {
        for (const c of e.section.courses) add(c.teacher?.user, c.subject.name);
        add(e.section.classTeacher?.user, 'Class teacher');
      }
      const teachers = [...map.values()].map(({ parts, ...c }): Contact => ({ ...c, detail: parts.join(', ') }));
      return [...teachers, ...(await this.adminsWhoWrote(user.id))].sort((a, b) => a.name.localeCompare(b.name));
    }
    if (user.role === Role.TEACHER) {
      const t = await this.prisma.teacherProfile.findUnique({ where: { userId: user.id }, select: { id: true } });
      if (!t) throw new ForbiddenException();
      const sections = await this.prisma.section.findMany({
        where: { class: { academicYear: { isCurrent: true } }, OR: [{ classTeacherId: t.id }, { courses: { some: { teacherId: t.id } } }] },
        select: {
          name: true,
          class: { select: { name: true } },
          enrollments: {
            where: { status: EnrollmentStatus.ACTIVE },
            select: { rollNumber: true, student: { select: { user: { select: userSel } } } },
          },
        },
      });
      const map = new Map<string, Contact>();
      for (const s of sections) {
        for (const e of s.enrollments) {
          const u = e.student.user;
          if (!map.has(u.id)) map.set(u.id, { userId: u.id, name: name(u), avatarKey: u.avatarKey, role: u.role, detail: `${s.class.name} · ${s.name}${e.rollNumber ? ` · Roll ${e.rollNumber}` : ''}` });
        }
      }
      return [...map.values(), ...(await this.adminsWhoWrote(user.id))].sort((a, b) => a.detail.localeCompare(b.detail) || a.name.localeCompare(b.name));
    }
    return [];
  }

  /** Contacts with unread count and the last message, newest conversation first. */
  async inbox(user: AuthUser) {
    const contacts = await this.contacts(user);
    const ids = contacts.map((c) => c.userId);
    const [unread, recent] = await Promise.all([
      this.prisma.chatMessage.groupBy({ by: ['senderId'], where: { recipientId: user.id, readAt: null, senderId: { in: ids } }, _count: { _all: true } }),
      this.prisma.chatMessage.findMany({
        where: { OR: [{ senderId: user.id, recipientId: { in: ids } }, { recipientId: user.id, senderId: { in: ids } }] },
        orderBy: { createdAt: 'desc' },
        take: 1000,
        select: { senderId: true, recipientId: true, body: true, createdAt: true },
      }),
    ]);
    const last = new Map<string, (typeof recent)[number]>();
    for (const m of recent) {
      const other = m.senderId === user.id ? m.recipientId : m.senderId;
      if (!last.has(other)) last.set(other, m);
    }
    return contacts
      .map((c) => {
        const m = last.get(c.userId);
        return {
          ...c,
          unread: unread.find((u) => u.senderId === c.userId)?._count._all ?? 0,
          lastMessage: m ? { body: m.body.slice(0, 120), at: m.createdAt, mine: m.senderId === user.id } : null,
        };
      })
      .sort((a, b) => (b.lastMessage?.at.getTime() ?? 0) - (a.lastMessage?.at.getTime() ?? 0));
  }

  private async assertContact(user: AuthUser, otherId: string) {
    if (user.role === Role.ADMIN) {
      const [a] = await this.adminContacts(otherId);
      if (!a) throw new ForbiddenException('You can only message active students and teachers of this school.');
      return a;
    }
    const contacts = await this.contacts(user);
    const c = contacts.find((x) => x.userId === otherId);
    if (!c) throw new ForbiddenException(user.role === Role.STUDENT ? 'You can only message your own teachers.' : 'You can only message students of your classes.');
    return c;
  }

  private messagesBetween(a: string, b: string) {
    return this.prisma.chatMessage.findMany({
      where: { OR: [{ senderId: a, recipientId: b }, { senderId: b, recipientId: a }] },
      orderBy: { createdAt: 'asc' },
      take: 500,
      select: { id: true, senderId: true, recipientId: true, body: true, readAt: true, createdAt: true },
    });
  }

  /** One conversation (marks the messages to me as read). */
  async conversation(user: AuthUser, otherId: string) {
    const contact = await this.assertContact(user, otherId);
    await this.prisma.chatMessage.updateMany({ where: { senderId: otherId, recipientId: user.id, readAt: null }, data: { readAt: new Date() } });
    return { contact, messages: await this.messagesBetween(user.id, otherId) };
  }

  async send(user: AuthUser, dto: SendChatDto) {
    const body = dto.body.trim();
    if (!body) throw new BadRequestException({ message: 'Type a message.', fields: { body: 'Required' } });
    await this.assertContact(user, dto.recipientId);
    return this.prisma.chatMessage.create({
      data: { senderId: user.id, recipientId: dto.recipientId, body },
      select: { id: true, senderId: true, recipientId: true, body: true, readAt: true, createdAt: true },
    });
  }

  async unreadCount(user: AuthUser) {
    return { unread: await this.prisma.chatMessage.count({ where: { recipientId: user.id, readAt: null } }) };
  }

  /** Admin: every teacher-student conversation of the school, newest first. */
  async adminConversations(search?: string) {
    // An admin's own chats are private to that admin (their inbox), not part of this list.
    const notAdmin = { role: { in: [Role.TEACHER, Role.STUDENT] } };
    const rows = await this.prisma.chatMessage.findMany({
      where: { sender: notAdmin, recipient: notAdmin },
      orderBy: { createdAt: 'desc' },
      take: 5000,
      select: { senderId: true, recipientId: true, body: true, createdAt: true },
    });
    const pairs = new Map<string, { a: string; b: string; count: number; last: (typeof rows)[number] }>();
    for (const m of rows) {
      const [a, b] = [m.senderId, m.recipientId].sort();
      const key = `${a}:${b}`;
      const p = pairs.get(key);
      if (p) p.count++;
      else pairs.set(key, { a, b, count: 1, last: m });
    }
    const ids = [...new Set([...pairs.values()].flatMap((p) => [p.a, p.b]))];
    const users = await this.prisma.user.findMany({ where: { id: { in: ids } }, select: userSel });
    const u = (id: string) => users.find((x) => x.id === id);
    const q = search?.trim().toLowerCase();
    return [...pairs.values()]
      .map((p) => {
        const [ua, ub] = [u(p.a), u(p.b)];
        const teacher = ua?.role === Role.STUDENT ? ub : ua;
        const student = ua?.role === Role.STUDENT ? ua : ub;
        return {
          teacher: teacher ? { id: teacher.id, name: name(teacher), avatarKey: teacher.avatarKey } : null,
          student: student ? { id: student.id, name: name(student), avatarKey: student.avatarKey } : null,
          count: p.count,
          lastMessage: { body: p.last.body.slice(0, 120), at: p.last.createdAt },
        };
      })
      .filter((c) => c.teacher && c.student && (!q || c.teacher.name.toLowerCase().includes(q) || c.student.name.toLowerCase().includes(q)));
  }

  async adminConversation(q: ChatPairQueryDto) {
    const users = await this.prisma.user.findMany({ where: { id: { in: [q.a, q.b] } }, select: userSel });
    // Only teacher-student conversations: another admin's chat stays private.
    if (users.length !== 2 || !users.some((x) => x.role === Role.TEACHER) || !users.some((x) => x.role === Role.STUDENT)) throw new NotFoundException('Conversation not found');
    return { users: users.map((x) => ({ id: x.id, name: name(x), role: x.role, avatarKey: x.avatarKey })), messages: await this.messagesBetween(q.a, q.b) };
  }

  // ---------------- complaints / suggestions ----------------

  private readonly complaintInclude = {
    author: { select: { id: true, firstName: true, lastName: true, role: true, phone: true } },
    student: {
      select: {
        id: true,
        admissionNo: true,
        user: { select: { firstName: true, lastName: true } },
        enrollments: {
          where: { status: EnrollmentStatus.ACTIVE, academicYear: { isCurrent: true } },
          select: { section: { select: { name: true, class: { select: { name: true } } } } },
          take: 1,
        },
      },
    },
    teacher: { select: { id: true, user: { select: { firstName: true, lastName: true } } } },
    repliedBy: { select: { firstName: true, lastName: true } },
  } satisfies Prisma.ComplaintInclude;

  private complaintView(c: Prisma.ComplaintGetPayload<{ include: CommunicationService['complaintInclude'] }>) {
    const sec = c.student?.enrollments[0]?.section;
    return {
      id: c.id,
      kind: c.kind,
      subject: c.subject,
      body: c.body,
      status: c.status,
      reply: c.reply,
      repliedAt: c.repliedAt,
      repliedByName: name(c.repliedBy),
      createdAt: c.createdAt,
      updatedAt: c.updatedAt,
      author: { id: c.author.id, name: name(c.author), role: c.author.role, phone: c.author.phone },
      student: c.student ? { id: c.student.id, name: name(c.student.user), admissionNo: c.student.admissionNo, classLabel: sec ? `${sec.class.name} · ${sec.name}` : null } : null,
      teacher: c.teacher ? { id: c.teacher.id, name: name(c.teacher.user) } : null,
    };
  }

  /** Children (parent) or the student themself, each with the teachers of their current classes. */
  async complaintOptions(user: AuthUser) {
    let students: { id: string; name: string }[] = [];
    if (user.role === Role.STUDENT) {
      const s = await this.prisma.studentProfile.findUnique({ where: { userId: user.id }, select: { id: true, user: { select: { firstName: true, lastName: true } } } });
      if (!s) throw new ForbiddenException();
      students = [{ id: s.id, name: name(s.user) }];
    } else {
      const parent = await this.prisma.parentProfile.findUnique({
        where: { userId: user.id },
        select: { children: { select: { student: { select: { id: true, user: { select: { firstName: true, lastName: true } } } } } } },
      });
      if (!parent) throw new ForbiddenException();
      students = parent.children.map((l) => ({ id: l.student.id, name: name(l.student.user) }));
    }
    return Promise.all(students.map(async (s) => ({ ...s, teachers: await this.teachersOf(s.id) })));
  }

  /** Teachers of a student's current classes (subject teachers + class teacher). */
  private async teachersOf(studentId: string) {
    const enr = await this.prisma.studentEnrollment.findMany({
      where: { studentId, status: EnrollmentStatus.ACTIVE, academicYear: { isCurrent: true } },
      select: {
        section: {
          select: {
            name: true,
            class: { select: { name: true } },
            classTeacher: { select: { id: true, user: { select: { firstName: true, lastName: true, avatarKey: true } } } },
            courses: { select: { subject: { select: { name: true } }, teacher: { select: { id: true, user: { select: { firstName: true, lastName: true, avatarKey: true } } } } } },
          },
        },
      },
    });
    const map = new Map<string, { id: string; name: string; avatarKey: string | null; subjects: string[] }>();
    const add = (t: { id: string; user: { firstName: string; lastName: string; avatarKey: string | null } } | null | undefined, what: string) => {
      if (!t) return;
      const row = map.get(t.id) ?? { id: t.id, name: name(t.user), avatarKey: t.user.avatarKey, subjects: [] };
      if (!row.subjects.includes(what)) row.subjects.push(what);
      map.set(t.id, row);
    };
    for (const e of enr) {
      for (const c of e.section.courses) add(c.teacher, c.subject.name);
      add(e.section.classTeacher, 'Class teacher');
    }
    return [...map.values()].sort((a, b) => a.name.localeCompare(b.name));
  }

  async createComplaint(user: AuthUser, dto: CreateComplaintDto) {
    const options = await this.complaintOptions(user);
    const studentId = user.role === Role.STUDENT ? options[0]?.id : dto.studentId;
    const child = options.find((o) => o.id === studentId);
    if (!child) throw new BadRequestException({ message: 'Choose your child.', fields: { studentId: 'Choose a child' } });
    if (dto.teacherId && !child.teachers.some((t) => t.id === dto.teacherId)) {
      throw new BadRequestException({ message: 'That teacher does not teach this student.', fields: { teacherId: 'Not a teacher of this student' } });
    }
    const c = await this.prisma.complaint.create({
      data: {
        authorId: user.id,
        studentId: child.id,
        teacherId: dto.teacherId || null,
        kind: dto.kind ?? 'COMPLAINT',
        subject: dto.subject.trim(),
        body: dto.body.trim(),
      },
      include: this.complaintInclude,
    });
    return this.complaintView(c);
  }

  async myComplaints(user: AuthUser) {
    const rows = await this.prisma.complaint.findMany({ where: { authorId: user.id }, include: this.complaintInclude, orderBy: { createdAt: 'desc' }, take: 200 });
    return rows.map((r) => this.complaintView(r));
  }

  /** Admin list with the count of every status (All | Open | In-Progress | Resolved | Closed). */
  async listComplaints(q: ListComplaintsDto) {
    const search = q.search?.trim();
    const where: Prisma.ComplaintWhereInput = {
      ...(q.kind ? { kind: q.kind } : {}),
      ...(search
        ? {
            OR: [
              { subject: { contains: search, mode: 'insensitive' } },
              { body: { contains: search, mode: 'insensitive' } },
              { author: { OR: [{ firstName: { contains: search, mode: 'insensitive' } }, { lastName: { contains: search, mode: 'insensitive' } }] } },
              { student: { user: { OR: [{ firstName: { contains: search, mode: 'insensitive' } }, { lastName: { contains: search, mode: 'insensitive' } }] } } },
            ],
          }
        : {}),
    };
    const [rows, groups] = await Promise.all([
      this.prisma.complaint.findMany({ where: { ...where, ...(q.status ? { status: q.status } : {}) }, include: this.complaintInclude, orderBy: { createdAt: 'desc' }, take: 1000 }),
      this.prisma.complaint.groupBy({ by: ['status'], where, _count: { _all: true } }),
    ]);
    const counts = { ALL: 0, OPEN: 0, IN_PROGRESS: 0, RESOLVED: 0, CLOSED: 0 } as Record<'ALL' | ComplaintStatus, number>;
    for (const g of groups) {
      counts[g.status] = g._count._all;
      counts.ALL += g._count._all;
    }
    return { rows: rows.map((r) => this.complaintView(r)), counts };
  }

  async updateComplaint(user: AuthUser, id: string, dto: UpdateComplaintDto) {
    const c = await this.prisma.complaint.findUnique({ where: { id }, select: { id: true, reply: true } });
    if (!c) throw new NotFoundException('Complaint not found');
    const reply = dto.reply === undefined ? undefined : dto.reply.trim() || null;
    const row = await this.prisma.complaint.update({
      where: { id },
      data: {
        ...(dto.status ? { status: dto.status } : {}),
        ...(reply !== undefined && reply !== c.reply ? { reply, repliedById: reply ? user.id : null, repliedAt: reply ? new Date() : null } : {}),
      },
      include: this.complaintInclude,
    });
    return this.complaintView(row);
  }

  // ---------------- teacher star ratings (parents give, admin sees) ----------------

  /** Parent: each child's teachers with the stars this parent gave. */
  async ratingOptions(user: AuthUser) {
    const options = await this.complaintOptions(user);
    const mine = await this.prisma.teacherRating.findMany({ where: { parentId: user.id }, select: { teacherId: true, stars: true, comment: true, updatedAt: true } });
    return options.map((o) => ({ ...o, teachers: o.teachers.map((t) => ({ ...t, myRating: mine.find((m) => m.teacherId === t.id) ?? null })) }));
  }

  async rate(user: AuthUser, dto: RateTeacherDto) {
    const options = await this.complaintOptions(user);
    if (!options.some((o) => o.teachers.some((t) => t.id === dto.teacherId))) {
      throw new ForbiddenException('You can only rate your children\'s teachers.');
    }
    const comment = dto.comment?.trim() || null;
    return this.prisma.teacherRating.upsert({
      where: { parentId_teacherId: { parentId: user.id, teacherId: dto.teacherId } },
      create: { parentId: user.id, teacherId: dto.teacherId, stars: dto.stars, comment },
      update: { stars: dto.stars, comment },
      select: { teacherId: true, stars: true, comment: true, updatedAt: true },
    });
  }

  /** Admin: average stars per teacher with every rating. */
  async ratingsReport() {
    const [teachers, ratings] = await Promise.all([
      this.prisma.teacherProfile.findMany({
        where: { user: { role: Role.TEACHER, isActive: true } },
        select: { id: true, employeeCode: true, user: { select: { firstName: true, lastName: true, avatarKey: true } } },
      }),
      this.prisma.teacherRating.findMany({
        select: { id: true, teacherId: true, stars: true, comment: true, updatedAt: true, parent: { select: { firstName: true, lastName: true, phone: true } } },
        orderBy: { updatedAt: 'desc' },
      }),
    ]);
    return teachers
      .map((t) => {
        const rs = ratings.filter((r) => r.teacherId === t.id);
        const avg = rs.length ? Math.round((rs.reduce((n, r) => n + r.stars, 0) / rs.length) * 10) / 10 : null;
        const dist = [1, 2, 3, 4, 5].map((s) => rs.filter((r) => r.stars === s).length);
        return {
          teacherId: t.id,
          name: name(t.user),
          employeeCode: t.employeeCode,
          avatarKey: t.user.avatarKey,
          average: avg,
          count: rs.length,
          distribution: dist,
          ratings: rs.map((r) => ({ id: r.id, stars: r.stars, comment: r.comment, updatedAt: r.updatedAt, parentName: name(r.parent), parentPhone: r.parent.phone })),
        };
      })
      .sort((a, b) => (b.average ?? -1) - (a.average ?? -1) || b.count - a.count || a.name.localeCompare(b.name));
  }
}
