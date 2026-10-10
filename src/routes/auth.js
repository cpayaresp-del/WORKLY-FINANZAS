import { Router } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { OAuth2Client } from 'google-auth-library';
import User from '../models/User.js';
import crypto from 'node:crypto';
import { sendPasswordResetEmail } from '../services/email.js';

const router = Router();
const googleClient = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);
const JWT_SECRET = process.env.JWT_SECRET || 'workly-development-secret';
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '7d';

const institutionFromEmail = (email) => {
  const domain = email?.split('@')[1]?.toLowerCase();
  if (!domain || ['gmail.com', 'hotmail.com', 'outlook.com', 'yahoo.com', 'icloud.com'].includes(domain)) {
    return null;
  }
  return domain;
};

const publicUser = (user) => ({
  id: user._id,
  name: user.name,
  displayName: user.displayName,
  description: user.description,
  email: user.email,
  institution: user.institution,
  documentNumber: user.documentNumber,
  phoneNumber: user.phoneNumber,
  dateOfBirth: user.dateOfBirth,
  emailEditable: !user.googleId,
  profileVisibility: user.profileVisibility,
  avatarUrl: user.avatarUrl,
  role: user.role,
  projectIds: user.projectIds,
  createdAt: user.createdAt,
});

const session = (user) => ({
  token: jwt.sign({ userId: user._id.toString() }, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN }),
  user: publicUser(user),
});

router.post('/register', async (req, res) => {
  try {
    const { name, documentNumber, dateOfBirth, email, password } = req.body;
    const parsedDateOfBirth = typeof dateOfBirth === 'string'
      ? new Date(dateOfBirth)
      : null;
    if (
      typeof name !== 'string' ||
      !name.trim() ||
      typeof documentNumber !== 'string' ||
      !documentNumber.trim() ||
      !parsedDateOfBirth ||
      Number.isNaN(parsedDateOfBirth.getTime()) ||
      parsedDateOfBirth > new Date() ||
      typeof email !== 'string' ||
      !email.trim() ||
      typeof password !== 'string' ||
      password.length < 6
    ) {
      return res.status(400).json({
        error: 'Nombre, número de identificación, fecha de nacimiento, correo y una contraseña de al menos 6 caracteres son obligatorios',
      });
    }
    const normalizedEmail = email.trim().toLowerCase();
    if (await User.exists({ email: normalizedEmail })) {
      return res.status(409).json({ error: 'El email ya está registrado' });
    }
    const user = await User.create({
      name: name.trim(),
      documentNumber: documentNumber.trim(),
      dateOfBirth: parsedDateOfBirth,
      email: normalizedEmail,
      institution: institutionFromEmail(normalizedEmail),
      passwordHash: await bcrypt.hash(password, 12),
    });
    return res.status(201).json(session(user));
  } catch (error) {
    console.error('Error registrando usuario:', error);
    return res.status(500).json({ error: error.message });
  }
});

router.post('/login', async (req, res) => {
  try {
    const email = req.body.email?.trim().toLowerCase();
    const { password } = req.body;
    const user = await User.findOne({ email }).select('+passwordHash');
    if (!user?.passwordHash || !(await bcrypt.compare(password || '', user.passwordHash))) {
      return res.status(401).json({ error: 'Email o contraseña incorrectos' });
    }
    return res.json(session(user));
  } catch (error) {
    console.error('Error iniciando sesión:', error);
    return res.status(500).json({ error: error.message });
  }
});

router.post('/forgot-password', async (req, res) => {
  const email = req.body.email?.trim().toLowerCase();
  const genericResponse = { message: 'Si existe una cuenta, recibirás instrucciones por correo' };
  if (!email) return res.json(genericResponse);
  try {
    const user = await User.findOne({ email }).select('+resetPasswordTokenHash +resetPasswordExpiresAt');
    if (!user) return res.json(genericResponse);
    const token = crypto.randomBytes(32).toString('hex');
    user.resetPasswordTokenHash = crypto.createHash('sha256').update(token).digest('hex');
    user.resetPasswordExpiresAt = new Date(Date.now() + 15 * 60 * 1000);
    await user.save();
    await sendPasswordResetEmail(user.email, token);
    return res.json(genericResponse);
  } catch (error) {
    console.error('Error solicitando recuperación:', error.message);
    return res.status(500).json({ error: 'No se pudo enviar el correo de recuperación' });
  }
});

router.post('/reset-password', async (req, res) => {
  const { token, password } = req.body;
  if (typeof token !== 'string' || typeof password !== 'string' || password.length < 6) {
    return res.status(400).json({ error: 'Token y contraseña válida son obligatorios' });
  }
  try {
    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
    const user = await User.findOne({
      resetPasswordTokenHash: tokenHash,
      resetPasswordExpiresAt: { $gt: new Date() },
    }).select('+resetPasswordTokenHash +resetPasswordExpiresAt');
    if (!user) return res.status(400).json({ error: 'El enlace no es válido o ya caducó' });
    user.passwordHash = await bcrypt.hash(password, 12);
    user.resetPasswordTokenHash = null;
    user.resetPasswordExpiresAt = null;
    await user.save();
    return res.json({ message: 'Contraseña actualizada' });
  } catch (error) {
    return res.status(500).json({ error: 'No se pudo actualizar la contraseña' });
  }
});

router.post('/google', async (req, res) => {
  try {
    if (!process.env.GOOGLE_CLIENT_ID) {
      return res.status(503).json({ error: 'Google Sign-In no está configurado en el backend' });
    }
    const ticket = await googleClient.verifyIdToken({
      idToken: req.body.idToken,
      audience: process.env.GOOGLE_CLIENT_ID,
    });
    const payload = ticket.getPayload();
    if (!payload?.sub || !payload.email) return res.status(401).json({ error: 'Token de Google inválido' });
    let user = await User.findOne({ $or: [{ googleId: payload.sub }, { email: payload.email.toLowerCase() }] });
    if (!user) {
      user = await User.create({
        name: payload.name || payload.email.split('@')[0],
        email: payload.email.toLowerCase(),
        institution: institutionFromEmail(payload.email),
        googleId: payload.sub,
        avatarUrl: payload.picture || null,
      });
    } else if (!user.googleId) {
      user.googleId = payload.sub;
      user.avatarUrl = user.avatarUrl || payload.picture || null;
      await user.save();
    }
    return res.json(session(user));
  } catch (error) {
    return res.status(401).json({ error: 'No se pudo validar la cuenta de Google' });
  }
});

router.get('/me', async (req, res) => {
  try {
    const token = req.headers.authorization?.replace('Bearer ', '');
    const decoded = jwt.verify(token || '', JWT_SECRET);
    const user = await User.findById(decoded.userId);
    if (!user) return res.status(404).json({ error: 'Usuario no encontrado' });
    return res.json(publicUser(user));
  } catch (_) {
    return res.status(401).json({ error: 'Sesión inválida o expirada' });
  }
});

export default router;