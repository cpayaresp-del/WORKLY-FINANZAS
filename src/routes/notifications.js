import { Router } from 'express';
import Notification from '../models/Notification.js';
import User from '../models/User.js';
import { sendPushNotification } from '../services/push_notifications.js';

const router = Router();

router.post('/', async (req, res) => {
  try {
    const { type, title, body, projectId } = req.body;
    if (!title?.trim() || !body?.trim()) {
      return res.status(400).json({ error: 'Título y contenido son obligatorios' });
    }
    const notification = await Notification.create({
      userId: req.user.id,
      type,
      title: title.trim(),
      body: body.trim(),
      projectId: projectId || null,
    });
    const user = await User.findById(req.user.id).select('fcmTokens');
    await sendPushNotification(
      user?.fcmTokens.map(({ token }) => token) || [],
      notification,
      { notificationId: notification.id, type: notification.type },
    );
    return res.status(201).json(notification);
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }
});

router.get('/', async (req, res) => {
  try {
    const { unread } = req.query;
    let query = Notification.find({ userId: req.user.id });
    if (unread === 'true') query = query.find({ isRead: false });
    const notifications = await query.sort({ createdAt: -1 });
    res.json(notifications);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.patch('/:id/read', async (req, res) => {
  try {
    const n = await Notification.findByIdAndUpdate(
      { _id: req.params.id, userId: req.user.id },
      { isRead: true },
      { new: true },
    );
    if (!n) return res.status(404).json({ error: 'Notificación no encontrada' });
    res.json(n);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.patch('/read-all', async (req, res) => {
  try {
    await Notification.updateMany({ userId: req.user.id, isRead: false }, { isRead: true });
    res.json({ message: 'Todas marcadas como leídas' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/:id', async (req, res) => {
  try {
    const notification = await Notification.findOneAndDelete({
      _id: req.params.id,
      userId: req.user.id,
    });
    if (!notification) {
      return res.status(404).json({ error: 'Notificación no encontrada' });
    }
    res.json({ message: 'Notificación eliminada' });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

export default router;
