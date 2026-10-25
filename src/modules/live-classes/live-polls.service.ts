import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { EnrollmentStatus, LiveClassStatus, Prisma, Role } from '@prisma/client';
import type { AuthUser } from '../../common/decorators/current-user.decorator';
import { PrismaService } from '../../prisma/prisma.service';
import { AnswerLivePollDto, CreateLivePollDto } from './dto/live-poll.dto';

const RECENT_HOURS = 72;
const name = (u?: { firstName: string; lastName: string } | null) => (u ? `${u.firstName} ${u.lastName}`.trim() : '');

type PollRow = Prisma.LiveClassPollGetPayload<{ include: { responses: { include: { student: { select: { id: true; user: { select: { firstName: true; lastName: true } } } } } } } }>;

/**
 * End-of-lesson quick quiz / poll (PDF2 Teacher 1): the teacher starts a question with 2–6 options for a set time (default 2 minutes),
 * enrolled students answer once while it is open, the teacher sees the results; correct answers are shown to students once it closes.
 */
@Injectable()
export class LivePollsService {
  constructor(private readonly prisma: PrismaService) {}

  private async ownClass(liveClassId: string, user: AuthUser) {
    const lc = await this.prisma.liveClass.findUnique({
      where: { id: liveClassId },
      include: { course: { select: { sectionId: true, teacher: { select: { userId: true } } } } },
    });
    if (!lc) throw new NotFoundException('Live class not found');
    if (user.role !== Role.ADMIN && lc.course.teacher.userId !== user.id) throw new ForbiddenException('Not the teacher of this class');
    return lc;
  }

  private async ownPoll(pollId: string, user: AuthUser) {
    const poll = await this.prisma.liveClassPoll.findUnique({ where: { id: pollId } });
    if (!poll) throw new NotFoundException('Poll not found');
    await this.ownClass(poll.liveClassId, user);
    return poll;
  }

  private static isOpen(p: { openedAt: Date | null; closesAt: Date | null }, now = new Date()) {
    return !!p.openedAt && !!p.closesAt && p.closesAt > now;
  }

  private results(p: PollRow, students: number) {
    const options = p.options as unknown as string[];
    const counts = options.map((_, i) => p.responses.filter((r) => r.option === i).length);
    return {
      id: p.id,
      question: p.question,
      options,
      correctOption: p.correctOption,
      durationSeconds: p.durationSeconds,
      openedAt: p.openedAt,
      closesAt: p.closesAt,
      status: !p.openedAt ? 'DRAFT' : LivePollsService.isOpen(p) ? 'OPEN' : 'CLOSED',
      counts,
      answered: p.responses.length,
      students,
      correct: p.correctOption == null ? null : p.responses.filter((r) => r.option === p.correctOption).length,
      responses: p.responses.map((r) => ({ studentId: r.studentId, name: name(r.student.user), option: r.option, at: r.createdAt })),
    };
  }

  private pollInclude = {
    responses: { include: { student: { select: { id: true, user: { select: { firstName: true, lastName: true } } } } } },
  } as const;

  /** Teacher / admin: the class's polls with live results. */
  async list(liveClassId: string, user: AuthUser) {
    const lc = await this.ownClass(liveClassId, user);
    const [polls, students] = await Promise.all([
      this.prisma.liveClassPoll.findMany({ where: { liveClassId }, include: this.pollInclude, orderBy: { createdAt: 'asc' } }),
      this.prisma.studentEnrollment.count({ where: { sectionId: lc.course.sectionId, status: EnrollmentStatus.ACTIVE } }),
    ]);
    return polls.map((p) => this.results(p, students));
  }

  async create(liveClassId: string, user: AuthUser, dto: CreateLivePollDto) {
    const lc = await this.ownClass(liveClassId, user);
    if (lc.status === LiveClassStatus.CANCELLED) throw new BadRequestException('This class was cancelled.');
    const options = dto.options.map((o) => o.trim());
    if (options.some((o) => !o)) throw new BadRequestException({ message: 'Fill in every option.', fields: { options: 'Fill in every option' } });
    if (new Set(options.map((o) => o.toLowerCase())).size !== options.length) {
      throw new BadRequestException({ message: 'Two options are the same.', fields: { options: 'Options must be different' } });
    }
    if (dto.correctOption != null && dto.correctOption >= options.length) {
      throw new BadRequestException({ message: 'Choose one of the options as the correct answer.', fields: { correctOption: 'Not one of the options' } });
    }
    const duration = dto.durationSeconds ?? 120;
    const now = new Date();
    const start = dto.start ?? true;
    await this.prisma.liveClassPoll.create({
      data: {
        liveClassId,
        question: dto.question.trim(),
        options,
        correctOption: dto.correctOption ?? null,
        durationSeconds: duration,
        openedAt: start ? now : null,
        closesAt: start ? new Date(now.getTime() + duration * 1000) : null,
      },
    });
    return this.list(liveClassId, user);
  }

