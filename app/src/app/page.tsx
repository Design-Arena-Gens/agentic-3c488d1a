import Dashboard from "@/components/dashboard/dashboard";
import {
  getAggTrades,
  getDepth,
  getExchangeInfo,
  getKlines,
  getMarketInfo,
  getTicker,
} from "@/lib/pi42";
import { fetchApiDocumentation } from "@/lib/docs";
import type {
  CombinedContractMetrics,
  Pi42AggTrade,
  Pi42DepthResponse,
  Pi42Kline,
  Pi42Ticker,
} from "@/types/pi42";

type Summary = {
  totalContracts: number;
  markets: string[];
  totalQuoteVolume: number;
  totalBaseVolume: number;
  averageFundingRate: number;
  topMovers: CombinedContractMetrics[];
};

function toNumber(value?: string | number | null): number | undefined {
  if (value === null || value === undefined) return undefined;
  if (typeof value === "number") return value;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function computeCombinedContracts(
  contracts: CombinedContractMetrics[],
): CombinedContractMetrics[] {
  return contracts
    .filter((item) => item.marketStats)
    .sort((a, b) => (b.quoteVolume ?? 0) - (a.quoteVolume ?? 0));
}

function summarise(
  contracts: CombinedContractMetrics[],
  markets: string[],
): Summary {
  const totalQuoteVolume = contracts.reduce(
    (acc, item) => acc + (item.quoteVolume ?? 0),
    0,
  );
  const totalBaseVolume = contracts.reduce(
    (acc, item) => acc + (item.baseVolume ?? 0),
    0,
  );
  const averageFundingRate =
    contracts.length > 0
      ? contracts.reduce((acc, item) => acc + (item.fundingRateBps ?? 0), 0) /
        contracts.length
      : 0;
  const topMovers = [...contracts]
    .filter((item) => typeof item.priceChangePercent === "number")
    .sort(
      (a, b) =>
        Math.abs(b.priceChangePercent ?? 0) -
        Math.abs(a.priceChangePercent ?? 0),
    )
    .slice(0, 6);

  return {
    totalContracts: contracts.length,
    markets,
    totalQuoteVolume,
    totalBaseVolume,
    averageFundingRate,
    topMovers,
  };
}

export default async function Home() {
  const [exchangeInfo, marketInfo, endpoints] = await Promise.all([
    getExchangeInfo(),
    getMarketInfo(),
    fetchApiDocumentation(),
  ]);

  const combinedContracts = computeCombinedContracts(
    exchangeInfo.contracts.map((contract) => {
      const stats = marketInfo[contract.name];
      const lastPrice = toNumber(stats?.lastPrice ?? stats?.marketPrice);
      const markPrice = toNumber(stats?.marketPrice);
      const priceChangePercent = toNumber(stats?.priceChangePercent);
      const baseVolume = toNumber(stats?.baseAssetVolume);
      const quoteVolume = toNumber(stats?.quoteAssetVolume);
      const fundingRate =
        stats?.upcomingFundingRate !== undefined
          ? Number(stats.upcomingFundingRate) * 10000
          : undefined;
      return {
        contract,
        marketStats: stats,
        market: contract.market ?? "Unknown",
        lastPrice,
        markPrice,
        priceChangePercent,
        baseVolume,
        quoteVolume,
        fundingRateBps: fundingRate,
      } satisfies CombinedContractMetrics;
    }),
  );

  const summary = summarise(combinedContracts, exchangeInfo.markets);
  const primaryContract =
    combinedContracts.find((item) => item.contract.isDefaultContract) ??
    combinedContracts[0];

  let initialTicker: Pi42Ticker | null = null;
  let initialDepth: Pi42DepthResponse | null = null;
  let initialTrades: Pi42AggTrade[] = [];
  let initialKlines: Pi42Kline[] = [];

  if (primaryContract) {
    const symbol = primaryContract.contract.name;
    try {
      [initialTicker, initialDepth, initialTrades, initialKlines] =
        await Promise.all([
          getTicker(symbol),
          getDepth(symbol),
          getAggTrades(symbol),
          getKlines({ pair: symbol, interval: "1h", limit: 180 }),
        ]);
    } catch (error) {
      console.error("Failed to fetch initial market data", error);
    }
  }

  return (
    <main className="relative min-h-screen overflow-hidden pb-32">
      <div className="absolute inset-0 -z-10 bg-[radial-gradient(circle_at_top,_rgba(59,130,246,0.12),_transparent_55%)]" />
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-8 px-4 pt-16 sm:px-6 lg:px-8">
        <Dashboard
          contracts={combinedContracts}
          summary={summary}
          endpoints={endpoints}
          initialSnapshot={{
            contract: primaryContract?.contract.name ?? null,
            ticker: initialTicker,
            depth: initialDepth,
            trades: initialTrades,
            klines: initialKlines,
          }}
        />
      </div>
    </main>
  );
}
