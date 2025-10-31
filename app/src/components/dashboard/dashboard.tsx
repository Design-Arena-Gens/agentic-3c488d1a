"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import dayjs from "dayjs";
import { io, type Socket } from "socket.io-client";
import {
  ResponsiveContainer,
  AreaChart,
  CartesianGrid,
  Area,
  XAxis,
  YAxis,
  Tooltip,
} from "recharts";
import {
  CandlestickSeries,
  ColorType,
  createChart,
  type IChartApi,
  type ISeriesApi,
  type CandlestickData,
  type UTCTimestamp,
} from "lightweight-charts";

import type {
  CombinedContractMetrics,
  EndpointDescriptor,
  Pi42AggTrade,
  Pi42DepthResponse,
  Pi42Kline,
  Pi42Ticker,
} from "@/types/pi42";

type InitialSnapshot = {
  contract: string | null;
  ticker: Pi42Ticker | null;
  depth: Pi42DepthResponse | null;
  trades: Pi42AggTrade[];
  klines: Pi42Kline[];
};

type DashboardProps = {
  contracts: CombinedContractMetrics[];
  summary: {
    totalContracts: number;
    markets: string[];
    totalQuoteVolume: number;
    totalBaseVolume: number;
    averageFundingRate: number;
    topMovers: CombinedContractMetrics[];
  };
  endpoints: EndpointDescriptor[];
  initialSnapshot: InitialSnapshot;
};

type MarketBundle = {
  ticker: Pi42Ticker | null;
  depth: Pi42DepthResponse | null;
  trades: Pi42AggTrade[];
  klines: Pi42Kline[];
};

type HttpMethod = "GET" | "POST" | "PUT" | "DELETE" | "PATCH";

const intervalOptions = [
  { label: "1m", value: "1m" },
  { label: "5m", value: "5m" },
  { label: "15m", value: "15m" },
  { label: "1h", value: "1h" },
  { label: "4h", value: "4h" },
  { label: "1d", value: "1d" },
];

const numberFormatter = new Intl.NumberFormat("en-IN", {
  notation: "compact",
  maximumFractionDigits: 2,
});

const priceFormatter = (value?: number) =>
  value !== undefined ? value.toLocaleString("en-IN", { maximumFractionDigits: 2 }) : "—";
const percentFormatter = (value?: number) =>
  value !== undefined ? `${value >= 0 ? "+" : ""}${value.toFixed(2)}%` : "—";
const fundingFormatter = (value?: number) =>
  value !== undefined ? `${value >= 0 ? "+" : ""}${value.toFixed(2)} bps` : "—";

async function proxyRequest<T>(payload: {
  method: HttpMethod;
  path: string;
  target?: "public" | "private";
  query?: Record<string, string | number | boolean | undefined>;
  body?: unknown;
  headers?: Record<string, string>;
}): Promise<T | null> {
  const res = await fetch("/api/pi42", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const detail = await res.json().catch(() => ({}));
    throw new Error(detail?.error ?? `Request failed with ${res.status}`);
  }

  const json = await res.json();
  return (json?.data as T) ?? null;
}

async function fetchMarketBundle(
  symbol: string,
  interval: string,
): Promise<MarketBundle> {
  const [ticker, depth, trades, klines] = await Promise.all([
    proxyRequest<{ data: Pi42Ticker }>({
      method: "GET",
      path: `/v1/market/ticker24Hr/${symbol}`,
    }),
    proxyRequest<{ data: Pi42DepthResponse }>({
      method: "GET",
      path: `/v1/market/depth/${symbol}`,
    }),
    proxyRequest<{ data: Pi42AggTrade[] }>({
      method: "GET",
      path: `/v1/market/aggTrade/${symbol}`,
    }),
    proxyRequest<Pi42Kline[]>({
      method: "POST",
      path: "/v1/market/klines",
      body: { pair: symbol, interval, limit: 400 },
    }),
  ]);

  return {
    ticker: ticker?.data ?? null,
    depth: depth?.data ?? null,
    trades: trades?.data?.slice(-120) ?? [],
    klines: klines ?? [],
  };
}

type DepthPoint = {
  price: number;
  bidLiquidity: number;
  askLiquidity: number;
};

