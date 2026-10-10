import mongoose from 'mongoose';

const objectiveSchema = new mongoose.Schema(
  {
    projectId: { type: String, required: true },
    title: { type: String, required: true },
    description: { type: String, default: '' },
    status: {
      type: String,
      enum: ['notStarted', 'inProgress', 'achieved', 'deferred'],
      default: 'notStarted',
    },
    weight: { type: Number, default: 1.0 },
    targetDate: { type: Date, default: null },
    milestones: { type: [String], default: [] },
    completedMilestones: { type: Number, default: 0 },
    createdAt: { type: Date, default: Date.now },
  },
  { timestamps: false },
);

export default mongoose.model('Objective', objectiveSchema);
