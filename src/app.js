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

// Services
const AuthService = require('./core/services/AuthService');
const UserService = require('./core/services/UserService');
const MessageService = require('./core/services/MessageService');

// Controllers
const AuthController = require('./api/controllers/AuthController');
const UserController = require('./api/controllers/UserController');
const MessageController = require('./api/controllers/MessageController');

// Routers
const createAuthRouter = require('./api/routes/authRoutes');
const createUserRouter = require('./api/routes/userRoutes');
const createMessageRouter = require('./api/routes/messageRoutes');

// Middlewares
const errorMiddleware = require('./api/middlewares/errorMiddleware');

function createApp() {
  const app = express();

  // Core Middlewares
  app.use(cors());
  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));

  // Dependency Injection Setup
  const userRepo = new UserRepository(prisma);
  const chatBoxRepo = new ChatBoxRepository(prisma);
  const messageRepo = new MessageRepository(prisma);

  const authService = new AuthService(userRepo);
  const userService = new UserService(userRepo);
  const messageService = new MessageService(chatBoxRepo, messageRepo, userRepo);

  const authController = new AuthController(authService);
  const userController = new UserController(userService);
  const messageController = new MessageController(messageService);

  // Serve Swagger OpenAPI UI
  app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec, {
    customCss: '.swagger-ui .topbar { display: none }',
    customSiteTitle: 'Messenger API Documentation',
  }));

  // API Routes
  app.use('/api/auth', createAuthRouter(authController));
  app.use('/api/users', createUserRouter(userController));
  app.use('/api/messages', createMessageRouter(messageController));

  // Serve Web Client (Static Assets)
  const publicPath = path.join(__dirname, '../public');
  app.use(express.static(publicPath));

  app.get('/', (req, res) => {
    res.sendFile(path.join(publicPath, 'index.html'));
  });

  // Global Error Handler
  app.use(errorMiddleware);

  return { app, messageService };
}

module.exports = createApp;
