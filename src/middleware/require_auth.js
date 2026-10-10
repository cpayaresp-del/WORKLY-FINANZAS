import jwt from 'jsonwebtoken';

export default function requireAuth(req, res, next) {
  const token = req.headers.authorization?.replace(/^Bearer\s+/i, '');
  if (!token) return res.status(401).json({ error: 'Autenticación requerida' });

  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET || 'workly-development-secret');
    req.user = { id: payload.userId };
    return next();
  } catch (_) {
    return res.status(401).json({ error: 'Sesión inválida o expirada' });
  }
}
