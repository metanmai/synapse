# Synapse Frontend SPA Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a React SPA for browsing/editing shared context, managing projects and team members, sharing via links, and tracking activity.

**Architecture:** React + Vite + TypeScript SPA in a `frontend/` subdirectory. Supabase Auth for login (email+password, magic link, OAuth). TanStack Query for API data fetching. Tailwind CSS for styling. Deployed to Railway.

**Tech Stack:** React 18, Vite, TypeScript, React Router, Supabase Auth JS, TanStack Query, Tailwind CSS

**Spec:** `docs/superpowers/specs/2026-03-19-synapse-frontend-design.md`

---

## File Structure

```
frontend/
├── src/
│   ├── main.tsx
│   ├── App.tsx
│   ├── lib/
│   │   ├── api.ts
│   │   ├── supabase.ts
│   │   └── auth.tsx
│   ├── pages/
│   │   ├── LoginPage.tsx
│   │   ├── SignupPage.tsx
│   │   ├── DashboardPage.tsx
│   │   ├── ProjectWorkspace.tsx
│   │   ├── ProjectSettings.tsx
│   │   ├── ActivityPage.tsx
│   │   ├── HistoryPage.tsx
│   │   ├── AccountPage.tsx
│   │   └── ShareAcceptPage.tsx
│   ├── components/
│   │   ├── layout/
│   │   │   ├── AppShell.tsx
│   │   │   └── Sidebar.tsx
│   │   ├── workspace/
│   │   │   ├── FolderTree.tsx
│   │   │   ├── EntryViewer.tsx
│   │   │   ├── EntryEditor.tsx
│   │   │   ├── SearchPanel.tsx
│   │   │   └── NewEntryDialog.tsx
│   │   ├── sharing/
│   │   │   ├── MemberList.tsx
│   │   │   ├── ShareLinkManager.tsx
│   │   │   └── InviteDialog.tsx
│   │   ├── activity/
│   │   │   ├── ActivityFeed.tsx
│   │   │   ├── VersionTimeline.tsx
│   │   │   └── DiffView.tsx
│   │   └── account/
│   │       ├── ConnectedAccounts.tsx
│   │       └── ApiKeyCard.tsx
│   ├── hooks/
│   │   ├── useProjects.ts
│   │   ├── useEntries.ts
│   │   ├── useMembers.ts
│   │   └── useActivity.ts
│   └── types/
│       └── index.ts
├── index.html
├── vite.config.ts
├── tailwind.config.ts
├── postcss.config.js
├── tsconfig.json
├── package.json
└── .env.example
```

---

### Task 1: Frontend Project Scaffolding

**Files:**
- Create: `frontend/package.json`, `frontend/tsconfig.json`, `frontend/vite.config.ts`
- Create: `frontend/tailwind.config.ts`, `frontend/postcss.config.js`
- Create: `frontend/index.html`, `frontend/src/main.tsx`, `frontend/src/App.tsx`
- Create: `frontend/.env.example`

- [ ] **Step 1: Initialize frontend project**

```bash
cd /Users/Tanmai.N/Documents/synapse
mkdir -p frontend/src
cd frontend
npm init -y
npm install react react-dom react-router-dom @tanstack/react-query @supabase/supabase-js
npm install -D vite @vitejs/plugin-react typescript @types/react @types/react-dom tailwindcss @tailwindcss/vite
```

- [ ] **Step 2: Create config files**

Create `frontend/tsconfig.json`:
```json
{
  "compilerOptions": {
    "target": "ES2020",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "lib": ["ES2020", "DOM", "DOM.Iterable"],
    "jsx": "react-jsx",
    "strict": true,
    "skipLibCheck": true,
    "noEmit": true,
    "resolveJsonModule": true,
    "isolatedModules": true,
    "forceConsistentCasingInFileNames": true,
    "esModuleInterop": true
  },
  "include": ["src"]
}
```

Create `frontend/vite.config.ts`:
```typescript
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
  },
});
```

Create `frontend/postcss.config.js`:
```javascript
export default {};
```

- [ ] **Step 3: Create entry files**

Create `frontend/index.html`:
```html
<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Synapse</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

Create `frontend/src/main.tsx`:
```tsx
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AuthProvider } from "./lib/auth";
import App from "./App";
import "./main.css";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { staleTime: 30_000, retry: 1 },
  },
});

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <BrowserRouter>
      <QueryClientProvider client={queryClient}>
        <AuthProvider>
          <App />
        </AuthProvider>
      </QueryClientProvider>
    </BrowserRouter>
  </StrictMode>
);
```

Create `frontend/src/main.css`:
```css
@import "tailwindcss";
```

Create `frontend/src/App.tsx` (placeholder):
```tsx
export default function App() {
  return <div className="p-8 text-xl">Synapse</div>;
}
```

Create `frontend/.env.example`:
```
VITE_API_URL=http://localhost:8787
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_ANON_KEY=your-anon-key
```

- [ ] **Step 4: Add scripts to package.json**

Update `frontend/package.json` scripts:
```json
{
  "scripts": {
    "dev": "vite",
    "build": "tsc && vite build",
    "preview": "vite preview",
    "typecheck": "tsc --noEmit"
  }
}
```

- [ ] **Step 5: Verify it runs**

```bash
cd /Users/Tanmai.N/Documents/synapse/frontend
npm run dev
```
Visit http://localhost:5173 — should show "Synapse". Stop the dev server.

- [ ] **Step 6: Commit**

```bash
cd /Users/Tanmai.N/Documents/synapse
git add frontend/
git commit -m "feat: scaffold frontend project with React, Vite, Tailwind, and TanStack Query"
```

---

### Task 2: Auth Layer (Supabase + API Client)

**Files:**
- Create: `frontend/src/lib/supabase.ts`
- Create: `frontend/src/lib/auth.tsx`
- Create: `frontend/src/lib/api.ts`
- Create: `frontend/src/types/index.ts`

- [ ] **Step 1: Create shared types**

Create `frontend/src/types/index.ts`:
```typescript
export interface User {
  id: string;
  email: string;
  created_at: string;
}

