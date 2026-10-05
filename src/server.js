require('dotenv').config();
const http = require('http');
const { Server } = require('socket.io');
const createApp = require('./app');
const { initSocket } = require('./socket/socketHandler');
const prisma = require('./config/prisma');

const PORT = process.env.PORT || 3000;

async function startServer() {
  try {
    // Verify Database Connection
    await prisma.$connect();
    console.log('[Database] Connect MySQL Messenger DB successfully!');

    const { app, messageService } = createApp();
    const server = http.createServer(app);

    // Initialize Socket.IO with CORS
    const io = new Server(server, {
      cors: {
        origin: '*',
        methods: ['GET', 'POST'],
      },
    });

    initSocket(io, messageService);

    server.listen(PORT, () => {
      console.log(`====================================================`);
      console.log(`🚀 Messenger Server is running on port: ${PORT}`);
      console.log(`🌐 Web Client: http://localhost:${PORT}`);
      console.log(`📚 Swagger OpenAPI Docs: http://localhost:${PORT}/api-docs`);
      console.log(`====================================================`);
    });
  } catch (error) {
    console.error('[Server Error] Failed to start server:', error);
    process.exit(1);
  }
}

startServer();
