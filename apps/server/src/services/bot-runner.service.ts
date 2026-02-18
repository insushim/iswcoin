// 하위 호환성을 위한 re-export
// 실제 구현은 ./bot-runner/ 디렉토리에 모듈 분할됨
export { botRunnerService, BotRunnerService } from './bot-runner/index.js';
export type { TrackedPosition, PaperTradeLog, ActiveBotState, BotRunnerState } from './bot-runner/types.js';
