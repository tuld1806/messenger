/**
 * Message Repository Implementation for Data Access
 */
class MessageRepository {
  constructor(prismaClient) {
    this.prisma = prismaClient;
  }

  async create({ chatBoxId, senderId, content }) {
    const message = await this.prisma.message.create({
      data: {
        chatBoxId: parseInt(chatBoxId, 10),
        senderId: parseInt(senderId, 10),
        content,
      },
      include: {
        sender: {
          select: { id: true, username: true, name: true, avatar: true },
        },
      },
    });

    // Update parent chat box timestamp
    await this.prisma.chatBox.update({
      where: { id: parseInt(chatBoxId, 10) },
      data: { updatedAt: new Date() },
    });

    return message;
  }

  async findByChatBoxId(chatBoxId, limit = 50, skip = 0) {
    return await this.prisma.message.findMany({
      where: { chatBoxId: parseInt(chatBoxId, 10) },
      include: {
        sender: {
          select: { id: true, username: true, name: true, avatar: true },
        },
      },
      orderBy: { createdAt: 'asc' },
      take: limit,
      skip: skip,
    });
  }

  async markAsRead(chatBoxId, currentUserId) {
    return await this.prisma.message.updateMany({
      where: {
        chatBoxId: parseInt(chatBoxId, 10),
        NOT: { senderId: parseInt(currentUserId, 10) },
        isRead: false,
      },
      data: { isRead: true },
    });
  }
}

module.exports = MessageRepository;
