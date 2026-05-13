import { Router, Request, Response } from 'express';

const router = Router();

let displayState = { total: 0 };

router.get('/', (req: Request, res: Response) => {
  res.json(displayState);
});

router.post('/update', (req: Request, res: Response) => {
  const { total } = req.body;
  if (typeof total !== 'number') {
    return res.status(400).json({ error: 'Total must be a number' });
  }
  displayState.total = total;
  res.json({ success: true, displayState });
});

export default router;