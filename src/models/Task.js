import mongoose from 'mongoose';

const taskSchema = new mongoose.Schema(
  {
    projectId: { type: String, required: true },
    title: { type: String, required: true },
    description: { type: String, default: '' },
    status: {
      type: String,
      enum: ['todo', 'inProgress', 'review', 'done'],
      default: 'todo',
    },
    priority: {
      type: String,
      enum: ['low', 'medium', 'high', 'urgent'],
      default: 'medium',
    },
    assigneeId: { type: String, default: null },
    assignedById: { type: String, default: null },
    objectiveId: { type: String, default: null },
    dueDate: { type: Date, default: null },
    subtasks: { type: [String], default: [] },
    completedSubtasks: { type: Number, default: 0 },
    attachmentUrl: { type: String, default: null },
    attachmentName: { type: String, default: null },
    submissionUrl: { type: String, default: null },
    submissionName: { type: String, default: null },
    createdAt: { type: Date, default: Date.now },
  },
  { timestamps: false },
);

export default mongoose.model('Task', taskSchema);