export interface Project {
  id: string;
  name: string;
  owner_id: string;
  google_drive_folder_id: string | null;
  created_at: string;
}

export interface Entry {
  id: string;
  project_id: string;
  path: string;
  content: string;
  content_type: "markdown" | "json";
  author_id: string | null;
  source: string;
  tags: string[];
  google_doc_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface EntryListItem {
  path: string;
  content_type: string;
  tags: string[];
  updated_at: string;
}

export interface EntryHistory {
  id: string;
  entry_id: string;
  content: string;
  source: string;
  changed_at: string;
}

export interface ProjectMember {
  project_id: string;
  user_id: string;
  role: "owner" | "editor" | "viewer";
  joined_at: string;
}

export interface ShareLink {
  id: string;
  project_id: string;
  token: string;
  role: "editor" | "viewer";
  created_by: string;
  expires_at: string | null;
  created_at: string;
}

export interface ActivityLogEntry {
  id: string;
  project_id: string;
  user_id: string | null;
  action: string;
  target_path: string | null;
  target_email: string | null;
  source: string;
  metadata: Record<string, unknown> | null;
  created_at: string;
}
```

- [ ] **Step 2: Create Supabase client**

Create `frontend/src/lib/supabase.ts`:
```typescript
import { createClient } from "@supabase/supabase-js";

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

export const supabase = createClient(supabaseUrl, supabaseAnonKey);
```

- [ ] **Step 3: Create auth context provider**

Create `frontend/src/lib/auth.tsx`:
```tsx
import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import type { Session, User as SupabaseUser } from "@supabase/supabase-js";
import { supabase } from "./supabase";

interface AuthState {
  session: Session | null;
  user: SupabaseUser | null;
  loading: boolean;
  signInWithEmail: (email: string, password: string) => Promise<void>;
  signUpWithEmail: (email: string, password: string) => Promise<void>;
  signInWithMagicLink: (email: string) => Promise<void>;
  signInWithOAuth: (provider: "google" | "github") => Promise<void>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      setLoading(false);
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session);
    });

    return () => subscription.unsubscribe();
  }, []);

  const signInWithEmail = async (email: string, password: string) => {
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) throw error;
  };

  const signUpWithEmail = async (email: string, password: string) => {
    const { error } = await supabase.auth.signUp({ email, password });
    if (error) throw error;
  };

  const signInWithMagicLink = async (email: string) => {
    const { error } = await supabase.auth.signInWithOtp({ email });
    if (error) throw error;
  };

  const signInWithOAuth = async (provider: "google" | "github") => {
    const { error } = await supabase.auth.signInWithOAuth({ provider });
    if (error) throw error;
  };

  const signOut = async () => {
    await supabase.auth.signOut();
  };

  return (
    <AuthContext.Provider
      value={{
        session,
        user: session?.user ?? null,
        loading,
        signInWithEmail,
        signUpWithEmail,
        signInWithMagicLink,
        signInWithOAuth,
        signOut,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
```

- [ ] **Step 4: Create API client**

Create `frontend/src/lib/api.ts`:
```typescript
import { supabase } from "./supabase";

const API_URL = import.meta.env.VITE_API_URL;

async function getAuthHeader(): Promise<Record<string, string>> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.access_token) return {};
  return { Authorization: `Bearer ${session.access_token}` };
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const headers = {
    "Content-Type": "application/json",
    ...(await getAuthHeader()),
    ...options.headers,
  };

  const res = await fetch(`${API_URL}${path}`, { ...options, headers });

  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(body.error || `Request failed: ${res.status}`);
  }

  return res.json();
}

export const api = {
  // Projects
  listProjects: () => request<any[]>("/api/projects"),
  createProject: (name: string) => request<any>("/api/projects", {
    method: "POST", body: JSON.stringify({ name }),
  }),

  // Project members
  addMember: (projectId: string, email: string, role: string) =>
    request<any>(`/api/projects/${projectId}/members`, {
      method: "POST", body: JSON.stringify({ email, role }),
    }),
  removeMember: (projectId: string, email: string) =>
    request<void>(`/api/projects/${projectId}/members/${encodeURIComponent(email)}`, {
      method: "DELETE",
    }),

  // Share links
  createShareLink: (projectId: string, role: string, expiresAt?: string) =>
    request<any>(`/api/projects/${projectId}/share-links`, {
      method: "POST", body: JSON.stringify({ role, expires_at: expiresAt }),
    }),
  listShareLinks: (projectId: string) =>
    request<any[]>(`/api/projects/${projectId}/share-links`),
  deleteShareLink: (projectId: string, token: string) =>
    request<void>(`/api/projects/${projectId}/share-links/${token}`, {
      method: "DELETE",
    }),
  joinShareLink: (token: string) =>
    request<any>(`/api/share/${token}/join`, { method: "POST" }),

  // Context entries
  listEntries: (project: string, folder?: string) =>
    request<any[]>(`/api/context/${encodeURIComponent(project)}/list${folder ? `?folder=${encodeURIComponent(folder)}` : ""}`),
  getEntry: (project: string, path: string) =>
    request<any>(`/api/context/${encodeURIComponent(project)}/${encodeURIComponent(path)}`),
  saveEntry: (project: string, path: string, content: string, tags?: string[]) =>
    request<any>("/api/context/save", {
      method: "POST", body: JSON.stringify({ project, path, content, tags }),
    }),
  searchEntries: (project: string, query: string) =>
    request<any[]>(`/api/context/${encodeURIComponent(project)}/search?q=${encodeURIComponent(query)}`),

  // History
  getEntryHistory: (project: string, path: string) =>
    request<any[]>(`/api/context/${encodeURIComponent(project)}/history/${encodeURIComponent(path)}`),
  restoreEntry: (project: string, path: string, historyId: string) =>
    request<any>(`/api/context/${encodeURIComponent(project)}/restore`, {
      method: "POST", body: JSON.stringify({ path, historyId }),
    }),

  // Activity
  getActivity: (projectId: string, limit = 50, offset = 0) =>
    request<any[]>(`/api/projects/${projectId}/activity?limit=${limit}&offset=${offset}`),

  // Account
  regenerateApiKey: () => request<{ api_key: string }>("/api/account/regenerate-key", {
    method: "POST",
  }),

  // Preferences
  setPreference: (project: string, key: string, value: string) =>
    request<any>(`/api/projects/preferences/${encodeURIComponent(project)}`, {
      method: "PUT", body: JSON.stringify({ key, value }),
    }),
};
```

- [ ] **Step 5: Commit**

```bash
git add frontend/
git commit -m "feat: add auth layer, API client, Supabase integration, and shared types"
```

---

### Task 3: TanStack Query Hooks

**Files:**
- Create: `frontend/src/hooks/useProjects.ts`
- Create: `frontend/src/hooks/useEntries.ts`
- Create: `frontend/src/hooks/useMembers.ts`
- Create: `frontend/src/hooks/useActivity.ts`

- [ ] **Step 1: Create all hooks**

Create `frontend/src/hooks/useProjects.ts`:
```typescript
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../lib/api";

