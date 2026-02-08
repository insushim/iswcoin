import { BaseStrategy, type TradeSignal } from './base.strategy.js';
import { logger } from '../utils/logger.js';
import { indicatorsService, type OHLCVData } from '../services/indicators.service.js';
import { onchainAnalyticsService } from '../services/onchain.service.js';

/**
 * 펀딩비 차익거래 전략 (Funding Rate Arbitrage)
 *
 * 원리: 선물 시장의 펀딩비가 극단적일 때,
 * - 펀딩비 > 0 (양수): 숏 포지션이 펀딩비 수취 → 선물 숏 + 현물 매수
 * - 펀딩비 < 0 (음수): 롱 포지션이 펀딩비 수취 → 선물 롱 + 현물 매도(보유분)
 *
 * 8시간마다 펀딩비 정산 → 연 수익률로 환산하여 진입 판단
 */
export interface FundingArbConfig {
  minAnnualizedRate: number;    // 최소 연환산 수익률 (%) 진입 기준
  maxAnnualizedRate: number;    // 최대 연환산 (과도한 펀딩비는 청산 위험)
  positionSize: number;         // 포지션 크기 ($)
  stopLossPercent: number;      // 가격 차이 손절 (%)
  maxHoldingHours: number;      // 최대 보유 시간
  minFundingCycles: number;     // 최소 수취 횟수 (3 = 24시간)
}

export interface FundingArbSignal {
  action: 'ENTER_LONG_FUNDING' | 'ENTER_SHORT_FUNDING' | 'EXIT' | 'HOLD';
  fundingRate: number;
  annualizedRate: number;
  predictedRate: number;
  expectedProfit: number;       // 예상 수익 ($)
  confidence: number;           // 0-100
  reason: string;
}

const DEFAULT_CONFIG: FundingArbConfig = {
  minAnnualizedRate: 15,       // 연 15% 이상이면 진입
  maxAnnualizedRate: 200,      // 연 200% 초과는 위험
  positionSize: 500,
  stopLossPercent: 2,
  maxHoldingHours: 72,         // 최대 3일
  minFundingCycles: 3,
};

export class FundingArbStrategy extends BaseStrategy {
  private fundingConfig: FundingArbConfig;
  private entryTimestamp: number | null = null;
  private entryFundingRate: number | null = null;
  private fundingRateHistory: { rate: number; timestamp: number }[] = [];

  constructor(config?: Record<string, number>) {
    super('Funding Rate Arbitrage', config);
    this.fundingConfig = { ...DEFAULT_CONFIG };
    if (config) {
      if (config['minAnnualizedRate'] !== undefined) this.fundingConfig.minAnnualizedRate = config['minAnnualizedRate'];
      if (config['maxAnnualizedRate'] !== undefined) this.fundingConfig.maxAnnualizedRate = config['maxAnnualizedRate'];
      if (config['positionSize'] !== undefined) this.fundingConfig.positionSize = config['positionSize'];
      if (config['stopLossPercent'] !== undefined) this.fundingConfig.stopLossPercent = config['stopLossPercent'];
      if (config['maxHoldingHours'] !== undefined) this.fundingConfig.maxHoldingHours = config['maxHoldingHours'];
      if (config['minFundingCycles'] !== undefined) this.fundingConfig.minFundingCycles = config['minFundingCycles'];
    }
  }

  getDefaultConfig(): Record<string, number> {
    return {
      minAnnualizedRate: DEFAULT_CONFIG.minAnnualizedRate,
      maxAnnualizedRate: DEFAULT_CONFIG.maxAnnualizedRate,
      positionSize: DEFAULT_CONFIG.positionSize,
      stopLossPercent: DEFAULT_CONFIG.stopLossPercent,
      maxHoldingHours: DEFAULT_CONFIG.maxHoldingHours,
      minFundingCycles: DEFAULT_CONFIG.minFundingCycles,
    };
  }

