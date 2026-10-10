import mongoose from 'mongoose';

const documentSchema = new mongoose.Schema(
  {
    projectId: { type: String, required: true },
    title: { type: String, required: true },
    type: {
      type: String,
      enum: ['paper', 'dataset', 'presentation', 'report', 'protocol', 'other'],
      default: 'other',
    },
    fileUrl: { type: String, default: null },
    storageName: { type: String, default: null },
    originalName: { type: String, default: null },
    mimeType: { type: String, default: null },
    fileType: { type: String, default: 'pdf' },
    sizeKb: { type: Number, default: 0 },
    uploadedById: { type: String, required: true },
    version: { type: String, default: '1.0' },
    tags: { type: [String], default: [] },
    createdAt: { type: Date, default: Date.now },
    updatedAt: { type: Date, default: Date.now },
  },
  { timestamps: false },
);

export default mongoose.model('Document', documentSchema);
