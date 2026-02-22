/**
 * Dashboard Routes
 * Serves static HTML files for the web dashboard
 */

import { Router, Response } from 'express';
import path from 'path';

const router = Router();

/**
 * Serve dashboard HTML
 */
router.get('/', (_req, res: Response) => {
  res.sendFile(path.join(process.cwd(), 'public', 'index.html'));
});

/**
 * Serve login page
 */
router.get('/login.html', (_req, res: Response) => {
  res.sendFile(path.join(process.cwd(), 'public', 'login.html'));
});

export default router;
