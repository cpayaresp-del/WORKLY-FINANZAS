import mongoose from 'mongoose';

const directMessageSchema = new mongoose.Schema(
  {
    chatId: { type: mongoose.Schema.Types.ObjectId, ref: 'DirectChat', required: true, index: true },
    senderId: { type: String, required: true, index: true },
    senderName: { type: String, required: true },
    senderAvatarUrl: { type: String, default: null },
    content: { type: String, required: true, trim: true, maxlength: 5000 },
    attachmentUrl: { type: String, default: null },
    attachmentName: { type: String, default: null },
    attachmentStorageName: { type: String, default: null },
    attachmentType: { type: String, default: null },
    replyToMessageId: { type: String, default: null },
    replyToSenderName: { type: String, default: null },
    replyToContent: { type: String, default: null },
    isDeleted: { type: Boolean, default: false },
    hiddenFor: { type: [String], default: [] },
    sentAt: { type: Date, default: Date.now, index: true },
  },
  { timestamps: false },
);

directMessageSchema.index({ chatId: 1, sentAt: 1 });

export default mongoose.model('DirectMessage', directMessageSchema);
