import { Router } from 'express';
import type { Request, Response, NextFunction } from 'express';
import { authenticate } from '../middleware/auth.js';
import { requireHR } from '../middleware/rbac.js';
import * as alertService from '../services/alert-service.js';

export const alertRoutes: Router = Router();

alertRoutes.use(authenticate, requireHR);

alertRoutes.get('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const acknowledged = req.query.acknowledged as string | undefined;
    const alerts = await alertService.getAlerts({
      acknowledged: acknowledged !== undefined ? acknowledged === 'true' : undefined,
    });
    res.json({ alerts });
  } catch (err) {
    next(err);
  }
});

alertRoutes.patch('/:id/acknowledge', async (req: Request, res: Response, next: NextFunction) => {
  try {
    await alertService.acknowledgeAlert(String(req.params.id));
    res.json({ message: 'Alert acknowledged' });
  } catch (err) {
    next(err);
  }
});
