import mongoose from 'mongoose';

const userSchema = new mongoose.Schema(
  {
    name: { type: String, required: true },
    displayName: { type: String, default: null, trim: true, maxlength: 60 },
    description: { type: String, default: null, trim: true, maxlength: 500 },
    email: { type: String, required: true, unique: true },
    passwordHash: { type: String, default: null, select: false },
    googleId: { type: String, default: undefined },
    institution: { type: String, default: null },
    documentNumber: { type: String, default: null },
    phoneNumber: { type: String, default: null },
    dateOfBirth: { type: Date, default: null },
    profileVisibility: {
      email: { type: Boolean, default: true },
      institution: { type: Boolean, default: true },
      phoneNumber: { type: Boolean, default: false },
      documentNumber: { type: Boolean, default: false },
      role: { type: Boolean, default: true },
    },
    avatarUrl: { type: String, default: null },
    showOnlineStatus: { type: Boolean, default: true },
    role: {
      type: String,
      enum: ['principalInvestigator', 'coInvestigator', 'researcher', 'assistant', 'external'],
      default: 'researcher',
    },
    projectIds: { type: [String], default: [] },
    fcmTokens: {
      type: [{ token: { type: String, required: true }, platform: String, updatedAt: { type: Date, default: Date.now } }],
      default: [],
    },
    resetPasswordTokenHash: { type: String, default: null, select: false },
    resetPasswordExpiresAt: { type: Date, default: null, select: false },
    createdAt: { type: Date, default: Date.now },
  },
  { timestamps: false },
);

userSchema.index(
  { googleId: 1 },
  {
    unique: true,
    partialFilterExpression: { googleId: { $type: 'string' } },
  },
);
userSchema.set('autoIndex', false);

const User = mongoose.model('User', userSchema);

export async function ensureUserIndexes() {
  await User.collection.createIndex({ email: 1 }, { unique: true });

  const indexes = await User.collection.indexes();
  const googleIdIndex = indexes.find(
    (index) =>
      Object.keys(index.key).length === 1 &&
      index.key.googleId === 1,
  );
  const hasCorrectGoogleIdIndex =
    googleIdIndex?.unique === true &&
    googleIdIndex.partialFilterExpression?.googleId?.$type === 'string';

  if (googleIdIndex && !hasCorrectGoogleIdIndex) {
    await User.collection.dropIndex(googleIdIndex.name);
  }

  if (!hasCorrectGoogleIdIndex) {
    await User.collection.createIndex(
      { googleId: 1 },
      {
        unique: true,
        partialFilterExpression: { googleId: { $type: 'string' } },
      },
    );
  }
}

export default User;
