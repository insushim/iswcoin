"use client";

import { useEffect, useState } from "react";
import { BotCard } from "@/components/bots/bot-card";
import { CreateBotForm } from "@/components/bots/create-bot-form";
import { Modal } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import { PageLoader } from "@/components/ui/loading";
import { useBotStore, type Bot } from "@/stores/bot.store";
import { Plus, Bot as BotIcon } from "lucide-react";
import { BotStatus } from "@cryptosentinel/shared";

export default function BotsPage() {
  const { bots, fetchBots, startBot, stopBot, deleteBot, isLoading, error } = useBotStore();
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [settingsBot, setSettingsBot] = useState<Bot | null>(null);
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);
  const [fetchError, setFetchError] = useState<string | null>(null);

  useEffect(() => {
    fetchBots().catch((err) => {
      setFetchError(err instanceof Error ? err.message : "봇 목록을 불러오는데 실패했습니다");
    });
  }, [fetchBots]);

  const handleDelete = async (id: string) => {
    const bot = bots.find((b) => b.id === id);
    if (bot?.status === BotStatus.RUNNING) {
      const confirmed = window.confirm(
        "이 봇은 현재 실행 중입니다. 중지 후 삭제하시겠습니까?\n진행 중인 포지션이 방치될 수 있습니다."
      );
      if (!confirmed) return;
    }
    setDeleteConfirmId(id);
  };

  const confirmDelete = async () => {
    if (!deleteConfirmId) return;
    await deleteBot(deleteConfirmId);
    setDeleteConfirmId(null);
  };

  if (isLoading && bots.length === 0) {
    return <PageLoader />;
  }

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-white">트레이딩 봇</h2>
          <p className="text-sm text-slate-400 mt-1">
            자동매매 봇을 관리하고 모니터링하세요
          </p>
        </div>
        <Button
          variant="primary"
          onClick={() => setShowCreateModal(true)}
          leftIcon={<Plus className="h-4 w-4" />}
        >
          봇 생성
        </Button>
      </div>

      {/* Error display */}
      {(fetchError || error) && (
        <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-400">
          {fetchError || error}
        </div>
      )}

      {/* Delete confirmation modal */}
      <Modal
        isOpen={!!deleteConfirmId}
        onClose={() => setDeleteConfirmId(null)}
        title="봇 삭제 확인"
      >
        <div className="space-y-4">
          <p className="text-sm text-slate-300">
            이 봇을 정말 삭제하시겠습니까? 이 작업은 되돌릴 수 없으며, 관련 거래 기록도 함께 삭제됩니다.
          </p>
          <div className="flex justify-end gap-3">
            <Button variant="secondary" size="sm" onClick={() => setDeleteConfirmId(null)}>
              취소
            </Button>
            <Button variant="danger" size="sm" onClick={confirmDelete}>
              삭제
            </Button>
          </div>
        </div>
      </Modal>

      {/* Bot grid */}
      {bots.length === 0 && !fetchError ? (
        <div className="flex flex-col items-center justify-center py-20">
          <BotIcon className="h-16 w-16 text-slate-700 mb-4" />
          <h3 className="text-lg font-semibold text-slate-400">봇이 없습니다</h3>
          <p className="text-sm text-slate-500 mt-1 mb-4">
            첫 번째 트레이딩 봇을 만들어 시작하세요
          </p>
          <Button
            variant="primary"
            onClick={() => setShowCreateModal(true)}
            leftIcon={<Plus className="h-4 w-4" />}
          >
            봇 생성
          </Button>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {bots.map((bot) => (
            <BotCard
              key={bot.id}
              bot={bot}
              onStart={startBot}
              onStop={stopBot}
              onDelete={handleDelete}
              onSettings={(b) => setSettingsBot(b)}
            />
          ))}
        </div>
      )}

      {/* Create bot modal */}
      <Modal
        isOpen={showCreateModal}
        onClose={() => setShowCreateModal(false)}
        title="새 봇 생성"
        size="lg"
      >
        <CreateBotForm onClose={() => setShowCreateModal(false)} />
      </Modal>

      {/* Settings modal */}
      <Modal
        isOpen={!!settingsBot}
        onClose={() => setSettingsBot(null)}
        title={`${settingsBot?.name ?? "봇"} 설정`}
        size="lg"
      >
        {settingsBot && (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <p className="text-xs text-slate-400">전략</p>
                <p className="text-sm font-medium text-white">{settingsBot.strategy}</p>
              </div>
              <div>
                <p className="text-xs text-slate-400">종목</p>
                <p className="text-sm font-medium text-white">{settingsBot.symbol}</p>
              </div>
              <div>
                <p className="text-xs text-slate-400">거래소</p>
                <p className="text-sm font-medium text-white">{settingsBot.exchange}</p>
              </div>
              <div>
                <p className="text-xs text-slate-400">모드</p>
                <p className="text-sm font-medium text-white">{settingsBot.mode === "PAPER" ? "모의 투자" : "실전 투자"}</p>
              </div>
            </div>
            <div>
              <p className="text-xs text-slate-400 mb-2">설정 값</p>
              <div className="rounded-lg bg-slate-800/30 p-3 space-y-1">
                {Object.entries(settingsBot.config).map(([key, val]) => (
                  <div key={key} className="flex justify-between text-sm">
                    <span className="text-slate-400">{key}</span>
                    <span className="text-white">{String(val)}</span>
                  </div>
                ))}
                {Object.keys(settingsBot.config).length === 0 && (
                  <p className="text-sm text-slate-500">설정 값이 없습니다</p>
                )}
              </div>
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <Button variant="secondary" size="sm" onClick={() => setSettingsBot(null)}>
                닫기
              </Button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
