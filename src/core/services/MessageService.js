const crypto = require('crypto');

class MessageService {
  constructor(
    chatBoxRepository,
    messageRepository,
    userRepository,
    storageService = null,
    messageQueue = null
  ) {
    this.chatBoxRepository = chatBoxRepository;
    this.messageRepository = messageRepository;
    this.userRepository = userRepository;
    this.storageService = storageService;
    this.messageQueue = messageQueue;
  }

  // Helper tao loi kem HTTP statusCode cho errorMiddleware
  _createError(message, statusCode = 400) {
    const err = new Error(message);
    err.statusCode = statusCode;
    return err;
  }

  // Sinh ma dinh danh duy nhat cho lan gui tin nhan (phuc vu chong trung khi retry)
  _resolveClientMessageId(clientMessageId = null) {
    if (clientMessageId && typeof clientMessageId === 'string' && clientMessageId.trim() !== '') {
      return clientMessageId.trim();
    }
    return `msg_${Date.now()}_${crypto.randomUUID().slice(0, 8)}`;
  }

  // Kiem tra nguoi dung co quyen tham gia chatBox khong
  async _verifyChatBoxAccess(chatBoxId, userId) {
    if (!chatBoxId) {
      throw this._createError('Thiếu thông tin cuộc trò chuyện.', 400);
    }

    const chatBox = await this.chatBoxRepository.findById(chatBoxId);
    if (!chatBox) {
      throw this._createError('Cuộc trò chuyện không tồn tại.', 404);
    }

    const uid = parseInt(userId, 10);
    if (chatBox.user1Id !== uid && chatBox.user2Id !== uid) {
      throw this._createError('Bạn không có quyền truy cập cuộc trò chuyện này.', 403);
    }

    return chatBox;
  }

  // Kiem tra key co dang cho xu ly (tren RAM hoac tren Redis)
  async _isKeyPendingAnywhere(objectKey) {
    if (!objectKey) return false;
    if (this.storageService && this.storageService.isKeyPending(objectKey)) {
      return true;
    }
    if (this.messageQueue && typeof this.messageQueue.isAttachmentPending === 'function') {
      return await this.messageQueue.isAttachmentPending(objectKey);
    }
    return false;
  }

  // Dinh kem Pre-signed GET URL tam thoi (3600s) vao attachments khi tra du lieu ve client
  async _hydrateMessageAttachments(message) {
    if (
      !message ||
      !this.storageService ||
      !Array.isArray(message.attachments) ||
      message.attachments.length === 0
    ) {
      return message;
    }

    const hydratedAttachments = await Promise.all(
      message.attachments.map(async (att) => {
        try {
          const { viewUrl, expiresIn } = await this.storageService.generatePresignedViewUrl(
            att.objectKey
          );
          return {
            ...att,
            viewUrl,
            viewUrlExpiresIn: expiresIn,
          };
        } catch (err) {
          return {
            ...att,
            viewUrl: null,
          };
        }
      })
    );

    return {
      ...message,
      attachments: hydratedAttachments,
    };
  }

  // Hydrate ket qua do MessageWorker tra ve sau khi luu DB thanh cong
  async hydratePersistedResult(workerResult) {
    if (!workerResult) return null;

    const attachments = workerResult.message?.attachments || [];
    const keys = attachments.map((a) => a?.objectKey).filter(Boolean);
    if (this.storageService && keys.length > 0) {
      this.storageService.unmarkPendingKeys(keys);
    }

    const hydratedMessage = await this._hydrateMessageAttachments(workerResult.message);
    return {
      ...workerResult,
      status: 'persisted',
      message: hydratedMessage,
    };
  }

