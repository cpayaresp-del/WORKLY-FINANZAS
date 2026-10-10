import jwt from 'jsonwebtoken';
import { Server } from 'socket.io';
import Project from '../models/Project.js';
import DirectChat from '../models/DirectChat.js';
import User from '../models/User.js';

let io;
const userSockets = new Map();
const userPresenceRooms = new Map();
const presencePreferences = new Map();

export function isUserOnline(userId) {
  return presencePreferences.get(userId) !== false &&
    (userSockets.get(userId)?.size ?? 0) > 0;
}

export function setPresencePreference(userId, enabled) {
  presencePreferences.set(userId, enabled);
  const online = enabled && (userSockets.get(userId)?.size ?? 0) > 0;
  for (const room of userPresenceRooms.get(userId) ?? []) {
    io?.to(room).emit('presence', { userId, online });
  }
  for (const socket of userSockets.get(userId) ?? []) {
    socket.data.presenceEnabled = enabled;
  }
}

export function attachRealtime(server) {
  io = new Server(server, {
    cors: { origin: process.env.CORS_ORIGIN || '*' },
  });

  io.use(async (socket, next) => {
    try {
      const token = socket.handshake.auth?.token;
      const projectId = socket.handshake.query?.projectId;
      const directChatId = socket.handshake.query?.directChatId;
      const presenceOnly = socket.handshake.query?.presenceOnly === 'true';
      const payload = jwt.verify(token || '', process.env.JWT_SECRET || 'workly-development-secret');
      const user = await User.findById(payload.userId).select('showOnlineStatus');
      if (!user) throw new Error('unauthorized');
      socket.data.userId = payload.userId;
      socket.data.presenceEnabled = user.showOnlineStatus !== false;
      presencePreferences.set(payload.userId, socket.data.presenceEnabled);
      if (projectId) {
        const project = await Project.findOne({
          _id: projectId,
          $or: [{ leadId: payload.userId }, { memberIds: payload.userId }],
        });
        if (!project) throw new Error('forbidden');
        socket.data.room = projectId;
      } else if (directChatId) {
        const chat = await DirectChat.findOne({
          _id: directChatId,
          participantIds: payload.userId,
        });
        if (!chat) throw new Error('forbidden');
        socket.data.room = `direct:${directChatId}`;
      } else if (presenceOnly) {
        socket.data.room = null;
        socket.data.presenceOnly = true;
      } else {
        throw new Error('forbidden');
      }
      next();
    } catch (_) {
      next(new Error('No autorizado'));
    }
  });

  io.on('connection', (socket) => {
    if (socket.data.room) socket.join(socket.data.room);
    const sockets = userSockets.get(socket.data.userId) ?? new Set();
    sockets.add(socket);
    userSockets.set(socket.data.userId, sockets);
    const presenceRooms =
      userPresenceRooms.get(socket.data.userId) ?? new Set();
    if (socket.data.presenceOnly) {
      DirectChat.find({ participantIds: socket.data.userId })
        .select('_id')
        .then((chats) => {
          if (!(userSockets.get(socket.data.userId)?.size ?? 0)) return;
          for (const chat of chats) {
            presenceRooms.add(`direct:${chat.id}`);
          }
          userPresenceRooms.set(socket.data.userId, presenceRooms);
          if (isUserOnline(socket.data.userId)) {
            for (const room of presenceRooms) {
              io.to(room).emit('presence', {
                userId: socket.data.userId,
                online: true,
              });
            }
          }
        })
        .catch((error) => {
          console.error('No se pudieron cargar los chats para presencia:', error.message);
        });
    } else if (socket.data.room?.startsWith('direct:')) {
      presenceRooms.add(socket.data.room);
      userPresenceRooms.set(socket.data.userId, presenceRooms);
    }
    if (socket.data.presenceEnabled) {
      if (socket.data.room) {
        socket.to(socket.data.room).emit('presence', {
          userId: socket.data.userId,
          online: true,
        });
      }
    }
    socket.on('chatActivity', (payload) => {
      if (!socket.data.room) return;
      const activity = payload?.activity;
      if (activity !== null && activity !== 'typing' && activity !== 'recording') return;
      socket.to(socket.data.room).emit('chatActivity', {
        userId: socket.data.userId,
        activity,
      });
    });
    socket.on('disconnect', () => {
      const currentSockets = userSockets.get(socket.data.userId);
      currentSockets?.delete(socket);
      if (currentSockets?.size) return;
      userSockets.delete(socket.data.userId);
      const rooms = userPresenceRooms.get(socket.data.userId) ?? new Set();
      if (socket.data.room?.startsWith('direct:')) rooms.add(socket.data.room);
      if (socket.data.presenceEnabled) {
        for (const room of rooms) {
          io.to(room).emit('presence', {
            userId: socket.data.userId,
            online: false,
          });
        }
      }
      userPresenceRooms.delete(socket.data.userId);
    });
  });
}

export function broadcastMessage(projectId, message) {
  io?.to(projectId).emit('message', message);
}

export function broadcastMessageDeleted(projectId, message) {
  io?.to(projectId).emit('messageDeleted', {
    messageId: message.id,
    projectId,
    senderId: message.senderId,
    senderName: message.senderName,
    sentAt: message.sentAt,
  });
}

export function broadcastDirectMessage(chatId, message) {
  io?.to(`direct:${chatId}`).emit('directMessage', message);
}

export function broadcastDirectMessageDeleted(chatId, message) {
  io?.to(`direct:${chatId}`).emit('directMessageDeleted', {
    ...message.toObject(),
    isDeleted: true,
    content: '',
  });
}
