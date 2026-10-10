import mongoose from 'mongoose';

const messageSchema = new mongoose.Schema(
  {
    projectId: { type: String, required: true },
    senderId: { type: String, required: true },
    senderName: { type: String, required: true },
    senderAvatarUrl: { type: String },
    content: { type: String, default: '' },
    attachmentUrl: { type: String },
    attachmentName: { type: String },
    attachmentType: { type: String },
    replyToMessageId: { type: String, default: null },
    replyToSenderName: { type: String, default: null },
    replyToContent: { type: String, default: null },
    attachmentStorageName: { type: String },
    isEdited: { type: Boolean, default: false },
    isDeleted: { type: Boolean, default: false },
    hiddenFor: { type: [String], default: [] },
    sentAt: { type: Date, default: Date.now },
  },
  { timestamps: false },
);

export default mongoose.model('Message', messageSchema);
