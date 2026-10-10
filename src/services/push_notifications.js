import admin from 'firebase-admin';

let messaging = null;

function initializeFirebase() {
  const serviceAccountJson =
    process.env.FIREBASE_SERVICE_ACCOUNT_JSON ||
    process.env.FIREBASE_SERVICE_ACCOUNT;
  if (messaging || !serviceAccountJson) return messaging;

  try {
    const serviceAccount = JSON.parse(serviceAccountJson);
    admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
    messaging = admin.messaging();
  } catch (error) {
    console.error('Firebase Admin no pudo inicializarse:', error.message);
  }
  return messaging;
}

export async function sendPushNotification(tokens, notification, data = {}) {
  const firebaseMessaging = initializeFirebase();
  if (!firebaseMessaging || tokens.length === 0) return;

  try {
    await firebaseMessaging.sendEachForMulticast({
      tokens,
      notification: { title: notification.title, body: notification.body },
      android: {
        notification: { channelId: 'workly_notifications', sound: 'default' },
      },
      apns: { payload: { aps: { sound: 'default' } } },
      data: Object.fromEntries(
        Object.entries(data).map(([key, value]) => [key, String(value)]),
      ),
    });
  } catch (error) {
    console.error('No se pudo enviar la notificación push:', error.message);
  }
}
