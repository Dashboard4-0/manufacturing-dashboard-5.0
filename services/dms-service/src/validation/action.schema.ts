import { z } from 'zod';

export const createActionSchema = z.object({
  tierBoardId: z.string().uuid().optional(),
  type: z.enum(['SAFETY', 'QUALITY', 'DELIVERY', 'COST', 'PEOPLE']),
  category: z.string().min(1).max(100),
  description: z.string().min(1).max(1000),
  owner: z.string().min(1).max(100),
  assignee: z.string().min(1).max(100),
  dueDate: z.string().datetime(),
  priority: z.enum(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']).default('MEDIUM'),
  lineId: z.string().uuid(),
  areaId: z.string().uuid().optional(),
  tags: z.array(z.string()).optional(),
  relatedAssetId: z.string().uuid().optional(),
  estimatedEffort: z.number().positive().optional(),
});

export const updateActionSchema = z.object({
  type: z.enum(['SAFETY', 'QUALITY', 'DELIVERY', 'COST', 'PEOPLE']).optional(),
  category: z.string().min(1).max(100).optional(),
  description: z.string().min(1).max(1000).optional(),
  owner: z.string().min(1).max(100).optional(),
  assignee: z.string().min(1).max(100).optional(),
  dueDate: z.string().datetime().optional(),
  priority: z.enum(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']).optional(),
  status: z.enum(['OPEN', 'IN_PROGRESS', 'COMPLETED', 'OVERDUE', 'CANCELLED']).optional(),
  progress: z.number().min(0).max(100).optional(),
  tags: z.array(z.string()).optional(),
  notes: z.string().optional(),
});

export type CreateActionInput = z.infer<typeof createActionSchema>;
export type UpdateActionInput = z.infer<typeof updateActionSchema>;