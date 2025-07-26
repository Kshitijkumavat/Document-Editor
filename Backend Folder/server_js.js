// server.js - Main Express Server with Socket.IO
const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const mongoose = require('mongoose');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const path = require('path');
require('dotenv').config();

// Import models and routes
const User = require('./models/User');
const Message = require('./models/Message');
const Room = require('./models/Room');
const chatRoutes = require('./routes/chatRoutes');
const authRoutes = require('./routes/authRoutes');

// Initialize Express app
const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
  cors: {
    origin: process.env.CLIENT_URL || "http://localhost:3000",
    methods: ["GET", "POST"],
    credentials: true
  }
});

// Middleware Configuration
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'", "https://cdnjs.cloudflare.com"],
      styleSrc: ["'self'", "'unsafe-inline'", "https://cdnjs.cloudflare.com"],
      imgSrc: ["'self'", "data:", "https:"],
      connectSrc: ["'self'", "ws:", "wss:"]
    },
  },
}));

app.use(cors({
  origin: process.env.CLIENT_URL || "http://localhost:3000",
  credentials: true
}));

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// Serve static files from frontend directory
app.use(express.static(path.join(__dirname, '../frontend')));

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // limit each IP to 100 requests per windowMs
  message: 'Too many requests from this IP, please try again later.'
});
app.use('/api/', limiter);

// Database Connection
const connectDB = async () => {
  try {
    const conn = await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/chatflow', {
      useNewUrlParser: true,
      useUnifiedTopology: true,
    });
    console.log(`MongoDB Connected: ${conn.connection.host}`);
  } catch (error) {
    console.error('Database connection error:', error.message);
    process.exit(1);
  }
};

// Connect to database
connectDB();

// In-memory storage for active connections
const activeUsers = new Map();
const activeRooms = new Map();

