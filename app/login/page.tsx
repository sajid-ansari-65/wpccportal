"use client";

import { useState, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";

function LoginForm() {
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const router = useRouter();
  const params = useSearchParams();

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);
    const res = await fetch("/api/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password }),
    });
    setLoading(false);
    if (res.ok) {
      router.push(params.get("next") || "/dashboard");
      router.refresh();
    } else {
      setError("Galat password. Dobara try karo.");
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-[#f2f6ff] px-4">
      <form
        onSubmit={handleSubmit}
        className="w-full max-w-sm bg-white border border-[#dee4ff] rounded-2xl p-8 shadow-sm"
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src="/wcc-logo.png"
          alt="WordPress Campus Connect"
          className="h-10 w-auto mb-5"
        />
        <div className="text-xs tracking-widest uppercase text-[#022f8c] font-bold mb-1">
          Surat 2026
        </div>
        <h1 className="text-lg text-[#1a1919] mb-6">Volunteer / Admin Login</h1>
        <input
          type="password"
          autoFocus
          placeholder="Password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="w-full bg-[#ffffff] border border-[#c9d4f9] rounded-lg px-4 py-3 text-[#1a1919] placeholder-[#646970] outline-none focus:border-[#3858e9] mb-3"
        />
        {error && <p className="text-[#f15a25] text-sm mb-3">{error}</p>}
        <button
          type="submit"
          disabled={loading}
          className="w-full bg-[#3858e9] text-white font-semibold rounded-lg py-3 disabled:opacity-60"
        >
          {loading ? "Checking..." : "Login"}
        </button>
      </form>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense>
      <LoginForm />
    </Suspense>
  );
}
