import mongoose from 'mongoose';

const notificationSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    type: {
      type: String,
      enum: [
        'taskAssigned',
        'taskCompleted',
        'deadlineReminder',
        'documentShared',
        'messageReceived',
        'projectUpdate',
        'mention',
        'contactRequest',
        'contactRequestAccepted',
        'contactRequestRejected',
        'projectMemberRequest',
      ],
      default: 'projectUpdate',
    },
    title: { type: String, required: true },
    body: { type: String, required: true },
    projectId: { type: String, default: null },
    directChatId: { type: String, default: null },
    relatedUserId: { type: String, default: null },
    isRead: { type: Boolean, default: false },
    createdAt: { type: Date, default: Date.now },
  },
  { timestamps: false },
);

export default mongoose.model('Notification', notificationSchema);
