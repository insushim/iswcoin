import { BotStatus } from "@cryptosentinel/shared";

/**
 * 봇 상태에 따른 Badge variant를 반환합니다.
 * BotStatus enum 또는 문자열 모두 지원합니다.
 */
export function getBotStatusVariant(status: BotStatus | string) {
  switch (status) {
    case BotStatus.RUNNING:
    case "RUNNING":
      return "running" as const;
    case BotStatus.STOPPED:
    case "STOPPED":
      return "stopped" as const;
    case BotStatus.ERROR:
    case "ERROR":
      return "error" as const;
    case BotStatus.IDLE:
    case "IDLE":
      return "idle" as const;
    default:
      return "info" as const;
  }
}

/**
 * 봇 상태 한국어 라벨을 반환합니다.
 */
export function getBotStatusLabel(status: BotStatus | string) {
  switch (status) {
    case BotStatus.RUNNING:
    case "RUNNING":
      return "실행 중";
    case BotStatus.STOPPED:
    case "STOPPED":
      return "중지됨";
    case BotStatus.ERROR:
    case "ERROR":
      return "오류";
    case BotStatus.IDLE:
    case "IDLE":
      return "대기 중";
    default:
      return String(status);
  }
}
