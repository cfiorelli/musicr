-- AlterTable: Add nullable replyToMessageId column
ALTER TABLE "messages" ADD COLUMN "replyToMessageId" UUID;

-- CreateIndex
CREATE INDEX "idx_messages_reply_to_message_id" ON "messages"("replyToMessageId");

-- AddForeignKey
ALTER TABLE "messages" ADD CONSTRAINT "messages_replyToMessageId_fkey" FOREIGN KEY ("replyToMessageId") REFERENCES "messages"("id") ON DELETE SET NULL ON UPDATE CASCADE;
