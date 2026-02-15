import BotDetailClient from "./bot-detail-client";

// Required for Next.js static export (output: "export")
// Provides a placeholder path for build; actual bot pages render client-side
export function generateStaticParams() {
  return [{ id: "_" }];
}

export default function BotDetailPage() {
  return <BotDetailClient />;
}