export function useProjects() {
  return useQuery({ queryKey: ["projects"], queryFn: api.listProjects });
}

export function useCreateProject() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (name: string) => api.createProject(name),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["projects"] }),
  });
}
```

Create `frontend/src/hooks/useEntries.ts`:
```typescript
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../lib/api";

export function useEntryList(project: string, folder?: string) {
  return useQuery({
    queryKey: ["entries", project, folder],
    queryFn: () => api.listEntries(project, folder),
    enabled: !!project,
  });
}

export function useEntry(project: string, path: string) {
  return useQuery({
    queryKey: ["entry", project, path],
    queryFn: () => api.getEntry(project, path),
    enabled: !!project && !!path,
  });
}

export function useSaveEntry(project: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ path, content, tags }: { path: string; content: string; tags?: string[] }) =>
      api.saveEntry(project, path, content, tags),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["entries", project] });
      qc.invalidateQueries({ queryKey: ["entry", project] });
    },
  });
}

export function useSearchEntries(project: string, query: string) {
  return useQuery({
    queryKey: ["search", project, query],
    queryFn: () => api.searchEntries(project, query),
    enabled: !!project && query.length > 1,
  });
}

export function useEntryHistory(project: string, path: string) {
  return useQuery({
    queryKey: ["history", project, path],
    queryFn: () => api.getEntryHistory(project, path),
    enabled: !!project && !!path,
  });
}

export function useRestoreEntry(project: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ path, historyId }: { path: string; historyId: string }) =>
      api.restoreEntry(project, path, historyId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["entries", project] });
      qc.invalidateQueries({ queryKey: ["entry", project] });
      qc.invalidateQueries({ queryKey: ["history", project] });
    },
  });
}
```

Create `frontend/src/hooks/useMembers.ts`:
```typescript
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../lib/api";

export function useAddMember(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ email, role }: { email: string; role: string }) =>
      api.addMember(projectId, email, role),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["projects"] }),
  });
}

export function useRemoveMember(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (email: string) => api.removeMember(projectId, email),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["projects"] }),
  });
}
```

Create `frontend/src/hooks/useActivity.ts`:
```typescript
import { useQuery } from "@tanstack/react-query";
import { api } from "../lib/api";

export function useActivity(projectId: string, limit = 50, offset = 0) {
  return useQuery({
    queryKey: ["activity", projectId, limit, offset],
    queryFn: () => api.getActivity(projectId, limit, offset),
    enabled: !!projectId,
  });
}
```

- [ ] **Step 2: Commit**

```bash
git add frontend/src/hooks/
git commit -m "feat: add TanStack Query hooks for projects, entries, members, and activity"
```

---

### Task 4: Layout & Routing

**Files:**
- Create: `frontend/src/components/layout/AppShell.tsx`
- Create: `frontend/src/components/layout/Sidebar.tsx`
- Modify: `frontend/src/App.tsx`

- [ ] **Step 1: Create AppShell**

Create `frontend/src/components/layout/AppShell.tsx`:
```tsx
import { Outlet, Link, useNavigate } from "react-router-dom";
import { useAuth } from "../../lib/auth";

export function AppShell() {
  const { user, signOut } = useAuth();
  const navigate = useNavigate();

  const handleSignOut = async () => {
    await signOut();
    navigate("/login");
  };

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white border-b border-gray-200 px-6 py-3 flex items-center justify-between">
        <Link to="/" className="text-lg font-semibold text-gray-900">
          Synapse
        </Link>
        <div className="flex items-center gap-4">
          <span className="text-sm text-gray-600">{user?.email}</span>
          <Link to="/account" className="text-sm text-blue-600 hover:underline">
            Account
          </Link>
          <button
            onClick={handleSignOut}
            className="text-sm text-gray-500 hover:text-gray-700"
          >
            Sign out
          </button>
        </div>
      </header>
      <main>
        <Outlet />
      </main>
    </div>
  );
}
```

- [ ] **Step 2: Create Sidebar**

Create `frontend/src/components/layout/Sidebar.tsx`:
```tsx
import { NavLink, useParams } from "react-router-dom";

