import { Router } from 'express';
import Task from '../models/Task.js';
import { findAccessibleProject } from '../middleware/project_access.js';
import User from '../models/User.js';
import Notification from '../models/Notification.js';
import fs from 'node:fs/promises';
import { upload, uploadToImageKit } from '../services/file_storage.js';
import { sendPushNotification } from '../services/push_notifications.js';
import { validateTaskAssignee } from '../utils/project_rules.js';

const router = Router();

async function notifyAssignee(task, project, assigneeId) {
  const assignee = await User.findById(assigneeId).select('fcmTokens');
  if (!assignee) return;

  const notification = await Notification.create({
    userId: assignee._id,
    type: 'taskAssigned',
    title: 'Nueva tarea asignada',
    body: `Te asignaron "${task.title}" en el proyecto ${project.title}. ${
      task.dueDate
        ? `Tienes hasta el ${new Intl.DateTimeFormat('es-MX', { dateStyle: 'long' }).format(task.dueDate)} para realizarla.`
        : 'No se definió una fecha límite.'
    }`,
    projectId: project.id,
  });
  await sendPushNotification(
    assignee.fcmTokens?.map(({ token }) => token) || [],
    notification,
    { notificationId: notification.id, type: notification.type, projectId: project.id },
  );
}

router.get('/', async (req, res) => {
  try {
    const { projectId, status, assigneeId } = req.query;
    const accessibleProjects = await (await import('../models/Project.js')).default.find({ $or: [{ leadId: req.user.id }, { memberIds: req.user.id }] }).select('_id');
    const filter = { projectId: { $in: accessibleProjects.map((project) => project._id.toString()) } };
    if (projectId) filter.projectId = projectId;
    if (status) filter.status = status;
    if (assigneeId) filter.assigneeId = assigneeId;
    const tasks = await Task.find(filter).sort({ createdAt: -1 });
    res.json(tasks);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/:id', async (req, res) => {
  try {
    const task = await Task.findById(req.params.id);
    if (!task) return res.status(404).json({ error: 'Tarea no encontrada' });
    if (!(await findAccessibleProject(task.projectId, req.user.id))) return res.status(403).json({ error: 'No tienes acceso a esta tarea' });
    res.json(task);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/', upload.single('file'), async (req, res) => {
  try {
    const project = await findAccessibleProject(req.body.projectId, req.user.id);
    if (!project) {
      if (req.file) await fs.unlink(req.file.path).catch(() => {});
      return res.status(403).json({ error: 'No tienes acceso al proyecto' });
    }
    if (req.body.assigneeId) {
      if (!(await User.exists({ _id: req.body.assigneeId }))) {
        if (req.file) await fs.unlink(req.file.path).catch(() => {});
        return res.status(400).json({ error: 'Asignado inválido' });
      }
      const assigneeError = validateTaskAssignee(project, req.body.assigneeId);
      if (assigneeError) {
        if (req.file) await fs.unlink(req.file.path).catch(() => {});
        return res.status(400).json({ error: assigneeError });
      }
    }
    const task = new Task({
      ...req.body,
      status: 'todo',
      assignedById: req.body.assigneeId ? req.user.id : null,
    });
    if (req.file) {
      task.attachmentUrl = await uploadToImageKit(req.file, 'workly/task-instructions');
      task.attachmentName = req.file.originalname;
    }
    await task.save();
    if (task.assigneeId) await notifyAssignee(task, project, task.assigneeId);
    res.status(201).json(task);
  } catch (err) {
    if (req.file) await fs.unlink(req.file.path).catch(() => {});
    res.status(400).json({ error: err.message });
  }
});

router.put('/:id', async (req, res) => {
  try {
    const current = await Task.findById(req.params.id);
    if (!current) return res.status(404).json({ error: 'Tarea no encontrada' });
    const project = await findAccessibleProject(current.projectId, req.user.id);
    if (!project) return res.status(403).json({ error: 'No tienes acceso a esta tarea' });

    const targetProjectId = req.body.projectId || current.projectId;
    const targetProject = targetProjectId === current.projectId ? project : await findAccessibleProject(targetProjectId, req.user.id);
    if (!targetProject) return res.status(403).json({ error: 'No tienes acceso al nuevo proyecto' });

    const assigneeId = req.body.assigneeId === undefined ? current.assigneeId : req.body.assigneeId;
    if (assigneeId && !(await User.exists({ _id: assigneeId }))) return res.status(400).json({ error: 'Asignado inválido' });
    if (assigneeId) {
      const assigneeError = validateTaskAssignee(targetProject, assigneeId);
      if (assigneeError) return res.status(400).json({ error: assigneeError });
    }

    const updates = { ...req.body };
    delete updates.status;
    delete updates.assignedById;
    if (assigneeId && assigneeId !== current.assigneeId) {
      updates.assignedById = req.user.id;
    }
    if (req.body.assigneeId === null) {
      updates.assigneeId = null;
      updates.assignedById = req.user.id;
    }
    const task = await Task.findByIdAndUpdate(req.params.id, updates, {
      new: true,
      runValidators: true,
    });
    if (!task) return res.status(404).json({ error: 'Tarea no encontrada' });
    if (task.assigneeId && task.assigneeId !== current.assigneeId) {
      const assignedProject = task.projectId === project.id
        ? project
        : await findAccessibleProject(task.projectId, req.user.id);
      if (assignedProject) await notifyAssignee(task, assignedProject, task.assigneeId);
    }
    res.json(task);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.patch('/:id/status', async (req, res) => {
  res.status(409).json({ error: 'La actividad se completa al cargar una entrega' });
});

router.post('/:id/submission', upload.single('file'), async (req, res) => {
  try {
    const task = await Task.findById(req.params.id);
    if (!task) return res.status(404).json({ error: 'Tarea no encontrada' });
    const project = await findAccessibleProject(task.projectId, req.user.id);
    if (!project || (task.assigneeId && task.assigneeId !== req.user.id && project.leadId !== req.user.id)) {
      if (req.file) await fs.unlink(req.file.path).catch(() => {});
      return res.status(403).json({ error: 'No puedes cargar una entrega en esta tarea' });
    }
    if (!req.file) return res.status(400).json({ error: 'No se recibió ningún archivo' });
    const completedByAssignee = Boolean(task.assigneeId && task.assigneeId === req.user.id);
    const newlyCompleted = completedByAssignee && task.status !== 'done';
    task.submissionUrl = await uploadToImageKit(req.file, 'workly/submissions');
    task.submissionName = req.file.originalname;
    if (completedByAssignee) task.status = 'done';
    await task.save();

    if (newlyCompleted) {
      const projectLeadId = project.leadId;
      if (projectLeadId && projectLeadId !== req.user.id) {
        const [assigner, completedBy] = await Promise.all([
          User.findById(projectLeadId).select('fcmTokens'),
          User.findById(req.user.id).select('name displayName'),
        ]);
        if (assigner) {
          const memberName = completedBy?.displayName || completedBy?.name || 'Un usuario';
          const notification = await Notification.create({
            userId: assigner._id,
            type: 'taskCompleted',
            title: `${memberName} realizó la actividad propuesta`,
            body: `La tarea "${task.title}" del proyecto ${project.title} se entregó.`,
            projectId: project.id,
            relatedUserId: req.user.id,
          });
          await sendPushNotification(
            assigner.fcmTokens?.map(({ token }) => token) || [],
            notification,
            {
              notificationId: notification.id,
              type: notification.type,
              projectId: project.id,
              relatedUserId: req.user.id,
            },
          );
        }
      }
    }
    res.json(task);
  } catch (err) {
    if (req.file) await fs.unlink(req.file.path).catch(() => {});
    res.status(400).json({ error: err.message });
  }
});

router.delete('/:id', async (req, res) => {
  try {
    const current = await Task.findById(req.params.id);
    if (!current) return res.status(404).json({ error: 'Tarea no encontrada' });
    if (!(await findAccessibleProject(current.projectId, req.user.id))) return res.status(403).json({ error: 'No tienes acceso a esta tarea' });
    const deleted = await Task.findByIdAndDelete(req.params.id);
    if (!deleted) return res.status(404).json({ error: 'Tarea no encontrada' });
    res.json({ message: 'Tarea eliminada' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
