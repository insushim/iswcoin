import { Router, type Response } from "express";
import { z } from "zod";
import { prisma } from "../db.js";
import {
  authMiddleware,
  type AuthenticatedRequest,
} from "../middleware/auth.js";
import {
  backtesterService,
  type BacktestConfig,
} from "../services/backtester.service.js";
import { exchangeService } from "../services/exchange.service.js";
import { indicatorsService } from "../services/indicators.service.js";
import { getStrategy, type StrategyType } from "../strategies/index.js";
import { logger } from "../utils/logger.js";
import ccxt from "ccxt";

const router = Router();

// 동시 백테스트 제한 (CPU 집약적 작업)
const MAX_CONCURRENT_BACKTESTS = 3;
let activeBacktests = 0;
const BACKTEST_TIMEOUT_MS = 120_000; // 2분

// ccxt 인스턴스 싱글턴
let backtestExchange: import("ccxt").Exchange | null = null;
function getBacktestExchange(): import("ccxt").Exchange {
  if (!backtestExchange) {
    backtestExchange = new ccxt.binance({ enableRateLimit: true });
  }
  return backtestExchange;
}

const runBacktestSchema = z.object({
  symbol: z.string().min(1),
  timeframe: z.string().default("1h"),
  startDate: z.string().optional(),
  endDate: z.string().optional(),
  initialCapital: z.number().min(100).default(10000),
  strategy: z.enum([
    "DCA",
    "GRID",
    "MOMENTUM",
    "MEAN_REVERSION",
    "TRAILING",
    "MARTINGALE",
    "RL_AGENT",
    "STAT_ARB",
    "SCALPING",
    "FUNDING_ARB",
    "ENSEMBLE",
  ]),
  strategyConfig: z.record(z.number()).optional(),
  slippagePct: z.number().min(0).max(0.1).default(0.0005),
  feePct: z.number().min(0).max(0.1).default(0.001),
  walkForwardSplit: z.number().min(0.5).max(0.9).default(0.7),
  botId: z.string().optional(),
  // 신규 옵션: 멀티포지션, 숏, 동적슬리피지, 데이터 양
  positionMode: z.enum(["single", "accumulate"]).default("single"),
  shortEnabled: z.boolean().default(false),
  maxPositionEntries: z.number().min(1).max(50).default(10),
  allocationPct: z.number().min(1).max(100).optional(),
  dynamicSlippage: z.boolean().default(false),
  maxCandles: z.number().min(100).max(10000).default(1000),
});

router.use(authMiddleware);

