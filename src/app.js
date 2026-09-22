require('dotenv').config();
const express = require('express');
const cors = require('cors');
const swaggerUi = require('swagger-ui-express');

const swaggerSpec = require('./docs/swagger');
const authRoutes = require('./routes/auth.routes');
const errorHandler = require('./middlewares/error.middleware');
const { NotFoundError } = require('./utils/errors');

const app = express();

// Middlewares cơ bản
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Swagger Documentation
app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec));

// Auth Routes
app.use('/api/auth', authRoutes);

// Bắt các route không tồn tại (404)
app.use((req, res, next) => {
  next(new NotFoundError(`Đường dẫn ${req.originalUrl} không tồn tại trên hệ thống`));
});

// Global Error Handler
app.use(errorHandler);

module.exports = app;
