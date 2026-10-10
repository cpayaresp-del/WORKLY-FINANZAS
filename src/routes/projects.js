import { Router } from 'express';
import Project from '../models/Project.js';
import Task from '../models/Task.js';
import User from '../models/User.js';
import ContactRequest from '../models/ContactRequest.js';
import ProjectMemberRequest from '../models/ProjectMemberRequest.js';
import Notification from '../models/Notification.js';
import { sendPushNotification } from '../services/push_notifications.js';
import fs from 'node:fs/promises';
import { upload, uploadToImageKit } from '../services/file_storage.js';
import { normalizeTags, validateProjectDates } from '../utils/project_rules.js';

const router = Router();

async function projectsWithProgress(projects) {
  const ids = projects.map((project) => project._id.toString());
  const tasks = await Task.find({ projectId: { $in: ids } }).select('projectId submissionUrl');
  const progressByProject = new Map();
  for (const id of ids) {
    const projectTasks = tasks.filter((task) => task.projectId === id);
    const submitted = projectTasks.filter((task) => task.submissionUrl).length;
    progressByProject.set(id, projectTasks.length === 0 ? 0 : Math.round((submitted / projectTasks.length) * 100));
  }
  return projects.map((project) => ({
    ...project.toObject(),
    progress: progressByProject.get(project._id.toString()) ?? 0,
  }));
}