export function Sidebar() {
  const { name } = useParams<{ name: string }>();

  const links = [
    { to: `/projects/${name}`, label: "Workspace", end: true },
    { to: `/projects/${name}/settings`, label: "Settings" },
    { to: `/projects/${name}/activity`, label: "Activity" },
  ];

  return (
    <nav className="w-48 border-r border-gray-200 bg-white p-4 space-y-1">
      {links.map((link) => (
        <NavLink
          key={link.to}
          to={link.to}
          end={link.end}
          className={({ isActive }) =>
            `block px-3 py-2 rounded text-sm ${
              isActive ? "bg-blue-50 text-blue-700 font-medium" : "text-gray-700 hover:bg-gray-100"
            }`
          }
        >
          {link.label}
        </NavLink>
      ))}
    </nav>
  );
}
```

- [ ] **Step 3: Set up routing in App.tsx**

Replace `frontend/src/App.tsx`:
```tsx
import { Routes, Route, Navigate } from "react-router-dom";
import { useAuth } from "./lib/auth";
import { AppShell } from "./components/layout/AppShell";
import { LoginPage } from "./pages/LoginPage";
import { SignupPage } from "./pages/SignupPage";
import { DashboardPage } from "./pages/DashboardPage";
import { ProjectWorkspace } from "./pages/ProjectWorkspace";
import { ProjectSettings } from "./pages/ProjectSettings";
import { ActivityPage } from "./pages/ActivityPage";
import { HistoryPage } from "./pages/HistoryPage";
import { AccountPage } from "./pages/AccountPage";
import { ShareAcceptPage } from "./pages/ShareAcceptPage";

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { session, loading } = useAuth();
  if (loading) return <div className="p-8 text-gray-500">Loading...</div>;
  if (!session) return <Navigate to="/login" replace />;
  return <>{children}</>;
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/signup" element={<SignupPage />} />
      <Route path="/share/:token" element={<ShareAcceptPage />} />
      <Route
        element={
          <ProtectedRoute>
            <AppShell />
          </ProtectedRoute>
        }
      >
        <Route path="/" element={<DashboardPage />} />
        <Route path="/projects/:name" element={<ProjectWorkspace />} />
        <Route path="/projects/:name/settings" element={<ProjectSettings />} />
        <Route path="/projects/:name/activity" element={<ActivityPage />} />
        <Route path="/projects/:name/history/*" element={<HistoryPage />} />
        <Route path="/account" element={<AccountPage />} />
      </Route>
    </Routes>
  );
}
```

- [ ] **Step 4: Create placeholder pages**

Create all page files as simple placeholders so the app compiles:

`frontend/src/pages/LoginPage.tsx`:
```tsx
export function LoginPage() {
  return <div className="p-8">Login</div>;
}
```

Create identical placeholders for: `SignupPage.tsx`, `DashboardPage.tsx`, `ProjectWorkspace.tsx`, `ProjectSettings.tsx`, `ActivityPage.tsx`, `HistoryPage.tsx`, `AccountPage.tsx`, `ShareAcceptPage.tsx` — each exporting a function with the page name.

- [ ] **Step 5: Verify it compiles and runs**

```bash
cd /Users/Tanmai.N/Documents/synapse/frontend
npx tsc --noEmit
npm run dev
```
Visit http://localhost:5173 — should redirect to /login. Stop dev server.

- [ ] **Step 6: Commit**

```bash
git add frontend/
git commit -m "feat: add routing, layout shell, sidebar, and placeholder pages"
```

---

### Task 5: Login & Signup Pages

**Files:**
- Replace: `frontend/src/pages/LoginPage.tsx`
- Replace: `frontend/src/pages/SignupPage.tsx`

- [ ] **Step 1: Implement LoginPage**

Replace `frontend/src/pages/LoginPage.tsx`:
```tsx
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
        <h1 className="text-xl font-semibold mb-6">Sign in to Synapse</h1>

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
```

- [ ] **Step 2: Implement SignupPage**

Replace `frontend/src/pages/SignupPage.tsx`:
```tsx
import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "../lib/auth";

export function SignupPage() {
  const { signUpWithEmail, signInWithOAuth } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    try {
      await signUpWithEmail(email, password);
      setSuccess(true);
    } catch (err: any) {
      setError(err.message);
    }
  };

  if (success) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="bg-white p-8 rounded-lg shadow-sm border max-w-sm w-full text-center">
          <h2 className="text-lg font-semibold mb-2">Check your email</h2>
          <p className="text-gray-600 text-sm">We sent a confirmation link to {email}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <div className="bg-white p-8 rounded-lg shadow-sm border max-w-sm w-full">
        <h1 className="text-xl font-semibold mb-6">Create your account</h1>

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
          <input
            type="password"
            placeholder="Password (min 6 characters)"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="w-full border border-gray-300 rounded px-3 py-2 text-sm"
            minLength={6}
            required
          />
          {error && <p className="text-red-600 text-sm">{error}</p>}
          <button
            type="submit"
            className="w-full bg-blue-600 text-white rounded px-4 py-2 text-sm font-medium hover:bg-blue-700"
          >
            Create account
          </button>
        </form>

        <p className="mt-4 text-center text-sm text-gray-500">
          Already have an account?{" "}
          <Link to="/login" className="text-blue-600 hover:underline">Sign in</Link>
        </p>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Commit**

```bash
git add frontend/src/pages/LoginPage.tsx frontend/src/pages/SignupPage.tsx
git commit -m "feat: add login and signup pages with email, magic link, and OAuth"
```

---

### Task 6: Dashboard Page

**Files:**
- Replace: `frontend/src/pages/DashboardPage.tsx`

- [ ] **Step 1: Implement DashboardPage**

Replace `frontend/src/pages/DashboardPage.tsx`:
```tsx
import { useState } from "react";
import { Link } from "react-router-dom";
import { useProjects, useCreateProject } from "../hooks/useProjects";

export function DashboardPage() {
  const { data: projects, isLoading } = useProjects();
  const createProject = useCreateProject();
  const [newName, setNewName] = useState("");
  const [showCreate, setShowCreate] = useState(false);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newName.trim()) return;
    await createProject.mutateAsync(newName.trim());
    setNewName("");
    setShowCreate(false);
  };

  return (
    <div className="max-w-3xl mx-auto p-8">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-semibold">Projects</h1>
        <button
          onClick={() => setShowCreate(true)}
          className="bg-blue-600 text-white rounded px-4 py-2 text-sm font-medium hover:bg-blue-700"
        >
          New Project
        </button>
      </div>

      {showCreate && (
        <form onSubmit={handleCreate} className="mb-6 flex gap-2">
          <input
            type="text"
            placeholder="Project name"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            className="flex-1 border border-gray-300 rounded px-3 py-2 text-sm"
            autoFocus
          />
          <button type="submit" className="bg-blue-600 text-white rounded px-4 py-2 text-sm">
            Create
          </button>
          <button
            type="button"
            onClick={() => setShowCreate(false)}
            className="text-gray-500 text-sm"
          >
            Cancel
          </button>
        </form>
      )}

      {isLoading ? (
        <p className="text-gray-500">Loading projects...</p>
      ) : !projects?.length ? (
        <p className="text-gray-500">No projects yet. Create one to get started.</p>
      ) : (
        <div className="space-y-2">
          {projects.map((p: any) => (
            <Link
              key={p.id}
              to={`/projects/${encodeURIComponent(p.name)}`}
              className="block bg-white border border-gray-200 rounded-lg p-4 hover:border-blue-300 transition-colors"
            >
              <div className="font-medium">{p.name}</div>
              <div className="text-sm text-gray-500 mt-1">
                Created {new Date(p.created_at).toLocaleDateString()}
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add frontend/src/pages/DashboardPage.tsx
git commit -m "feat: add dashboard page with project list and creation"
```

