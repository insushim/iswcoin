import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import { QueryProvider } from "@/components/providers/query-provider";
import { SocketProvider } from "@/components/providers/socket-provider";
import { AuthGuard } from "@/components/providers/auth-guard";
import { AppShell } from "@/components/layout/app-shell";
import { ErrorBoundary } from "@/components/providers/error-boundary";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
  display: "swap",
});

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 5,
  themeColor: "#0f172a",
};

export const metadata: Metadata = {
  title: {
    default: "CryptoSentinel Pro - AI 트레이딩 대시보드",
    template: "%s | CryptoSentinel Pro",
  },
  description:
    "AI 기반 실시간 암호화폐 자동매매 시스템. 10가지 전략, 백테스트, 포트폴리오 관리를 제공합니다.",
  keywords: [
    "암호화폐",
    "자동매매",
    "트레이딩봇",
    "AI트레이딩",
    "비트코인",
    "백테스트",
    "포트폴리오",
  ],
  authors: [{ name: "CryptoSentinel" }],
  icons: {
    icon: "/favicon.svg",
  },
  openGraph: {
    type: "website",
    locale: "ko_KR",
    siteName: "CryptoSentinel Pro",
    title: "CryptoSentinel Pro - AI 트레이딩 대시보드",
    description:
      "AI 기반 실시간 암호화폐 자동매매 시스템. 10가지 전략, 백테스트, 포트폴리오 관리.",
  },
  twitter: {
    card: "summary_large_image",
    title: "CryptoSentinel Pro",
    description: "AI 기반 실시간 암호화폐 자동매매 시스템",
  },
  robots: {
    index: true,
    follow: true,
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="ko" className="dark">
      <body className={`${inter.variable} font-sans bg-slate-950 text-white antialiased`}>
        <ErrorBoundary>
          <QueryProvider>
            <SocketProvider>
              <AuthGuard>
                <AppShell>
                  {children}
                </AppShell>
              </AuthGuard>
            </SocketProvider>
          </QueryProvider>
        </ErrorBoundary>
      </body>
    </html>
  );
}
