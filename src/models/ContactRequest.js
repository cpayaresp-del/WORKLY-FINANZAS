import mongoose from 'mongoose';

const contactRequestSchema = new mongoose.Schema(
  {
    requesterId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    recipientId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    status: {
      type: String,
      enum: ['pending', 'accepted', 'rejected'],
      default: 'pending',
    },
  },
  { timestamps: true },
);

contactRequestSchema.index({ requesterId: 1, recipientId: 1 }, { unique: true });

export default mongoose.model('ContactRequest', contactRequestSchema);