function buildDepthSeries(depth: Pi42DepthResponse | null): DepthPoint[] {
  if (!depth) return [];

  const depthMap = new Map<number, DepthPoint>();
  let cumulativeBid = 0;
  depth.b.slice(0, 20).forEach(([price, qty]) => {
    cumulativeBid += Number(qty);
    const key = Number(price);
    const existing = depthMap.get(key) ?? {
      price: key,
      bidLiquidity: 0,
      askLiquidity: 0,
    };
    existing.bidLiquidity = cumulativeBid;
    depthMap.set(key, existing);
  });

  let cumulativeAsk = 0;
  depth.a.slice(0, 20).forEach(([price, qty]) => {
    cumulativeAsk += Number(qty);
    const key = Number(price);
    const existing = depthMap.get(key) ?? {
      price: key,
      bidLiquidity: 0,
      askLiquidity: 0,
    };
    existing.askLiquidity = cumulativeAsk;
    depthMap.set(key, existing);
  });

  return Array.from(depthMap.values()).sort((a, b) => a.price - b.price);
}

function transformKlines(klines: Pi42Kline[]): CandlestickData[] {
  return klines.map((kline) => ({
    time: (Number(kline.startTime) / 1000) as UTCTimestamp,
    open: Number(kline.open),
    high: Number(kline.high),
    low: Number(kline.low),
    close: Number(kline.close),
  }));
}

function CandleChart({ klines }: { klines: Pi42Kline[] }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<"Candlestick"> | null>(null);

  useEffect(() => {
    if (!containerRef.current) return;

    const chart = createChart(containerRef.current, {
      layout: {
        background: { type: ColorType.Solid, color: "transparent" },
        textColor: "rgba(226,232,240,0.85)",
      },
      rightPriceScale: {
        borderVisible: false,
      },
      timeScale: {
        borderVisible: false,
        timeVisible: true,
      },
      grid: {
        horzLines: {
          color: "rgba(148,163,184,0.14)",
        },
        vertLines: {
          color: "rgba(148,163,184,0.08)",
        },
      },
      autoSize: true,
    });

    const candleSeries = chart.addSeries(CandlestickSeries, {
      upColor: "#22c55e",
      borderUpColor: "#22c55e",
      wickUpColor: "#22c55e",
      downColor: "#ef4444",
      borderDownColor: "#ef4444",
      wickDownColor: "#ef4444",
    });

    chartRef.current = chart;
    seriesRef.current = candleSeries;

    const observer = new ResizeObserver(() => {
      chart.timeScale().fitContent();
    });

    observer.observe(containerRef.current);

    return () => {
      observer.disconnect();
      chart.remove();
    };
  }, []);

  useEffect(() => {
    if (!seriesRef.current) return;
    const transformed = transformKlines(klines);
    seriesRef.current.setData(transformed);
    chartRef.current?.timeScale().fitContent();
  }, [klines]);

  return <div ref={containerRef} className="h-[320px] w-full" />;
}

