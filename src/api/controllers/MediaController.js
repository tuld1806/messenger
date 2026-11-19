class MediaController {
  constructor(messageService) {
    this.messageService = messageService;
  }

  // POST /api/media/presigned-url
  createPresignedUrls = async (req, res, next) => {
    try {
      const { chatBoxId, files, fileName, mimeType, fileSize } = req.body || {};

      // Ho tro ca mang files (1..4 file) hoac 1 file don le
      const normalizedFiles = Array.isArray(files)
        ? files
        : fileName
          ? [{ fileName, mimeType, fileSize, sortOrder: 0 }]
          : [];

      const result = await this.messageService.requestPresignedUploadUrls({
        chatBoxId,
        userId: req.user.id,
        files: normalizedFiles,
      });

      return res.status(200).json({
        success: true,
        data: result,
      });
    } catch (error) {
      if (error.details) {
        return res.status(error.statusCode || 400).json({
          success: false,
          message: error.message,
          data: error.details,
        });
      }
      next(error);
    }
  };

  // GET /api/media/view-url
  getViewUrl = async (req, res, next) => {
    try {
      const chatBoxId = req.query.chatBoxId || req.body?.chatBoxId;
      const objectKey = req.query.objectKey || req.body?.objectKey;

      const result = await this.messageService.getAttachmentViewUrl({
        chatBoxId,
        objectKey,
        userId: req.user.id,
      });

      return res.status(200).json({
        success: true,
        data: result,
      });
    } catch (error) {
      next(error);
    }
  };

  // POST /api/media/cleanup
  cleanupTempFiles = async (req, res, next) => {
    try {
      const { chatBoxId, objectKeys } = req.body || {};

      const result = await this.messageService.cleanupTempFiles({
        chatBoxId,
        objectKeys,
        userId: req.user.id,
      });

      return res.status(200).json({
        success: true,
        data: result,
      });
    } catch (error) {
      next(error);
    }
  };
}

module.exports = MediaController;
