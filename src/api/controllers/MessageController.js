class MessageController {
  constructor(messageService) {
    this.messageService = messageService;
  }

  getConversations = async (req, res, next) => {
    try {
      const conversations = await this.messageService.getUserConversations(req.user.id);
      return res.status(200).json({
        success: true,
        data: conversations,
      });
    } catch (error) {
      next(error);
    }
  };

  getHistory = async (req, res, next) => {
    try {
      const { chatBoxId } = req.params;
      const { limit, skip } = req.query;
      const history = await this.messageService.getChatHistory(
        chatBoxId,
        req.user.id,
        limit ? parseInt(limit, 10) : 50,
        skip ? parseInt(skip, 10) : 0
      );

      return res.status(200).json({
        success: true,
        data: history,
      });
    } catch (error) {
      next(error);
    }
  };

  createChatBox = async (req, res, next) => {
    try {
      const { recipientId } = req.body;
      const chatBox = await this.messageService.getOrCreateChatBox(req.user.id, recipientId);
      return res.status(200).json({
        success: true,
        data: chatBox,
      });
    } catch (error) {
      next(error);
    }
  };

  sendMessage = async (req, res, next) => {
    try {
      const { chatBoxId, targetUserId, content } = req.body;
      const result = await this.messageService.sendMessage({
        chatBoxId,
        targetUserId,
        senderId: req.user.id,
        content,
      });

      return res.status(201).json({
        success: true,
        message: 'Gửi tin nhắn thành công.',
        data: result,
      });
    } catch (error) {
      next(error);
    }
  };
}

module.exports = MessageController;
