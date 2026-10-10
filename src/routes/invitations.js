import crypto from 'node:crypto';
import { Router } from 'express';
import Project from '../models/Project.js';
import ProjectInvitation from '../models/ProjectInvitation.js';
import User from '../models/User.js';
import Notification from '../models/Notification.js';
import { sendPushNotification } from '../services/push_notifications.js';

const router = Router();

router.post('/projects/:projectId', async (req, res) => {
  try {
    const project = await Project.findOne({ _id: req.params.projectId, leadId: req.user.id });
    if (!project) return res.status(403).json({ error: 'Sólo el creador puede invitar usuarios' });
    const token = crypto.randomBytes(32).toString('base64url');
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    await ProjectInvitation.create({
      projectId: project._id,
      inviterId: req.user.id,
      tokenHash: crypto.createHash('sha256').update(token).digest('hex'),
      expiresAt,
    });
    const appUrl = process.env.APP_INVITE_URL || 'workly://invite';
    return res.status(201).json({
      token,
      projectId: project.id,
      expiresAt,
      inviteUrl: `${appUrl}?token=${encodeURIComponent(token)}`,
    });
  } catch (error) {
    return res.status(400).json({ error: error.message });
  }
});

router.get('/:token', async (req, res) => {
  try {
    const tokenHash = crypto.createHash('sha256').update(req.params.token).digest('hex');
    const invitation = await ProjectInvitation.findOne({
      tokenHash,
      acceptedBy: null,
      expiresAt: { $gt: new Date() },
    });
    if (!invitation) return res.status(400).json({ error: 'La invitación no existe, ya fue usada o caducó' });
    const project = await Project.findById(invitation.projectId).select('title description avatarUrl');
    if (!project) return res.status(404).json({ error: 'Proyecto no encontrado' });
    const inviter = await User.findById(invitation.inviterId).select('name displayName');
    return res.json({ project, inviterName: inviter?.name, expiresAt: invitation.expiresAt });
  } catch (error) {
    return res.status(400).json({ error: error.message });
  }
});

router.post('/:token/accept', async (req, res) => {
  try {
    const tokenHash = crypto.createHash('sha256').update(req.params.token).digest('hex');
    const invitation = await ProjectInvitation.findOne({
      tokenHash,
      acceptedBy: null,
      expiresAt: { $gt: new Date() },
    });
    if (!invitation) return res.status(400).json({ error: 'La invitación no existe, ya fue usada o caducó' });
    const project = await Project.findById(invitation.projectId);
    if (!project) return res.status(404).json({ error: 'Proyecto no encontrado' });
    if (!project.memberIds.includes(req.user.id) && project.leadId !== req.user.id) {
      project.memberIds.push(req.user.id);
      await project.save();
    }
    invitation.acceptedBy = req.user.id;
    invitation.acceptedAt = new Date();
    await invitation.save();
    const member = await User.findById(req.user.id).select('name displayName');
    const inviter = await User.findById(invitation.inviterId).select('fcmTokens');
    if (inviter) {
      const notification = await Notification.create({
        userId: inviter._id,
        type: 'projectUpdate',
        title: 'Nueva persona en el proyecto',
        body: `${member?.displayName || member?.name || 'Un usuario'} aceptó la invitación al proyecto`,
        projectId: project._id.toString(),
      });
      await sendPushNotification(
        inviter.fcmTokens?.map(({ token }) => token) || [],
        notification,
        { notificationId: notification.id, type: 'projectUpdate', projectId: project._id },
      );
    }
    return res.json({ message: 'Te uniste al proyecto', project });
  } catch (error) {
    return res.status(400).json({ error: error.message });
  }
});

export default router;