import { Router } from 'express';
import DirectChat from '../models/DirectChat.js';
import DirectMessage from '../models/DirectMessage.js';
import ContactRequest from '../models/ContactRequest.js';
import Notification from '../models/Notification.js';
import User from '../models/User.js';
import {
  broadcastDirectMessage,
  broadcastDirectMessageDeleted,
  isUserOnline,
} from '../services/realtime.js';
import { sendPushNotification } from '../services/push_notifications.js';
import fs from 'node:fs/promises';
import { upload, uploadToImageKit } from '../services/file_storage.js';

const router = Router();

async function hasAcceptedContact(userId, contactId) {
  return ContactRequest.exists({
    status: 'accepted',
    $or: [
      { requesterId: userId, recipientId: contactId },
      { requesterId: contactId, recipientId: userId },
    ],
  });
}

async function serializeChat(chat, userId) {
  const otherUserId = chat.participantIds.find((id) => id !== userId);
  const otherUser = otherUserId
    ? await User.findById(otherUserId).select('name displayName avatarUrl institution role showOnlineStatus')
    : null;
  const latestVisibleMessage = await DirectMessage.findOne({
    chatId: chat._id,
    isDeleted: { $ne: true },
    hiddenFor: { $ne: userId },
  }).sort({ sentAt: -1 });
  const readAt = chat.readAtByUser.get(userId);
  const unreadCount = otherUserId
    ? await DirectMessage.countDocuments({
        chatId: chat._id,
        senderId: otherUserId,
        isDeleted: { $ne: true },
        hiddenFor: { $ne: userId },
        ...(readAt ? { sentAt: { $gt: readAt } } : {}),
      })
    : 0;

  return {
    id: chat.id,
    otherUser: otherUser
      ? {
          id: otherUser.id,
          name: otherUser.displayName || otherUser.name,
          avatarUrl: otherUser.avatarUrl,
          institution: otherUser.institution,
          role: otherUser.role,
          isOnline: isUserOnline(otherUserId) && otherUser.showOnlineStatus !== false,
        }
      : { id: otherUserId, name: 'Usuario', avatarUrl: null },
    lastMessage: latestVisibleMessage?.content ?? '',
    lastMessageSenderId: latestVisibleMessage?.senderId ?? null,
    lastMessageAt: latestVisibleMessage?.sentAt ?? new Date(0),
    unreadCount,
  };
}

async function getChatForUser(chatId, userId) {
  return DirectChat.findOne({ _id: chatId, participantIds: userId });
}

async function notifyDirectMessage(chat, senderId, sender, content) {
  const otherUserId = chat.participantIds.find((id) => id !== senderId);
  const recipient = otherUserId
    ? await User.findById(otherUserId).select('fcmTokens')
    : null;
  if (!recipient) return;
  const notification = await Notification.create({
    userId: recipient._id,
    type: 'messageReceived',
    title: `${sender?.displayName || sender?.name || 'Un contacto'} te escribió`,
    body: content,
    directChatId: chat.id,
    relatedUserId: senderId,
  });
  await sendPushNotification(
    recipient.fcmTokens?.map(({ token }) => token) || [],
    notification,
    {
      notificationId: notification.id,
      type: notification.type,
      directChatId: chat.id,
      relatedUserId: senderId,
    },
  );
}

