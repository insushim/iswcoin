"use client";

import { usePathname } from "next/navigation";
import { Sidebar } from "@/components/layout/sidebar";
import { Header } from "@/components/layout/header";

const PUBLIC_PATHS = ["/login", "/register"];

function isPublicPath(path: string): boolean {
  const normalized = path.endsWith("/") && path !== "/" ? path.slice(0, -1) : path;
  return PUBLIC_PATHS.includes(normalized);
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const isPublic = isPublicPath(pathname);

  if (isPublic) {
    return <>{children}</>;
  }

  return (
    <div className="flex h-screen overflow-hidden">
      <Sidebar />
      <div className="flex flex-1 flex-col overflow-hidden ml-60">
        <Header />
        <main role="main" className="flex-1 overflow-y-auto p-6">
          {children}
        </main>
      </div>
    </div>
  );
}
