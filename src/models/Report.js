import mongoose from 'mongoose';

const reportSchema = new mongoose.Schema(
  {
    projectId: { type: String, required: true },
    title: { type: String, required: true },
    summary: { type: String, default: '' },
    authorId: { type: String, required: true },
    authorName: { type: String, required: true },
    progressBefore: { type: Number, default: 0 },
    progressAfter: { type: Number, default: 0 },
    highlights: { type: [String], default: [] },
    challenges: { type: [String], default: [] },
    nextSteps: { type: [String], default: [] },
    periodStart: { type: Date, required: true },
    periodEnd: { type: Date, required: true },
    createdAt: { type: Date, default: Date.now },
  },
  { timestamps: false },
);

export default mongoose.model('Report', reportSchema);
