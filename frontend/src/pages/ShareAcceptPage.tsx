import { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useAuth } from "../lib/auth";
import { api } from "../lib/api";

export function ShareAcceptPage() {
  const { token } = useParams<{ token: string }>();
  const { session, loading } = useAuth();
  const navigate = useNavigate();
  const [status, setStatus] = useState<"loading" | "success" | "error">("loading");
  const [error, setError] = useState("");

  useEffect(() => {
    if (loading) return;
    if (!session) {
      navigate(`/login?redirect=/share/${token}`);
      return;
    }

    api.joinShareLink(token!)
      .then(() => {
        setStatus("success");
        setTimeout(() => navigate("/"), 2000);
      })
      .catch((err) => {
        setStatus("error");
        setError(err.message);
      });
  }, [session, loading, token, navigate]);

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <div className="bg-white p-8 rounded-lg shadow-sm border max-w-sm w-full text-center">
        {status === "loading" && <p className="text-gray-500">Joining project...</p>}
        {status === "success" && <p className="text-green-600">Joined! Redirecting to dashboard...</p>}
        {status === "error" && <p className="text-red-600">{error}</p>}
      </div>
    </div>
  );
}
