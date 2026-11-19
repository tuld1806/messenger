const express = require('express');
const cors = require('cors');
const path = require('path');
const swaggerUi = require('swagger-ui-express');
const swaggerSpec = require('./config/swagger');

// Database Client
const prisma = require('./config/prisma');

// Repositories
const UserRepository = require('./core/repositories/UserRepository');
const ChatBoxRepository = require('./core/repositories/ChatBoxRepository');
const MessageRepository = require('./core/repositories/MessageRepository');

// Services & Queues
const AuthService = require('./core/services/AuthService');
const UserService = require('./core/services/UserService');
const MessageService = require('./core/services/MessageService');
const StorageService = require('./core/services/StorageService');
const MessageQueue = require('./core/queues/messageQueue');

// Controllers
const AuthController = require('./api/controllers/AuthController');
const UserController = require('./api/controllers/UserController');
const MessageController = require('./api/controllers/MessageController');
const MediaController = require('./api/controllers/MediaController');

// Routers
const createAuthRouter = require('./api/routes/authRoutes');
const createUserRouter = require('./api/routes/userRoutes');
const createMessageRouter = require('./api/routes/messageRoutes');
const createMediaRouter = require('./api/routes/mediaRoutes');

// Middlewares
const errorMiddleware = require('./api/middlewares/errorMiddleware');

function createApp(options = {}) {
  const app = express();

  // Core Middlewares
  app.use(cors());
  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));

  // Dependency Injection Setup
  const dbClient = options.prisma || prisma;
  const userRepo = new UserRepository(dbClient);
  const chatBoxRepo = new ChatBoxRepository(dbClient);
  const messageRepo = new MessageRepository(dbClient);

  const storageService = options.storageService || new StorageService();

  const enableQueue =
    options.enableQueue !== undefined
      ? Boolean(options.enableQueue)
      : process.env.ENABLE_MESSAGE_QUEUE === 'true';

  const messageQueue =
    options.messageQueue !== undefined
      ? options.messageQueue
      : enableQueue
        ? new MessageQueue(options.queueOptions || {})
        : null;

  const authService = new AuthService(userRepo);
  const userService = new UserService(userRepo);
  const messageService = new MessageService(
    chatBoxRepo,
    messageRepo,
    userRepo,
    storageService,
    messageQueue
  );

  const authController = new AuthController(authService);
  const userController = new UserController(userService);
  const messageController = new MessageController(messageService);
  const mediaController = new MediaController(messageService);

  // Serve Swagger OpenAPI UI
  app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec, {
    customCss: '.swagger-ui .topbar { display: none }',
    customSiteTitle: 'Messenger API Documentation',
  }));

  // API Routes
  app.use('/api/auth', createAuthRouter(authController));
  app.use('/api/users', createUserRouter(userController));
  app.use('/api/messages', createMessageRouter(messageController));
  app.use('/api/media', createMediaRouter(mediaController));

  // Serve Web Client (Static Assets)
  const publicPath = path.join(__dirname, '../public');
  app.use(express.static(publicPath));

  app.get('/', (req, res) => {
    res.sendFile(path.join(publicPath, 'index.html'));
  });

  // Global Error Handler
  app.use(errorMiddleware);

  return { app, messageService, storageService, messageQueue };
}

module.exports = createApp;