  /** Start (or restart for another round of answers) a poll for its set time. Earlier answers are kept. */
  async open(pollId: string, user: AuthUser) {
    const p = await this.ownPoll(pollId, user);
    const now = new Date();
    await this.prisma.liveClassPoll.update({ where: { id: pollId }, data: { openedAt: now, closesAt: new Date(now.getTime() + p.durationSeconds * 1000) } });
    return this.list(p.liveClassId, user);
  }

  async close(pollId: string, user: AuthUser) {
    const p = await this.ownPoll(pollId, user);
    if (LivePollsService.isOpen(p)) await this.prisma.liveClassPoll.update({ where: { id: pollId }, data: { closesAt: new Date() } });
    return this.list(p.liveClassId, user);
  }

  async remove(pollId: string, user: AuthUser) {
    const p = await this.ownPoll(pollId, user);
    await this.prisma.liveClassPoll.delete({ where: { id: pollId } });
    return this.list(p.liveClassId, user);
  }

  // ---------- students ----------
  private async student(user: AuthUser) {
    const s = await this.prisma.studentProfile.findUnique({
      where: { userId: user.id },
      select: { id: true, enrollments: { where: { status: EnrollmentStatus.ACTIVE }, select: { sectionId: true } } },
    });
    if (!s) throw new ForbiddenException('Student profile not found');
    return s;
  }

  /** Student: open polls of their classes, plus polls closed in the last 3 days with the right answer and their own answer. */
  async mine(user: AuthUser) {
    const s = await this.student(user);
    const since = new Date(Date.now() - RECENT_HOURS * 3_600_000);
    const polls = await this.prisma.liveClassPoll.findMany({
      where: {
        openedAt: { not: null },
        closesAt: { gte: since },
        liveClass: { course: { sectionId: { in: s.enrollments.map((e) => e.sectionId) } }, status: { not: LiveClassStatus.CANCELLED } },
      },
      include: {
        liveClass: { select: { id: true, title: true, course: { select: { subject: { select: { name: true } } } } } },
        responses: { where: { studentId: s.id }, select: { option: true } },
      },
      orderBy: { openedAt: 'desc' },
    });
    const now = new Date();
    return polls.map((p) => {
      const open = LivePollsService.isOpen(p, now);
      return {
        id: p.id,
        question: p.question,
        options: p.options as unknown as string[],
        liveClass: { id: p.liveClass.id, title: p.liveClass.title, subject: p.liveClass.course.subject.name },
        status: open ? 'OPEN' : 'CLOSED',
        closesAt: p.closesAt,
        myAnswer: p.responses[0]?.option ?? null,
        // The right answer is only revealed after the poll closes.
        correctOption: open ? null : p.correctOption,
      };
    });
  }

  async answer(pollId: string, user: AuthUser, dto: AnswerLivePollDto) {
    const s = await this.student(user);
    const p = await this.prisma.liveClassPoll.findUnique({ where: { id: pollId }, include: { liveClass: { select: { course: { select: { sectionId: true } } } } } });
    if (!p || !s.enrollments.some((e) => e.sectionId === p.liveClass.course.sectionId)) throw new NotFoundException('Poll not found');
    if (!LivePollsService.isOpen(p)) throw new BadRequestException('This poll is closed.');
    if (dto.option >= (p.options as unknown as string[]).length) throw new BadRequestException('Choose one of the options.');
    try {
      await this.prisma.liveClassPollResponse.create({ data: { pollId, studentId: s.id, option: dto.option } });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') throw new ConflictException('You have already answered this poll.');
      throw e;
    }
    return { answered: true, option: dto.option };
  }

  // ---------- teacher: recent classes ----------
  /** Teacher: own classes that ended in the last 3 days (for the end-of-lesson poll), with their poll count. */
  async recentClasses(user: AuthUser) {
    const t = await this.prisma.teacherProfile.findUnique({ where: { userId: user.id }, select: { id: true } });
    if (!t) return [];
    const now = new Date();
    return this.prisma.liveClass.findMany({
      where: { teacherId: t.id, scheduledEnd: { lt: now, gte: new Date(now.getTime() - RECENT_HOURS * 3_600_000) }, status: { not: LiveClassStatus.CANCELLED } },
      include: { course: { include: { subject: true, section: { include: { class: true } } } }, _count: { select: { polls: true } } },
      orderBy: { scheduledStart: 'desc' },
    });
  }
}
