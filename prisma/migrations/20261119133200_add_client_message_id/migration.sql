-- AlterTable
ALTER TABLE `messages` ADD COLUMN `clientMessageId` VARCHAR(100) NULL;

-- CreateIndex
CREATE UNIQUE INDEX `messages_clientMessageId_key` ON `messages`(`clientMessageId`);
