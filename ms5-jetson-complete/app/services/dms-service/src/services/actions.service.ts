import { PrismaClient } from '@prisma/client';
import { ActionsRepository } from '../repositories/actions.repository';
import { KafkaProducer } from '../events/producer';
import { createLogger } from '@ms5/shared/logger';

const logger = createLogger('actions-service');

export class ActionsService {
  private repository: ActionsRepository;
  private producer: KafkaProducer;

  constructor() {
    this.repository = new ActionsRepository();
    this.producer = new KafkaProducer();
  }

  async getActions(filters: any) {
    return this.repository.findMany(filters);
  }

  async getAction(id: string) {
    return this.repository.findById(id);
  }

  async createAction(data: any, userId: string) {
    const action = await this.repository.create({
      ...data,
      createdBy: userId,
      status: data.status || 'OPEN',
    });

    await this.producer.sendActionEvent({
      eventType: 'ACTION_CREATED',
      actionId: action.id,
      data: action,
      userId,
      timestamp: new Date().toISOString(),
    });

    logger.info({ actionId: action.id, type: data.type }, 'Action created');

    return action;
  }

  async updateAction(id: string, data: any, userId: string) {
    const action = await this.repository.update(id, {
      ...data,
      updatedBy: userId,
      updatedAt: new Date(),
    });

    if (action) {
      await this.producer.sendActionEvent({
        eventType: 'ACTION_UPDATED',
        actionId: action.id,
        data: action,
        userId,
        timestamp: new Date().toISOString(),
      });

      if (data.status === 'OVERDUE') {
        await this.escalateAction(action);
      }
    }

    return action;
  }

  async deleteAction(id: string) {
    return this.repository.delete(id);
  }

  async completeAction(id: string, resolution: string, userId: string, completionDate?: string) {
    const action = await this.repository.update(id, {
      status: 'COMPLETED',
      resolution,
      actualCompletionDate: completionDate || new Date().toISOString(),
      completedBy: userId,
      updatedAt: new Date(),
    });

    if (action) {
      await this.producer.sendActionEvent({
        eventType: 'ACTION_COMPLETED',
        actionId: action.id,
        data: action,
        userId,
        timestamp: new Date().toISOString(),
      });

      logger.info({ actionId: action.id }, 'Action completed');
    }

    return action;
  }

  async checkOverdueActions() {
    const overdueActions = await this.repository.findOverdue();

    for (const action of overdueActions) {
      await this.updateAction(action.id, { status: 'OVERDUE' }, 'system');
    }

    logger.info({ count: overdueActions.length }, 'Overdue actions processed');
  }

  private async escalateAction(action: any) {
    await this.producer.sendActionEvent({
      eventType: 'ACTION_ESCALATED',
      actionId: action.id,
      data: action,
      userId: 'system',
      timestamp: new Date().toISOString(),
    });

    logger.warn({ actionId: action.id }, 'Action escalated due to overdue status');
  }
}