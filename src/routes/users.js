import { Router } from 'express';
import User from '../models/User.js';
import Notification from '../models/Notification.js';
import ContactRequest from '../models/ContactRequest.js';
import { sendPushNotification } from '../services/push_notifications.js';
import { upload, uploadToImageKit } from '../services/file_storage.js';
import { setPresencePreference } from '../services/realtime.js';

const router = Router();

const institutionFromEmail = (email) => {
  const domain = email?.split('@')[1]?.toLowerCase();
  if (!domain || ['gmail.com', 'hotmail.com', 'outlook.com', 'yahoo.com', 'icloud.com'].includes(domain)) {
    return null;
  }
  return domain;
};

const isInstitutionalEmail = (email) => institutionFromEmail(email) != null;

router.get('/', async (req, res) => {
  try {
    const users = await User.find().sort({ createdAt: -1 });
    res.json(users);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/directory', async (req, res) => {
  try {
    const users = await User.find({ _id: { $ne: req.user.id } })
      .select('_id name displayName description email institution documentNumber phoneNumber dateOfBirth avatarUrl role profileVisibility googleId projectIds createdAt')
      .sort({ name: 1 })
      .lean();
    res.json(users.map(({ googleId, ...user }) => ({ ...user, emailEditable: !googleId })));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/', async (req, res) => {
  try {
    const user = new User(req.body);
    await user.save();
    res.status(201).json(user);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.put('/:id', async (req, res) => {
  if (req.params.id !== req.user.id) {
    return res.status(403).json({ error: 'Sólo puedes actualizar tu propio perfil' });
  }
  try {
    const currentUser = await User.findById(req.params.id).select('+googleId email');
    if (!currentUser) return res.status(404).json({ error: 'Usuario no encontrado' });
    if (req.body.email && req.body.email !== currentUser.email && currentUser.googleId) {
      return res.status(403).json({ error: 'El correo de una cuenta de Google no se puede modificar' });
    }
    const effectiveEmail = req.body.email || currentUser.email;
    if (isInstitutionalEmail(effectiveEmail)) {
      const detectedInstitution = institutionFromEmail(effectiveEmail);
      if (req.body.institution && req.body.institution !== detectedInstitution) {
        return res.status(400).json({ error: 'La institución se obtiene automáticamente del correo institucional' });
      }
      req.body.institution = detectedInstitution;
    } else if (req.body.email) {
      req.body.institution ??= institutionFromEmail(req.body.email);
    }
    const user = await User.findByIdAndUpdate(
      req.params.id,
      req.body,
      { new: true, runValidators: true },
    );
    if (!user) return res.status(404).json({ error: 'Usuario no encontrado' });
    if (typeof req.body.showOnlineStatus === 'boolean') {
      setPresencePreference(user.id, req.body.showOnlineStatus);
    }
    res.json(user);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.post('/:id/contact-request', async (req, res) => {
  try {
    if (req.params.id === req.user.id) {
      return res.status(400).json({ error: 'No puedes enviarte una solicitud a ti mismo' });
    }
    const recipient = await User.findById(req.params.id).select('name displayName fcmTokens');
    if (!recipient) return res.status(404).json({ error: 'Usuario no encontrado' });
    const existing = await ContactRequest.findOne({
      requesterId: req.user.id,
      recipientId: recipient._id,
      status: 'pending',
    });
    if (existing) return res.status(409).json({ error: 'Ya enviaste una solicitud a este usuario' });
    const alreadyContact = await ContactRequest.findOne({
      status: 'accepted',
      $or: [
        { requesterId: req.user.id, recipientId: recipient._id },
        { requesterId: recipient._id, recipientId: req.user.id },
      ],
    });
    if (alreadyContact) return res.status(409).json({ error: 'Este usuario ya está en tus contactos' });

    const requester = await User.findById(req.user.id).select('name displayName');
    const request = await ContactRequest.findOneAndUpdate(
      { requesterId: req.user.id, recipientId: recipient._id },
      { status: 'pending' },
      { upsert: true, new: true, setDefaultsOnInsert: true },
    );
    const notification = await Notification.create({
      userId: recipient._id,
      type: 'contactRequest',
      title: 'Solicitud de contacto',
      body: `${requester?.displayName || requester?.name || 'Un usuario'} te está enviando una solicitud de contacto`,
      relatedUserId: req.user.id,
    });
    await sendPushNotification(
      recipient.fcmTokens?.map(({ token }) => token) || [],
      notification,
      { notificationId: notification.id, type: notification.type, relatedUserId: req.user.id },
    );
    res.status(201).json({ request, notification });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.get('/contacts', async (req, res) => {
  try {
    const requests = await ContactRequest.find({
      status: 'accepted',
      $or: [{ requesterId: req.user.id }, { recipientId: req.user.id }],
    }).lean();
    const ids = requests.map((request) => (
      request.requesterId.toString() === req.user.id
        ? request.recipientId
        : request.requesterId
    ));
    const contacts = await User.find({ _id: { $in: ids } })
      .select('_id name displayName description email institution avatarUrl role projectIds createdAt')
      .sort({ name: 1 });
    res.json(contacts);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/contact-requests/incoming', async (req, res) => {
  try {
    const requests = await ContactRequest.find({ recipientId: req.user.id, status: 'pending' })
      .populate('requesterId', 'name email institution avatarUrl role createdAt')
      .sort({ createdAt: -1 });
    res.json(requests.map((request) => ({
      requestId: request.id,
      user: request.requesterId,
      createdAt: request.createdAt,
    })));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/:id/contact-request/respond', async (req, res) => {
  try {
    const accepted = req.body.accepted === true;
    const request = await ContactRequest.findOne({
      requesterId: req.params.id,
      recipientId: req.user.id,
      status: 'pending',
    });
    if (!request) return res.status(404).json({ error: 'Solicitud de contacto no encontrada' });
    request.status = accepted ? 'accepted' : 'rejected';
    await request.save();
    const recipient = await User.findById(req.user.id).select('name displayName');
    const requester = await User.findById(req.params.id).select('name displayName fcmTokens');
    if (requester) {
      const notification = await Notification.create({
        userId: requester._id,
        type: accepted ? 'contactRequestAccepted' : 'contactRequestRejected',
        title: accepted ? 'Solicitud de contacto aceptada' : 'Solicitud de contacto rechazada',
        body: `${recipient?.displayName || recipient?.name || 'El usuario'} ${accepted ? 'aceptó' : 'rechazó'} tu solicitud de contacto`,
        relatedUserId: req.user.id,
      });
      await sendPushNotification(
        requester.fcmTokens?.map(({ token }) => token) || [],
        notification,
        { notificationId: notification.id, type: notification.type, relatedUserId: req.user.id },
      );
    }
    res.json({ request });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.get('/:id', async (req, res) => {
  try {
    const user = await User.findById(req.params.id);
    if (!user) return res.status(404).json({ error: 'Usuario no encontrado' });
    res.json(user);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/:id/avatar', upload.single('file'), async (req, res) => {
  try {
    if (req.params.id !== req.user.id) {
      return res.status(403).json({ error: 'No puedes cambiar este avatar' });
    }
    if (!req.file) return res.status(400).json({ error: 'No se recibió ninguna imagen' });
    const avatarUrl = await uploadToImageKit(req.file, 'workly/avatars');
    const user = await User.findByIdAndUpdate(
      req.params.id,
      { avatarUrl },
      { new: true, runValidators: true },
    );
    if (!user) return res.status(404).json({ error: 'Usuario no encontrado' });
    res.json(user);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.delete('/:id', async (req, res) => {
  try {
    const deleted = await User.findByIdAndDelete(req.params.id);
    if (!deleted) return res.status(404).json({ error: 'Usuario no encontrado' });
    res.json({ message: 'Usuario eliminado' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
