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
      const { chatBoxId, targetUserId, content, attachments, clientMessageId } = req.body || {};
      const result = await this.messageService.sendMessage({
        chatBoxId,
        targetUserId,
        senderId: req.user.id,
        content,
        attachments,
        clientMessageId,
      });

      const statusCode = result.status === 'queued' ? 202 : 201;
      const responseMessage =
        result.status === 'queued'
          ? 'Tin nhắn đã được tiếp nhận vào hàng đợi xử lý.'
          : 'Gửi tin nhắn thành công.';

      return res.status(statusCode).json({
        success: true,
        message: responseMessage,
        data: result,
      });
    } catch (error) {
      next(error);
    }
  };
}

module.exports = MessageController;
