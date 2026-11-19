const jwt = require('jsonwebtoken');
const JWT_SECRET = process.env.JWT_SECRET || 'super_secret_messenger_key';

// Map to store connected users: userId -> Set of socket.id
const onlineUsers = new Map();

// Phat su kien sau khi tin nhan da duoc luu thanh cong vao Database
function broadcastPersistedMessage(io, persistedResult) {
  if (!persistedResult || !persistedResult.chatBoxId) return;

  const roomName = `chat_${persistedResult.chatBoxId}`;

  // Phat su kien message_persisted toi tat ca thanh vien trong room
  io.to(roomName).emit('message_persisted', persistedResult);

  // Dam bao nguoi gui va nguoi nhan deu nhan duoc message_persisted ke ca khi chua join room
  const roomSockets = io.sockets?.adapter?.rooms?.get(roomName) || new Set();
  const targetUserIds = [persistedResult.senderId, persistedResult.recipientId].filter(Boolean);

  for (const uid of targetUserIds) {
    const numUid = parseInt(uid, 10);
    if (onlineUsers.has(numUid)) {
      onlineUsers.get(numUid).forEach((sockId) => {
        if (!roomSockets.has(sockId)) {
          io.to(sockId).emit('message_persisted', persistedResult);
        }
      });
    }
  }

  // Giu nguyen su kien receive_message va conversation_updated cho giao dien real-time hien tai
  io.to(roomName).emit('receive_message', persistedResult);

  const recipientUid = persistedResult.recipientId ? parseInt(persistedResult.recipientId, 10) : null;
  if (recipientUid && onlineUsers.has(recipientUid)) {
    onlineUsers.get(recipientUid).forEach((recipientSocketId) => {
      io.to(recipientSocketId).emit('conversation_updated', persistedResult);
    });
  }
}

function initSocket(io, messageService) {
  let queueEventsWrapper = null;

  // Neu messageService co gan MessageQueue, lang nghe su kien completed tu MessageWorker
  if (
    messageService &&
    messageService.messageQueue &&
    typeof messageService.messageQueue.createQueueEvents === 'function'
  ) {
    queueEventsWrapper = messageService.messageQueue.createQueueEvents();
    const { queueEvents } = queueEventsWrapper;

    queueEvents.on('completed', async ({ returnvalue }) => {
      try {
        const parsed =
          typeof returnvalue === 'string' ? JSON.parse(returnvalue) : returnvalue;

        if (!parsed || !parsed.message) return;

        const hydratedResult =
          typeof messageService.hydratePersistedResult === 'function'
            ? await messageService.hydratePersistedResult(parsed)
            : parsed;

        broadcastPersistedMessage(io, hydratedResult);
      } catch (err) {
        console.error('[Socket.IO] Loi xu ly su kien message_persisted tu Worker:', err.message);
      }
    });
  }

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
        const { chatBoxId, targetUserId, content, attachments, clientMessageId } = data || {};
        const result = await messageService.sendMessage({
          chatBoxId,
          targetUserId,
          senderId: socket.user.id,
          content,
          attachments,
          clientMessageId,
        });

        if (result.status === 'queued') {
          // Thong bao cho nguoi gui rang tin nhan da duoc dua vao Queue
          socket.emit('message_queued', result);

          if (typeof callback === 'function') {
            callback({ success: true, status: 'queued', data: result });
          }
        } else {
          // Truong hop khong dung Queue (luu truc tiep)
          broadcastPersistedMessage(io, result);

          if (typeof callback === 'function') {
            callback({ success: true, status: 'persisted', data: result });
          }
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

  return {
    closeQueueEvents: async () => {
      if (queueEventsWrapper) {
        await queueEventsWrapper.close();
      }
    },
  };
}

function getOnlineUsers() {
  return Array.from(onlineUsers.keys());
}

module.exports = {
  initSocket,
  getOnlineUsers,
  broadcastPersistedMessage,
};
