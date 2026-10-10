import { Router } from 'express';
import User from '../models/User.js';

const router = Router();

router.post('/fcm-token', async (req, res) => {
  const { token, platform } = req.body;
  if (typeof token !== 'string' || token.trim().length < 10) {
    return res.status(400).json({ error: 'Token FCM inválido' });
  }

  try {
    await User.updateOne(
      { _id: req.user.id },
      { $pull: { fcmTokens: { token: token.trim() } } },
    );
    await User.updateOne(
      { _id: req.user.id },
      { $push: { fcmTokens: { token: token.trim(), platform: platform || 'unknown', updatedAt: new Date() } } },
    );
    return res.status(204).send();
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});

router.delete('/fcm-token', async (req, res) => {
  const { token } = req.body;
  if (typeof token !== 'string' || !token.trim()) {
    return res.status(400).json({ error: 'Token FCM requerido' });
  }

  try {
    await User.updateOne({ _id: req.user.id }, { $pull: { fcmTokens: { token: token.trim() } } });
    return res.status(204).send();
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});

export default router;
