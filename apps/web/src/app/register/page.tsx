"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { useAuthStore } from "@/stores/auth.store";
import { Zap, UserPlus } from "lucide-react";

export default function RegisterPage() {
  const router = useRouter();
  const { register, isLoading, error, clearError } = useAuthStore();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [formError, setFormError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);
    clearError();

    if (!name.trim()) {
      setFormError("이름을 입력해주세요");
      return;
    }
    if (!email.trim()) {
      setFormError("이메일을 입력해주세요");
      return;
    }
    if (!password) {
      setFormError("비밀번호를 입력해주세요");
      return;
    }
    if (password.length < 8) {
      setFormError("비밀번호는 최소 8자 이상이어야 합니다");
      return;
    }
    if (password !== confirmPassword) {
      setFormError("비밀번호가 일치하지 않습니다");
      return;
    }

    try {
      await register(name, email, password);
      router.push("/");
    } catch {
      // Error is handled by the store
    }
  };

  const displayError = formError || error;

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-950 px-4">
      <div className="w-full max-w-md">
        {/* Logo */}
        <div className="mb-8 text-center">
          <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-emerald-600 shadow-lg shadow-emerald-900/30">
            <Zap className="h-8 w-8 text-white" />
          </div>
          <h1 className="text-2xl font-bold text-white">CryptoSentinel Pro</h1>
          <p className="mt-2 text-sm text-slate-400">
            계정을 만들어 트레이딩을 시작하세요
          </p>
        </div>

        {/* Form */}
        <div className="rounded-xl border border-slate-800 bg-slate-900/50 p-6 backdrop-blur-sm">
          <form onSubmit={handleSubmit} className="space-y-4">
            {displayError && (
              <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-400">
                {displayError}
              </div>
            )}

            <Input
              label="이름"
              type="text"
              placeholder="이름을 입력하세요"
              value={name}
              onChange={(e) => setName(e.target.value)}
              autoComplete="name"
            />

            <Input
              label="이메일"
              type="email"
              placeholder="trader@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="email"
            />

            <Input
              label="비밀번호"
              type="password"
              placeholder="최소 8자 이상"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="new-password"
            />

            <Input
              label="비밀번호 확인"
              type="password"
              placeholder="비밀번호를 다시 입력하세요"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              autoComplete="new-password"
            />

            <Button
              type="submit"
              variant="primary"
              className="w-full"
              size="lg"
              isLoading={isLoading}
              leftIcon={<UserPlus className="h-4 w-4" />}
            >
              계정 생성
            </Button>
          </form>

          <div className="mt-6 text-center">
            <p className="text-sm text-slate-400">
              이미 계정이 있으신가요?{" "}
              <Link
                href="/login"
                className="font-medium text-emerald-400 hover:text-emerald-300 transition-colors"
              >
                로그인
              </Link>
            </p>
          </div>
        </div>

        <p className="mt-6 text-center text-xs text-slate-600">
          계정 생성 시 서비스 이용약관 및 개인정보 처리방침에 동의하게 됩니다
        </p>
      </div>
    </div>
  );
}