// Socket.IO Connection Handling
io.on('connection', (socket) => {
  console.log(`User connected: ${socket.id}`);

  // Handle user joining a room
  socket.on('join-room', async (userData) => {
    try {
      const { userId, username, roomId = 'general' } = userData;
      
      // Validate user data
      if (!userId || !username) {
        socket.emit('error', { message: 'Invalid user data' });
        return;
      }

      // Store user info
      activeUsers.set(socket.id, {
        userId,
        username,
        roomId,
        joinedAt: new Date()
      });

      // Join the room
      socket.join(roomId);

      // Save or update user in database
      await User.findOneAndUpdate(
        { userId },
        { 
          username, 
          isOnline: true, 
          lastSeen: new Date(),
          socketId: socket.id 
        },
        { upsert: true, new: true }
      );

      // Get room info and create if doesn't exist
      let room = await Room.findOne({ roomId });
      if (!room) {
        room = new Room({
          roomId,
          name: roomId === 'general' ? 'General Chat' : roomId,
          description: 'Real-time chat room',
          createdBy: userId
        });
        await room.save();
      }

      // Add user to room participants
      if (!room.participants.includes(userId)) {
        room.participants.push(userId);
        await room.save();
      }

      // Get recent messages for the room
      const recentMessages = await Message.find({ roomId })
        .populate('sender', 'username userId')
        .sort({ timestamp: -1 })
        .limit(50)
        .lean();

      // Send recent messages to the user
      if (recentMessages.length > 0) {
        socket.emit('recent-messages', recentMessages.reverse());
      }

      // Get online users in the room
      const onlineUsers = Array.from(activeUsers.values())
        .filter(user => user.roomId === roomId)
        .map(user => ({
          userId: user.userId,
          username: user.username,
          joinedAt: user.joinedAt,
          avatar: '👤'
        }));

      // Notify room about new user
      socket.to(roomId).emit('user-joined', {
        userId,
        username,
        message: `${username} joined the chat`
      });

      // Send updated user list to all users in room
      io.to(roomId).emit('users-update', onlineUsers);

      // Send success response to user
      socket.emit('join-success', {
        roomId,
        roomName: room.name,
        onlineUsers
      });

    } catch (error) {
      console.error('Error joining room:', error);
      socket.emit('error', { message: 'Failed to join room' });
    }
  });

  // Handle sending messages
  socket.on('send-message', async (messageData) => {
    try {
      const userInfo = activeUsers.get(socket.id);
      if (!userInfo) {
        socket.emit('error', { message: 'User not authenticated' });
        return;
      }

      const { content, type = 'text' } = messageData;
      const { userId, username, roomId } = userInfo;

      // Validate message content
      if (!content || content.trim().length === 0) {
        socket.emit('error', { message: 'Message content cannot be empty' });
        return;
      }

      if (content.length > 1000) {
        socket.emit('error', { message: 'Message too long' });
        return;
      }

      // Create message in database
      const newMessage = new Message({
        content: content.trim(),
        sender: userId,
        roomId,
        type,
        timestamp: new Date()
      });

      const savedMessage = await newMessage.save();
      
      // Populate sender info
      await savedMessage.populate('sender', 'username userId');

      // Broadcast message to all users in the room
      io.to(roomId).emit('receive-message', {
        messageId: savedMessage._id,
        content: savedMessage.content,
        username: savedMessage.sender.username,
        userId: savedMessage.sender.userId,
        timestamp: savedMessage.timestamp,
        type: savedMessage.type,
        avatar: '👤'
      });

    } catch (error) {
      console.error('Error sending message:', error);
      socket.emit('error', { message: 'Failed to send message' });
    }
  });

  // Handle typing indicators
  socket.on('typing-start', (data) => {
    const userInfo = activeUsers.get(socket.id);
    if (userInfo) {
      socket.to(userInfo.roomId).emit('user-typing', {
        userId: userInfo.userId,
        username: userInfo.username,
        typing: true
      });
    }
  });

  socket.on('typing-stop', (data) => {
    const userInfo = activeUsers.get(socket.id);
    if (userInfo) {
      socket.to(userInfo.roomId).emit('user-typing', {
        userId: userInfo.userId,
        username: userInfo.username,
        typing: false
      });
    }
  });

  // Handle private messages
  socket.on('private-message', async (data) => {
    try {
      const { recipientUserId, content } = data;
      const senderInfo = activeUsers.get(socket.id);
      
      if (!senderInfo) return;

      // Find recipient's socket
      const recipientSocket = Array.from(activeUsers.entries())
        .find(([socketId, user]) => user.userId === recipientUserId);

      if (recipientSocket) {
        const [recipientSocketId] = recipientSocket;
        
        // Save private message to database
        const privateMessage = new Message({
          content,
          sender: senderInfo.userId,
          recipient: recipientUserId,
          type: 'private',
          timestamp: new Date()
        });

        await privateMessage.save();
        await privateMessage.populate('sender', 'username userId');

        // Send to recipient
        io.to(recipientSocketId).emit('private-message', {
          messageId: privateMessage._id,
          content: privateMessage.content,
          username: privateMessage.sender.username,
          userId: privateMessage.sender.userId,
          timestamp: privateMessage.timestamp,
          type: 'private'
        });

        // Confirm to sender
        socket.emit('message-sent', { messageId: privateMessage._id });
      } else {
        socket.emit('error', { message: 'User is offline' });
      }

    } catch (error) {
      console.error('Error sending private message:', error);
      socket.emit('error', { message: 'Failed to send private message' });
    }
  });

  // Handle disconnect
  socket.on('disconnect', async () => {
    try {
      const userInfo = activeUsers.get(socket.id);
      
      if (userInfo) {
        const { userId, username, roomId } = userInfo;

        // Update user status in database
        await User.findOneAndUpdate(
          { userId },
          { 
            isOnline: false, 
            lastSeen: new Date(),
            socketId: null 
          }
        );

        // Remove from active users
        activeUsers.delete(socket.id);

        // Get updated online users list
        const onlineUsers = Array.from(activeUsers.values())
          .filter(user => user.roomId === roomId)
          .map(user => ({
            userId: user.userId,
            username: user.username,
            joinedAt: user.joinedAt,
            avatar: '👤'
          }));

        // Notify room about user leaving
        socket.to(roomId).emit('user-left', {
          userId,
          username,
          message: `${username} left the chat`
        });

        // Send updated user list
        socket.to(roomId).emit('users-update', onlineUsers);
      }

      console.log(`User disconnected: ${socket.id}`);
    } catch (error) {
      console.error('Error handling disconnect:', error);
    }
  });
});

// API Routes
app.use('/api/auth', authRoutes);
app.use('/api/chat', chatRoutes);

// Serve frontend for all other routes
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '../frontend/index.html'));
});

// Health check endpoint
app.get('/api/health', (req, res) => {
  res.json({ 
    status: 'OK', 
    timestamp: new Date(),
    activeConnections: activeUsers.size 
  });
});

// Error handling middleware
app.use((error, req, res, next) => {
  console.error('Server Error:', error);
  res.status(500).json({
    success: false,
    message: 'Internal server error',
    ...(process.env.NODE_ENV === 'development' && { error: error.message })
  });
});

// Handle 404
app.use('/api/*', (req, res) => {
  res.status(404).json({
    success: false,
    message: 'API route not found'
  });
});

// Start server
const PORT = process.env.PORT || 5000;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  console.log(`Environment: ${process.env.NODE_ENV || 'development'}`);
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('SIGTERM received, shutting down gracefully');
  server.close(() => {
    console.log('Process terminated');
    process.exit(0);
  });
});

module.exports = { app, server, io };