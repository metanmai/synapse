import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "../lib/auth";

export function LoginPage() {
  const { signInWithEmail, signInWithMagicLink, signInWithOAuth } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [mode, setMode] = useState<"password" | "magic">("password");
  const [error, setError] = useState("");
  const [magicSent, setMagicSent] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    try {
      if (mode === "magic") {
        await signInWithMagicLink(email);
        setMagicSent(true);
      } else {
        await signInWithEmail(email, password);
        navigate("/");
      }
    } catch (err: any) {
      setError(err.message);
    }
  };

  if (magicSent) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="bg-white p-8 rounded-lg shadow-sm border max-w-sm w-full text-center">
          <h2 className="text-lg font-semibold mb-2">Check your email</h2>
          <p className="text-gray-600 text-sm">We sent a login link to {email}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <div className="bg-white p-8 rounded-lg shadow-sm border max-w-sm w-full">
        <h1 className="text-xl font-semibold mb-6">Sign in to MCP-Sync</h1>

        <div className="space-y-3 mb-6">
          <button
            onClick={() => signInWithOAuth("google")}
            className="w-full border border-gray-300 rounded px-4 py-2 text-sm hover:bg-gray-50"
          >
            Continue with Google
          </button>
          <button
            onClick={() => signInWithOAuth("github")}
            className="w-full border border-gray-300 rounded px-4 py-2 text-sm hover:bg-gray-50"
          >
            Continue with GitHub
          </button>
        </div>

        <div className="relative mb-6">
          <div className="absolute inset-0 flex items-center">
            <div className="w-full border-t border-gray-200" />
          </div>
          <div className="relative flex justify-center text-xs">
            <span className="bg-white px-2 text-gray-500">or</span>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <input
            type="email"
            placeholder="Email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="w-full border border-gray-300 rounded px-3 py-2 text-sm"
            required
          />
          {mode === "password" && (
            <input
              type="password"
              placeholder="Password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full border border-gray-300 rounded px-3 py-2 text-sm"
              required
            />
          )}
          {error && <p className="text-red-600 text-sm">{error}</p>}
          <button
            type="submit"
            className="w-full bg-blue-600 text-white rounded px-4 py-2 text-sm font-medium hover:bg-blue-700"
          >
            {mode === "magic" ? "Send magic link" : "Sign in"}
          </button>
        </form>

        <div className="mt-4 text-center text-sm text-gray-500">
          <button
            onClick={() => setMode(mode === "password" ? "magic" : "password")}
            className="text-blue-600 hover:underline"
          >
            {mode === "password" ? "Use magic link instead" : "Use password instead"}
          </button>
        </div>

        <p className="mt-4 text-center text-sm text-gray-500">
          Don't have an account?{" "}
          <Link to="/signup" className="text-blue-600 hover:underline">Sign up</Link>
        </p>
      </div>
    </div>
  );
}