  async getOrCreateChatBox(userAId, userBId) {
    if (parseInt(userAId, 10) === parseInt(userBId, 10)) {
      throw this._createError('Không thể nhắn tin với chính mình.', 400);
    }

    const targetUser = await this.userRepository.findById(userBId);
    if (!targetUser) {
      throw this._createError('Người nhận không tồn tại.', 404);
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

    return await Promise.all(
      chatBoxes.map(async (box) => {
        const partner = box.user1Id === uid ? box.user2 : box.user1;
        const rawLastMessage = box.messages && box.messages.length > 0 ? box.messages[0] : null;
        const lastMessage = await this._hydrateMessageAttachments(rawLastMessage);

        return {
          chatBoxId: box.id,
          partner,
          lastMessage,
          updatedAt: box.updatedAt,
        };
      })
    );
  }

  async getChatHistory(chatBoxId, userId, limit = 50, skip = 0) {
    const chatBox = await this._verifyChatBoxAccess(chatBoxId, userId);

    // Danh dau da doc khi lay lich su
    await this.messageRepository.markAsRead(chatBoxId, userId);

    const rawMessages = await this.messageRepository.findByChatBoxId(chatBoxId, limit, skip);
    const messages = await Promise.all(
      rawMessages.map((msg) => this._hydrateMessageAttachments(msg))
    );

    return {
      chatBox,
      messages,
    };
  }

  // Kiem tra quyen ChatBox, noi dung tin nhan va xac minh attachments tren MinIO
  async _prepareAndVerifyMessage({
    chatBoxId,
    targetUserId,
    senderId,
    content = '',
    attachments = [],
    clientMessageId = null,
  }) {
    const trimmedContent = typeof content === 'string' ? content.trim() : '';
    const rawAttachments = Array.isArray(attachments) ? attachments : [];

    if (rawAttachments.length > 4) {
      throw this._createError('Mỗi tin nhắn chỉ được đính kèm tối đa 4 tệp.', 400);
    }

    if (trimmedContent === '' && rawAttachments.length === 0) {
      throw this._createError('Nội dung tin nhắn không được để trống.', 400);
    }

    let chatBox;
    if (chatBoxId) {
      chatBox = await this.chatBoxRepository.findById(chatBoxId);
    } else if (targetUserId) {
      chatBox = await this.getOrCreateChatBox(senderId, targetUserId);
    } else {
      throw this._createError('Thiếu thông tin cuộc trò chuyện hoặc người nhận.', 400);
    }

    if (!chatBox) {
      throw this._createError('Không tìm thấy phòng chat.', 404);
    }

    const uid = parseInt(senderId, 10);
    if (chatBox.user1Id !== uid && chatBox.user2Id !== uid) {
      throw this._createError('Bạn không có quyền gửi tin nhắn trong phòng chat này.', 403);
    }

    const verifiedAttachments = [];
    const candidateKeys = rawAttachments
      .map((a) => (typeof a === 'string' ? a : a?.objectKey || a?.fileKey))
      .filter(Boolean);

    if (this.storageService && candidateKeys.length > 0) {
      this.storageService.markKeysAsPending(candidateKeys);
    }

    try {
      for (let idx = 0; idx < rawAttachments.length; idx++) {
        const item = rawAttachments[idx];
        const objectKey = typeof item === 'string' ? item : item?.objectKey || item?.fileKey;
        if (!objectKey) continue;

        const requestedSortOrder =
          typeof item === 'object' &&
          item.sortOrder !== undefined &&
          Number.isInteger(Number(item.sortOrder))
            ? Number(item.sortOrder)
            : idx;

        if (this.storageService) {
          const verification = await this.storageService.verifyUploadedObject(objectKey, {
            expectedChatBoxId: chatBox.id,
            expectedUserId: uid,
            declaredMimeType: typeof item === 'object' ? item.mimeType : null,
          });

          if (verification.valid) {
            verifiedAttachments.push({
              objectKey: verification.objectKey,
              fileName:
                typeof item === 'object' && item.fileName
                  ? String(item.fileName).trim()
                  : verification.fileName,
              mimeType: verification.mimeType,
              fileSize: verification.fileSize,
              sortOrder: requestedSortOrder,
            });
          }
        } else {
          verifiedAttachments.push({
            objectKey: String(objectKey),
            fileName:
              typeof item === 'object' && item.fileName ? String(item.fileName).trim() : 'file',
            mimeType:
              typeof item === 'object' && item.mimeType
                ? String(item.mimeType).trim()
                : 'image/png',
            fileSize: (typeof item === 'object' && Number(item.fileSize)) || 0,
            sortOrder: requestedSortOrder,
          });
        }
      }

      verifiedAttachments.sort((a, b) => a.sortOrder - b.sortOrder);

      if (trimmedContent === '' && verifiedAttachments.length === 0) {
        throw this._createError('Không có tệp đính kèm hợp lệ và nội dung văn bản trống.', 400);
      }

      const recipientId = chatBox.user1Id === uid ? chatBox.user2Id : chatBox.user1Id;
      const resolvedClientMessageId = this._resolveClientMessageId(clientMessageId);

      return {
        chatBox,
        uid,
        recipientId,
        trimmedContent,
        verifiedAttachments,
        candidateKeys,
        resolvedClientMessageId,
      };
    } catch (err) {
      if (this.storageService && candidateKeys.length > 0) {
        this.storageService.unmarkPendingKeys(candidateKeys);
      }
      throw err;
    }
  }

  // Day tin nhan vao BullMQ chat-message-queue de MessageWorker xu ly bat dong bo
  async enqueueMessage({
    chatBoxId,
    targetUserId,
    senderId,
    content = '',
    attachments = [],
    clientMessageId = null,
  }) {
    if (!this.messageQueue) {
      throw this._createError('Hàng đợi tin nhắn chưa được cấu hình.', 500);
    }

    const prepared = await this._prepareAndVerifyMessage({
      chatBoxId,
      targetUserId,
      senderId,
      content,
      attachments,
      clientMessageId,
    });

    const {
      chatBox,
      uid,
      recipientId,
      trimmedContent,
      verifiedAttachments,
      candidateKeys,
      resolvedClientMessageId,
    } = prepared;

    const queuedAt = new Date().toISOString();

    try {
      const job = await this.messageQueue.enqueueMessageJob({
        clientMessageId: resolvedClientMessageId,
        chatBoxId: chatBox.id,
        senderId: uid,
        recipientId,
        content: trimmedContent,
        attachments: verifiedAttachments,
        queuedAt,
      });

      return {
        status: 'queued',
        jobId: job.id,
        clientMessageId: resolvedClientMessageId,
        chatBoxId: chatBox.id,
        senderId: uid,
        recipientId,
        message: {
          id: null,
          clientMessageId: resolvedClientMessageId,
          chatBoxId: chatBox.id,
          senderId: uid,
          content: trimmedContent,
          attachments: verifiedAttachments,
          status: 'queued',
          createdAt: queuedAt,
        },
      };
    } catch (err) {
      if (this.storageService && candidateKeys.length > 0) {
        this.storageService.unmarkPendingKeys(candidateKeys);
      }
      throw this._createError(`Không thể đưa tin nhắn vào hàng đợi: ${err.message}`, 503);
    }
  }

  // Luu truc tiep vao Database (dung khi khong bat Queue hoac goi truc tiep)
  async persistMessageDirect({
    chatBoxId,
    targetUserId,
    senderId,
    content = '',
    attachments = [],
    clientMessageId = null,
  }) {
    const prepared = await this._prepareAndVerifyMessage({
      chatBoxId,
      targetUserId,
      senderId,
      content,
      attachments,
      clientMessageId,
    });

    const {
      chatBox,
      uid,
      recipientId,
      trimmedContent,
      verifiedAttachments,
      candidateKeys,
      resolvedClientMessageId,
    } = prepared;

    try {
      const rawMessage = await this.messageRepository.create({
        clientMessageId: resolvedClientMessageId,
        chatBoxId: chatBox.id,
        senderId: uid,
        content: trimmedContent,
        attachments: verifiedAttachments,
      });

      const message = await this._hydrateMessageAttachments(rawMessage);

      return {
        status: 'persisted',
        clientMessageId: resolvedClientMessageId,
        chatBoxId: chatBox.id,
        senderId: uid,
        recipientId,
        message,
      };
    } finally {
      if (this.storageService && candidateKeys.length > 0) {
        this.storageService.unmarkPendingKeys(candidateKeys);
      }
    }
  }

  // Ham gui tin nhan chinh: Neu co messageQueue thi dua vao Queue, nguoc lai luu DB truc tiep
  async sendMessage({
    chatBoxId,
    targetUserId,
    senderId,
    content = '',
    attachments = [],
    clientMessageId = null,
    useQueue = undefined,
  }) {
    const shouldUseQueue =
      useQueue !== undefined ? Boolean(useQueue) : Boolean(this.messageQueue);

    if (shouldUseQueue && this.messageQueue) {
      return await this.enqueueMessage({
        chatBoxId,
        targetUserId,
        senderId,
        content,
        attachments,
        clientMessageId,
      });
    }

    return await this.persistMessageDirect({
      chatBoxId,
      targetUserId,
      senderId,
      content,
      attachments,
      clientMessageId,
    });
  }

  // Cap Pre-signed PUT URL cho toi da 4 file sau khi kiem tra quyen ChatBox
  async requestPresignedUploadUrls({ chatBoxId, userId, files }) {
    if (!this.storageService) {
      throw this._createError('Dịch vụ lưu trữ chưa được cấu hình.', 500);
    }

    const chatBox = await this._verifyChatBoxAccess(chatBoxId, userId);

    if (!Array.isArray(files) || files.length === 0) {
      throw this._createError('Danh sách tệp không được để trống.', 400);
    }

    if (files.length > 4) {
      throw this._createError('Mỗi tin nhắn chỉ được đính kèm tối đa 4 tệp.', 400);
    }

    const result = await this.storageService.generatePresignedUploadUrls({
      chatBoxId: chatBox.id,
      userId: parseInt(userId, 10),
      files,
    });

    if (result.validCount === 0) {
      const firstError = result.files[0]?.error || 'Không có tệp nào hợp lệ.';
      const err = this._createError(firstError, 400);
      err.details = result;
      throw err;
    }

    return result;
  }

  // Cap Pre-signed GET URL (3600s) sau khi kiem tra quyen ChatBox va objectKey
  async getAttachmentViewUrl({ chatBoxId, objectKey, userId }) {
    if (!this.storageService) {
      throw this._createError('Dịch vụ lưu trữ chưa được cấu hình.', 500);
    }

    if (!objectKey || typeof objectKey !== 'string' || objectKey.trim() === '') {
      throw this._createError('Thiếu thông tin objectKey.', 400);
    }

    const chatBox = await this._verifyChatBoxAccess(chatBoxId, userId);
    const cleanKey = objectKey.trim();

    // Kiem tra objectKey phai ton tai trong MessageAttachment va thuoc dung chatBoxId nay
    const attachmentRecord = await this.messageRepository.findAttachmentByObjectKey(cleanKey);
    const belongsToChatBox =
      Boolean(attachmentRecord && attachmentRecord.message) &&
      attachmentRecord.message.chatBoxId === chatBox.id;

    if (!belongsToChatBox) {
      throw this._createError(
        'Tệp không thuộc cuộc trò chuyện này hoặc bạn không có quyền truy cập.',
        403
      );
    }

    return await this.storageService.generatePresignedViewUrl(cleanKey);
  }

  // Lop 1: Cleanup chu dong khi nguoi dung huy chon file hoac thoat ChatBox
  async cleanupTempFiles({ chatBoxId, objectKeys, userId }) {
    if (!this.storageService) {
      throw this._createError('Dịch vụ lưu trữ chưa được cấu hình.', 500);
    }

    const chatBox = await this._verifyChatBoxAccess(chatBoxId, userId);
    const uid = parseInt(userId, 10);

    if (!Array.isArray(objectKeys) || objectKeys.length === 0) {
      throw this._createError('Danh sách objectKeys không được để trống.', 400);
    }

    const ownedCandidateKeys = [];
    const rejectedKeys = [];

    for (const rawKey of objectKeys) {
      const key = typeof rawKey === 'string' ? rawKey.trim() : '';
      if (!key) continue;

      const parsed = this.storageService.parseObjectKey(key);
      // Chi cho phep xoa file do chinh userId nay tao va thuoc dung chatBoxId
      if (!parsed.isValidChatKey || parsed.chatBoxId !== chatBox.id || parsed.userId !== uid) {
        rejectedKeys.push({
          objectKey: key,
          reason: 'Khong thuoc quyen so huu hoac khong thuoc ChatBox nay',
        });
        continue;
      }

      if (await this._isKeyPendingAnywhere(key)) {
        rejectedKeys.push({
          objectKey: key,
          reason: 'File dang trong qua trinh gui tin nhan hoac cho Worker xu ly',
        });
        continue;
      }

      ownedCandidateKeys.push(key);
    }

    // Kiem tra DB de khong bao gio xoa file da gan voi MessageAttachment
    const attachedKeys = await this.messageRepository.findExistingAttachmentKeys(ownedCandidateKeys);
    const attachedSet = new Set(attachedKeys);

    const deletableKeys = ownedCandidateKeys.filter((k) => !attachedSet.has(k));
    const skippedAttachedKeys = ownedCandidateKeys.filter((k) => attachedSet.has(k));

    if (deletableKeys.length > 0) {
      await this.storageService.deleteObjects(deletableKeys);
    }

    return {
      chatBoxId: chatBox.id,
      deletedKeys: deletableKeys,
      skippedAttachedKeys,
      rejectedKeys,
    };
  }

  // Lop 2: Cleanup du phong tu dong cho cac file mo coi qua 30 phut
  async cleanupExpiredOrphanFiles({ maxAgeMs } = {}) {
    if (!this.storageService) {
      throw this._createError('Dịch vụ lưu trữ chưa được cấu hình.', 500);
    }

    const thresholdMs =
      maxAgeMs !== undefined && Number.isFinite(Number(maxAgeMs))
        ? Number(maxAgeMs)
        : this.storageService.orphanMaxAgeMs;

    const now = Date.now();
    const allObjects = await this.storageService.listObjects('chats/');

    const expiredCandidates = [];
    for (const obj of allObjects) {
      const key = obj.objectKey;
      if (!key || (await this._isKeyPendingAnywhere(key))) {
        continue;
      }

      const parsed = this.storageService.parseObjectKey(key);
      const createdTime = parsed.isValidChatKey
        ? parsed.timestamp
        : obj.lastModified
          ? new Date(obj.lastModified).getTime()
          : now;

      if (now - createdTime >= thresholdMs) {
        expiredCandidates.push(key);
      }
    }

    if (expiredCandidates.length === 0) {
      return {
        scannedCount: allObjects.length,
        deletedKeys: [],
        protectedAttachedKeys: [],
      };
    }

    const attachedKeys = await this.messageRepository.findExistingAttachmentKeys(expiredCandidates);
    const attachedSet = new Set(attachedKeys);

    const orphanKeysToDelete = expiredCandidates.filter((k) => !attachedSet.has(k));
    const protectedAttachedKeys = expiredCandidates.filter((k) => attachedSet.has(k));

    if (orphanKeysToDelete.length > 0) {
      await this.storageService.deleteObjects(orphanKeysToDelete);
    }

    return {
      scannedCount: allObjects.length,
      deletedKeys: orphanKeysToDelete,
      protectedAttachedKeys,
    };
  }
}

module.exports = MessageService;
