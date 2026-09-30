import { Router, Response } from 'express';
import bcrypt from 'bcryptjs';
import { Role } from '@prisma/client';
import { prisma } from '../db/prisma';
import {
  AuthenticatedRequest,
  requireAuth,
  signToken,
} from '../middleware/auth';

const router = Router();

function publicUser(user: {
  id: string;
  name: string;
  email: string;
  role: Role;
  created_at: Date;
}) {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
    created_at: user.created_at,
  };
}

router.post('/register', async (req, res: Response) => {
  try {
    const { name, email, password, role } = req.body as {
      name?: string;
      email?: string;
      password?: string;
      role?: string;
    };

    if (!name?.trim() || !email?.trim() || !password) {
      res.status(400).json({ error: 'name, email, and password are required' });
      return;
    }

    if (password.length < 6) {
      res.status(400).json({ error: 'password must be at least 6 characters' });
      return;
    }

    const existing = await prisma.user.findUnique({
      where: { email: email.toLowerCase().trim() },
    });
    if (existing) {
      res.status(409).json({ error: 'email already registered' });
      return;
    }

    const assignedRole: Role =
      role === 'admin' && process.env.ALLOW_ADMIN_REGISTER === 'true'
        ? Role.admin
        : Role.user;

    const password_hash = await bcrypt.hash(password, 10);
    const user = await prisma.user.create({
      data: {
        name: name.trim(),
        email: email.toLowerCase().trim(),
        password_hash,
        role: assignedRole,
      },
    });

    const token = signToken({
      sub: user.id,
      email: user.email,
      role: user.role,
    });

    res.status(201).json({ user: publicUser(user), token });
  } catch (err) {
    console.error('[register]', err);
    res.status(500).json({ error: 'registration failed' });
  }
});

router.post('/login', async (req, res: Response) => {
  try {
    const { email, password } = req.body as {
      email?: string;
      password?: string;
    };

    if (!email?.trim() || !password) {
      res.status(400).json({ error: 'email and password are required' });
      return;
    }

    const user = await prisma.user.findUnique({
      where: { email: email.toLowerCase().trim() },
    });
    if (!user) {
      res.status(401).json({ error: 'invalid credentials' });
      return;
    }

    const ok = await bcrypt.compare(password, user.password_hash);
    if (!ok) {
      res.status(401).json({ error: 'invalid credentials' });
      return;
    }

    const token = signToken({
      sub: user.id,
      email: user.email,
      role: user.role,
    });

    res.json({ user: publicUser(user), token });
  } catch (err) {
    console.error('[login]', err);
    res.status(500).json({ error: 'login failed' });
  }
});

router.get('/me', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.user!.sub },
    });
    if (!user) {
      res.status(404).json({ error: 'user not found' });
      return;
    }
    res.json({ user: publicUser(user) });
  } catch (err) {
    console.error('[me]', err);
    res.status(500).json({ error: 'failed to load profile' });
  }
});

export default router;
