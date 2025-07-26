// routes/chatRoutes.js - Chat API Routes
const express = require('express');
const { body, query, validationResult } = require('express-validator');
const { authenticateToken } = require('./authRoutes');
const User = require('../models/User');
const Message = require('../models/Message');
const Room = require('../models/Room');

const router = express.Router();

// @route   GET /api/chat/rooms
// @desc    Get all public rooms or user's rooms
// @access  Public for public rooms, Private for user rooms
router.get('/rooms', [
  query('type')
    .optional()
    .isIn(['public', 'user'])
    .withMessage('Type must be either public or user'),
  query('limit')
    .optional()
    .isInt({ min: 1, max: 50 })
    .withMessage('Limit must be between 1 and 50')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        message: 'Validation failed',
        errors: errors.array()
      });
    }

    const { type = 'public', limit = 20 } = req.query;
    let rooms;

    if (type === 'public') {
      rooms = await Room.findPublicRooms(parseInt(limit));
    } else {
      // For user rooms, authentication is required
      const authHeader = req.headers['authorization'];
      if (!authHeader) {
        return res.status(401).json({
          success: false,
          message: 'Authentication required'
        });
      }

      // Simple token verification for this route
      try {
        const token = authHeader.split(' ')[1];
        const jwt = require('jsonwebtoken');
        const decoded = jwt.verify(token, process.env.JWT_SECRET || 'your-secret-key');
        const user = await User.findOne({ userId: decoded.userId });
        
        if (!user) {
          return res.status(401).json({
            success: false,
            message: 'Invalid token'
          });
        }

        rooms = await Room.findUserRooms(user.userId);
      } catch (error) {
        return res.status(401).json({
          success: false,
          message: 'Invalid token'
        });
      }
    }

    res.json({
      success: true,
      data: { rooms }
    });

  } catch (error) {
    console.error('Get rooms error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error fetching rooms'
    });
  }
});

