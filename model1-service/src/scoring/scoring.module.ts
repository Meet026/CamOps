import { Module } from '@nestjs/common';
import { ScoringController } from './scoring.controller';
import { ScoringService } from './scoring.service';
import { OpenAiProvider } from './providers/openai.provider';
import { AI_PROVIDER } from './providers/ai-provider.token';
import { AuditContextModule } from '../common/context/audit-context.module';

@Module({
  imports: [AuditContextModule],
  controllers: [ScoringController],
  providers: [
    ScoringService,
    { provide: AI_PROVIDER, useClass: OpenAiProvider },
  ],
  exports: [ScoringService, AI_PROVIDER],
})
export class ScoringModule {}
