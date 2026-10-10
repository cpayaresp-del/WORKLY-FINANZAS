import mongoose from 'mongoose';

const directChatSchema = new mongoose.Schema(
  {
    pairKey: { type: String, required: true, unique: true, index: true },
    participantIds: { type: [String], required: true, index: true },
    hiddenFor: { type: [String], default: [] },
    lastMessage: { type: String, default: '' },
    lastMessageSenderId: { type: String, default: null },
    lastMessageAt: { type: Date, default: Date.now },
    readAtByUser: { type: Map, of: Date, default: () => new Map() },
  },
  { timestamps: true },
);

export default mongoose.model('DirectChat', directChatSchema);
