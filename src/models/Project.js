import mongoose from 'mongoose';

const projectSchema = new mongoose.Schema(
  {
    title: { type: String, required: true },
    avatarUrl: { type: String, default: null },
    description: { type: String, default: '' },
    area: { type: String, default: null },
    status: {
      type: String,
      enum: ['planning', 'active', 'onHold', 'completed', 'cancelled'],
      default: 'planning',
    },
    leadId: { type: String, required: true },
    memberIds: { type: [String], default: [] },
    startDate: { type: Date, required: true },
    endDate: { type: Date, default: null },
    budget: { type: Number, default: 0 },
    spent: { type: Number, default: 0 },
    progress: { type: Number, default: 0 },
    tags: { type: [String], default: [] },
    formulation: { type: mongoose.Schema.Types.Mixed, default: () => ({}) },
    createdAt: { type: Date, default: Date.now },
  },
  { timestamps: false },
);

export default mongoose.model('Project', projectSchema);