  /**
   * 동기식 분석 (BaseStrategy 인터페이스) - 기술적 필터만 적용
   */
  analyze(data: OHLCVData[]): TradeSignal | null {
    if (data.length < 15) return null;

    const closes = data.map((d) => d.close);
    const rsi = indicatorsService.calculateRSI(closes, 14);
    const lastRSI = rsi.length > 0 ? rsi[rsi.length - 1]! : 50;
    const lastPrice = closes[closes.length - 1]!;

    // RSI가 극단값이면 진입 회피 (가격 반전 위험)
    if (lastRSI > 85 || lastRSI < 15) {
      return null;
    }

    // 기본 hold 신호 (비동기 analyzeWithFunding으로 실제 결정)
    return {
      action: 'hold',
      confidence: 0,
      reason: '펀딩비 데이터 필요 (analyzeWithFunding 사용)',
      price: lastPrice,
    };
  }

  async analyzeWithFunding(
    symbol: string,
    currentPrice: number,
    ohlcv: number[][]
  ): Promise<FundingArbSignal> {
    // 펀딩비 조회
    const fundingData = await onchainAnalyticsService.getFundingRate(symbol);
    const { fundingRate, annualizedRate, predictedRate } = fundingData;

    // 펀딩비 히스토리 기록
    this.fundingRateHistory.push({ rate: fundingRate, timestamp: Date.now() });
    if (this.fundingRateHistory.length > 100) {
      this.fundingRateHistory = this.fundingRateHistory.slice(-100);
    }

    const absAnnualized = Math.abs(annualizedRate);

    // 1) 이미 포지션이 있는 경우 → EXIT 조건 확인
    if (this.entryTimestamp !== null) {
      return this.checkExitConditions(fundingRate, annualizedRate, currentPrice);
    }

    // 2) 연환산 수익률이 기준 미만이면 관망
    if (absAnnualized < this.fundingConfig.minAnnualizedRate) {
      return {
        action: 'HOLD',
        fundingRate,
        annualizedRate,
        predictedRate,
        expectedProfit: 0,
        confidence: 0,
        reason: `연환산 ${absAnnualized.toFixed(1)}%: 최소 기준(${this.fundingConfig.minAnnualizedRate}%) 미달`,
      };
    }

    // 3) 과도한 펀딩비는 청산 위험
    if (absAnnualized > this.fundingConfig.maxAnnualizedRate) {
      return {
        action: 'HOLD',
        fundingRate,
        annualizedRate,
        predictedRate,
        expectedProfit: 0,
        confidence: 20,
        reason: `연환산 ${absAnnualized.toFixed(1)}%: 과도한 펀딩비, 청산 위험`,
      };
    }

    // 4) 펀딩비 안정성 확인 (최근 3개 이상 같은 방향)
    const consistency = this.checkFundingConsistency();
    if (consistency < 0.6) {
      return {
        action: 'HOLD',
        fundingRate,
        annualizedRate,
        predictedRate,
        expectedProfit: 0,
        confidence: 30,
        reason: `펀딩비 방향 일관성 부족 (${(consistency * 100).toFixed(0)}%)`,
      };
    }

    // 5) 기술적 필터: 극단적 가격 움직임 중에는 진입 회피
    const parsedOhlcv = indicatorsService.parseOHLCV(ohlcv);
    if (parsedOhlcv.length >= 15) {
      const closes = parsedOhlcv.map((d) => d.close);
      const rsi = indicatorsService.calculateRSI(closes, 14);
      const lastRSI = rsi.length > 0 ? rsi[rsi.length - 1]! : 50;

      // RSI 극단값일 때는 가격 반전 위험
      if (lastRSI > 85 || lastRSI < 15) {
        return {
          action: 'HOLD',
          fundingRate,
          annualizedRate,
          predictedRate,
          expectedProfit: 0,
          confidence: 25,
          reason: `RSI ${lastRSI.toFixed(1)}: 극단적 가격 → 반전 위험`,
        };
      }
    }

    // 6) 신호 생성
    const expectedProfit = this.calculateExpectedProfit(fundingRate, currentPrice);
    const confidence = Math.min(95, Math.round(
      (absAnnualized / this.fundingConfig.minAnnualizedRate) * 30 +
      consistency * 40 +
      20 // 기본점수
    ));

    if (fundingRate > 0) {
      // 양수 펀딩비: 숏이 돈을 받음 → 선물 숏 + 현물 롱
      this.entryTimestamp = Date.now();
      this.entryFundingRate = fundingRate;

      return {
        action: 'ENTER_SHORT_FUNDING',
        fundingRate,
        annualizedRate,
        predictedRate,
        expectedProfit,
        confidence,
        reason: `양수 펀딩비 ${(fundingRate * 100).toFixed(4)}% (연 ${annualizedRate.toFixed(1)}%): 숏 펀딩 수취`,
      };
    } else {
      // 음수 펀딩비: 롱이 돈을 받음 → 선물 롱 + 현물 숏/보유없음
      this.entryTimestamp = Date.now();
      this.entryFundingRate = fundingRate;

      return {
        action: 'ENTER_LONG_FUNDING',
        fundingRate,
        annualizedRate,
        predictedRate,
        expectedProfit,
        confidence,
        reason: `음수 펀딩비 ${(fundingRate * 100).toFixed(4)}% (연 ${annualizedRate.toFixed(1)}%): 롱 펀딩 수취`,
      };
    }
  }

