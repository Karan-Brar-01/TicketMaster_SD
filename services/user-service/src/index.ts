import express from 'express';
import cors from 'cors';
import bcrypt from 'bcryptjs';
import { Role } from '@prisma/client';
import { prisma } from './db/prisma';
import authRoutes from './routes/auth';

const app = express();
const PORT = Number(process.env.PORT) || 3001;
const INSTANCE_ID = process.env.INSTANCE_ID || 'user-service';

app.use(cors());
app.use(express.json());

app.use((_req, res, next) => {
  res.setHeader('X-Instance-Id', INSTANCE_ID);
  next();
});

app.get('/api/auth/health', (_req, res) => {
  res.json({ status: 'ok', service: 'user-service', instance: INSTANCE_ID });
});

// Gateway routes /api/auth/* → this service
app.use('/api/auth', authRoutes);
// Direct short paths for local testing
app.use(authRoutes);

async function seedDemoUsers(): Promise<void> {
  const demos = [
    {
      name: 'Demo Admin',
      email: 'admin@demo.com',
      password: 'admin123',
      role: Role.admin,
    },
    {
      name: 'Demo User',
      email: 'user@demo.com',
      password: 'user123',
      role: Role.user,
    },
  ];

  for (const demo of demos) {
    const existing = await prisma.user.findUnique({ where: { email: demo.email } });
    if (existing) continue;
    await prisma.user.create({
      data: {
        name: demo.name,
        email: demo.email,
        password_hash: await bcrypt.hash(demo.password, 10),
        role: demo.role,
      },
    });
    console.log(`[seed] created ${demo.email} / ${demo.password}`);
  }
}

async function main(): Promise<void> {
  await prisma.$connect();
  await seedDemoUsers();

  app.listen(PORT, () => {
    console.log(`[${INSTANCE_ID}] listening on ${PORT}`);
  });
}

main().catch((err) => {
  console.error('Failed to start user-service', err);
  process.exit(1);
});
