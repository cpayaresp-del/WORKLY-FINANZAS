import mongoose from 'mongoose';

const projectMemberRequestSchema = new mongoose.Schema(
  {
    projectId: { type: mongoose.Schema.Types.ObjectId, ref: 'Project', required: true, index: true },
    requesterId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    recipientId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    status: {
      type: String,
      enum: ['pending', 'accepted', 'rejected'],
      default: 'pending',
    },
  },
  { timestamps: true },
);

projectMemberRequestSchema.index(
  { projectId: 1, requesterId: 1, recipientId: 1 },
  { unique: true },
);

export default mongoose.model('ProjectMemberRequest', projectMemberRequestSchema);
