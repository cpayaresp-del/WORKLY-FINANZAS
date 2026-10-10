import { Router } from 'express';
import Message from '../models/Message.js';
import Project from '../models/Project.js';
import User from '../models/User.js';
import Notification from '../models/Notification.js';
import { broadcastMessage, broadcastMessageDeleted } from '../services/realtime.js';
import { sendPushNotification } from '../services/push_notifications.js';
import fs from 'node:fs/promises';
import path from 'node:path';
import { upload, uploadDirectory, uploadToImageKit } from '../services/file_storage.js';

const router = Router();

async function notifyProjectMembers(project, senderId, senderName, messageText) {
  try {
    const recipientIds = [project.leadId, ...project.memberIds]
      .map((id) => id.toString())
      .filter((id, index, ids) => id !== senderId.toString() && ids.indexOf(id) === index);
    if (recipientIds.length === 0) return;
    const recipients = await User.find({ _id: { $in: recipientIds } }).select('_id fcmTokens');
    const notifications = await Notification.insertMany(
      recipients.map((recipient) => ({
        userId: recipient._id,
        type: 'messageReceived',
        title: project.title,
        body: `${senderName}: ${messageText}`,
        projectId: project._id.toString(),
      })),
    );
    await Promise.all(recipients.map((recipient, index) => sendPushNotification(
      recipient.fcmTokens?.map(({ token }) => token) || [],
      notifications[index],
      { notificationId: notifications[index].id, type: 'messageReceived', projectId: project._id },
    )));
  } catch (error) {
    console.error('No se pudo notificar el mensaje:', error.message);
  }
}

router.get('/:projectId', async (req, res) => {
  try {
    const project = await Project.findOne({
      _id: req.params.projectId,
      $or: [{ leadId: req.user.id }, { memberIds: req.user.id }],
    });
    if (!project) return res.status(403).json({ error: 'No perteneces a este proyecto' });
    const messages = await Message.find({
      projectId: req.params.projectId,
      hiddenFor: { $ne: req.user.id },
    }).sort({ sentAt: 1, _id: 1 });
    const senderIds = [...new Set(messages.map((message) => message.senderId))];
    const users = await User.find({ _id: { $in: senderIds } }).select('_id avatarUrl');
    const avatars = new Map(users.map((user) => [user._id.toString(), user.avatarUrl]));
    res.json(messages.map((message) => {
      const data = message.toObject();
      data.senderAvatarUrl ??= avatars.get(message.senderId);
      return data;
    }));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/', async (req, res) => {
  try {
    const project = await Project.findOne({
      _id: req.body.projectId,
      $or: [{ leadId: req.user.id }, { memberIds: req.user.id }],
    });
    if (!project) return res.status(403).json({ error: 'No perteneces a este proyecto' });
    const user = await User.findById(req.user.id).select('name displayName avatarUrl');
    const message = new Message({
      ...req.body,
      senderId: req.user.id,
      senderName: user?.displayName || user?.name || 'Usuario',
      senderAvatarUrl: user?.avatarUrl,
      sentAt: new Date(),
    });
    await message.save();
    broadcastMessage(message.projectId, message);
    await notifyProjectMembers(
      project,
      req.user.id,
      user?.displayName || user?.name || 'Usuario',
      message.content || 'Te enviaron un archivo',
    );
    res.status(201).json(message);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.post('/attachment', upload.single('file'), async (req, res) => {
  try {
    const project = await Project.findOne({
      _id: req.body.projectId,
      $or: [{ leadId: req.user.id }, { memberIds: req.user.id }],
    });
    if (!project || !req.file) {
      if (req.file) await fs.unlink(req.file.path).catch(() => {});
      return res.status(400).json({ error: 'Archivo o proyecto inválido' });
    }
    const user = await User.findById(req.user.id).select('name displayName avatarUrl');
    const attachmentUrl = await uploadToImageKit(req.file, 'workly/chat');
    const message = new Message({
      projectId: req.body.projectId,
      senderId: req.user.id,
      senderName: user?.displayName || user?.name || 'Usuario',
      senderAvatarUrl: user?.avatarUrl,
      content: req.body.content || '',
      attachmentUrl,
      attachmentName: req.file.originalname,
      attachmentType: req.body.attachmentType || req.file.mimetype,
    });
    await message.save();
    broadcastMessage(message.projectId, message);
    await notifyProjectMembers(
      project,
      req.user.id,
      user?.displayName || user?.name || 'Usuario',
      message.content || (message.attachmentType === 'audio' ? 'Te enviaron una nota de voz' : 'Te enviaron un archivo'),
    );
    res.status(201).json(message);
  } catch (err) {
    if (req.file) await fs.unlink(req.file.path).catch(() => {});
    res.status(400).json({ error: err.message });
  }
});

router.delete('/:id', async (req, res) => {
  try {
    const now = new Date();
    const editableAfter = new Date(now.getTime() - 2 * 60 * 60 * 1000);
    const message = await Message.findOneAndUpdate(
      {
        _id: req.params.id,
        senderId: req.user.id,
        isDeleted: false,
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
    broadcastMessageDeleted(message.projectId, message);
    res.json({ message: 'Mensaje anulado' });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.patch('/:id/hide', async (req, res) => {
  try {
    const message = await Message.findById(req.params.id);
    if (!message || message.isDeleted) {
      return res.status(404).json({ error: 'Mensaje no encontrado' });
    }
    const project = await Project.findOne({
      _id: message.projectId,
      $or: [{ leadId: req.user.id }, { memberIds: req.user.id }],
    });
    if (!project) {
      return res.status(403).json({ error: 'No perteneces a este proyecto' });
    }
    await Message.updateOne(
      { _id: message.id },
      { $addToSet: { hiddenFor: req.user.id } },
    );
    res.json({ message: 'Mensaje eliminado para ti' });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

async function editMessage(req, res) {
  try {
    const content = req.body.content?.trim();
    if (!content) {
      return res.status(400).json({ error: 'El mensaje no puede estar vacío' });
    }
    const now = new Date();
    const editableAfter = new Date(now.getTime() - 2 * 60 * 60 * 1000);
    const message = await Message.findOneAndUpdate(
      {
        _id: req.params.id,
        senderId: req.user.id,
        isDeleted: false,
        sentAt: { $gte: editableAfter, $lte: now },
      },
      { content, isEdited: true },
      { new: true, runValidators: true },
    );
    if (!message) {
      return res.status(403).json({
        error: 'Solo puedes editar tus mensajes durante las primeras 2 horas',
      });
    }
    res.json(message);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
}

router.patch('/:id', editMessage);
router.put('/:id', editMessage);

router.get('/:id/download', async (req, res) => {
  try {
    const message = await Message.findById(req.params.id);
    if (!message || message.isDeleted) return res.status(404).json({ error: 'Mensaje no encontrado' });
    const project = await Project.findOne({
      _id: message.projectId,
      $or: [{ leadId: req.user.id }, { memberIds: req.user.id }],
    });
    if (!project || !message.attachmentUrl) {
      return res.status(403).json({ error: 'Sin acceso al archivo' });
    }
    if (message.attachmentUrl.startsWith('http')) return res.redirect(message.attachmentUrl);
    if (!message.attachmentStorageName) return res.status(404).json({ error: 'Archivo no disponible' });
    return res.download(
      path.join(uploadDirectory, message.attachmentStorageName),
      message.attachmentName || 'archivo',
    );
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

export default router;
