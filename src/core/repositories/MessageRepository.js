/**
 * Message Repository Implementation for Data Access
 */
class MessageRepository {
  constructor(prismaClient) {
    this.prisma = prismaClient;
  }

  // Tim tin nhan theo clientMessageId de chong luu trung khi retry Job
  async findByClientMessageId(clientMessageId) {
    if (!clientMessageId || typeof clientMessageId !== 'string' || clientMessageId.trim() === '') {
      return null;
    }

    return await this.prisma.message.findUnique({
      where: { clientMessageId: clientMessageId.trim() },
      include: {
        sender: {
          select: { id: true, username: true, name: true, avatar: true },
        },
        attachments: {
          orderBy: { sortOrder: 'asc' },
        },
      },
    });
  }

  // Luu tin nhan va danh sach tep dinh kem trong cung mot transaction (co chong trung clientMessageId)
  async create({
    chatBoxId,
    senderId,
    content = '',
    mediaUrl = null,
    attachments = [],
    clientMessageId = null,
  }) {
    const normalizedClientMsgId =
      clientMessageId && typeof clientMessageId === 'string' && clientMessageId.trim() !== ''
        ? clientMessageId.trim()
        : null;

    // Neu da ton tai tin nhan voi clientMessageId nay thi tra ve luon (Idempotency)
    if (normalizedClientMsgId) {
      const existingMessage = await this.findByClientMessageId(normalizedClientMsgId);
      if (existingMessage) {
        return existingMessage;
      }
    }

    const validAttachments = Array.isArray(attachments)
      ? attachments
          .map((att, idx) => ({
            objectKey: String(att.objectKey).trim(),
            fileName: String(att.fileName || 'file').trim(),
            mimeType: String(att.mimeType || 'application/octet-stream').trim(),
            fileSize: parseInt(att.fileSize, 10) || 0,
            sortOrder: att.sortOrder !== undefined ? parseInt(att.sortOrder, 10) : idx,
          }))
          .sort((a, b) => a.sortOrder - b.sortOrder)
      : [];

    // Giu tuong thich nguoc voi truong mediaUrl khi duoc truyen tuong minh
    const resolvedMediaUrl = mediaUrl || null;

    const executeCreate = async (client) => {
      if (normalizedClientMsgId && typeof client.message.findUnique === 'function') {
        const existingInTx = await client.message.findUnique({
          where: { clientMessageId: normalizedClientMsgId },
          include: {
            sender: {
              select: { id: true, username: true, name: true, avatar: true },
            },
            attachments: {
              orderBy: { sortOrder: 'asc' },
            },
          },
        });
        if (existingInTx) {
          return existingInTx;
        }
      }

      const messageData = {
        chatBoxId: parseInt(chatBoxId, 10),
        senderId: parseInt(senderId, 10),
        content: content !== undefined && content !== null ? String(content) : '',
        mediaUrl: resolvedMediaUrl,
      };

      if (normalizedClientMsgId) {
        messageData.clientMessageId = normalizedClientMsgId;
      }

      if (validAttachments.length > 0) {
        messageData.attachments = {
          create: validAttachments,
        };
      }

      const message = await client.message.create({
        data: messageData,
        include: {
          sender: {
            select: { id: true, username: true, name: true, avatar: true },
          },
          attachments: {
            orderBy: { sortOrder: 'asc' },
          },
        },
      });

      // Cap nhat thoi gian cua phong chat
      await client.chatBox.update({
        where: { id: parseInt(chatBoxId, 10) },
        data: { updatedAt: new Date() },
      });

      return message;
    };

    try {
      if (typeof this.prisma.$transaction === 'function') {
        return await this.prisma.$transaction(async (tx) => executeCreate(tx));
      }
      return await executeCreate(this.prisma);
    } catch (err) {
      // Neu gap loi trung unique key clientMessageId do race condition thi lay ban ghi da luu
      if (err.code === 'P2002' && normalizedClientMsgId) {
        const existing = await this.findByClientMessageId(normalizedClientMsgId);
        if (existing) {
          return existing;
        }
      }
      throw err;
    }
  }

  async findByChatBoxId(chatBoxId, limit = 50, skip = 0) {
    return await this.prisma.message.findMany({
      where: { chatBoxId: parseInt(chatBoxId, 10) },
      include: {
        sender: {
          select: { id: true, username: true, name: true, avatar: true },
        },
        attachments: {
          orderBy: { sortOrder: 'asc' },
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

  // Tim cac objectKey da duoc gan voi MessageAttachment trong DB
  async findExistingAttachmentKeys(objectKeys = []) {
    const keys = objectKeys.filter((k) => typeof k === 'string' && k.trim() !== '');
    if (keys.length === 0 || !this.prisma.messageAttachment) {
      return [];
    }

    const rows = await this.prisma.messageAttachment.findMany({
      where: {
        objectKey: { in: keys },
      },
      select: {
        objectKey: true,
      },
    });

    return rows.map((r) => r.objectKey);
  }

  // Tim thong tin attachment theo objectKey de kiem tra quyen xem
  async findAttachmentByObjectKey(objectKey) {
    if (!objectKey || !this.prisma.messageAttachment) {
      return null;
    }

    return await this.prisma.messageAttachment.findFirst({
      where: { objectKey: String(objectKey).trim() },
      include: {
        message: {
          select: {
            id: true,
            chatBoxId: true,
            senderId: true,
          },
        },
      },
    });
  }
}

module.exports = MessageRepository;
