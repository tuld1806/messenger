/**
 * ChatBox Repository Implementation for Data Access
 */
class ChatBoxRepository {
  constructor(prismaClient) {
    this.prisma = prismaClient;
  }

  async findBetweenUsers(userAId, userBId) {
    const id1 = Math.min(parseInt(userAId, 10), parseInt(userBId, 10));
    const id2 = Math.max(parseInt(userAId, 10), parseInt(userBId, 10));

    return await this.prisma.chatBox.findUnique({
      where: {
        user1Id_user2Id: {
          user1Id: id1,
          user2Id: id2,
        },
      },
      include: {
        user1: { select: { id: true, username: true, name: true, avatar: true } },
        user2: { select: { id: true, username: true, name: true, avatar: true } },
      },
    });
  }

  async create(userAId, userBId) {
    const id1 = Math.min(parseInt(userAId, 10), parseInt(userBId, 10));
    const id2 = Math.max(parseInt(userAId, 10), parseInt(userBId, 10));

    return await this.prisma.chatBox.create({
      data: {
        user1Id: id1,
        user2Id: id2,
      },
      include: {
        user1: { select: { id: true, username: true, name: true, avatar: true } },
        user2: { select: { id: true, username: true, name: true, avatar: true } },
      },
    });
  }

  async findById(id) {
    return await this.prisma.chatBox.findUnique({
      where: { id: parseInt(id, 10) },
      include: {
        user1: { select: { id: true, username: true, name: true, avatar: true } },
        user2: { select: { id: true, username: true, name: true, avatar: true } },
      },
    });
  }

  async getUserChatBoxes(userId) {
    const uid = parseInt(userId, 10);
    return await this.prisma.chatBox.findMany({
      where: {
        OR: [{ user1Id: uid }, { user2Id: uid }],
      },
      include: {
        user1: { select: { id: true, username: true, name: true, avatar: true } },
        user2: { select: { id: true, username: true, name: true, avatar: true } },
        messages: {
          orderBy: { createdAt: 'desc' },
          take: 1,
          include: {
            sender: { select: { id: true, username: true, name: true } },
          },
        },
      },
      orderBy: { updatedAt: 'desc' },
    });
  }
}

module.exports = ChatBoxRepository;