// @route   POST /api/chat/rooms
// @desc    Create a new room
// @access  Private
router.post('/rooms', authenticateToken, [
  body('name')
    .trim()
    .isLength({ min: 1, max: 50 })
    .withMessage('Room name must be between 1 and 50 characters'),
  body('description')
    .optional()
    .isLength({ max: 200 })
    .withMessage('Description must be less than 200 characters'),
  body('type')
    .optional()
    .isIn(['public', 'private'])
    .withMessage('Type must be either public or private'),
  body('settings.maxParticipants')
    .optional()
    .isInt({ min: 2, max: 500 })
    .withMessage('Max participants must be between 2 and 500')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        message: 'Validation failed',
        errors: errors.array()
      });
    }

    const { name, description, type = 'public', settings, tags } = req.body;

    // Generate unique room ID
    const roomId = `room_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

    // Create new room
    const newRoom = new Room({
      roomId,
      name,
      description,
      type,
      createdBy: req.user.userId,
      settings: {
        ...settings,
        maxParticipants: settings?.maxParticipants || 100
      },
      tags: tags || []
    });

    await newRoom.save();

    res.status(201).json({
      success: true,
      message: 'Room created successfully',
      data: { room: newRoom }
    });

  } catch (error) {
    console.error('Create room error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error creating room'
    });
  }
});

// @route   GET /api/chat/rooms/:roomId
// @desc    Get room details
// @access  Public for public rooms, Private for private rooms
router.get('/rooms/:roomId', async (req, res) => {
  try {
    const { roomId } = req.params;

    const room = await Room.findOne({ roomId, isActive: true })
      .populate('createdBy', 'username avatar')
      .populate('participants', 'username avatar isOnline')
      .populate('admins', 'username avatar');

    if (!room) {
      return res.status(404).json({
        success: false,
        message: 'Room not found'
      });
    }

    // Check if room is private and user has access
    if (room.type === 'private') {
      const authHeader = req.headers['authorization'];
      if (!authHeader) {
        return res.status(401).json({
          success: false,
          message: 'Authentication required for private rooms'
        });
      }

      try {
        const token = authHeader.split(' ')[1];
        const jwt = require('jsonwebtoken');
        const decoded = jwt.verify(token, process.env.JWT_SECRET || 'your-secret-key');
        const user = await User.findOne({ userId: decoded.userId });

        if (!user || !room.isParticipant(user.userId)) {
          return res.status(403).json({
            success: false,
            message: 'Access denied'
          });
        }
      } catch (error) {
        return res.status(401).json({
          success: false,
          message: 'Invalid token'
        });
      }
    }

    res.json({
      success: true,
      data: { room }
    });

  } catch (error) {
    console.error('Get room details error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error fetching room details'
    });
  }
});

// @route   GET /api/chat/rooms/:roomId/messages
// @desc    Get messages for a room
// @access  Public for public rooms, Private for private rooms
router.get('/rooms/:roomId/messages', [
  query('limit')
    .optional()
    .isInt({ min: 1, max: 100 })
    .withMessage('Limit must be between 1 and 100'),
  query('before')
    .optional()
    .isISO8601()
    .withMessage('Before must be a valid date')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        message: 'Validation failed',
        errors: errors.array()
      });
    }

    const { roomId } = req.params;
    const { limit = 50, before } = req.query;

    // Check if room exists
    const room = await Room.findOne({ roomId, isActive: true });

    if (!room) {
      return res.status(404).json({
        success: false,
        message: 'Room not found'
      });
    }

    // Check access for private rooms
    if (room.type === 'private') {
      const authHeader = req.headers['authorization'];
      if (!authHeader) {
        return res.status(401).json({
          success: false,
          message: 'Authentication required for private rooms'
        });
      }

      try {
        const token = authHeader.split(' ')[1];
        const jwt = require('jsonwebtoken');
        const decoded = jwt.verify(token, process.env.JWT_SECRET || 'your-secret-key');
        const user = await User.findOne({ userId: decoded.userId });

        if (!user || !room.isParticipant(user.userId)) {
          return res.status(403).json({
            success: false,
            message: 'Access denied'
          });
        }
      } catch (error) {
        return res.status(401).json({
          success: false,
          message: 'Invalid token'
        });
      }
    }

    // Build query
    const query = { roomId };
    
    if (before) {
      query.timestamp = { $lt: new Date(before) };
    }

    // Get messages
    const messages = await Message.find(query)
      .populate('sender', 'username avatar')
      .sort({ timestamp: -1 })
      .limit(parseInt(limit))
      .lean();

    res.json({
      success: true,
      data: { messages: messages.reverse() }
    });

  } catch (error) {
    console.error('Get messages error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error fetching messages'
    });
  }
});

// @route   POST /api/chat/rooms/:roomId/join
// @desc    Join a room
// @access  Private
router.post('/rooms/:roomId/join', authenticateToken, async (req, res) => {
  try {
    const { roomId } = req.params;

    const room = await Room.findOne({ roomId, isActive: true });

    if (!room) {
      return res.status(404).json({
        success: false,
        message: 'Room not found'
      });
    }

    // Check if user is already a participant
    if (room.isParticipant(req.user.userId)) {
      return res.status(400).json({
        success: false,
        message: 'You are already a member of this room'
      });
    }

    // Add user to room
    await room.addParticipant(req.user.userId);
    
    // Add room to user's joined rooms
    await req.user.joinRoom(roomId);

    res.json({
      success: true,
      message: 'Successfully joined the room'
    });

  } catch (error) {
    console.error('Join room error:', error);
    
    if (error.message === 'Room has reached maximum participant limit') {
      return res.status(400).json({
        success: false,
        message: error.message
      });
    }

    res.status(500).json({
      success: false,
      message: 'Server error joining room'
    });
  }
});

// @route   POST /api/chat/rooms/:roomId/leave
// @desc    Leave a room
// @access  Private
router.post('/rooms/:roomId/leave', authenticateToken, async (req, res) => {
  try {
    const { roomId } = req.params;

    const room = await Room.findOne({ roomId, isActive: true });

    if (!room) {
      return res.status(404).json({
        success: false,
        message: 'Room not found'
      });
    }

    // Check if user is a participant
    if (!room.isParticipant(req.user.userId)) {
      return res.status(400).json({
        success: false,
        message: 'You are not a member of this room'
      });
    }

    // Cannot leave if user is the creator and there are other participants
    if (room.createdBy === req.user.userId && room.participants.length > 1) {
      return res.status(400).json({
        success: false,
        message: 'Room creator cannot leave while other participants are present'
      });
    }

    // Remove user from room
    await room.removeParticipant(req.user.userId);
    
    // Remove room from user's joined rooms
    await req.user.leaveRoom(roomId);

    res.json({
      success: true,
      message: 'Successfully left the room'
    });

  } catch (error) {
    console.error('Leave room error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error leaving room'
    });
  }
});

// @route   GET /api/chat/search/messages
// @desc    Search messages
// @access  Private
router.get('/search/messages', authenticateToken, [
  query('q')
    .notEmpty()
    .isLength({ min: 1, max: 100 })
    .withMessage('Query must be between 1 and 100 characters'),
  query('roomId')
    .optional()
    .notEmpty()
    .withMessage('Room ID cannot be empty'),
  query('limit')
    .optional()
    .isInt({ min: 1, max: 50 })
    .withMessage('Limit must be between 1 and 50')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        message: 'Validation failed',
        errors: errors.array()
      });
    }

    const { q: query, roomId, limit = 20 } = req.query;

    // If roomId is provided, check if user has access to the room
    if (roomId) {
      const room = await Room.findOne({ roomId, isActive: true });
      
      if (!room) {
        return res.status(404).json({
          success: false,
          message: 'Room not found'
        });
      }

      if (room.type === 'private' && !room.isParticipant(req.user.userId)) {
        return res.status(403).json({
          success: false,
          message: 'Access denied to this room'
        });
      }
    }

    // Search messages
    const messages = await Message.searchMessages(query, roomId, parseInt(limit));

    res.json({
      success: true,
      data: { messages }
    });

  } catch (error) {
    console.error('Search messages error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error searching messages'
    });
  }
});

// @route   GET /api/chat/search/rooms
// @desc    Search rooms
// @access  Public
router.get('/search/rooms', [
  query('q')
    .notEmpty()
    .isLength({ min: 1, max: 100 })
    .withMessage('Query must be between 1 and 100 characters'),
  query('limit')
    .optional()
    .isInt({ min: 1, max: 50 })
    .withMessage('Limit must be between 1 and 50')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        message: 'Validation failed',
        errors: errors.array()
      });
    }

    const { q: query, limit = 20 } = req.query;

    // Search rooms
    const rooms = await Room.searchRooms(query, parseInt(limit));

    res.json({
      success: true,
      data: { rooms }
    });

  } catch (error) {
    console.error('Search rooms error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error searching rooms'
    });
  }
});

// @route   GET /api/chat/users/online
// @desc    Get online users
// @access  Private
router.get('/users/online', authenticateToken, async (req, res) => {
  try {
    const onlineUsers = await User.findOnlineUsers();

    res.json({
      success: true,
      data: { users: onlineUsers }
    });

  } catch (error) {
    console.error('Get online users error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error fetching online users'
    });
  }
});

// @route   GET /api/chat/messages/private/:userId
// @desc    Get private messages with a user
// @access  Private
router.get('/messages/private/:userId', authenticateToken, [
  query('limit')
    .optional()
    .isInt({ min: 1, max: 100 })
    .withMessage('Limit must be between 1 and 100')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        message: 'Validation failed',
        errors: errors.array()
      });
    }

    const { userId } = req.params;
    const { limit = 50 } = req.query;

    // Check if the other user exists
    const otherUser = await User.findOne({ userId });
    if (!otherUser) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    // Get private messages
    const messages = await Message.getPrivateMessages(
      req.user.userId, 
      userId, 
      parseInt(limit)
    );

    res.json({
      success: true,
      data: { messages: messages.reverse() }
    });

  } catch (error) {
    console.error('Get private messages error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error fetching private messages'
    });
  }
});

// @route   PUT /api/chat/messages/:messageId/read
// @desc    Mark message as read
// @access  Private
router.put('/messages/:messageId/read', authenticateToken, async (req, res) => {
  try {
    const { messageId } = req.params;

    const message = await Message.findById(messageId);
    
    if (!message) {
      return res.status(404).json({
        success: false,
        message: 'Message not found'
      });
    }

    // Mark as read
    await message.markAsRead(req.user.userId);

    res.json({
      success: true,
      message: 'Message marked as read'
    });

  } catch (error) {
    console.error('Mark message as read error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error marking message as read'
    });
  }
});

// @route   POST /api/chat/messages/:messageId/react
// @desc    Add reaction to message
// @access  Private
router.post('/messages/:messageId/react', authenticateToken, [
  body('emoji')
    .notEmpty()
    .isLength({ min: 1, max: 10 })
    .withMessage('Emoji is required and must be valid')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        message: 'Validation failed',
        errors: errors.array()
      });
    }

    const { messageId } = req.params;
    const { emoji } = req.body;

    const message = await Message.findById(messageId);
    
    if (!message) {
      return res.status(404).json({
        success: false,
        message: 'Message not found'
      });
    }

    // Add reaction
    await message.addReaction(req.user.userId, emoji);

    res.json({
      success: true,
      message: 'Reaction added successfully'
    });

  } catch (error) {
    console.error('Add reaction error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error adding reaction'
    });
  }
});

// @route   DELETE /api/chat/messages/:messageId/react
// @desc    Remove reaction from message
// @access  Private
router.delete('/messages/:messageId/react', authenticateToken, [
  body('emoji')
    .notEmpty()
    .withMessage('Emoji is required')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        message: 'Validation failed',
        errors: errors.array()
      });
    }

    const { messageId } = req.params;
    const { emoji } = req.body;

    const message = await Message.findById(messageId);
    
    if (!message) {
      return res.status(404).json({
        success: false,
        message: 'Message not found'
      });
    }

    // Remove reaction
    await message.removeReaction(req.user.userId, emoji);

    res.json({
      success: true,
      message: 'Reaction removed successfully'
    });

  } catch (error) {
    console.error('Remove reaction error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error removing reaction'
    });
  }
});

module.exports = router;