  private checkExitConditions(
    currentRate: number,
    annualizedRate: number,
    currentPrice: number
  ): FundingArbSignal {
    const holdingMs = Date.now() - (this.entryTimestamp ?? Date.now());
    const holdingHours = holdingMs / (1000 * 60 * 60);

    // 최대 보유 시간 초과
    if (holdingHours >= this.fundingConfig.maxHoldingHours) {
      this.resetPosition();
      return {
        action: 'EXIT',
        fundingRate: currentRate,
        annualizedRate,
        predictedRate: currentRate,
        expectedProfit: 0,
        confidence: 90,
        reason: `보유 시간 ${holdingHours.toFixed(1)}h 초과 (최대 ${this.fundingConfig.maxHoldingHours}h)`,
      };
    }

    // 펀딩비 방향 전환
    if (this.entryFundingRate !== null) {
      const entrySign = Math.sign(this.entryFundingRate);
      const currentSign = Math.sign(currentRate);
      if (entrySign !== 0 && currentSign !== entrySign) {
        this.resetPosition();
        return {
          action: 'EXIT',
          fundingRate: currentRate,
          annualizedRate,
          predictedRate: currentRate,
          expectedProfit: 0,
          confidence: 85,
          reason: '펀딩비 방향 전환 → 포지션 청산',
        };
      }
    }

    // 펀딩비가 기준 미만으로 하락
    if (Math.abs(annualizedRate) < this.fundingConfig.minAnnualizedRate * 0.5) {
      this.resetPosition();
      return {
        action: 'EXIT',
        fundingRate: currentRate,
        annualizedRate,
        predictedRate: currentRate,
        expectedProfit: 0,
        confidence: 70,
        reason: `펀딩비 약화 (연 ${Math.abs(annualizedRate).toFixed(1)}%)`,
      };
    }

    return {
      action: 'HOLD',
      fundingRate: currentRate,
      annualizedRate,
      predictedRate: currentRate,
      expectedProfit: this.calculateExpectedProfit(currentRate, currentPrice),
      confidence: 60,
      reason: `포지션 유지 중 (${holdingHours.toFixed(1)}h, 펀딩비 ${(currentRate * 100).toFixed(4)}%)`,
    };
  }

  private checkFundingConsistency(): number {
    if (this.fundingRateHistory.length < 3) return 0;

    const recent = this.fundingRateHistory.slice(-6);
    const positiveCount = recent.filter((r) => r.rate > 0).length;
    const negativeCount = recent.filter((r) => r.rate < 0).length;

    return Math.max(positiveCount, negativeCount) / recent.length;
  }

  private calculateExpectedProfit(fundingRate: number, price: number): number {
    // 펀딩비 × 포지션 크기 × 예상 수취 횟수
    const positionInCoins = this.fundingConfig.positionSize / price;
    const profitPerCycle = Math.abs(fundingRate) * this.fundingConfig.positionSize;
    return profitPerCycle * this.fundingConfig.minFundingCycles;
  }

  private resetPosition(): void {
    this.entryTimestamp = null;
    this.entryFundingRate = null;
  }
}
