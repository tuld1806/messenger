require('dotenv').config();
const { PrismaClient } = require('@prisma/client');
const { PrismaMariaDb } = require('@prisma/adapter-mariadb');

const databaseUrl = process.env.DATABASE_URL || 'mysql://root:password@localhost:3306/messenger_db';

// Prisma 7 yêu cầu driver adapter cho kết nối MySQL / MariaDB
const adapter = new PrismaMariaDb({
  connectionString: databaseUrl,
});

const prisma = new PrismaClient({
  adapter,
  log: process.env.NODE_ENV === 'development' ? ['query', 'info', 'warn', 'error'] : ['error'],
});

module.exports = prisma;
