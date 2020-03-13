import { Injectable, NotFoundException, Logger, Inject } from '@nestjs/common';
import { DescriptionTemplateEvent } from './enums/description-template.events.enum';
import {
  DescriptionTemplateRepository,
  DescriptionTemplateDatabaseToken,
} from './description-template.repository';
import { EventsGateway } from 'src/events/events.gateway';
import DescriptionTemplateEntity from './models/description-template.entity';

@Injectable()
export class DescriptionTemplateService {
  private readonly logger = new Logger(DescriptionTemplateService.name);

  constructor(
    @Inject(DescriptionTemplateDatabaseToken)
    private repository: DescriptionTemplateRepository,
    private readonly eventEmitter: EventsGateway,
  ) {}

  async get(id: string) {
    const entity = await this.repository.findOne(id);
    if (!entity) {
      throw new NotFoundException(`Description Template ${id} could not be found`);
    }
    return entity;
  }

  getAll() {
    return this.repository.find();
  }

  async create(descriptionTemplateDto: DescriptionTemplateEntity) {
    this.logger.log(descriptionTemplateDto, 'Create Description Template');
    const dt = await this.repository.save(descriptionTemplateDto);
    this.eventEmitter.emit(DescriptionTemplateEvent.CREATED, dt);
    return dt;
  }

  remove(id: string) {
    this.logger.log(id, 'Delete Description Template');
    this.eventEmitter.emit(DescriptionTemplateEvent.REMOVED, id);
    return this.repository.remove(id);
  }

  async update(update: DescriptionTemplateEntity) {
    this.logger.log(update._id, 'Update Description Template');
    const exists = await this.repository.findOne(update._id);
    if (!exists) {
      throw new NotFoundException(`Description template ${update._id} does not exist.`);
    }
    exists.content = update.content;
    exists.description = update.description;
    exists.title = update.title;
    await this.repository.update(exists);

    this.eventEmitter.emit(DescriptionTemplateEvent.UPDATED, exists);
  }
}
