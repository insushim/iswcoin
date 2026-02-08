import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";
import { format, formatDistanceToNow } from "date-fns";
import { ko } from "date-fns/locale";

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}

export function formatCurrency(
  value: number,
  currency: string = "USD",
  minimumFractionDigits: number = 2,
  maximumFractionDigits?: number
): string {
  const maxDigits = maximumFractionDigits ?? Math.max(minimumFractionDigits, 2);
  return new Intl.NumberFormat("ko-KR", {
    style: "currency",
    currency,
    minimumFractionDigits,
    maximumFractionDigits: maxDigits,
  }).format(value);
}

export function formatPercent(value: number, decimals: number = 2): string {
  const sign = value >= 0 ? "+" : "";
  return `${sign}${value.toFixed(decimals)}%`;
}

export function formatDate(date: string | number | Date, pattern: string = "yyyy.MM.dd HH:mm"): string {
  return format(new Date(date), pattern, { locale: ko });
}

export function formatRelativeTime(date: string | number | Date): string {
  return formatDistanceToNow(new Date(date), { addSuffix: true, locale: ko });
}

export function formatNumber(value: number, decimals: number = 2): string {
  if (Math.abs(value) >= 1_000_000_000_000) {
    return `${(value / 1_000_000_000_000).toFixed(decimals)}조`;
  }
  if (Math.abs(value) >= 100_000_000) {
    return `${(value / 100_000_000).toFixed(decimals)}억`;
  }
  if (Math.abs(value) >= 10_000) {
    return `${(value / 10_000).toFixed(decimals)}만`;
  }
  if (Math.abs(value) >= 1_000) {
    return `${(value / 1_000).toFixed(decimals)}K`;
  }
  return value.toFixed(decimals);
}

export function truncateAddress(address: string, chars: number = 4): string {
  return `${address.slice(0, chars + 2)}...${address.slice(-chars)}`;
}
