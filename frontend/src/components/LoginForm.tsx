import { useState, type FormEvent } from "react";
import { login, type User } from "@/lib/api";

type LoginFormProps = {
  onSignedIn: (user: User) => void;
};

const fieldClasses =
  "w-full rounded-xl border border-[var(--stroke)] bg-white px-3 py-2 text-sm text-[var(--navy-dark)] outline-none transition focus:border-[var(--primary-blue)]";

export const LoginForm = ({ onSignedIn }: LoginFormProps) => {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);
    setPending(true);
    try {
      onSignedIn(await login(username, password));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Sign in failed");
      setPending(false);
    }
  };

  return (
    <main className="flex min-h-screen items-center justify-center px-6">
      <form
        onSubmit={handleSubmit}
        className="w-full max-w-sm rounded-[32px] border border-[var(--stroke)] bg-white/80 p-8 shadow-[var(--shadow)] backdrop-blur"
      >
        <div className="h-1 w-12 rounded-full bg-[var(--accent-yellow)]" />
        <h1 className="mt-4 font-display text-3xl font-semibold text-[var(--navy-dark)]">
          Kanban Studio
        </h1>
        <p className="mt-2 text-sm leading-6 text-[var(--gray-text)]">
          Sign in to open your board.
        </p>

        <label className="mt-6 block text-xs font-semibold uppercase tracking-[0.2em] text-[var(--gray-text)]">
          Username
          <input
            value={username}
            onChange={(event) => setUsername(event.target.value)}
            autoComplete="username"
            className={`mt-2 ${fieldClasses}`}
          />
        </label>

        <label className="mt-4 block text-xs font-semibold uppercase tracking-[0.2em] text-[var(--gray-text)]">
          Password
          <input
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            autoComplete="current-password"
            className={`mt-2 ${fieldClasses}`}
          />
        </label>

        {error && (
          <p
            role="alert"
            className="mt-4 rounded-xl bg-[var(--surface)] px-3 py-2 text-sm text-[var(--secondary-purple)]"
          >
            {error}
          </p>
        )}

        <button
          type="submit"
          disabled={pending}
          className="mt-6 w-full rounded-full bg-[var(--secondary-purple)] px-4 py-3 text-xs font-semibold uppercase tracking-wide text-white transition hover:brightness-110 disabled:opacity-60"
        >
          {pending ? "Signing in" : "Sign in"}
        </button>
      </form>
    </main>
  );
};
