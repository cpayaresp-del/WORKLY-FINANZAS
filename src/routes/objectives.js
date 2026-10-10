import { Router } from 'express';
import Objective from '../models/Objective.js';
import { findAccessibleProject } from '../middleware/project_access.js';

const router = Router();

router.get('/:projectId', async (req, res) => {
  try {
    if (!(await findAccessibleProject(req.params.projectId, req.user.id))) {
      return res.status(403).json({ error: 'No tienes acceso a este proyecto' });
    }
    const objectives = await Objective.find({ projectId: req.params.projectId });
    res.json(objectives);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/', async (req, res) => {
  try {
    if (!(await findAccessibleProject(req.body.projectId, req.user.id))) {
      return res.status(403).json({ error: 'No tienes acceso a este proyecto' });
    }
    const obj = new Objective(req.body);
    await obj.save();
    res.status(201).json(obj);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.put('/:id', async (req, res) => {
  try {
    const current = await Objective.findById(req.params.id);
    if (!current) return res.status(404).json({ error: 'Objetivo no encontrado' });
    if (!(await findAccessibleProject(current.projectId, req.user.id))) {
      return res.status(403).json({ error: 'No tienes acceso a este objetivo' });
    }
    if (req.body.projectId && req.body.projectId !== current.projectId && !(await findAccessibleProject(req.body.projectId, req.user.id))) {
      return res.status(403).json({ error: 'No tienes acceso al nuevo proyecto' });
    }
    const obj = await Objective.findByIdAndUpdate(req.params.id, req.body, {
      new: true,
    });
    res.json(obj);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.delete('/:id', async (req, res) => {
  try {
    const obj = await Objective.findById(req.params.id);
    if (!obj) return res.status(404).json({ error: 'Objetivo no encontrado' });
    if (!(await findAccessibleProject(obj.projectId, req.user.id))) {
      return res.status(403).json({ error: 'No tienes acceso a este objetivo' });
    }
    await obj.deleteOne();
    res.json({ message: 'Objetivo eliminado' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