function DepthChart({ depth }: { depth: Pi42DepthResponse | null }) {
  const depthData = useMemo(() => buildDepthSeries(depth), [depth]);

  if (depthData.length === 0) {
    return (
      <div className="flex h-[260px] items-center justify-center rounded-xl border border-slate-800 bg-slate-900/30">
        <p className="text-sm text-slate-400">No depth snapshot available.</p>
      </div>
    );
  }

  return (
    <div className="h-[260px] overflow-hidden rounded-xl border border-slate-800 bg-slate-900/30 p-4">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={depthData}>
          <CartesianGrid strokeDasharray="3 3" stroke="rgba(148,163,184,0.1)" />
          <XAxis
            dataKey="price"
            tickFormatter={(value) =>
              Number(value).toLocaleString("en-IN", {
                maximumFractionDigits: 0,
              })
            }
            stroke="rgba(226,232,240,0.65)"
          />
          <YAxis
            tickFormatter={(value) => numberFormatter.format(Number(value))}
            stroke="rgba(226,232,240,0.65)"
          />
          <Tooltip
            contentStyle={{ background: "#0f172a", borderRadius: 12, border: "1px solid #1e293b" }}
            labelFormatter={(label) =>
              `Price: ${Number(label).toLocaleString("en-IN", {
                maximumFractionDigits: 0,
              })}`
            }
            formatter={(value: number, name) => [
              `${numberFormatter.format(value)} ${name === "Bid Depth" ? "bid" : "ask"}`,
              name,
            ]}
          />
          <Area
            type="monotone"
            dataKey="bidLiquidity"
            stroke="#22c55e"
            fill="url(#bidGradient)"
            connectNulls
            isAnimationActive={false}
            dot={false}
            name="Bid Depth"
          />
          <defs>
            <linearGradient id="bidGradient" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor="#22c55e" stopOpacity={0.28} />
              <stop offset="95%" stopColor="#22c55e" stopOpacity={0} />
            </linearGradient>
            <linearGradient id="askGradient" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor="#ef4444" stopOpacity={0.28} />
              <stop offset="95%" stopColor="#ef4444" stopOpacity={0} />
            </linearGradient>
          </defs>
          <Area
            type="monotone"
            dataKey="askLiquidity"
            stroke="#ef4444"
            fill="url(#askGradient)"
            connectNulls
            isAnimationActive={false}
            dot={false}
            name="Ask Depth"
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

function TradesTable({ trades }: { trades: Pi42AggTrade[] }) {
  return (
    <div className="h-[260px] overflow-hidden rounded-xl border border-slate-800 bg-slate-900/30">
      <div className="flex items-center justify-between border-b border-slate-800 px-4 py-3">
        <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-200">
          Latest Trades
        </h3>
        <span className="text-xs text-slate-400">
          {trades.length ? `${trades.length.toLocaleString()} events` : "No trades"}
        </span>
      </div>
      <div className="h-[210px] overflow-y-auto">
        <table className="min-w-full text-sm">
          <thead className="sticky top-0 bg-slate-950/80 backdrop-blur">
            <tr className="text-xs uppercase tracking-wide text-slate-400">
              <th className="px-4 py-2 text-left font-medium">Time</th>
              <th className="px-4 py-2 text-right font-medium">Price</th>
              <th className="px-4 py-2 text-right font-medium">Size</th>
            </tr>
          </thead>
          <tbody>
            {trades.slice(-100).reverse().map((trade) => (
              <tr
                key={trade.a}
                className={`border-t border-slate-800/60 ${
                  trade.m ? "bg-red-500/5 text-red-300" : "bg-emerald-500/5 text-emerald-200"
                }`}
              >
                <td className="px-4 py-2 text-xs text-slate-300">
                  {dayjs(trade.T).format("HH:mm:ss")}
                </td>
                <td className="px-4 py-2 text-right">
                  {Number(trade.p).toLocaleString("en-IN")}
                </td>
                <td className="px-4 py-2 text-right">
                  {Number(trade.q).toLocaleString("en-IN", { maximumFractionDigits: 4 })}
                </td>
              </tr>
            ))}
            {trades.length === 0 && (
              <tr>
                <td colSpan={3} className="px-4 py-6 text-center text-slate-400">
                  Awaiting trade stream...
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function StatsGrid({
  summary,
}: {
  summary: DashboardProps["summary"];
}) {
  return (
    <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
      <div className="rounded-2xl border border-slate-800 bg-slate-900/40 p-5 shadow-lg shadow-blue-500/10">
        <p className="text-xs font-medium uppercase tracking-wide text-slate-400">
          Total Contracts
        </p>
        <p className="mt-2 text-3xl font-semibold text-slate-100">
          {summary.totalContracts.toLocaleString()}
        </p>
        <p className="mt-3 text-xs text-slate-400">
          Markets: {summary.markets.join(", ")}
        </p>
      </div>
      <div className="rounded-2xl border border-slate-800 bg-slate-900/40 p-5 shadow-lg shadow-emerald-500/10">
        <p className="text-xs font-medium uppercase tracking-wide text-slate-400">
          24h Quote Volume
        </p>
        <p className="mt-2 text-3xl font-semibold text-emerald-300">
          ₹{numberFormatter.format(summary.totalQuoteVolume)}
        </p>
        <p className="mt-3 text-xs text-slate-400">
          Base units traded: {numberFormatter.format(summary.totalBaseVolume)}
        </p>
      </div>
      <div className="rounded-2xl border border-slate-800 bg-slate-900/40 p-5 shadow-lg shadow-purple-500/10">
        <p className="text-xs font-medium uppercase tracking-wide text-slate-400">
          Avg Funding (Next)
        </p>
        <p className="mt-2 text-3xl font-semibold text-purple-300">
          {summary.averageFundingRate.toFixed(2)} bps
        </p>
        <p className="mt-3 text-xs text-slate-400">
          Upcoming cycle: every 8 hours across all perpetual pairs.
        </p>
      </div>
      <div className="rounded-2xl border border-slate-800 bg-slate-900/40 p-5 shadow-lg shadow-amber-500/10">
        <p className="text-xs font-medium uppercase tracking-wide text-slate-400">
          Top Movers
        </p>
        <div className="mt-2 flex flex-wrap gap-2 text-sm">
          {summary.topMovers.map((item) => (
            <span
              key={item.contract.name}
              className={`rounded-full px-3 py-1 text-xs font-medium ${
                (item.priceChangePercent ?? 0) >= 0
                  ? "bg-emerald-500/20 text-emerald-200"
                  : "bg-red-500/20 text-red-200"
              }`}
            >
              {item.contract.name}: {percentFormatter(item.priceChangePercent)}
            </span>
          ))}
        </div>
      </div>
    </section>
  );
}

function ContractsTable({
  contracts,
  selected,
  onSelect,
}: {
  contracts: CombinedContractMetrics[];
  selected?: string;
  onSelect: (symbol: string) => void;
}) {
  const [query, setQuery] = useState("");

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return contracts;
    return contracts.filter((item) => {
      const haystack = [
        item.contract.name,
        item.contract.contractName,
        ...(item.contract.tags ?? []),
      ]
        .join(" ")
        .toLowerCase();
      return haystack.includes(q);
    });
  }, [contracts, query]);

  return (
    <section className="rounded-2xl border border-slate-800 bg-slate-900/30">
      <div className="flex flex-col gap-4 border-b border-slate-800 px-6 py-5 md:flex-row md:items-center md:justify-between">
        <div>
          <h2 className="text-lg font-semibold text-slate-100">Market Scanner</h2>
          <p className="text-sm text-slate-400">
            Compare liquidity, volatility and funding across Pi42 perpetuals.
          </p>
        </div>
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search symbol, asset or tag"
          className="w-full rounded-full border border-slate-700 bg-slate-950 px-4 py-2 text-sm text-slate-200 placeholder:text-slate-500 focus:border-blue-500 focus:outline-none md:w-72"
        />
      </div>
      <div className="overflow-x-auto">
        <table className="min-w-full divide-y divide-slate-800 text-sm text-slate-200">
          <thead className="text-xs uppercase tracking-wide text-slate-400">
            <tr>
              <th className="px-6 py-3 text-left font-medium">Contract</th>
              <th className="px-6 py-3 text-right font-medium">Last</th>
              <th className="px-6 py-3 text-right font-medium">Δ 24h</th>
              <th className="px-6 py-3 text-right font-medium">Quote Vol</th>
              <th className="px-6 py-3 text-right font-medium">Funding</th>
              <th className="px-6 py-3 text-right font-medium">Max Lev</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-900/70">
            {filtered.map((item) => {
              const isSelected = item.contract.name === selected;
              return (
                <tr
                  key={item.contract.name}
                  className={`cursor-pointer transition-colors ${
                    isSelected ? "bg-blue-500/10" : "hover:bg-slate-800/40"
                  }`}
                  onClick={() => onSelect(item.contract.name)}
                >
                  <td className="px-6 py-4">
                    <div className="flex flex-col">
                      <span className="font-semibold text-slate-100">
                        {item.contract.name}
                      </span>
                      <span className="text-xs text-slate-400">
                        {item.contract.contractName}
                      </span>
                      <span className="mt-1 flex flex-wrap gap-1 text-[10px] uppercase text-slate-500">
                        {(item.contract.tags ?? []).slice(0, 3).map((tag) => (
                          <span
                            key={tag}
                            className="rounded-full bg-slate-800/60 px-2 py-1"
                          >
                            {tag}
                          </span>
                        ))}
                      </span>
                    </div>
                  </td>
                  <td className="px-6 py-4 text-right">
                    ₹{priceFormatter(item.lastPrice)}
                  </td>
                  <td
                    className={`px-6 py-4 text-right ${
                      (item.priceChangePercent ?? 0) >= 0
                        ? "text-emerald-300"
                        : "text-red-300"
                    }`}
                  >
                    {percentFormatter(item.priceChangePercent)}
                  </td>
                  <td className="px-6 py-4 text-right">
                    ₹{numberFormatter.format(item.quoteVolume ?? 0)}
                  </td>
                  <td className="px-6 py-4 text-right">
                    {fundingFormatter(item.fundingRateBps)}
                  </td>
                  <td className="px-6 py-4 text-right text-slate-300">
                    ×{item.contract.maxLeverage ?? "—"}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function MarketHeader({
  contract,
  ticker,
  loading,
  onIntervalChange,
  interval,
  socketConnected,
}: {
  contract: CombinedContractMetrics;
  ticker: Pi42Ticker | null;
  loading: boolean;
  onIntervalChange: (interval: string) => void;
  interval: string;
  socketConnected: boolean;
}) {
  const change = ticker ? Number(ticker.P) : contract.priceChangePercent ?? 0;
  const last = ticker ? Number(ticker.c) : contract.lastPrice ?? 0;
  const volume = ticker ? Number(ticker.q) : contract.quoteVolume ?? 0;
  return (
    <div className="flex flex-col gap-4 rounded-2xl border border-slate-800 bg-slate-900/30 p-6 md:flex-row md:items-center md:justify-between">
      <div>
        <div className="flex items-center gap-3">
          <div className="flex h-12 w-12 items-center justify-center rounded-full border border-slate-700 bg-slate-900">
            <span className="text-lg font-semibold text-slate-200">
              {contract.contract.baseAsset}
            </span>
          </div>
          <div>
            <h2 className="flex items-center gap-3 text-2xl font-semibold text-slate-100">
              {contract.contract.name}
              <span className="rounded-full border border-emerald-500/60 bg-emerald-500/10 px-2 py-1 text-xs font-medium uppercase text-emerald-200">
                {contract.contract.contractType}
              </span>
            </h2>
            <p className="text-sm text-slate-400">
              {contract.contract.contractName} • Max leverage ×
              {contract.contract.maxLeverage ?? "—"} • Depth grouping{" "}
              {(contract.contract.depthGrouping ?? [])[0] ?? "n/a"}
            </p>
          </div>
        </div>
        <div className="mt-4 flex flex-wrap items-end gap-6 text-slate-100">
          <div>
            <p className="text-xs uppercase tracking-wide text-slate-400">
              Mark (INR)
            </p>
            <p className="text-3xl font-semibold">₹{last.toLocaleString("en-IN")}</p>
          </div>
          <div>
            <p className="text-xs uppercase tracking-wide text-slate-400">
              24h Change
            </p>
            <p className={`text-xl font-medium ${change >= 0 ? "text-emerald-300" : "text-red-300"}`}>
              {change >= 0 ? "+" : ""}
              {change.toFixed(2)}%
            </p>
          </div>
          <div>
            <p className="text-xs uppercase tracking-wide text-slate-400">
              Notional Volume
            </p>
            <p className="text-xl font-medium text-slate-200">
              ₹{numberFormatter.format(volume)}
            </p>
          </div>
          <div>
            <p className="text-xs uppercase tracking-wide text-slate-400">
              Funding Next
            </p>
            <p className="text-xl font-medium text-purple-300">
              {fundingFormatter(contract.fundingRateBps)}
            </p>
          </div>
        </div>
      </div>
      <div className="flex flex-col items-end gap-3">
        <div className="flex items-center gap-2">
          <span
            className={`flex h-2.5 w-2.5 items-center justify-center rounded-full ${
              socketConnected ? "bg-emerald-400" : "bg-slate-500"
            }`}
          />
          <span className="text-xs uppercase tracking-wide text-slate-400">
            {socketConnected ? "Realtime Stream" : "Socket reconnecting"}
          </span>
        </div>
        <div className="flex gap-2">
          {intervalOptions.map((option) => (
            <button
              key={option.value}
              onClick={() => onIntervalChange(option.value)}
              className={`rounded-full px-3 py-1 text-xs font-semibold transition ${
                interval === option.value
                  ? "bg-blue-500/80 text-white"
                  : "bg-slate-800/60 text-slate-300 hover:bg-slate-700/60"
              }`}
            >
              {option.label}
            </button>
          ))}
        </div>
        {loading && (
          <span className="text-xs text-slate-400">Refreshing snapshot…</span>
        )}
      </div>
    </div>
  );
}

function ApiExplorer({
  endpoints,
}: {
  endpoints: EndpointDescriptor[];
}) {
  const [selected, setSelected] = useState<EndpointDescriptor | null>(null);
  const [method, setMethod] = useState<HttpMethod>("GET");
  const [path, setPath] = useState<string>("/v1/market/ticker24Hr/BTCINR");
  const [target, setTarget] = useState<"public" | "private">("public");
  const [query, setQuery] = useState<string>("{}");
  const [body, setBody] = useState<string>("{}");
  const [headers, setHeaders] = useState<string>("{}");
  const [response, setResponse] = useState<string>("");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return endpoints;
    return endpoints.filter((endpoint) => {
      const haystack = [endpoint.method, endpoint.path, endpoint.section, endpoint.description]
        .join(" ")
        .toLowerCase();
      return haystack.includes(q);
    });
  }, [endpoints, search]);

  useEffect(() => {
    if (!selected) return;
    const nextMethod = (selected.method?.toUpperCase() as HttpMethod) ?? "GET";
    setMethod(nextMethod);
    setPath(selected.path);
    if (selected.method === "POST") {
      setBody(
        JSON.stringify(
          { pair: "BTCINR", interval: "1h", limit: 50 },
          null,
          2,
        ),
      );
    }
  }, [selected]);

  async function execute() {
    setIsLoading(true);
    setError(null);
    try {
      const queryPayload =
        query.trim() === "" ? {} : (JSON.parse(query) as Record<string, unknown>);
      const bodyPayload =
        body.trim() === "" || method === "GET"
          ? undefined
          : (JSON.parse(body) as Record<string, unknown>);
      const headersPayload =
        headers.trim() === "" ? {} : (JSON.parse(headers) as Record<string, string>);

      const res = await proxyRequest<unknown>({
        method,
        path,
        target,
        query: queryPayload as Record<string, string | number | boolean | undefined>,
        body: bodyPayload,
        headers: headersPayload,
      });

      setResponse(JSON.stringify(res, null, 2));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <section className="grid gap-6 rounded-2xl border border-slate-800 bg-slate-900/30 p-6 lg:grid-cols-[320px,1fr]">
      <div className="flex flex-col gap-4">
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-semibold text-slate-100">API Explorer</h3>
        </div>
        <input
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Filter endpoints"
          className="rounded-full border border-slate-700 bg-slate-950 px-4 py-2 text-sm text-slate-200 placeholder:text-slate-500 focus:border-blue-500 focus:outline-none"
        />
        <div className="h-[420px] overflow-y-auto rounded-xl border border-slate-800/70 bg-slate-950/40">
          {filtered.map((endpoint) => (
            <button
              key={endpoint.id}
              className={`w-full border-b border-slate-900 px-4 py-3 text-left text-xs transition ${
                selected?.id === endpoint.id ? "bg-blue-500/20" : "hover:bg-slate-800/40"
              }`}
              onClick={() => setSelected(endpoint)}
            >
              <span
                className={`mr-2 inline-flex min-w-[48px] justify-center rounded-full px-2 py-1 text-[10px] font-semibold uppercase ${
                  endpoint.method === "GET"
                    ? "bg-emerald-500/20 text-emerald-200"
                    : endpoint.method === "POST"
                      ? "bg-blue-500/20 text-blue-200"
                      : "bg-purple-500/20 text-purple-200"
                }`}
              >
                {endpoint.method}
              </span>
              <span className="font-mono text-[11px] text-slate-200">{endpoint.path}</span>
              {endpoint.description && (
                <p className="mt-1 text-[10px] text-slate-400 line-clamp-2">
                  {endpoint.description}
                </p>
              )}
            </button>
          ))}
        </div>
      </div>
      <div className="flex flex-col gap-4">
        <div className="grid gap-4 md:grid-cols-2">
          <label className="flex flex-col gap-2 text-xs uppercase tracking-wide text-slate-400">
            Method
            <select
              value={method}
              onChange={(event) => setMethod(event.target.value as HttpMethod)}
              className="rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-200 focus:border-blue-500 focus:outline-none"
            >
              {["GET", "POST", "PUT", "DELETE", "PATCH"].map((mth) => (
                <option key={mth}>{mth}</option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-2 text-xs uppercase tracking-wide text-slate-400">
            Target Cluster
            <select
              value={target}
              onChange={(event) => setTarget(event.target.value as "public" | "private")}
              className="rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-200 focus:border-blue-500 focus:outline-none"
            >
              <option value="public">Public (api.pi42.com)</option>
              <option value="private">Authenticated (fapi.pi42.com)</option>
            </select>
          </label>
        </div>
        <label className="flex flex-col gap-2 text-xs uppercase tracking-wide text-slate-400">
          Path
          <input
            value={path}
            onChange={(event) => setPath(event.target.value)}
            className="rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 font-mono text-sm text-slate-200 focus:border-blue-500 focus:outline-none"
          />
        </label>
        <label className="flex flex-col gap-2 text-xs uppercase tracking-wide text-slate-400">
          Query (JSON)
          <textarea
            value={query}
            rows={3}
            onChange={(event) => setQuery(event.target.value)}
            className="rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 font-mono text-xs text-slate-200 focus:border-blue-500 focus:outline-none"
          />
        </label>
        {method !== "GET" && (
          <label className="flex flex-col gap-2 text-xs uppercase tracking-wide text-slate-400">
            Body (JSON)
            <textarea
              value={body}
              rows={4}
              onChange={(event) => setBody(event.target.value)}
              className="rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 font-mono text-xs text-slate-200 focus:border-blue-500 focus:outline-none"
            />
          </label>
        )}
        <label className="flex flex-col gap-2 text-xs uppercase tracking-wide text-slate-400">
          Headers (JSON)
          <textarea
            value={headers}
            rows={2}
            onChange={(event) => setHeaders(event.target.value)}
            className="rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 font-mono text-xs text-slate-200 focus:border-blue-500 focus:outline-none"
          />
        </label>
        <div className="flex items-center gap-3">
          <button
            onClick={execute}
            disabled={isLoading}
            className="rounded-full bg-blue-500 px-4 py-2 text-sm font-semibold text-white shadow-lg shadow-blue-500/25 transition hover:bg-blue-600 disabled:cursor-not-allowed disabled:bg-slate-700"
          >
            {isLoading ? "Executing…" : "Send Request"}
          </button>
          {error && <span className="text-xs text-red-400">{error}</span>}
        </div>
        <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-4">
          <p className="text-xs uppercase tracking-wide text-slate-400">Response</p>
          <pre className="mt-2 max-h-64 overflow-y-auto whitespace-pre-wrap break-all text-xs text-slate-200">
            {response || "Run a request to inspect output."}
          </pre>
        </div>
      </div>
    </section>
  );
}

export default function Dashboard({
  contracts,
  summary,
  endpoints,
  initialSnapshot,
}: DashboardProps) {
  const [selectedSymbol, setSelectedSymbol] = useState(
    initialSnapshot.contract ?? contracts[0]?.contract.name ?? "",
  );
  const [interval, setInterval] = useState("1h");
  const [ticker, setTicker] = useState<Pi42Ticker | null>(initialSnapshot.ticker);
  const [depth, setDepth] = useState<Pi42DepthResponse | null>(initialSnapshot.depth);
  const [trades, setTrades] = useState<Pi42AggTrade[]>(initialSnapshot.trades ?? []);
  const [klines, setKlines] = useState<Pi42Kline[]>(initialSnapshot.klines ?? []);
  const [loading, setLoading] = useState(false);
  const [socketConnected, setSocketConnected] = useState(false);
  const socketRef = useRef<Socket | null>(null);

  const selectedContract = useMemo(
    () => contracts.find((item) => item.contract.name === selectedSymbol) ?? contracts[0],
    [contracts, selectedSymbol],
  );

  const handleSymbolSelect = (symbol: string) => {
    if (symbol === selectedSymbol) return;
    setLoading(true);
    setSelectedSymbol(symbol);
  };

  const handleIntervalChange = (value: string) => {
    if (value === interval) return;
    setLoading(true);
    setInterval(value);
  };

  const contractName = selectedContract?.contract.name ?? "";

  useEffect(() => {
    if (!contractName) return;

    let cancelled = false;
    fetchMarketBundle(contractName, interval)
      .then((bundle) => {
        if (cancelled) return;
        setTicker(bundle.ticker);
        setDepth(bundle.depth);
        setTrades(bundle.trades);
        setKlines(bundle.klines);
      })
      .catch((error) => {
        console.error("Failed to refresh bundle", error);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [contractName, interval]);

  useEffect(() => {
    const socket = io("https://fawss.pi42.com/", {
      transports: ["websocket"],
    });

    socketRef.current = socket;

    socket.on("connect", () => setSocketConnected(true));
    socket.on("disconnect", () => setSocketConnected(false));
    socket.on("connect_error", () => setSocketConnected(false));

    return () => {
      socket.disconnect();
      socketRef.current = null;
    };
  }, []);

  const depthGroupingValue =
    selectedContract?.contract.depthGrouping?.[0]?.toString().replace(/\s+/g, "") ?? "0.1";
  const lowerSymbol = contractName.toLowerCase();

  useEffect(() => {
    const socket = socketRef.current;
    if (!socket || !lowerSymbol) return;

    const topics = [
      `${lowerSymbol}@depth_${depthGroupingValue}`,
      `${lowerSymbol}@aggTrade`,
      `${lowerSymbol}@ticker`,
      `${lowerSymbol}@kline_${interval}`,
    ];

    socket.emit("subscribe", { params: topics });

    const handleDepth = (payload: Pi42DepthResponse) => {
      setDepth(payload);
    };
    const handleTrade = (payload: Pi42AggTrade) => {
      setTrades((prev) => [...prev.slice(-180), payload]);
    };
    const handleTicker = (payload: Pi42Ticker) => {
      setTicker(payload);
    };
    const handleKline = (payload: { k: Pi42Kline }) => {
      if (!payload?.k) return;
      setKlines((prev) => {
        const next = [...prev];
        const index = next.findIndex((item) => item.startTime === payload.k.startTime);
        if (index >= 0) {
          next[index] = payload.k;
        } else {
          next.push(payload.k);
        }
        return next.slice(-400);
      });
    };

    socket.on("depthUpdate", handleDepth);
    socket.on("aggTrade", handleTrade);
    socket.on("24hrTicker", handleTicker);
    socket.on("kline", handleKline);

    return () => {
      socket.emit("unsubscribe", { params: topics });
      socket.off("depthUpdate", handleDepth);
      socket.off("aggTrade", handleTrade);
      socket.off("24hrTicker", handleTicker);
      socket.off("kline", handleKline);
    };
  }, [lowerSymbol, depthGroupingValue, interval]);

  if (!selectedContract) {
    return (
      <div className="rounded-2xl border border-slate-800 bg-slate-900/30 p-10 text-center text-slate-200">
        Unable to load contract metadata from Pi42.
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-8">
      <header className="flex flex-col gap-3">
        <span className="text-sm uppercase tracking-[0.4em] text-blue-300/80">
          Pi42 Quant Intelligence
        </span>
        <h1 className="text-4xl font-semibold text-slate-50">
          Institutional-grade telemetry for the Pi42 derivatives exchange
        </h1>
        <p className="max-w-3xl text-sm text-slate-400">
          Monitor funding, depth resilience, trade flow and candlestick structure in real-time.
          All data is sourced directly from the public Pi42 APIs documented at lightningnodes.github.io/slate.
        </p>
      </header>

      <StatsGrid summary={summary} />

      <ContractsTable
        contracts={contracts}
        selected={selectedContract.contract.name}
        onSelect={handleSymbolSelect}
      />

      <MarketHeader
        contract={selectedContract}
        ticker={ticker}
        loading={loading}
        onIntervalChange={handleIntervalChange}
        interval={interval}
        socketConnected={socketConnected}
      />

      <section className="grid gap-6 lg:grid-cols-2">
        <div className="rounded-2xl border border-slate-800 bg-slate-900/30 p-6">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-200">
              Market Structure
            </h3>
            <span className="text-xs text-slate-400">Interval {interval}</span>
          </div>
          <div className="mt-4">
            <CandleChart klines={klines} />
          </div>
        </div>
        <div className="flex flex-col gap-6">
          <DepthChart depth={depth} />
          <TradesTable trades={trades} />
        </div>
      </section>

      <ApiExplorer endpoints={endpoints} />
    </div>
  );
}
