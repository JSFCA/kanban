"use client";

import { useEffect, useState } from "react";
import { KanbanBoard } from "@/components/KanbanBoard";
import { LoginForm } from "@/components/LoginForm";
import { fetchMe, logout, type User } from "@/lib/api";

/**
 * Decides whether to show the board or the login form.
 *
 * The site is a static export, so every visitor receives the same HTML and this
 * check runs in the browser. That is a presentation gate, not a security
 * boundary -- the board's data is protected by the session cookie on /api.
 */
export const AuthGate = () => {
  const [user, setUser] = useState<User | null>(null);
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    fetchMe()
      .then(setUser)
      .catch(() => setUser(null))
      .finally(() => setChecking(false));
  }, []);

  const handleSignOut = async () => {
    await logout();
    setUser(null);
  };

  if (checking) {
    return (
      <main className="flex min-h-screen items-center justify-center">
        <p className="text-xs font-semibold uppercase tracking-[0.3em] text-[var(--gray-text)]">
          Loading
        </p>
      </main>
    );
  }

  if (!user) {
    return <LoginForm onSignedIn={setUser} />;
  }

  return <KanbanBoard user={user} onSignOut={handleSignOut} />;
};
