import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import multer from 'multer';
import ImageKit from '@imagekit/nodejs';

let imageKit;

export const uploadDirectory = path.resolve(process.env.UPLOAD_DIR || 'uploads');
fs.mkdirSync(uploadDirectory, { recursive: true });

const storage = multer.diskStorage({
  destination: (_req, _file, callback) => callback(null, uploadDirectory),
  filename: (_req, file, callback) => {
    const extension = path.extname(file.originalname).toLowerCase();
    callback(null, `${Date.now()}-${randomUUID()}${extension}`);
  },
});

export const upload = multer({
  storage,
  limits: { fileSize: 25 * 1024 * 1024 },
});

export async function uploadToImageKit(file, folder) {
  if (!process.env.IMAGEKIT_PRIVATE_KEY) {
    throw new Error('ImageKit no está configurado en el servidor');
  }
  imageKit ??= new ImageKit({ privateKey: process.env.IMAGEKIT_PRIVATE_KEY });

  const result = await imageKit.files.upload({
    file: fs.createReadStream(file.path),
    fileName: file.originalname,
    folder,
    useUniqueFileName: true,
  });
  await fs.promises.unlink(file.path).catch(() => {});
  return result.url;
}
