import Project from '../models/Project.js';

export async function findAccessibleProject(projectId, userId) {
  return Project.findOne({
    _id: projectId,
    $or: [{ leadId: userId }, { memberIds: userId }],
  });
}

export async function requireProjectMember(req, res, next) {
  const projectId = req.params.projectId || req.body.projectId || req.query.projectId;
  if (!projectId) return res.status(400).json({ error: 'projectId es obligatorio' });
  try {
    const project = await findAccessibleProject(projectId, req.user.id);
    if (!project) return res.status(403).json({ error: 'No tienes acceso a este proyecto' });
    req.project = project;
    return next();
  } catch (error) {
    return res.status(400).json({ error: error.message });
  }
}
