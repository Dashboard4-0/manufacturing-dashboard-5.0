import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { Request, Response } from 'express';
import { ActionsController } from '../actions.controller';
import { prisma } from '../../lib/prisma';
import { AuditLogger } from '@ms5/shared';

vi.mock('../../lib/prisma', () => ({
  prisma: {
    sQDCAction: {
      create: vi.fn(),
      findMany: vi.fn(),
      findUnique: vi.fn(),
      update: vi.fn()
    }
  }
}));

vi.mock('@ms5/shared', () => ({
  AuditLogger: vi.fn().mockImplementation(() => ({
    log: vi.fn()
  }))
}));

describe('ActionsController', () => {
  let controller: ActionsController;
  let mockReq: Partial<Request>;
  let mockRes: Partial<Response>;

  beforeEach(() => {
    controller = new ActionsController();
    mockReq = {
      body: {},
      params: {},
      query: {},
      user: { id: 'test-user', role: 'manager' }
    };
    mockRes = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn().mockReturnThis()
    };
    vi.clearAllMocks();
  });

  describe('createAction', () => {
    it('should create a new SQDC action', async () => {
      const actionData = {
        boardType: 'SQDC',
        category: 'SAFETY',
        description: 'Test action',
        assignedTo: 'user-1',
        dueDate: new Date().toISOString()
      };

      mockReq.body = actionData;
      (prisma.sQDCAction.create as any).mockResolvedValue({
        id: 'action-1',
        ...actionData,
        createdAt: new Date(),
        updatedAt: new Date()
      });

      await controller.createAction(mockReq as Request, mockRes as Response);

      expect(prisma.sQDCAction.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          boardType: actionData.boardType,
          category: actionData.category,
          description: actionData.description
        })
      });
      expect(mockRes.status).toHaveBeenCalledWith(201);
      expect(mockRes.json).toHaveBeenCalledWith(
        expect.objectContaining({
          id: 'action-1',
          boardType: actionData.boardType
        })
      );
    });

    it('should handle validation errors', async () => {
      mockReq.body = { description: 'Missing required fields' };

      await controller.createAction(mockReq as Request, mockRes as Response);

      expect(mockRes.status).toHaveBeenCalledWith(400);
      expect(mockRes.json).toHaveBeenCalledWith(
        expect.objectContaining({
          error: expect.any(String)
        })
      );
    });
  });

  describe('getActions', () => {
    it('should retrieve actions with filters', async () => {
      mockReq.query = {
        boardType: 'SQDC',
        category: 'QUALITY',
        status: 'OPEN'
      };

      const mockActions = [
        {
          id: 'action-1',
          boardType: 'SQDC',
          category: 'QUALITY',
          status: 'OPEN',
          description: 'Action 1'
        },
        {
          id: 'action-2',
          boardType: 'SQDC',
          category: 'QUALITY',
          status: 'OPEN',
          description: 'Action 2'
        }
      ];

      (prisma.sQDCAction.findMany as any).mockResolvedValue(mockActions);

      await controller.getActions(mockReq as Request, mockRes as Response);

      expect(prisma.sQDCAction.findMany).toHaveBeenCalledWith({
        where: {
          boardType: 'SQDC',
          category: 'QUALITY',
          status: 'OPEN'
        },
        orderBy: { createdAt: 'desc' }
      });
      expect(mockRes.json).toHaveBeenCalledWith(mockActions);
    });
  });

  describe('updateActionStatus', () => {
    it('should update action status', async () => {
      mockReq.params = { id: 'action-1' };
      mockReq.body = { status: 'COMPLETED' };

      const updatedAction = {
        id: 'action-1',
        status: 'COMPLETED',
        completedAt: new Date()
      };

      (prisma.sQDCAction.findUnique as any).mockResolvedValue({
        id: 'action-1',
        status: 'IN_PROGRESS'
      });
      (prisma.sQDCAction.update as any).mockResolvedValue(updatedAction);

      await controller.updateActionStatus(mockReq as Request, mockRes as Response);

      expect(prisma.sQDCAction.update).toHaveBeenCalledWith({
        where: { id: 'action-1' },
        data: expect.objectContaining({
          status: 'COMPLETED'
        })
      });
      expect(mockRes.json).toHaveBeenCalledWith(updatedAction);
    });

    it('should return 404 for non-existent action', async () => {
      mockReq.params = { id: 'non-existent' };
      mockReq.body = { status: 'COMPLETED' };

      (prisma.sQDCAction.findUnique as any).mockResolvedValue(null);

      await controller.updateActionStatus(mockReq as Request, mockRes as Response);

      expect(mockRes.status).toHaveBeenCalledWith(404);
      expect(mockRes.json).toHaveBeenCalledWith({
        error: 'Action not found'
      });
    });
  });
});