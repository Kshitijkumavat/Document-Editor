// models/Room.js - Room Schema
const mongoose = require('mongoose');

const roomSchema = new mongoose.Schema({
  roomId: {
    type: String,
    required: true,
    unique: true,
    trim: true,
    index: true
  },
  name: {
    type: String,
    required: true,
    trim: true,
    maxlength: 50
  },
  description: {
    type: String,
    maxlength: 200,
    default: ''
  },
  type: {
    type: String,
    enum: ['public', 'private', 'direct'],
    default: 'public'
  },
  avatar: {
    type: String,
    default: '💬'
  },
  createdBy: {
    type: String,
    required: true,
    ref: 'User'
  },
  participants: [{
    type: String,
    ref: 'User'
  }],
  admins: [{
    type: String,
    ref: 'User'
  }],
  settings: {
    maxParticipants: {
      type: Number,
      default: 100
    },
    allowFileSharing: {
      type: Boolean,
      default: true
    },
    allowInvites: {
      type: Boolean,
      default: true
    },
    messageRetention: {
      type: Number, // days
      default: 30
    },
    requireApproval: {
      type: Boolean,
      default: false
    }
  },
  lastActivity: {
    type: Date,
    default: Date.now
  },
  messageCount: {
    type: Number,
    default: 0
  },
  isActive: {
    type: Boolean,
    default: true
  },
  tags: [{
    type: String,
    trim: true,
    lowercase: true
  }],
  metadata: {
    pinnedMessages: [{
      messageId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Message'
      },
      pinnedBy: {
        type: String,
        ref: 'User'
      },
      pinnedAt: {
        type: Date,
        default: Date.now
      }
    }],
    welcomeMessage: {
      type: String,
      maxlength: 500,
      default: ''
    },
    rules: [{
      title: {
        type: String,
        maxlength: 100
      },
      description: {
        type: String,
        maxlength: 500
      }
    }]
  }
}, {
  timestamps: true
});

// Indexes for better performance
roomSchema.index({ type: 1, isActive: 1 });
roomSchema.index({ participants: 1 });
roomSchema.index({ createdBy: 1 });
roomSchema.index({ lastActivity: -1 });
roomSchema.index({ tags: 1 });

// Virtual for participant count
roomSchema.virtual('participantCount').get(function() {
  return this.participants.length;
});

// Virtual for admin count
roomSchema.virtual('adminCount').get(function() {
  return this.admins.length;
});

// Static method to find public rooms
roomSchema.statics.findPublicRooms = function(limit = 20) {
  return this.find({
    type: 'public',
    isActive: true
  })
  .select('roomId name description avatar participantCount lastActivity')
  .sort({ lastActivity: -1 })
  .limit(limit)
  .lean();
};

// Static method to find user's rooms
roomSchema.statics.findUserRooms = function(userId) {
  return this.find({
    participants: userId,
    isActive: true
  })
  .select('roomId name description avatar type participantCount lastActivity')
  .sort({ lastActivity: -1 })
  .lean();
};

// Static method to search rooms
roomSchema.statics.searchRooms = function(query, limit = 20) {
  return this.find({
    $or: [
      { name: { $regex: query, $options: 'i' } },
      { description: { $regex: query, $options: 'i' } },
      { tags: { $in: [new RegExp(query, 'i')] } }
    ],
    type: 'public',
    isActive: true
  })
  .select('roomId name description avatar participantCount lastActivity tags')
  .sort({ lastActivity: -1 })
  .limit(limit)
  .lean();
};

// Instance method to add participant
roomSchema.methods.addParticipant = function(userId) {
  if (!this.participants.includes(userId)) {
    // Check max participants limit
    if (this.participants.length >= this.settings.maxParticipants) {
      throw new Error('Room has reached maximum participant limit');
    }
    
    this.participants.push(userId);
    this.lastActivity = new Date();
    return this.save();
  }
  
  return Promise.resolve(this);
};

// Instance method to remove participant
roomSchema.methods.removeParticipant = function(userId) {
  this.participants = this.participants.filter(id => id !== userId);
  
  // Also remove from admins if they were admin
  this.admins = this.admins.filter(id => id !== userId);
  
  this.lastActivity = new Date();
  return this.save();
};

// Instance method to add admin
roomSchema.methods.addAdmin = function(userId) {
  // User must be a participant first
  if (!this.participants.includes(userId)) {
    throw new Error('User must be a participant before becoming admin');
  }
  
  if (!this.admins.includes(userId)) {
    this.admins.push(userId);
    return this.save();
  }
  
  return Promise.resolve(this);
};

// Instance method to remove admin
roomSchema.methods.removeAdmin = function(userId) {
  // Cannot remove the creator as admin
  if (userId === this.createdBy) {
    throw new Error('Cannot remove room creator as admin');
  }
  
  this.admins = this.admins.filter(id => id !== userId);
  return this.save();
};

// Instance method to check if user is admin
roomSchema.methods.isAdmin = function(userId) {
  return this.admins.includes(userId) || this.createdBy === userId;
};

// Instance method to check if user is participant
roomSchema.methods.isParticipant = function(userId) {
  return this.participants.includes(userId);
};

// Instance method to pin message
roomSchema.methods.pinMessage = function(messageId, pinnedBy) {
  // Check if message is already pinned
  const existingPin = this.metadata.pinnedMessages.find(
    pin => pin.messageId.toString() === messageId.toString()
  );
  
  if (!existingPin) {
    this.metadata.pinnedMessages.push({
      messageId,
      pinnedBy,
      pinnedAt: new Date()
    });
    
    return this.save();
  }
  
  return Promise.resolve(this);
};

// Instance method to unpin message
roomSchema.methods.unpinMessage = function(messageId) {
  this.metadata.pinnedMessages = this.metadata.pinnedMessages.filter(
    pin => pin.messageId.toString() !== messageId.toString()
  );
  
  return this.save();
};

// Instance method to update activity
roomSchema.methods.updateActivity = function() {
  this.lastActivity = new Date();
  this.messageCount += 1;
  return this.save();
};

// Pre-save middleware to ensure creator is admin and participant
roomSchema.pre('save', function(next) {
  // Ensure creator is in participants array
  if (!this.participants.includes(this.createdBy)) {
    this.participants.push(this.createdBy);
  }
  
  // Ensure creator is in admins array
  if (!this.admins.includes(this.createdBy)) {
    this.admins.push(this.createdBy);
  }
  
  next();
});

// Pre-remove middleware to cleanup related data
roomSchema.pre('remove', async function(next) {
  try {
    // Remove all messages in this room
    await mongoose.model('Message').deleteMany({ roomId: this.roomId });
    
    // Remove room from users' joinedRooms
    await mongoose.model('User').updateMany(
      { 'joinedRooms.roomId': this.roomId },
      { $pull: { joinedRooms: { roomId: this.roomId } } }
    );
    
    next();
  } catch (error) {
    next(error);
  }
});

// Ensure virtual fields are serialized
roomSchema.set('toJSON', {
  virtuals: true,
  transform: function(doc, ret) {
    delete ret._id;
    delete ret.__v;
    return ret;
  }
});

module.exports = mongoose.model('Room', roomSchema);