router.get('/', async (req, res) => {
  try {
    const projects = await Project.find({
      $or: [{ leadId: req.user.id }, { memberIds: req.user.id }],
    }).sort({ createdAt: -1 });
    res.json(await projectsWithProgress(projects));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/:id', async (req, res) => {
  try {
    const project = await Project.findOne({ _id: req.params.id, $or: [{ leadId: req.user.id }, { memberIds: req.user.id }] });
    if (!project) return res.status(404).json({ error: 'Proyecto no encontrado' });
    res.json((await projectsWithProgress([project]))[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/:id/avatar', upload.single('file'), async (req, res) => {
  try {
    const project = await Project.findOne({ _id: req.params.id, leadId: req.user.id });
    if (!project) {
      if (req.file) await fs.unlink(req.file.path).catch(() => {});
      return res.status(403).json({ error: 'Sólo el líder puede cambiar la foto del proyecto' });
    }
    if (!req.file) return res.status(400).json({ error: 'No se recibió ninguna imagen' });
    project.avatarUrl = await uploadToImageKit(req.file, 'workly/projects');
    await project.save();
    res.json(project);
  } catch (err) {
    if (req.file) await fs.unlink(req.file.path).catch(() => {});
    res.status(400).json({ error: err.message });
  }
});

router.post('/:id/member-requests', async (req, res) => {
  try {
    const project = await Project.findOne({ _id: req.params.id, leadId: req.user.id });
    if (!project) return res.status(403).json({ error: 'Sólo el líder puede invitar contactos' });
    const recipient = await User.findById(req.body.userId).select('name displayName fcmTokens');
    if (!recipient) return res.status(404).json({ error: 'Contacto no encontrado' });
    if (recipient.id === req.user.id || project.memberIds.includes(recipient.id)) {
      return res.status(400).json({ error: 'El contacto ya pertenece al proyecto' });
    }
    const connected = await ContactRequest.findOne({
      status: 'accepted',
      $or: [
        { requesterId: req.user.id, recipientId: recipient._id },
        { requesterId: recipient._id, recipientId: req.user.id },
      ],
    });
    if (!connected) return res.status(403).json({ error: 'Sólo puedes invitar a tus contactos' });
    const existing = await ProjectMemberRequest.findOne({
      projectId: project._id,
      requesterId: req.user.id,
      recipientId: recipient._id,
      status: 'pending',
    });
    if (existing) return res.status(409).json({ error: 'Ya enviaste esta solicitud' });
    const request = await ProjectMemberRequest.findOneAndUpdate(
      { projectId: project._id, requesterId: req.user.id, recipientId: recipient._id },
      { status: 'pending' },
      { upsert: true, new: true, setDefaultsOnInsert: true },
    );
    const requester = await User.findById(req.user.id).select('name displayName');
    const notification = await Notification.create({
      userId: recipient._id,
      type: 'projectMemberRequest',
      title: 'Invitación a un proyecto',
      body: `${requester?.displayName || requester?.name || 'Un contacto'} quiere agregarte a ${project.title}`,
      projectId: project.id,
      relatedUserId: req.user.id,
    });
    await sendPushNotification(
      recipient.fcmTokens?.map(({ token }) => token) || [],
      notification,
      { notificationId: notification.id, type: notification.type, projectId: project.id, relatedUserId: req.user.id },
    );
    res.status(201).json({ request, notification });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.get('/member-requests/:projectId', async (req, res) => {
  try {
    const request = await ProjectMemberRequest.findOne({
      projectId: req.params.projectId,
      recipientId: req.user.id,
      requesterId: req.query.requesterId,
      status: 'pending',
    }).populate('projectId', 'title description avatarUrl').populate('requesterId', 'name email avatarUrl');
    if (!request) return res.status(404).json({ error: 'La solicitud ya no está disponible' });
    res.json(request);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.post('/member-requests/:projectId/respond', async (req, res) => {
  try {
    const accepted = req.body.accepted === true;
    const request = await ProjectMemberRequest.findOne({
      projectId: req.params.projectId,
      recipientId: req.user.id,
      requesterId: req.body.requesterId,
      status: 'pending',
    });
    if (!request) return res.status(404).json({ error: 'La solicitud ya no está disponible' });
    if (accepted) {
      const project = await Project.findById(request.projectId);
      if (!project) return res.status(404).json({ error: 'Proyecto no encontrado' });
      if (!project.memberIds.includes(req.user.id)) {
        project.memberIds.push(req.user.id);
        await project.save();
      }
    }
    request.status = accepted ? 'accepted' : 'rejected';
    await request.save();
    res.json({ message: accepted ? 'Te uniste al proyecto' : 'Invitación rechazada' });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.post('/', async (req, res) => {
  try {
    const startDate = req.body.startDate ? new Date(req.body.startDate) : null;
    const endDate = req.body.endDate ? new Date(req.body.endDate) : null;
    const dateError = validateProjectDates(startDate, endDate);
    if (dateError) return res.status(400).json({ error: dateError });

    const project = new Project({
      ...req.body,
      leadId: req.user.id,
      memberIds: [req.user.id],
      tags: normalizeTags(req.body.tags || req.body.tagsText || ''),
    });
    await project.save();
    res.status(201).json(project);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.put('/:id/formulation', async (req, res) => {
  try {
    const project = await Project.findOne({
      _id: req.params.id,
      $or: [{ leadId: req.user.id }, { memberIds: req.user.id }],
    });
    if (!project) {
      return res.status(403).json({ error: 'No tienes acceso a este proyecto' });
    }
    if (
      !req.body.formulation ||
      typeof req.body.formulation !== 'object' ||
      Array.isArray(req.body.formulation)
    ) {
      return res.status(400).json({ error: 'La formulación no es válida' });
    }
    project.formulation = req.body.formulation;
    project.markModified('formulation');
    await project.save();
    res.json({ formulation: project.formulation });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.put('/:id', async (req, res) => {
  try {
    const current = await Project.findOne({ _id: req.params.id, leadId: req.user.id });
    if (!current) return res.status(403).json({ error: 'Sólo el líder puede editar el proyecto' });
    const requestedMembers = [...new Set(req.body.memberIds || current.memberIds)];
    const currentMembers = new Set([current.leadId, ...current.memberIds]);
    if (requestedMembers.some((memberId) => !currentMembers.has(memberId))) {
      return res.status(403).json({ error: 'Los nuevos miembros deben unirse mediante una invitación' });
    }
    const memberIds = requestedMembers;
    const nextLeadId = req.body.leadId || current.leadId;
    if (!memberIds.includes(nextLeadId)) return res.status(400).json({ error: 'El líder debe pertenecer al proyecto' });
    const validMembers = await User.countDocuments({ _id: { $in: memberIds } });
    if (validMembers !== memberIds.length) return res.status(400).json({ error: 'Hay miembros inválidos' });

    const startDate = req.body.startDate ? new Date(req.body.startDate) : current.startDate;
    const endDate = req.body.endDate === undefined ? current.endDate : req.body.endDate ? new Date(req.body.endDate) : null;
    const dateError = validateProjectDates(startDate, endDate);
    if (dateError) return res.status(400).json({ error: dateError });

    const project = await Project.findByIdAndUpdate(req.params.id, {
      ...req.body,
      leadId: nextLeadId,
      memberIds,
      startDate,
      endDate,
      tags: req.body.tags ? normalizeTags(req.body.tags) : current.tags,
    }, {
      new: true,
      runValidators: true,
    });
    if (!project) return res.status(404).json({ error: 'Proyecto no encontrado' });
    res.json(project);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.delete('/:id', async (req, res) => {
  try {
    const deleted = await Project.findOneAndDelete({ _id: req.params.id, leadId: req.user.id });
    if (!deleted) return res.status(404).json({ error: 'Proyecto no encontrado' });
    await Task.deleteMany({ projectId: req.params.id });
    const { Objective } = await import('../models/Objective.js');
    await Objective.deleteMany({ projectId: req.params.id });
    res.json({ message: 'Proyecto eliminado' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/:id/objectives', async (req, res) => {
  try {
    const accessible = await Project.findOne({ _id: req.params.id, $or: [{ leadId: req.user.id }, { memberIds: req.user.id }] });
    if (!accessible) return res.status(403).json({ error: 'No tienes acceso a este proyecto' });
    const { Objective } = await import('../models/Objective.js');
    const objectives = await Objective.find({ projectId: req.params.id });
    res.json(objectives);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
