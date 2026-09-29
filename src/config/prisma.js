const { PrismaClient } = require('@prisma/client');
const { PrismaMariaDb } = require('@prisma/adapter-mariadb');
const mariadb = require('mariadb');

const rawUrl = process.env.DATABASE_URL || 'mysql://root:@Ldtuan1806@localhost:3306/messenger_db';
const connectionString = rawUrl.startsWith('mysql:') ? rawUrl.replace(/^mysql:/, 'mariadb:') : rawUrl;

const pool = mariadb.createPool(connectionString);
const adapter = new PrismaMariaDb(pool);

const prisma = new PrismaClient({ adapter });

module.exports = prisma;