---

### Task 7: Project Workspace (Folder Tree + Entry Viewer/Editor)

**Files:**
- Create: `frontend/src/components/workspace/FolderTree.tsx`
- Create: `frontend/src/components/workspace/EntryViewer.tsx`
- Create: `frontend/src/components/workspace/EntryEditor.tsx`
- Create: `frontend/src/components/workspace/SearchPanel.tsx`
- Create: `frontend/src/components/workspace/NewEntryDialog.tsx`
- Replace: `frontend/src/pages/ProjectWorkspace.tsx`

- [ ] **Step 1: Create FolderTree**

Create `frontend/src/components/workspace/FolderTree.tsx`:
```tsx
import type { EntryListItem } from "../../types";

interface Props {
  entries: EntryListItem[];
  selectedPath: string | null;
  onSelect: (path: string) => void;
}

function buildTree(entries: EntryListItem[]) {
  const tree: Record<string, string[]> = {};
  for (const entry of entries) {
    const parts = entry.path.split("/");
    const folder = parts.length > 1 ? parts.slice(0, -1).join("/") : "(root)";
    if (!tree[folder]) tree[folder] = [];
    tree[folder].push(entry.path);
  }
  return tree;
}

export function FolderTree({ entries, selectedPath, onSelect }: Props) {
  const tree = buildTree(entries);
  const folders = Object.keys(tree).sort();

  return (
    <div className="text-sm">
      {folders.map((folder) => (
        <div key={folder} className="mb-3">
          <div className="font-medium text-gray-500 text-xs uppercase tracking-wide px-2 mb-1">
            {folder}
          </div>
          {tree[folder].map((path) => {
            const filename = path.split("/").pop();
            return (
              <button
                key={path}
                onClick={() => onSelect(path)}
                className={`w-full text-left px-2 py-1 rounded text-sm truncate ${
                  selectedPath === path
                    ? "bg-blue-50 text-blue-700"
                    : "text-gray-700 hover:bg-gray-100"
                }`}
              >
                {filename}
              </button>
            );
          })}
        </div>
      ))}
      {!entries.length && (
        <p className="text-gray-400 text-xs px-2">No entries yet</p>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Create EntryViewer**

Create `frontend/src/components/workspace/EntryViewer.tsx`:
```tsx
import { Link, useParams } from "react-router-dom";
import type { Entry } from "../../types";

interface Props {
  entry: Entry;
  onEdit: () => void;
}