router.get('/', async (req, res) => {
  try {
    const chats = await DirectChat.find({
      participantIds: req.user.id,
      hiddenFor: { $ne: req.user.id },
    }).sort({ lastMessageAt: -1 });
    res.json(await Promise.all(chats.map((chat) => serializeChat(chat, req.user.id))));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/:userId', async (req, res) => {
  try {
    const otherUserId = req.params.userId;
    if (otherUserId === req.user.id) {
      return res.status(400).json({ error: 'No puedes abrir un chat contigo mismo' });
    }
    const contact = await User.findById(otherUserId).select('_id');
    if (!contact) return res.status(404).json({ error: 'Contacto no encontrado' });
    if (!(await hasAcceptedContact(req.user.id, otherUserId))) {
      return res.status(403).json({ error: 'Solo puedes chatear con tus contactos aceptados' });
    }

    const participantIds = [req.user.id, otherUserId].sort();
    const pairKey = participantIds.join(':');
    const chat = await DirectChat.findOneAndUpdate(
      { pairKey },
      {
        $setOnInsert: {
          pairKey,
          participantIds,
          lastMessageAt: new Date(0),
        },
        $pull: { hiddenFor: req.user.id },
      },
      { new: true, upsert: true, setDefaultsOnInsert: true },
    );
    res.json(await serializeChat(chat, req.user.id));
  } catch (err) {
    if (err.code === 11000) {
      const pairKey = [req.user.id, req.params.userId].sort().join(':');
      const chat = await DirectChat.findOne({ pairKey });
      if (chat) return res.json(await serializeChat(chat, req.user.id));
    }
    res.status(400).json({ error: err.message });
  }
});

router.get('/:chatId/messages', async (req, res) => {
  try {
    const chat = await getChatForUser(req.params.chatId, req.user.id);
    if (!chat) return res.status(404).json({ error: 'Chat privado no encontrado' });
    const messages = await DirectMessage.find({
      chatId: chat._id,
      hiddenFor: { $ne: req.user.id },
    }).sort({ sentAt: 1, _id: 1 });
    res.json(messages);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.post('/:chatId/messages', async (req, res) => {
  try {
    const content = req.body.content?.trim();
    if (!content) return res.status(400).json({ error: 'El mensaje no puede estar vacío' });
    const chat = await getChatForUser(req.params.chatId, req.user.id);
    if (!chat) return res.status(404).json({ error: 'Chat privado no encontrado' });
    const otherUserId = chat.participantIds.find((id) => id !== req.user.id);
    if (!otherUserId || !(await hasAcceptedContact(req.user.id, otherUserId))) {
      return res.status(403).json({ error: 'El contacto ya no está disponible' });
    }
    const sender = await User.findById(req.user.id).select('name displayName avatarUrl');
    const message = await DirectMessage.create({
      chatId: chat._id,
      senderId: req.user.id,
      senderName: sender?.displayName || sender?.name || 'Usuario',
      senderAvatarUrl: sender?.avatarUrl,
      content,
      replyToMessageId: req.body.replyToMessageId || null,
      replyToSenderName: req.body.replyToSenderName || null,
      replyToContent: req.body.replyToContent || null,
    });
    chat.lastMessage = content;
    chat.lastMessageSenderId = req.user.id;
    chat.lastMessageAt = message.sentAt;
    chat.readAtByUser.set(req.user.id, message.sentAt);
    await chat.save();
    broadcastDirectMessage(chat.id, message.toObject());

    await notifyDirectMessage(chat, req.user.id, sender, content);
    res.status(201).json(message);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.post('/:chatId/attachment', upload.single('file'), async (req, res) => {
  try {
    const chat = await getChatForUser(req.params.chatId, req.user.id);
    if (!chat || !req.file) {
      if (req.file) await fs.unlink(req.file.path).catch(() => {});
      return res.status(400).json({ error: 'Archivo o chat inválido' });
    }
    const otherUserId = chat.participantIds.find((id) => id !== req.user.id);
    if (!otherUserId || !(await hasAcceptedContact(req.user.id, otherUserId))) {
      await fs.unlink(req.file.path).catch(() => {});
      return res.status(403).json({ error: 'El contacto ya no está disponible' });
    }
    const sender = await User.findById(req.user.id).select('name displayName avatarUrl');
    const attachmentUrl = await uploadToImageKit(req.file, 'workly/chat');
    const content = req.body.content || (
      req.body.attachmentType === 'audio' ? 'Nota de voz' : 'Archivo adjunto'
    );
    const message = await DirectMessage.create({
      chatId: chat._id,
      senderId: req.user.id,
      senderName: sender?.displayName || sender?.name || 'Usuario',
      senderAvatarUrl: sender?.avatarUrl,
      content,
      attachmentUrl,
      attachmentName: req.file.originalname,
      attachmentType: req.body.attachmentType || req.file.mimetype,
      replyToMessageId: req.body.replyToMessageId || null,
      replyToSenderName: req.body.replyToSenderName || null,
      replyToContent: req.body.replyToContent || null,
    });
    chat.lastMessage = content;
    chat.lastMessageSenderId = req.user.id;
    chat.lastMessageAt = message.sentAt;
    chat.readAtByUser.set(req.user.id, message.sentAt);
    await chat.save();
    broadcastDirectMessage(chat.id, message.toObject());
    await notifyDirectMessage(chat, req.user.id, sender, content);
    res.status(201).json(message);
  } catch (err) {
    if (req.file) await fs.unlink(req.file.path).catch(() => {});
    res.status(400).json({ error: err.message });
  }
});

router.delete('/:chatId/messages/:messageId', async (req, res) => {
  try {
    const chat = await getChatForUser(req.params.chatId, req.user.id);
    if (!chat) return res.status(404).json({ error: 'Chat privado no encontrado' });
    const now = new Date();
    const editableAfter = new Date(now.getTime() - 2 * 60 * 60 * 1000);
    const message = await DirectMessage.findOneAndUpdate(
      {
        _id: req.params.messageId,
        chatId: chat._id,
        senderId: req.user.id,
        isDeleted: { $ne: true },
        sentAt: { $gte: editableAfter, $lte: now },
      },
      {
        isDeleted: true,
        content: '',
        attachmentUrl: null,
        attachmentName: null,
        attachmentStorageName: null,
      },
      { new: true },
    );
    if (!message) {
      return res.status(403).json({
        error: 'Solo puedes anular tus mensajes durante las primeras 2 horas',
      });
    }

    const latestMessage = await DirectMessage.findOne({
      chatId: chat._id,
      isDeleted: { $ne: true },
    }).sort({ sentAt: -1 });
    chat.lastMessage = latestMessage?.content ?? '';
    chat.lastMessageSenderId = latestMessage?.senderId ?? null;
    chat.lastMessageAt = latestMessage?.sentAt ?? new Date(0);
    await chat.save();

    broadcastDirectMessageDeleted(chat.id, message);
    res.json(message);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.patch('/:chatId/messages/:messageId/hide', async (req, res) => {
  try {
    const chat = await getChatForUser(req.params.chatId, req.user.id);
    if (!chat) return res.status(404).json({ error: 'Chat privado no encontrado' });
    const result = await DirectMessage.updateOne(
      {
        _id: req.params.messageId,
        chatId: chat._id,
        isDeleted: { $ne: true },
      },
      { $addToSet: { hiddenFor: req.user.id } },
    );
    if (!result.matchedCount) {
      return res.status(404).json({ error: 'Mensaje no encontrado' });
    }
    res.json({ message: 'Mensaje eliminado para ti' });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.patch('/:chatId/read', async (req, res) => {
  try {
    const chat = await getChatForUser(req.params.chatId, req.user.id);
    if (!chat) return res.status(404).json({ error: 'Chat privado no encontrado' });
    const latestIncoming = await DirectMessage.findOne({
      chatId: chat._id,
      senderId: { $ne: req.user.id },
      isDeleted: { $ne: true },
    }).sort({ sentAt: -1 });
    if (latestIncoming) {
      chat.readAtByUser.set(req.user.id, latestIncoming.sentAt);
      await chat.save();
    }
    await Notification.updateMany(
      {
        userId: req.user.id,
        directChatId: chat.id,
        type: 'messageReceived',
        isRead: false,
      },
      { isRead: true },
    );
    res.json({ message: 'Chat marcado como leído' });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.delete('/:chatId', async (req, res) => {
  try {
    const chat = await getChatForUser(req.params.chatId, req.user.id);
    if (!chat) return res.status(404).json({ error: 'Chat privado no encontrado' });
    if (!chat.hiddenFor.includes(req.user.id)) {
      chat.hiddenFor.push(req.user.id);
      await chat.save();
    }
    res.json({ message: 'Chat privado eliminado' });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

export default router;
