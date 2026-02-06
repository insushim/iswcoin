"use client";

import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Cell,
} from "recharts";
import { formatCurrency, formatDate } from "@/lib/utils";

interface PnLData {
  date: string;
  pnl: number;
}

interface PnLChartProps {
  data: PnLData[];
  height?: number;
}

interface TooltipPayload {
  active?: boolean;
  payload?: Array<{ value: number; payload: PnLData }>;
  label?: string;
}

function CustomTooltip({ active, payload, label }: TooltipPayload) {
  if (!active || !payload?.length) return null;

  const value = payload[0].value;
  const isPositive = value >= 0;

  return (
    <div className="rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 shadow-xl">
      <p className="text-xs text-slate-400">{label ? formatDate(label, "MMM dd, yyyy") : ""}</p>
      <p
        className={`text-sm font-semibold ${
          isPositive ? "text-emerald-400" : "text-red-400"
        }`}
      >
        {isPositive ? "+" : ""}
        {formatCurrency(value)}
      </p>
    </div>
  );
}

export function PnLChart({ data, height = 300 }: PnLChartProps) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={data} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="rgba(51, 65, 85, 0.3)" />
        <XAxis
          dataKey="date"
          tick={{ fill: "#64748b", fontSize: 11 }}
          tickLine={false}
          axisLine={{ stroke: "rgba(51, 65, 85, 0.5)" }}
          tickFormatter={(val: string) => formatDate(val, "MMM dd")}
        />
        <YAxis
          tick={{ fill: "#64748b", fontSize: 11 }}
          tickLine={false}
          axisLine={{ stroke: "rgba(51, 65, 85, 0.5)" }}
          tickFormatter={(val: number) => formatCurrency(val, "USD", 0, 0)}
          width={80}
        />
        <Tooltip content={<CustomTooltip />} />
        <Bar dataKey="pnl" radius={[4, 4, 0, 0]} maxBarSize={40}>
          {data.map((entry, index) => (
            <Cell
              key={`cell-${index}`}
              fill={entry.pnl >= 0 ? "#10b981" : "#ef4444"}
              fillOpacity={0.8}
            />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}
