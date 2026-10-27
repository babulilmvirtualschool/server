import { Module } from '@nestjs/common';
import { LeaderboardService } from './leaderboard.service';
import { ResultsController } from './results.controller';
import { ResultsService } from './results.service';

@Module({
  controllers: [ResultsController],
  providers: [ResultsService, LeaderboardService],
})
export class ResultsModule {}
