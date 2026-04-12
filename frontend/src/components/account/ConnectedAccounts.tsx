import { useAuth } from "../../lib/auth";

export function ConnectedAccounts() {
  const { signInWithOAuth } = useAuth();

  return (
    <div className="bg-white border rounded-lg p-4">
      <h3 className="font-medium mb-3">Connected Accounts</h3>
      <div className="space-y-2">
        <button
          onClick={() => signInWithOAuth("google")}
          className="w-full border border-gray-300 rounded px-4 py-2 text-sm hover:bg-gray-50 text-left"
        >
          Link Google Account
        </button>
        <button
          onClick={() => signInWithOAuth("github")}
          className="w-full border border-gray-300 rounded px-4 py-2 text-sm hover:bg-gray-50 text-left"
        >
          Link GitHub Account
        </button>
      </div>
    </div>
  );
}