export function EntryViewer({ entry, onEdit }: Props) {
  const { name } = useParams<{ name: string }>();

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="text-lg font-medium">{entry.path}</h2>
          <div className="text-xs text-gray-500 mt-1">
            {entry.source} · {new Date(entry.updated_at).toLocaleString()}
            {entry.tags.length > 0 && (
              <span className="ml-2">
                {entry.tags.map((t) => (
                  <span key={t} className="inline-block bg-gray-100 rounded px-1.5 py-0.5 text-xs mr-1">
                    {t}
                  </span>
                ))}
              </span>
            )}
          </div>
        </div>
        <div className="flex gap-2">
          <Link
            to={`/projects/${name}/history/${encodeURIComponent(entry.path)}`}
            className="text-sm text-gray-500 hover:text-gray-700"
          >
            History
          </Link>
          <button onClick={onEdit} className="text-sm text-blue-600 hover:underline">
            Edit
          </button>
        </div>
      </div>
      <div className="bg-white border border-gray-200 rounded-lg p-4 whitespace-pre-wrap font-mono text-sm">
        {entry.content}
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Create EntryEditor**

Create `frontend/src/components/workspace/EntryEditor.tsx`:
```tsx
import { useState } from "react";

interface Props {
  initialContent?: string;
  initialPath?: string;
  initialTags?: string[];
  onSave: (path: string, content: string, tags: string[]) => void;
  onCancel: () => void;
  isNew?: boolean;
}

export function EntryEditor({ initialContent = "", initialPath = "", initialTags = [], onSave, onCancel, isNew }: Props) {
  const [path, setPath] = useState(initialPath);
  const [content, setContent] = useState(initialContent);
  const [tagsInput, setTagsInput] = useState(initialTags.join(", "));

  const handleSave = () => {
    const tags = tagsInput.split(",").map((t) => t.trim()).filter(Boolean);
    onSave(path, content, tags);
  };

  return (
    <div className="space-y-4">
      {isNew && (
        <input
          type="text"
          placeholder="Path (e.g., decisions/chose-react.md)"
          value={path}
          onChange={(e) => setPath(e.target.value)}
          className="w-full border border-gray-300 rounded px-3 py-2 text-sm"
        />
      )}
      <textarea
        value={content}
        onChange={(e) => setContent(e.target.value)}
        className="w-full border border-gray-300 rounded px-3 py-2 text-sm font-mono min-h-[400px]"
        placeholder="Content (markdown)"
      />
      <input
        type="text"
        placeholder="Tags (comma-separated)"
        value={tagsInput}
        onChange={(e) => setTagsInput(e.target.value)}
        className="w-full border border-gray-300 rounded px-3 py-2 text-sm"
      />
      <div className="flex gap-2">
        <button onClick={handleSave} className="bg-blue-600 text-white rounded px-4 py-2 text-sm font-medium hover:bg-blue-700">
          Save
        </button>
        <button onClick={onCancel} className="text-gray-500 text-sm hover:text-gray-700">
          Cancel
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Create SearchPanel**

Create `frontend/src/components/workspace/SearchPanel.tsx`:
```tsx
import { useState } from "react";
import { useSearchEntries } from "../../hooks/useEntries";

interface Props {
  project: string;
  onSelect: (path: string) => void;
}

export function SearchPanel({ project, onSelect }: Props) {
  const [query, setQuery] = useState("");
  const { data: results } = useSearchEntries(project, query);

  return (
    <div className="space-y-3">
      <input
        type="text"
        placeholder="Search context..."
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        className="w-full border border-gray-300 rounded px-3 py-2 text-sm"
        autoFocus
      />
      {results?.map((entry: any) => (
        <button
          key={entry.id}
          onClick={() => onSelect(entry.path)}
          className="w-full text-left bg-white border border-gray-200 rounded p-3 hover:border-blue-300 text-sm"
        >
          <div className="font-medium">{entry.path}</div>
          <div className="text-gray-500 text-xs mt-1 line-clamp-2">{entry.content.slice(0, 150)}</div>
        </button>
      ))}
    </div>
  );
}
```

- [ ] **Step 5: Create NewEntryDialog (simple)**

Create `frontend/src/components/workspace/NewEntryDialog.tsx`:
```tsx
import { EntryEditor } from "./EntryEditor";

interface Props {
  onSave: (path: string, content: string, tags: string[]) => void;
  onCancel: () => void;
}

export function NewEntryDialog({ onSave, onCancel }: Props) {
  return (
    <div>
      <h2 className="text-lg font-medium mb-4">New Entry</h2>
      <EntryEditor isNew onSave={onSave} onCancel={onCancel} />
    </div>
  );
}
```

- [ ] **Step 6: Implement ProjectWorkspace**

Replace `frontend/src/pages/ProjectWorkspace.tsx`:
```tsx
import { useState } from "react";
import { useParams } from "react-router-dom";
import { Sidebar } from "../components/layout/Sidebar";
import { FolderTree } from "../components/workspace/FolderTree";
import { EntryViewer } from "../components/workspace/EntryViewer";
import { EntryEditor } from "../components/workspace/EntryEditor";
import { SearchPanel } from "../components/workspace/SearchPanel";
import { NewEntryDialog } from "../components/workspace/NewEntryDialog";
import { useEntryList, useEntry, useSaveEntry } from "../hooks/useEntries";

export function ProjectWorkspace() {
  const { name } = useParams<{ name: string }>();
  const { data: entries = [] } = useEntryList(name!);
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [mode, setMode] = useState<"view" | "edit" | "new" | "search">("view");
  const { data: entry } = useEntry(name!, selectedPath ?? "");
  const saveEntry = useSaveEntry(name!);

  const handleSave = async (path: string, content: string, tags: string[]) => {
    await saveEntry.mutateAsync({ path, content, tags });
    setSelectedPath(path);
    setMode("view");
  };

  return (
    <div className="flex h-[calc(100vh-57px)]">
      <Sidebar />
      <div className="w-64 border-r border-gray-200 bg-white p-3 overflow-y-auto">
        <div className="flex items-center justify-between mb-3">
          <span className="text-xs font-medium text-gray-500 uppercase">Files</span>
          <div className="flex gap-1">
            <button
              onClick={() => setMode("search")}
              className="text-xs text-gray-500 hover:text-gray-700 px-1"
            >
              Search
            </button>
            <button
              onClick={() => setMode("new")}
              className="text-xs text-blue-600 hover:underline px-1"
            >
              + New
            </button>
          </div>
        </div>
        <FolderTree entries={entries} selectedPath={selectedPath} onSelect={(p) => { setSelectedPath(p); setMode("view"); }} />
      </div>
      <div className="flex-1 p-6 overflow-y-auto">
        {mode === "search" && (
          <SearchPanel project={name!} onSelect={(p) => { setSelectedPath(p); setMode("view"); }} />
        )}
        {mode === "new" && (
          <NewEntryDialog onSave={handleSave} onCancel={() => setMode("view")} />
        )}
        {mode === "view" && entry && (
          <EntryViewer entry={entry} onEdit={() => setMode("edit")} />
        )}
        {mode === "edit" && entry && (
          <EntryEditor
            initialContent={entry.content}
            initialPath={entry.path}
            initialTags={entry.tags}
            onSave={handleSave}
            onCancel={() => setMode("view")}
          />
        )}
        {mode === "view" && !selectedPath && (
          <div className="text-gray-400 text-center mt-20">Select a file or create a new one</div>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 7: Commit**

```bash
git add frontend/src/components/workspace/ frontend/src/pages/ProjectWorkspace.tsx
git commit -m "feat: add project workspace with folder tree, entry viewer/editor, and search"
```

---

### Task 8: Project Settings (Members + Share Links)

**Files:**
- Create: `frontend/src/components/sharing/MemberList.tsx`
- Create: `frontend/src/components/sharing/ShareLinkManager.tsx`
- Create: `frontend/src/components/sharing/InviteDialog.tsx`
- Replace: `frontend/src/pages/ProjectSettings.tsx`

- [ ] **Step 1: Create MemberList, ShareLinkManager, InviteDialog**

Create `frontend/src/components/sharing/MemberList.tsx`:
```tsx
import { useRemoveMember } from "../../hooks/useMembers";

interface Props {
  projectId: string;
  members: Array<{ user_id: string; role: string; email?: string }>;
}

export function MemberList({ projectId, members }: Props) {
  const removeMember = useRemoveMember(projectId);

  return (
    <div className="space-y-2">
      {members.map((m) => (
        <div key={m.user_id} className="flex items-center justify-between bg-white border rounded p-3">
          <div>
            <span className="text-sm">{m.email ?? m.user_id}</span>
            <span className="ml-2 text-xs bg-gray-100 rounded px-1.5 py-0.5">{m.role}</span>
          </div>
          {m.role !== "owner" && (
            <button
              onClick={() => m.email && removeMember.mutate(m.email)}
              className="text-xs text-red-600 hover:underline"
            >
              Remove
            </button>
          )}
        </div>
      ))}
    </div>
  );
}
```

Create `frontend/src/components/sharing/ShareLinkManager.tsx`:
```tsx
import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../../lib/api";

interface Props { projectId: string; }

export function ShareLinkManager({ projectId }: Props) {
  const qc = useQueryClient();
  const { data: links = [] } = useQuery({
    queryKey: ["share-links", projectId],
    queryFn: () => api.listShareLinks(projectId),
  });
  const createLink = useMutation({
    mutationFn: (role: string) => api.createShareLink(projectId, role),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["share-links", projectId] }),
  });
  const deleteLink = useMutation({
    mutationFn: (token: string) => api.deleteShareLink(projectId, token),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["share-links", projectId] }),
  });
  const [copied, setCopied] = useState<string | null>(null);

  const copyLink = (token: string) => {
    navigator.clipboard.writeText(`${window.location.origin}/share/${token}`);
    setCopied(token);
    setTimeout(() => setCopied(null), 2000);
  };

  return (
    <div>
      <div className="flex gap-2 mb-4">
        <button
          onClick={() => createLink.mutate("viewer")}
          className="border border-gray-300 rounded px-3 py-1.5 text-sm hover:bg-gray-50"
        >
          Create viewer link
        </button>
        <button
          onClick={() => createLink.mutate("editor")}
          className="border border-gray-300 rounded px-3 py-1.5 text-sm hover:bg-gray-50"
        >
          Create editor link
        </button>
      </div>
      <div className="space-y-2">
        {links.map((link: any) => (
          <div key={link.id} className="flex items-center justify-between bg-white border rounded p-3 text-sm">
            <div>
              <span className="font-mono text-xs">{link.token.slice(0, 12)}...</span>
              <span className="ml-2 text-xs bg-gray-100 rounded px-1.5 py-0.5">{link.role}</span>
            </div>
            <div className="flex gap-2">
              <button onClick={() => copyLink(link.token)} className="text-xs text-blue-600 hover:underline">
                {copied === link.token ? "Copied!" : "Copy"}
              </button>
              <button onClick={() => deleteLink.mutate(link.token)} className="text-xs text-red-600 hover:underline">
                Revoke
              </button>
            </div>
          </div>
        ))}
        {!links.length && <p className="text-gray-400 text-sm">No share links yet</p>}
      </div>
    </div>
  );
}
```

Create `frontend/src/components/sharing/InviteDialog.tsx`:
```tsx
import { useState } from "react";
import { useAddMember } from "../../hooks/useMembers";

interface Props { projectId: string; }

export function InviteDialog({ projectId }: Props) {
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<"editor" | "viewer">("editor");
  const [error, setError] = useState("");
  const addMember = useAddMember(projectId);

  const handleInvite = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    try {
      await addMember.mutateAsync({ email, role });
      setEmail("");
    } catch (err: any) {
      setError(err.message);
    }
  };

  return (
    <form onSubmit={handleInvite} className="flex gap-2 items-end">
      <input
        type="email"
        placeholder="Email address"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        className="flex-1 border border-gray-300 rounded px-3 py-2 text-sm"
        required
      />
      <select value={role} onChange={(e) => setRole(e.target.value as any)} className="border border-gray-300 rounded px-3 py-2 text-sm">
        <option value="editor">Editor</option>
        <option value="viewer">Viewer</option>
      </select>
      <button type="submit" className="bg-blue-600 text-white rounded px-4 py-2 text-sm">Invite</button>
      {error && <span className="text-red-600 text-sm">{error}</span>}
    </form>
  );
}
```

- [ ] **Step 2: Implement ProjectSettings**

Replace `frontend/src/pages/ProjectSettings.tsx`:
```tsx
import { useParams } from "react-router-dom";
import { Sidebar } from "../components/layout/Sidebar";
import { MemberList } from "../components/sharing/MemberList";
import { ShareLinkManager } from "../components/sharing/ShareLinkManager";
import { InviteDialog } from "../components/sharing/InviteDialog";
import { useProjects } from "../hooks/useProjects";

export function ProjectSettings() {
  const { name } = useParams<{ name: string }>();
  const { data: projects = [] } = useProjects();
  const project = projects.find((p: any) => p.name === name);

  if (!project) return <div className="p-8 text-gray-500">Project not found</div>;

  return (
    <div className="flex h-[calc(100vh-57px)]">
      <Sidebar />
      <div className="flex-1 p-6 overflow-y-auto max-w-3xl">
        <h1 className="text-xl font-semibold mb-6">Settings — {name}</h1>

        <section className="mb-8">
          <h2 className="text-lg font-medium mb-3">Members</h2>
          <InviteDialog projectId={project.id} />
          <div className="mt-4">
            <MemberList projectId={project.id} members={project.project_members ?? []} />
          </div>
        </section>

        <section className="mb-8">
          <h2 className="text-lg font-medium mb-3">Share Links</h2>
          <ShareLinkManager projectId={project.id} />
        </section>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Commit**

```bash
git add frontend/src/components/sharing/ frontend/src/pages/ProjectSettings.tsx
git commit -m "feat: add project settings with member management and share links"
```

---

### Task 9: Activity, History, Account, and Share Accept Pages

**Files:**
- Create: `frontend/src/components/activity/ActivityFeed.tsx`
- Create: `frontend/src/components/activity/VersionTimeline.tsx`
- Create: `frontend/src/components/account/ApiKeyCard.tsx`
- Create: `frontend/src/components/account/ConnectedAccounts.tsx`
- Replace: `frontend/src/pages/ActivityPage.tsx`
- Replace: `frontend/src/pages/HistoryPage.tsx`
- Replace: `frontend/src/pages/AccountPage.tsx`
- Replace: `frontend/src/pages/ShareAcceptPage.tsx`

- [ ] **Step 1: Create ActivityFeed component**

Create `frontend/src/components/activity/ActivityFeed.tsx`:
```tsx
import type { ActivityLogEntry } from "../../types";

interface Props { entries: ActivityLogEntry[]; }

const actionLabels: Record<string, string> = {
  entry_created: "created",
  entry_updated: "updated",
  entry_deleted: "deleted",
  member_added: "added member",
  member_removed: "removed member",
  settings_changed: "changed settings",
  share_link_created: "created share link",
  share_link_revoked: "revoked share link",
};

export function ActivityFeed({ entries }: Props) {
  return (
    <div className="space-y-3">
      {entries.map((e) => (
        <div key={e.id} className="bg-white border rounded p-3 text-sm">
          <div className="flex items-center gap-2">
            <span className="font-medium">{actionLabels[e.action] ?? e.action}</span>
            <span className="text-xs bg-gray-100 rounded px-1.5 py-0.5">{e.source}</span>
            <span className="text-xs text-gray-400 ml-auto">{new Date(e.created_at).toLocaleString()}</span>
          </div>
          {e.target_path && <div className="text-gray-600 text-xs mt-1 font-mono">{e.target_path}</div>}
          {e.target_email && <div className="text-gray-600 text-xs mt-1">{e.target_email}</div>}
        </div>
      ))}
      {!entries.length && <p className="text-gray-400 text-sm">No activity yet</p>}
    </div>
  );
}
```

- [ ] **Step 2: Create VersionTimeline component**

Create `frontend/src/components/activity/VersionTimeline.tsx`:
```tsx
import type { EntryHistory } from "../../types";

interface Props {
  versions: EntryHistory[];
  onRestore: (historyId: string) => void;
}

export function VersionTimeline({ versions, onRestore }: Props) {
  return (
    <div className="space-y-3">
      {versions.map((v) => (
        <div key={v.id} className="bg-white border rounded p-4">
          <div className="flex items-center justify-between mb-2">
            <div className="text-xs text-gray-500">
              {new Date(v.changed_at).toLocaleString()} · {v.source}
            </div>
            <button
              onClick={() => onRestore(v.id)}
              className="text-xs text-blue-600 hover:underline"
            >
              Restore this version
            </button>
          </div>
          <pre className="text-xs font-mono bg-gray-50 rounded p-3 whitespace-pre-wrap max-h-48 overflow-y-auto">
            {v.content}
          </pre>
        </div>
      ))}
      {!versions.length && <p className="text-gray-400 text-sm">No version history</p>}
    </div>
  );
}
```

- [ ] **Step 3: Create account components**

Create `frontend/src/components/account/ApiKeyCard.tsx`:
```tsx
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
```

Create `frontend/src/components/account/ConnectedAccounts.tsx`:
```tsx
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
```

- [ ] **Step 4: Implement remaining pages**

Replace `frontend/src/pages/ActivityPage.tsx`:
```tsx
import { useParams } from "react-router-dom";
import { Sidebar } from "../components/layout/Sidebar";
import { ActivityFeed } from "../components/activity/ActivityFeed";
import { useActivity } from "../hooks/useActivity";
import { useProjects } from "../hooks/useProjects";

export function ActivityPage() {
  const { name } = useParams<{ name: string }>();
  const { data: projects = [] } = useProjects();
  const project = projects.find((p: any) => p.name === name);
  const { data: activity = [] } = useActivity(project?.id ?? "");

  return (
    <div className="flex h-[calc(100vh-57px)]">
      <Sidebar />
      <div className="flex-1 p-6 overflow-y-auto max-w-3xl">
        <h1 className="text-xl font-semibold mb-6">Activity — {name}</h1>
        <ActivityFeed entries={activity} />
      </div>
    </div>
  );
}
```

Replace `frontend/src/pages/HistoryPage.tsx`:
```tsx
import { useParams } from "react-router-dom";
import { Sidebar } from "../components/layout/Sidebar";
import { VersionTimeline } from "../components/activity/VersionTimeline";
import { useEntryHistory, useRestoreEntry } from "../hooks/useEntries";

export function HistoryPage() {
  const { name, "*": path } = useParams<{ name: string; "*": string }>();
  const { data: history = [] } = useEntryHistory(name!, path ?? "");
  const restoreEntry = useRestoreEntry(name!);

  const handleRestore = async (historyId: string) => {
    if (!path) return;
    await restoreEntry.mutateAsync({ path, historyId });
  };

  return (
    <div className="flex h-[calc(100vh-57px)]">
      <Sidebar />
      <div className="flex-1 p-6 overflow-y-auto max-w-3xl">
        <h1 className="text-xl font-semibold mb-2">Version History</h1>
        <p className="text-sm text-gray-500 mb-6 font-mono">{path}</p>
        <VersionTimeline versions={history} onRestore={handleRestore} />
      </div>
    </div>
  );
}
```

Replace `frontend/src/pages/AccountPage.tsx`:
```tsx
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
```

Replace `frontend/src/pages/ShareAcceptPage.tsx`:
```tsx
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
```

- [ ] **Step 5: Verify frontend compiles**

```bash
cd /Users/Tanmai.N/Documents/synapse/frontend
npx tsc --noEmit
```
Expected: No errors

- [ ] **Step 6: Commit**

```bash
git add frontend/src/
git commit -m "feat: add activity, history, account, and share accept pages"
```

---

### Task 10: Final Verification & Cleanup

**Files:**
- Modify: `frontend/package.json` (if needed)
- Verify all files

- [ ] **Step 1: TypeScript check**

```bash
cd /Users/Tanmai.N/Documents/synapse/frontend
npx tsc --noEmit
```
Expected: No errors

- [ ] **Step 2: Build test**

```bash
npm run build
```
Expected: Successful build in `frontend/dist/`

- [ ] **Step 3: Verify dev server runs**

```bash
npm run dev
```
Visit http://localhost:5173 — should show login page. Stop dev server.

- [ ] **Step 4: Commit any fixes**

```bash
git add frontend/
git commit -m "chore: final cleanup and build verification for frontend"
```
