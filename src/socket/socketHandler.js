const jwt = require('jsonwebtoken');
const JWT_SECRET = process.env.JWT_SECRET || 'super_secret_messenger_key';

// Map to store connected users: userId -> Set of socket.id
const onlineUsers = new Map();

function initSocket(io, messageService) {
  // Authentication Middleware for Socket.IO
  io.use((socket, next) => {
    const token = socket.handshake.auth.token || socket.handshake.query.token;

    if (!token) {
      return next(new Error('Authentication error: Token is required'));
    }

    const cleanToken = token.startsWith('Bearer ') ? token.slice(7) : token;

    try {
      const decoded = jwt.verify(cleanToken, JWT_SECRET);
      socket.user = decoded;
      next();
    } catch (err) {
      next(new Error('Authentication error: Invalid or expired token'));
    }
  });

  io.on('connection', (socket) => {
    const userId = socket.user.id;
    console.log(`[Socket.IO] User ${socket.user.username} (ID: ${userId}) connected. Socket ID: ${socket.id}`);

    // Track online user
    if (!onlineUsers.has(userId)) {
      onlineUsers.set(userId, new Set());
    }
    onlineUsers.get(userId).add(socket.id);

    // Broadcast user online status
    io.emit('user_status', {
      userId,
      username: socket.user.username,
      status: 'online',
    });

    // Join room for specific chat box
    socket.on('join_chat', ({ chatBoxId }) => {
      const roomName = `chat_${chatBoxId}`;
      socket.join(roomName);
      console.log(`[Socket.IO] User ${userId} joined room ${roomName}`);
    });

    // Leave room
    socket.on('leave_chat', ({ chatBoxId }) => {
      const roomName = `chat_${chatBoxId}`;
      socket.leave(roomName);
      console.log(`[Socket.IO] User ${userId} left room ${roomName}`);
    });

    // Handle typing event
    socket.on('typing', ({ chatBoxId }) => {
      socket.to(`chat_${chatBoxId}`).emit('typing', {
        chatBoxId,
        userId: socket.user.id,
        username: socket.user.username,
      });
    });

    // Handle stop_typing event
    socket.on('stop_typing', ({ chatBoxId }) => {
      socket.to(`chat_${chatBoxId}`).emit('stop_typing', {
        chatBoxId,
        userId: socket.user.id,
      });
    });

    // Real-time message sending via Socket.IO
    socket.on('send_message', async (data, callback) => {
      try {
        const { chatBoxId, targetUserId, content } = data;
        const result = await messageService.sendMessage({
          chatBoxId,
          targetUserId,
          senderId: socket.user.id,
          content,
        });

        const roomName = `chat_${result.chatBoxId}`;

        // Broadcast to everyone in the room (including recipient)
        io.to(roomName).emit('receive_message', result);

        // Also check if recipient is online but hasn't joined room yet, notify them
        if (onlineUsers.has(result.recipientId)) {
          onlineUsers.get(result.recipientId).forEach((recipientSocketId) => {
            io.to(recipientSocketId).emit('conversation_updated', result);
          });
        }

        if (typeof callback === 'function') {
          callback({ success: true, data: result });
        }
      } catch (err) {
        console.error('[Socket.IO] Error sending message:', err.message);
        if (typeof callback === 'function') {
          callback({ success: false, message: err.message });
        }
      }
    });

    // Disconnect event
    socket.on('disconnect', () => {
      console.log(`[Socket.IO] User ${socket.user.username} disconnected.`);

      const userSockets = onlineUsers.get(userId);
      if (userSockets) {
        userSockets.delete(socket.id);
        if (userSockets.size === 0) {
          onlineUsers.delete(userId);
          // Broadcast user offline status
          io.emit('user_status', {
            userId,
            username: socket.user.username,
            status: 'offline',
          });
        }
      }
    });
  });
}

function getOnlineUsers() {
  return Array.from(onlineUsers.keys());
}

module.exports = {
  initSocket,
  getOnlineUsers,
};
