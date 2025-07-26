// models/User.js - User Schema
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const userSchema = new mongoose.Schema({
  userId: {
    type: String,
    required: true,
    unique: true,
    index: true
  },
  username: {
    type: String,
    required: true,
    trim: true,
    minlength: 2,
    maxlength: 25
  },
  email: {
    type: String,
    unique: true,
    sparse: true,
    lowercase: true,
    validate: {
      validator: function(email) {
        return /^\w+([.-]?\w+)*@\w+([.-]?\w+)*(\.\w{2,3})+$/.test(email);
      },
      message: 'Please enter a valid email'
    }
  },
  password: {
    type: String,
    minlength: 6,
    select: false // Don't include password in queries by default
  },
  avatar: {
    type: String,
    default: '👤'
  },
  isOnline: {
    type: Boolean,
    default: false
  },
  lastSeen: {
    type: Date,
    default: Date.now
  },
  socketId: {
    type: String,
    default: null
  },
  joinedRooms: [{
    roomId: {
      type: String,
      required: true
    },
    joinedAt: {
      type: Date,
      default: Date.now
    }
  }],
  profile: {
    bio: {
      type: String,
      maxlength: 200,
      default: ''
    },
    location: {
      type: String,
      maxlength: 100,
      default: ''
    },
    website: {
      type: String,
      maxlength: 200,
      default: ''
    }
  },
  preferences: {
    notifications: {
      type: Boolean,
      default: true
    },
    soundEnabled: {
      type: Boolean,
      default: true
    },
    theme: {
      type: String,
      enum: ['light', 'dark', 'auto'],
      default: 'light'
    }
  },
  createdAt: {
    type: Date,
    default: Date.now
  },
  updatedAt: {
    type: Date,
    default: Date.now
  }
}, {
  timestamps: true
});

// Indexes for better performance
userSchema.index({ username: 1 });
userSchema.index({ email: 1 });
userSchema.index({ isOnline: 1 });
userSchema.index({ lastSeen: -1 });

// Pre-save middleware to hash password
userSchema.pre('save', async function(next) {
  // Only hash the password if it has been modified (or is new)
  if (!this.isModified('password')) return next();
  
  try {
    // Hash password with cost of 12
    const hashedPassword = await bcrypt.hash(this.password, 12);
    this.password = hashedPassword;
    next();
  } catch (error) {
    next(error);
  }
});

// Instance method to check password
userSchema.methods.comparePassword = async function(candidatePassword) {
  return await bcrypt.compare(candidatePassword, this.password);
};

// Instance method to get public profile
userSchema.methods.getPublicProfile = function() {
  return {
    userId: this.userId,
    username: this.username,
    avatar: this.avatar,
    isOnline: this.isOnline,
    lastSeen: this.lastSeen,
    profile: this.profile,
    createdAt: this.createdAt
  };
};

// Static method to find online users
userSchema.statics.findOnlineUsers = function() {
  return this.find({ isOnline: true }).select('userId username avatar lastSeen');
};

// Static method to find users by room
userSchema.statics.findUsersByRoom = function(roomId) {
  return this.find({ 'joinedRooms.roomId': roomId })
    .select('userId username avatar isOnline lastSeen');
};

// Method to add user to room
userSchema.methods.joinRoom = function(roomId) {
  const existingRoom = this.joinedRooms.find(room => room.roomId === roomId);
  
  if (!existingRoom) {
    this.joinedRooms.push({ roomId, joinedAt: new Date() });
  }
  
  return this.save();
};

// Method to remove user from room
userSchema.methods.leaveRoom = function(roomId) {
  this.joinedRooms = this.joinedRooms.filter(room => room.roomId !== roomId);
  return this.save();
};

// Virtual for user's active status
userSchema.virtual('isActive').get(function() {
  // Consider user active if they were online in the last 5 minutes
  const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000);
  return this.isOnline || (this.lastSeen && this.lastSeen > fiveMinutesAgo);
});

// Ensure virtual fields are serialized
userSchema.set('toJSON', {
  virtuals: true,
  transform: function(doc, ret) {
    delete ret._id;
    delete ret.__v;
    delete ret.password;
    return ret;
  }
});

module.exports = mongoose.model('User', userSchema);