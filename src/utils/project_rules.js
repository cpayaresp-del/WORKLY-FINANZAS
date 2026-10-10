export function getProjectMemberIds(project) {
  if (!project) return new Set();
  return new Set([project.leadId, ...(project.memberIds || [])].map((id) => String(id)));
}

export function validateProjectDates(startDate, endDate) {
  if (!startDate || !endDate) return null;
  if (new Date(endDate) < new Date(startDate)) {
    return 'La fecha de fin no puede ser anterior a la fecha de inicio';
  }
  return null;
}

export function validateTaskAssignee(project, assigneeId) {
  if (!assigneeId) return null;
  const memberIds = getProjectMemberIds(project);
  if (!memberIds.has(String(assigneeId))) {
    return 'El asignado debe pertenecer al proyecto';
  }
  return null;
}

export function normalizeTags(rawValue = '') {
  return String(rawValue)
    .split(',')
    .map((tag) => tag.trim())
    .filter(Boolean)
    .filter((tag, index, arr) => arr.indexOf(tag) === index);
}
