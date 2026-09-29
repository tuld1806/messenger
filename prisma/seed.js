const prisma = require('../src/config/prisma');
const bcrypt = require('bcryptjs');

async function main() {
  console.log('Seeding initial data...');

  const hashedPassword = await bcrypt.hash('123456', 10);

  const u1 = await prisma.user.upsert({
    where: { username: 'tuandl' },
    update: {},
    create: {
      username: 'tuandl',
      password: hashedPassword,
      name: 'Đỗ Tấn Tuấn',
      avatar: 'https://api.dicebear.com/7.x/avataaars/svg?seed=tuandl',
    },
  });

  const u2 = await prisma.user.upsert({
    where: { username: 'minhth' },
    update: {},
    create: {
      username: 'minhth',
      password: hashedPassword,
      name: 'Trần Hoàng Minh',
      avatar: 'https://api.dicebear.com/7.x/avataaars/svg?seed=minhth',
    },
  });

  const u3 = await prisma.user.upsert({
    where: { username: 'lanhuong' },
    update: {},
    create: {
      username: 'lanhuong',
      password: hashedPassword,
      name: 'Nguyễn Lan Hương',
      avatar: 'https://api.dicebear.com/7.x/avataaars/svg?seed=lanhuong',
    },
  });

  console.log('Created sample users:', { u1, u2, u3 });

  // Create initial chatbox between tuandl & minhth
  const id1 = Math.min(u1.id, u2.id);
  const id2 = Math.max(u1.id, u2.id);

  const chatBox = await prisma.chatBox.upsert({
    where: {
      user1Id_user2Id: {
        user1Id: id1,
        user2Id: id2,
      },
    },
    update: {},
    create: {
      user1Id: id1,
      user2Id: id2,
    },
  });

  // Seed sample messages
  await prisma.message.createMany({
    data: [
      {
        chatBoxId: chatBox.id,
        senderId: u1.id,
        content: 'Chào Minh! Hệ thống Messenger Nodejs Socket.io chạy mượt quá!',
      },
      {
        chatBoxId: chatBox.id,
        senderId: u2.id,
        content: 'Chào Tuấn! Đúng rồi, vừa có Swagger API vừa nhắn tin Realtime cực đã.',
      },
    ],
  });

  console.log('Seeding completed successfully!');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
