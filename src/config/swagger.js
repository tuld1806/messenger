const swaggerJSDoc = require('swagger-jsdoc');

const options = {
  definition: {
    openapi: '3.0.0',
    info: {
      title: 'Messenger API Documentation',
      version: '1.0.0',
      description: 'Hệ thống API RESTful & WebSocket Realtime cho ứng dụng nhắn tin Messenger với Node.js, Express, Prisma ORM, Socket.IO và JWT Middleware.',
      contact: {
        name: 'Messenger Support',
      },
    },
    servers: [
      {
        url: 'http://localhost:3000',
        description: 'Local Development Server',
      },
    ],
    components: {
      securitySchemes: {
        bearerAuth: {
          type: 'http',
          scheme: 'bearer',
          bearerFormat: 'JWT',
          description: 'Nhập JWT Token theo định dạng: Bearer <token>',
        },
      },
      schemas: {
        User: {
          type: 'object',
          properties: {
            id: { type: 'integer', example: 1 },
            username: { type: 'string', example: 'tuandl' },
            name: { type: 'string', example: 'Đỗ Tấn Tuấn' },
            avatar: { type: 'string', example: 'https://api.dicebear.com/7.x/bottts/svg?seed=tuandl' },
            createdAt: { type: 'string', format: 'date-time' },
          },
        },
        ChatBox: {
          type: 'object',
          properties: {
            id: { type: 'integer', example: 5 },
            user1Id: { type: 'integer', example: 1 },
            user2Id: { type: 'integer', example: 2 },
            createdAt: { type: 'string', format: 'date-time' },
            updatedAt: { type: 'string', format: 'date-time' },
          },
        },
        Message: {
          type: 'object',
          properties: {
            id: { type: 'integer', example: 101 },
            chatBoxId: { type: 'integer', example: 5 },
            senderId: { type: 'integer', example: 1 },
            content: { type: 'string', example: 'Chào bạn, làm quen nhé!' },
            isRead: { type: 'boolean', example: false },
            createdAt: { type: 'string', format: 'date-time' },
          },
        },
        ErrorResponse: {
          type: 'object',
          properties: {
            success: { type: 'boolean', example: false },
            message: { type: 'string', example: 'Mô tả lỗi xảy ra' },
          },
        },
      },
    },
  },
  apis: ['./src/api/routes/*.js'],
};

const swaggerSpec = swaggerJSDoc(options);

module.exports = swaggerSpec;
