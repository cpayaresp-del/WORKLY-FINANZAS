import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import mongoose from 'mongoose';
import http from 'node:http';

import projectRoutes from './src/routes/projects.js';
import taskRoutes from './src/routes/tasks.js';
import documentRoutes from './src/routes/documents.js';
import reportRoutes from './src/routes/reports.js';
import notificationRoutes from './src/routes/notifications.js';
import messageRoutes from './src/routes/messages.js';
import directChatRoutes from './src/routes/direct_chats.js';
import objectiveRoutes from './src/routes/objectives.js';
import userRoutes from './src/routes/users.js';
import authRoutes from './src/routes/auth.js';
import deviceRoutes from './src/routes/devices.js';
import requireAuth from './src/middleware/require_auth.js';
import { attachRealtime } from './src/services/realtime.js';
import invitationRoutes from './src/routes/invitations.js';
import { ensureUserIndexes } from './src/models/User.js';

const PORT = process.env.PORT || 3001;
const MONGODB_URI = process.env.MONGODB_URI;

if (!MONGODB_URI) {
  console.error('MONGODB_URI no definida en .env');
  process.exit(1);
}

const app = express();
const server = http.createServer(app);
attachRealtime(server);

app.use(cors({ origin: process.env.CORS_ORIGIN || '*' }));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

app.get('/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

app.use('/api/projects', requireAuth, projectRoutes);
app.use('/api/tasks', requireAuth, taskRoutes);
app.use('/api/documents', requireAuth, documentRoutes);
app.use('/api/reports', requireAuth, reportRoutes);
app.use('/api/notifications', requireAuth, notificationRoutes);
app.use('/api/messages', requireAuth, messageRoutes);
app.use('/api/direct-chats', requireAuth, directChatRoutes);
app.use('/api/objectives', requireAuth, objectiveRoutes);
app.use('/api/users', requireAuth, userRoutes);
app.use('/api/devices', requireAuth, deviceRoutes);
app.use('/api/invitations', requireAuth, invitationRoutes);
app.use('/api/auth', authRoutes);

app.use((err, _req, res, _next) => {
  console.error(err.stack);
  res.status(500).json({ error: 'Error interno del servidor' });
});

async function start() {
  try {
    await mongoose.connect(MONGODB_URI, {
      dbName: process.env.MONGODB_DB || 'research_hub',
      serverSelectionTimeoutMS: 10000,
    });
    await ensureUserIndexes();
    console.log('Conectado a MongoDB Atlas');
    server.listen(PORT, '0.0.0.0', () => {
      console.log(`Backend online escuchando en el puerto ${PORT}`);
    });
  } catch (err) {
    console.error('MongoDB no disponible:', err.message);
    process.exit(1);
  }
}

start();
