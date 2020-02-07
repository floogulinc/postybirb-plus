import { Module, forwardRef } from '@nestjs/common';
import { FileRepositoryModule } from 'src/file-repository/file-repository.module';
import { WebsitesModule } from 'src/websites/websites.module';
import { SettingsModule } from 'src/settings/settings.module';
import { FileManipulationModule } from 'src/file-manipulation/file-manipulation.module';
import { AccountModule } from 'src/account/account.module';

import { FileSubmissionService } from './file-submission/file-submission.service';
import { SubmissionController } from './submission.controller';
import { SubmissionPartRepository } from './submission-part/submission-part.repository';
import { SubmissionPartService } from './submission-part/submission-part.service';
import { SubmissionRepository } from './submission.repository';
import { SubmissionService } from './submission.service';
import { ValidatorService } from './validator/validator.service';
import { SubmissionTemplateController } from './submission-template/submission-template.controller';
import { SubmissionTemplateService } from './submission-template/submission-template.service';
import { SubmissionTemplateRepository } from './submission-template/submission-template.repository';
import { PostController } from './post/post.controller';
import { PostService } from './post/post.service';
import { LogController } from './log/log.controller';
import { LogService } from './log/log.service';
import { SubmissionLogRepository } from './log/log.repository';

@Module({
  imports: [
    FileRepositoryModule,
    WebsitesModule,
    SettingsModule,
    forwardRef(() => AccountModule),
    FileManipulationModule,
  ],
  controllers: [SubmissionController, SubmissionTemplateController, PostController, LogController],
  providers: [
    FileSubmissionService,
    SubmissionPartRepository,
    SubmissionPartService,
    SubmissionRepository,
    SubmissionService,
    ValidatorService,
    SubmissionTemplateService,
    SubmissionTemplateRepository,
    PostService,
    LogService,
    SubmissionLogRepository,
  ],
  exports: [SubmissionService, SubmissionPartService, SubmissionTemplateService, PostService],
})
export class SubmissionModule {}
