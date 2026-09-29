class MessageService {
  constructor(chatBoxRepository, messageRepository, userRepository) {
    this.chatBoxRepository = chatBoxRepository;
    this.messageRepository = messageRepository;
    this.userRepository = userRepository;
  }

  async getOrCreateChatBox(userAId, userBId) {
    if (parseInt(userAId, 10) === parseInt(userBId, 10)) {
      throw new Error('Không thể nhắn tin với chính mình.');
    }

    const targetUser = await this.userRepository.findById(userBId);
    if (!targetUser) {
      throw new Error('Người nhận không tồn tại.');
    }

    let chatBox = await this.chatBoxRepository.findBetweenUsers(userAId, userBId);
    if (!chatBox) {
      chatBox = await this.chatBoxRepository.create(userAId, userBId);
    }

    return chatBox;
  }

  async getUserConversations(userId) {
    const chatBoxes = await this.chatBoxRepository.getUserChatBoxes(userId);
    const uid = parseInt(userId, 10);

    return chatBoxes.map(box => {
      const partner = box.user1Id === uid ? box.user2 : box.user1;
      const lastMessage = box.messages && box.messages.length > 0 ? box.messages[0] : null;

      return {
        chatBoxId: box.id,
        partner,
        lastMessage,
        updatedAt: box.updatedAt,
      };
    });
  }

  async getChatHistory(chatBoxId, userId, limit = 50, skip = 0) {
    const chatBox = await this.chatBoxRepository.findById(chatBoxId);
    if (!chatBox) {
      throw new Error('Cuộc trò chuyện không tồn tại.');
    }

    const uid = parseInt(userId, 10);
    if (chatBox.user1Id !== uid && chatBox.user2Id !== uid) {
      throw new Error('Bạn không có quyền truy cập cuộc trò chuyện này.');
    }

    // Mark messages as read when fetched
    await this.messageRepository.markAsRead(chatBoxId, userId);

    const messages = await this.messageRepository.findByChatBoxId(chatBoxId, limit, skip);

    return {
      chatBox,
      messages,
    };
  }

  async sendMessage({ chatBoxId, targetUserId, senderId, content }) {
    if (!content || content.trim() === '') {
      throw new Error('Nội dung tin nhắn không được để trống.');
    }

    let chatBox;
    if (chatBoxId) {
      chatBox = await this.chatBoxRepository.findById(chatBoxId);
    } else if (targetUserId) {
      chatBox = await this.getOrCreateChatBox(senderId, targetUserId);
    } else {
      throw new Error('Thiếu thông tin cuộc trò chuyện hoặc người nhận.');
    }

    if (!chatBox) {
      throw new Error('Không tìm thấy phòng chat.');
    }

    const uid = parseInt(senderId, 10);
    if (chatBox.user1Id !== uid && chatBox.user2Id !== uid) {
      throw new Error('Bạn không có quyền gửi tin nhắn trong phòng chat này.');
    }

    const message = await this.messageRepository.create({
      chatBoxId: chatBox.id,
      senderId: uid,
      content: content.trim(),
    });

    const recipientId = chatBox.user1Id === uid ? chatBox.user2Id : chatBox.user1Id;

    return {
      chatBoxId: chatBox.id,
      recipientId,
      message,
    };
  }
}

module.exports = MessageService;
