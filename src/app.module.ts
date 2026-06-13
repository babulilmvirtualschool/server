import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { LoggerModule } from 'nestjs-pino';
import { AppConfigModule } from './config/app-config.module';
import { PrismaModule } from './prisma/prisma.module';
import { AuthModule } from './modules/auth/auth.module';
import { UsersModule } from './modules/users/users.module';
import { AcademicModule } from './modules/academic/academic.module';
import { ContentModule } from './modules/content/content.module';
import { LiveClassesModule } from './modules/live-classes/live-classes.module';
import { AssignmentsModule } from './modules/assignments/assignments.module';
import { QuizzesModule } from './modules/quizzes/quizzes.module';
import { ExamsModule } from './modules/exams/exams.module';
import { AttendanceModule } from './modules/attendance/attendance.module';
import { FeesModule } from './modules/fees/fees.module';
import { SalariesModule } from './modules/salaries/salaries.module';
import { AnnouncementsModule } from './modules/announcements/announcements.module';
import { NotificationsModule } from './modules/notifications/notifications.module';
import { MediaModule } from './modules/media/media.module';
import { ParentsModule } from './modules/parents/parents.module';
import { HealthModule } from './modules/health/health.module';
import { ApplicationsModule } from './modules/applications/applications.module';
import { LeaveModule } from './modules/leave/leave.module';
import { TimetableModule } from './modules/timetable/timetable.module';

@Module({
  imports: [
    AppConfigModule,
    LoggerModule.forRoot({
      pinoHttp: {
        transport:
          process.env.NODE_ENV !== 'production'
            ? {
                target: 'pino-pretty',
                options: { singleLine: true, colorize: true },
              }
            : undefined,
        autoLogging: { ignore: (req) => req.url === '/api/v1/health' },
        redact: ['req.headers.authorization', 'req.headers.cookie'],
      },
    }),
    ScheduleModule.forRoot(),
    PrismaModule,

    AuthModule,
    UsersModule,
    AcademicModule,
    ContentModule,
    LiveClassesModule,
    AssignmentsModule,
    QuizzesModule,
    ExamsModule,
    AttendanceModule,
    FeesModule,
    SalariesModule,
    AnnouncementsModule,
    NotificationsModule,
    MediaModule,
    ParentsModule,
    HealthModule,
    ApplicationsModule,
    LeaveModule,
    TimetableModule,
  ],
})
export class AppModule {}
