import { Router } from 'express';
import { authMiddleware } from '../auth/middleware';
import * as actionsController from '../controllers/actions.controller';
import * as tierBoardController from '../controllers/tier-board.controller';
import * as problemSolvingController from '../controllers/problem-solving.controller';

const router = Router();

router.use(authMiddleware);

// Tier Board routes
router.get('/tier-boards', tierBoardController.getTierBoards);
router.get('/tier-boards/current/:lineId', tierBoardController.getCurrentTierBoard);
router.get('/tier-boards/:id', tierBoardController.getTierBoard);
router.post('/tier-boards', tierBoardController.createTierBoard);
router.patch('/tier-boards/:id', tierBoardController.updateTierBoard);

// Actions routes
router.get('/actions', actionsController.getActions);
router.get('/actions/:id', actionsController.getAction);
router.post('/actions', actionsController.createAction);
router.patch('/actions/:id', actionsController.updateAction);
router.delete('/actions/:id', actionsController.deleteAction);
router.post('/actions/:id/complete', actionsController.completeAction);

// Problem Solving routes
router.get('/problems', problemSolvingController.getProblems);
router.get('/problems/:id', problemSolvingController.getProblem);
router.post('/problems', problemSolvingController.createProblem);
router.patch('/problems/:id', problemSolvingController.updateProblem);
router.post('/problems/:id/rca', problemSolvingController.addRootCause);
router.post('/problems/:id/countermeasure', problemSolvingController.addCountermeasure);

export default router;