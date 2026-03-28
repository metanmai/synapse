import { useAuth } from "../lib/auth";
import { ApiKeyCard } from "../components/account/ApiKeyCard";
import { ConnectedAccounts } from "../components/account/ConnectedAccounts";

export function AccountPage() {
  const { user } = useAuth();

  return (
    <div className="max-w-2xl mx-auto p-8">
      <h1 className="text-2xl font-semibold mb-6">Account</h1>
      <div className="mb-4 text-sm text-gray-600">Signed in as {user?.email}</div>
      <div className="space-y-6">
        <ApiKeyCard />
        <ConnectedAccounts />
      </div>
    </div>
  );
}
