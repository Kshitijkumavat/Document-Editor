// models/Message.js - Message Schema
const mongoose = require('mongoose');

const messageSchema = new mongoose.Schema({
  content: {
    type: String,
    required: true,
    trim: true,
    maxlength: 1000
  },
  sender: {
    type: String,
    required: true,
    ref: 'User'
  },
  roomId: {
    type: String,
    required: function() {
      return this.type !== 'private';
    },
    index: true
  },
  recipient: {
    type: String,
    ref: 'User',
    required: function() {
      return this.type === 'private';
    }
  },
  type: {
    type: String,
    enum: ['text', 'image', 'file', 'system', 'private'],
    default: 'text'
  },
  attachments: [{
    filename: String,
    originalName: String,
    mimeType: String,
    size: Number,
    url: String
  }],
  metadata: {
    edited: {
      type: Boolean,
      default: false
    },
    editedAt: Date,
    deleted: {
      type: Boolean,
      default: false
    },
    deletedAt: Date,
    reactions: [{
      userId: {
        type: String,
        ref: 'User'
      },
      emoji: String,
      createdAt: {
        type: Date,
        default: Date.now
      }
    }],
    mentions: [{
      userId: {
        type: String,
        ref: 'User'
      },
      username: String,
      position: {
        start: Number,
        end: Number
      }
    }],
    replyTo: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Message'
    }
  },
  readBy: [{
    userId: {
      type: String,
      ref: 'User'
    },
    readAt: {
      type: Date,
      default: Date.now
    }
  }],
  timestamp: {
    type: Date,
    default: Date.now,
    index: true
  }
}, {
  timestamps: true
});

// Compound indexes for better query performance
messageSchema.index({ roomId: 1, timestamp: -1 });
messageSchema.index({ sender: 1, timestamp: -1 });
messageSchema.index({ recipient: 1, timestamp: -1 });
messageSchema.index({ type: 1, timestamp: -1 });

// Index for private messages
messageSchema.index({ 
  sender: 1, 
  recipient: 1, 
  timestamp: -1 
}, {
  partialFilterExpression: { type: 'private' }
});

// Static method to get recent messages for a room
messageSchema.statics.getRecentMessages = function(roomId, limit = 50) {
  return this.find({ 
    roomId, 
    'metadata.deleted': { $ne: true } 
  })
  .populate('sender', 'username avatar')
  .sort({ timestamp: -1 })
  .limit(limit)
  .lean();
};

// Static method to get private messages between two users
messageSchema.statics.getPrivateMessages = function(userId1, userId2, limit = 50) {
  return this.find({
    $or: [
      { sender: userId1, recipient: userId2 },
      { sender: userId2, recipient: userId1 }
    ],
    type: 'private',
    'metadata.deleted': { $ne: true }
  })
  .populate('sender', 'username avatar')
  .sort({ timestamp: -1 })
  .limit(limit)
  .lean();
};

// Static method to search messages
messageSchema.statics.searchMessages = function(query, roomId, limit = 20) {
  const searchCriteria = {
    content: { $regex: query, $options: 'i' },
    'metadata.deleted': { $ne: true }
  };
  
  if (roomId) {
    searchCriteria.roomId = roomId;
  }
  
  return this.find(searchCriteria)
    .populate('sender', 'username avatar')
    .sort({ timestamp: -1 })
    .limit(limit)
    .lean();
};

// Instance method to mark message as read
messageSchema.methods.markAsRead = function(userId) {
  const existingRead = this.readBy.find(read => read.userId === userId);
  
  if (!existingRead) {
    this.readBy.push({ userId, readAt: new Date() });
    return this.save();
  }
  
  return Promise.resolve(this);
};

// Instance method to add reaction
messageSchema.methods.addReaction = function(userId, emoji) {
  const existingReaction = this.metadata.reactions.find(
    reaction => reaction.userId === userId && reaction.emoji === emoji
  );
  
  if (!existingReaction) {
    this.metadata.reactions.push({ userId, emoji });
    return this.save();
  }
  
  return Promise.resolve(this);
};

// Instance method to remove reaction
messageSchema.methods.removeReaction = function(userId, emoji) {
  this.metadata.reactions = this.metadata.reactions.filter(
    reaction => !(reaction.userId === userId && reaction.emoji === emoji)
  );
  
  return this.save();
};

// Instance method to edit message
messageSchema.methods.editContent = function(newContent) {
  this.content = newContent;
  this.metadata.edited = true;
  this.metadata.editedAt = new Date();
  
  return this.save();
};

// Instance method to soft delete message
messageSchema.methods.softDelete = function() {
  this.metadata.deleted = true;
  this.metadata.deletedAt = new Date();
  
  return this.save();
};

// Virtual for reaction counts
messageSchema.virtual('reactionCounts').get(function() {
  const counts = {};
  
  this.metadata.reactions.forEach(reaction => {
    counts[reaction.emoji] = (counts[reaction.emoji] || 0) + 1;
  });
  
  return counts;
});

// Virtual for read count
messageSchema.virtual('readCount').get(function() {
  return this.readBy.length;
});

// Pre-save middleware to validate message content
messageSchema.pre('save', function(next) {
  // Validate content based on type
  if (this.type === 'text' && (!this.content || this.content.trim().length === 0)) {
    return next(new Error('Text messages must have content'));
  }
  
  // Ensure private messages have recipient
  if (this.type === 'private' && !this.recipient) {
    return next(new Error('Private messages must have a recipient'));
  }
  
  // Ensure room messages have roomId
  if (this.type !== 'private' && !this.roomId) {
    return next(new Error('Room messages must have a roomId'));
  }
  
  next();
});

// Pre-find middleware to exclude deleted messages by default
messageSchema.pre(/^find/, function() {
  if (!this.getQuery()['metadata.deleted']) {
    this.where({ 'metadata.deleted': { $ne: true } });
  }
});

// Ensure virtual fields are serialized
messageSchema.set('toJSON', {
  virtuals: true,
  transform: function(doc, ret) {
    delete ret._id;
    delete ret.__v;
    return ret;
  }
});

module.exports = mongoose.model('Message', messageSchema);