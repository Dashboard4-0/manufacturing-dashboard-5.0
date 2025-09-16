import { Request, Response } from 'express';
import { z } from 'zod';
import { ActionsService } from '../services/actions.service';
import { createActionSchema, updateActionSchema } from '../validation/action.schema';
import { auditLog } from '@ms5/shared/logger';

const actionsService = new ActionsService();

export async function getActions(req: Request, res: Response): Promise<void> {
  const querySchema = z.object({
    status: z.enum(['OPEN', 'IN_PROGRESS', 'COMPLETED', 'OVERDUE']).optional(),
    type: z.enum(['SAFETY', 'QUALITY', 'DELIVERY', 'COST', 'PEOPLE']).optional(),
    lineId: z.string().uuid().optional(),
    assignee: z.string().optional(),
    from: z.string().datetime().optional(),
    to: z.string().datetime().optional(),
    page: z.string().transform(Number).default('1'),
    limit: z.string().transform(Number).default('20'),
  });

  const query = querySchema.parse(req.query);
  const actions = await actionsService.getActions(query);

  res.json(actions);
}

export async function getAction(req: Request, res: Response): Promise<void> {
  const { id } = req.params;
  const action = await actionsService.getAction(id);

  if (!action) {
    res.status(404).json({
      type: 'https://httpstatuses.com/404',
      title: 'Not Found',
      status: 404,
      detail: `Action ${id} not found`,
    });
    return;
  }

  res.json(action);
}

export async function createAction(req: Request, res: Response): Promise<void> {
  const data = createActionSchema.parse(req.body);
  const userId = (req as any).user?.id;

  const action = await actionsService.createAction(data, userId);

  await auditLog('CREATE', 'action', userId, 'SUCCESS', { actionId: action.id });

  res.status(201).json(action);
}

export async function updateAction(req: Request, res: Response): Promise<void> {
  const { id } = req.params;
  const data = updateActionSchema.parse(req.body);
  const userId = (req as any).user?.id;

  const action = await actionsService.updateAction(id, data, userId);

  if (!action) {
    res.status(404).json({
      type: 'https://httpstatuses.com/404',
      title: 'Not Found',
      status: 404,
      detail: `Action ${id} not found`,
    });
    return;
  }

  await auditLog('UPDATE', 'action', userId, 'SUCCESS', { actionId: action.id });

  res.json(action);
}

export async function deleteAction(req: Request, res: Response): Promise<void> {
  const { id } = req.params;
  const userId = (req as any).user?.id;

  const deleted = await actionsService.deleteAction(id);

  if (!deleted) {
    res.status(404).json({
      type: 'https://httpstatuses.com/404',
      title: 'Not Found',
      status: 404,
      detail: `Action ${id} not found`,
    });
    return;
  }

  await auditLog('DELETE', 'action', userId, 'SUCCESS', { actionId: id });

  res.status(204).send();
}

export async function completeAction(req: Request, res: Response): Promise<void> {
  const { id } = req.params;
  const userId = (req as any).user?.id;

  const bodySchema = z.object({
    resolution: z.string().min(1),
    actualCompletionDate: z.string().datetime().optional(),
  });

  const data = bodySchema.parse(req.body);
  const action = await actionsService.completeAction(id, data.resolution, userId, data.actualCompletionDate);

  if (!action) {
    res.status(404).json({
      type: 'https://httpstatuses.com/404',
      title: 'Not Found',
      status: 404,
      detail: `Action ${id} not found`,
    });
    return;
  }

  await auditLog('COMPLETE', 'action', userId, 'SUCCESS', { actionId: action.id });

  res.json(action);
}