import { useState } from "react";
import { api } from "../../lib/api";

export function ApiKeyCard() {
  const [apiKey, setApiKey] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const regenerate = async () => {
    setLoading(true);
    try {
      const { api_key } = await api.regenerateApiKey();
      setApiKey(api_key);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="bg-white border rounded-lg p-4">
      <h3 className="font-medium mb-2">API Key</h3>
      <p className="text-sm text-gray-500 mb-3">
        Use this key to connect Claude, ChatGPT, or other AI tools.
      </p>
      {apiKey ? (
        <div className="bg-gray-50 rounded p-3 font-mono text-sm break-all mb-3">{apiKey}</div>
      ) : (
        <div className="bg-gray-50 rounded p-3 font-mono text-sm text-gray-400 mb-3">
          ••••••••••••••••
        </div>
      )}
      <button
        onClick={regenerate}
        disabled={loading}
        className="border border-gray-300 rounded px-3 py-1.5 text-sm hover:bg-gray-50"
      >
        {loading ? "Generating..." : apiKey ? "Regenerate" : "Generate API Key"}
      </button>
      {apiKey && (
        <p className="text-xs text-amber-600 mt-2">
          Save this key now — it won't be shown again.
        </p>
      )}
    </div>
  );
}
