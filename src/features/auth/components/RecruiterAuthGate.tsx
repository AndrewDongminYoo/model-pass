import {
  useEffect,
  useState,
  type FormEvent,
  type PropsWithChildren,
} from "react";
import type { User } from "@supabase/supabase-js";
import { getSupabaseClient } from "../../../lib/supabase/client";

type AuthState = User | null | undefined;

export function RecruiterAuthGate({ children }: PropsWithChildren) {
  const [user, setUser] = useState<AuthState>();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [errorMessage, setErrorMessage] = useState<string>();
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    let active = true;
    try {
      const auth = getSupabaseClient().auth;
      void auth.getSession().then(({ data, error }) => {
        if (!active) return;
        if (error !== null) {
          setErrorMessage("Could not check the recruiter session.");
          setUser(null);
          return;
        }
        setUser(data.session?.user ?? null);
      });
      const { data } = auth.onAuthStateChange((_event, session) => {
        if (active) setUser(session?.user ?? null);
      });

      return () => {
        active = false;
        data.subscription.unsubscribe();
      };
    } catch {
      void Promise.resolve().then(() => {
        if (!active) return;
        setErrorMessage("Recruiter authentication is not configured.");
        setUser(null);
      });
      return () => {
        active = false;
      };
    }
  }, []);

  async function signIn(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setErrorMessage(undefined);
    const { data, error } = await getSupabaseClient().auth.signInWithPassword({
      email,
      password,
    });
    setSubmitting(false);
    if (error !== null || data.user === null) {
      setErrorMessage("Email or password is incorrect.");
      return;
    }
    setUser(data.user);
  }

  if (user === undefined) {
    return (
      <main className="app-shell app-shell--narrow auth-shell">
        <h1 className="brand-name">Model Pass</h1>
        <p role="status">Checking recruiter session…</p>
      </main>
    );
  }
  if (user !== null) return children;

  return (
    <main className="app-shell app-shell--narrow auth-shell">
      <header className="page-header">
        <p className="eyebrow">Recruiter workspace</p>
        <h1 className="brand-name">Model Pass</h1>
        <p className="lede">
          Review structured applications without sorting through chat threads.
        </p>
      </header>
      <form className="surface form-stack" onSubmit={signIn}>
        <h2>Recruiter sign in</h2>
        <div className="field">
          <label htmlFor="recruiter-email">Email</label>
          <input
            id="recruiter-email"
            type="email"
            autoComplete="email"
            required
            value={email}
            onChange={(event) => setEmail(event.target.value)}
          />
        </div>
        <div className="field">
          <label htmlFor="recruiter-password">Password</label>
          <input
            id="recruiter-password"
            type="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
        </div>
        <button type="submit" disabled={submitting}>
          {submitting ? "Signing in…" : "Sign in"}
        </button>
        {errorMessage && <p role="alert">{errorMessage}</p>}
      </form>
    </main>
  );
}
