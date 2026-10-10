import { Router } from 'express';
import Document from '../models/Document.js';
import fs from 'node:fs/promises';
import path from 'node:path';
import { upload, uploadDirectory, uploadToImageKit } from '../services/file_storage.js';
import { findAccessibleProject } from '../middleware/project_access.js';

const router = Router();

router.get('/', async (req, res) => {
  try {
    const { projectId, type } = req.query;
    const filter = {};
    if (projectId) filter.projectId = projectId;
    if (type) filter.type = type;
    if (!projectId) {
      const projects = await (await import('../models/Project.js')).default.find({
        $or: [{ leadId: req.user.id }, { memberIds: req.user.id }],
      }).select('_id');
      filter.projectId = { $in: projects.map((project) => project._id.toString()) };
    } else if (!(await findAccessibleProject(projectId, req.user.id))) {
      return res.status(403).json({ error: 'No tienes acceso a este proyecto' });
    }
    const docs = await Document.find(filter).sort({ createdAt: -1 });
    res.json(docs);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/', upload.single('file'), async (req, res) => {
  try {
    const { projectId, title, type, version, tags } = req.body;
    if (!(await findAccessibleProject(projectId, req.user.id))) {
      if (req.file) await fs.unlink(req.file.path).catch(() => {});
      return res.status(403).json({ error: 'No tienes acceso a este proyecto' });
    }
    const fileUrl = req.file ? await uploadToImageKit(req.file, 'workly/documents') : null;
    const doc = new Document({
      projectId,
      title: title || req.file?.originalname || 'Documento',
      type,
      version,
      tags: typeof tags === 'string' ? tags.split(',').map((tag) => tag.trim()).filter(Boolean) : tags,
      uploadedById: req.user.id,
      fileUrl,
      storageName: null,
      originalName: req.file?.originalname || null,
      mimeType: req.file?.mimetype || null,
      fileType: path.extname(req.file?.originalname || '').replace('.', '') || 'file',
      sizeKb: req.file ? Math.ceil(req.file.size / 1024) : 0,
    });
    await doc.save();
    res.status(201).json(doc);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.put('/:id', async (req, res) => {
  try {
    const existing = await Document.findById(req.params.id);
    if (!existing) return res.status(404).json({ error: 'Documento no encontrado' });
    if (!(await findAccessibleProject(existing.projectId, req.user.id))) {
      return res.status(403).json({ error: 'No tienes acceso a este documento' });
    }
    if (req.body.projectId && req.body.projectId !== existing.projectId && !(await findAccessibleProject(req.body.projectId, req.user.id))) {
      return res.status(403).json({ error: 'No tienes acceso al nuevo proyecto' });
    }
    const doc = await Document.findByIdAndUpdate(req.params.id, req.body, {
      new: true,
    });
    if (!doc) return res.status(404).json({ error: 'Documento no encontrado' });
    res.json(doc);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.delete('/:id', async (req, res) => {
  try {
    const existing = await Document.findById(req.params.id);
    if (!existing) return res.status(404).json({ error: 'Documento no encontrado' });
    if (!(await findAccessibleProject(existing.projectId, req.user.id))) {
      return res.status(403).json({ error: 'No tienes acceso a este documento' });
    }
    const deleted = await Document.findByIdAndDelete(req.params.id);
    if (!deleted) return res.status(404).json({ error: 'Documento no encontrado' });
    if (deleted.storageName) await fs.unlink(path.join(uploadDirectory, deleted.storageName)).catch(() => {});
    res.json({ message: 'Documento eliminado' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/:id/download', async (req, res) => {
  try {
    const doc = await Document.findById(req.params.id);
    if (!doc) return res.status(404).json({ error: 'Documento no encontrado' });
    if (!(await findAccessibleProject(doc.projectId, req.user.id))) {
      return res.status(403).json({ error: 'No tienes acceso a este documento' });
    }
    if (doc.fileUrl?.startsWith('http')) return res.redirect(doc.fileUrl);
    if (!doc.storageName) return res.status(404).json({ error: 'El documento no tiene archivo' });
    return res.download(path.join(uploadDirectory, doc.storageName), doc.originalName || doc.title);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

export default router;
