const app = require('./app');
const prisma = require('./config/prisma');

const PORT = process.env.PORT || 5000;

const server = app.listen(PORT);
console.log(`Server đang chạy tại http://localhost:${PORT}`);
console.log(`Swagger API Docs: http://localhost:${PORT}/api-docs`);

// Xử lý tắt server an toàn (Graceful shutdown)
const gracefulShutdown = async (signal) => {
  console.log(`\nNhận tín hiệu ${signal}. Đang đóng server...`);
  server.close(async () => {
    console.log('HTTP Server đã đóng.');
    await prisma.$disconnect();
    console.log('Prisma Database connection đã ngắt.');
    process.exit(0);
  });
};

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));