router.post(
  "/run",
  async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    try {
      const userId = req.user!.userId;
      const validation = runBacktestSchema.safeParse(req.body);

      if (!validation.success) {
        res
          .status(400)
          .json({
            error: "Validation failed",
            details: validation.error.errors,
          });
        return;
      }

      const params = validation.data;

      // 동시실행 제한 체크
      if (activeBacktests >= MAX_CONCURRENT_BACKTESTS) {
        res
          .status(429)
          .json({
            error: `백테스트 동시 실행 제한 (${MAX_CONCURRENT_BACKTESTS}개) 초과. 잠시 후 다시 시도하세요.`,
          });
        return;
      }
      activeBacktests++;

      logger.info("Starting backtest", {
        userId,
        symbol: params.symbol,
        strategy: params.strategy,
        positionMode: params.positionMode,
        shortEnabled: params.shortEnabled,
        maxCandles: params.maxCandles,
      });

      const exchange = getBacktestExchange();
      const since = params.startDate
        ? new Date(params.startDate).getTime()
        : undefined;
      const until = params.endDate
        ? new Date(params.endDate).getTime()
        : undefined;

      // 페이지네이션으로 대량 데이터 조회 (1000캔들 한계 돌파)
      let rawOhlcv: import("ccxt").OHLCV[];
      if (params.maxCandles > 1000) {
        rawOhlcv = await exchangeService.fetchPaginatedOHLCV(
          exchange,
          params.symbol,
          params.timeframe,
          since,
          until,
          params.maxCandles,
        );
      } else {
        rawOhlcv = await exchange.fetchOHLCV(
          params.symbol,
          params.timeframe,
          since,
          1000,
        );
      }

      if (rawOhlcv.length < 50) {
        res
          .status(400)
          .json({
            error: `데이터 부족: ${rawOhlcv.length}캔들 (최소 50개 필요)`,
          });
        return;
      }

      const ohlcvData = indicatorsService.parseOHLCV(
        rawOhlcv.map((c) => [
          c[0] ?? 0,
          c[1] ?? 0,
          c[2] ?? 0,
          c[3] ?? 0,
          c[4] ?? 0,
          c[5] ?? 0,
        ]),
      );

      const strategyType = params.strategy as StrategyType;

      const config: BacktestConfig = {
        symbol: params.symbol,
        timeframe: params.timeframe,
        startDate: params.startDate ?? new Date(rawOhlcv[0]![0]!).toISOString(),
        endDate:
          params.endDate ??
          new Date(rawOhlcv[rawOhlcv.length - 1]![0]!).toISOString(),
        initialCapital: params.initialCapital,
        strategy: params.strategy,
        strategyConfig:
          params.strategyConfig ?? getStrategy(strategyType).getDefaultConfig(),
        slippagePct: params.slippagePct,
        feePct: params.feePct,
        walkForwardSplit: params.walkForwardSplit,
        positionMode: params.positionMode,
        shortEnabled: params.shortEnabled,
        maxPositionEntries: params.maxPositionEntries,
        allocationPct: params.allocationPct,
        dynamicSlippage: params.dynamicSlippage,
      };

      // 타임아웃 적용
      const backtestPromise = backtesterService.runBacktest(
        config,
        ohlcvData,
        () => {
          const s = getStrategy(strategyType, params.strategyConfig);
          return (data, cfg) => s.analyze(data, cfg);
        },
      );

      const timeoutPromise = new Promise<never>((_, reject) =>
        setTimeout(
          () => reject(new Error("백테스트 타임아웃 (2분 초과)")),
          BACKTEST_TIMEOUT_MS,
        ),
      );

      const result = await Promise.race([backtestPromise, timeoutPromise]);

      const saved = await prisma.backtestResult.create({
        data: {
          userId,
          botId: params.botId ?? null,
          config: JSON.parse(JSON.stringify(config)),
          result: JSON.parse(
            JSON.stringify({
              metrics: result.metrics,
              tradeCount: result.trades.length,
              trades: result.trades.slice(0, 100),
              equityCurveLength: result.equityCurve.length,
              equityCurveSampled: sampleArray(result.equityCurve, 200),
              drawdownCurveSampled: sampleArray(result.drawdownCurve, 200),
              inSampleMetrics: result.inSampleMetrics,
              outOfSampleMetrics: result.outOfSampleMetrics,
            }),
          ),
        },
      });

      res.json({
        id: saved.id,
        config: {
          ...config,
          dataPoints: ohlcvData.length,
        },
        metrics: result.metrics,
        trades: result.trades.slice(0, 50),
        equityCurve: sampleArray(result.equityCurve, 200),
        drawdownCurve: sampleArray(result.drawdownCurve, 200),
        inSampleMetrics: result.inSampleMetrics,
        outOfSampleMetrics: result.outOfSampleMetrics,
      });
    } catch (err) {
      logger.error("Backtest failed", {
        error: String(err),
        stack: (err as Error).stack,
      });
      const message = String(err).includes("타임아웃")
        ? String(err)
        : "Backtest failed";
      res.status(500).json({ error: message });
    } finally {
      activeBacktests = Math.max(0, activeBacktests - 1);
    }
  },
);

router.get(
  "/results",
  async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    try {
      const userId = req.user!.userId;
      const page = Math.max(
        parseInt(String(req.query["page"] ?? "1"), 10) || 1,
        1,
      );
      const limit = Math.min(
        Math.max(parseInt(String(req.query["limit"] ?? "20"), 10) || 20, 1),
        100,
      );

      const [results, total] = await Promise.all([
        prisma.backtestResult.findMany({
          where: { userId },
          orderBy: { createdAt: "desc" },
          skip: (page - 1) * limit,
          take: limit,
          select: {
            id: true,
            botId: true,
            config: true,
            createdAt: true,
          },
        }),
        prisma.backtestResult.count({ where: { userId } }),
      ]);

      res.json({
        results,
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      });
    } catch (err) {
      logger.error("Failed to fetch backtest results", { error: String(err) });
      res.status(500).json({ error: "Failed to fetch backtest results" });
    }
  },
);

router.get(
  "/results/:id",
  async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    try {
      const userId = req.user!.userId;
      const resultId = req.params["id"];

      const result = await prisma.backtestResult.findFirst({
        where: { id: resultId, userId },
      });

      if (!result) {
        res.status(404).json({ error: "Backtest result not found" });
        return;
      }

      res.json({ result });
    } catch (err) {
      logger.error("Failed to fetch backtest result", { error: String(err) });
      res.status(500).json({ error: "Failed to fetch backtest result" });
    }
  },
);

function sampleArray<T>(arr: T[], maxSamples: number): T[] {
  if (arr.length <= maxSamples) return arr;
  const step = arr.length / maxSamples;
  const sampled: T[] = [];
  for (let i = 0; i < maxSamples; i++) {
    const index = Math.min(Math.floor(i * step), arr.length - 1);
    sampled.push(arr[index]!);
  }
  if (sampled[sampled.length - 1] !== arr[arr.length - 1]) {
    sampled.push(arr[arr.length - 1]!);
  }
  return sampled;
}

export default router;
