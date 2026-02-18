-- CreateIndex
CREATE INDEX "bots_userId_status_idx" ON "bots"("userId", "status");

-- CreateIndex
CREATE INDEX "bots_status_idx" ON "bots"("status");
