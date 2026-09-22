import {
  useEffect,
  useState,
  type FormEvent,
  type PropsWithChildren,
} from "react";
import type { User } from "@supabase/supabase-js";
import { getSupabaseClient } from "../../../lib/supabase/client";
import { appNameFor } from "../../../i18n/brand";
import { useI18n } from "../../../i18n/locale";

type AuthState = User | null | undefined;

export function RecruiterAuthGate({ children }: PropsWithChildren) {
  const { locale, t } = useI18n();
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
          setErrorMessage("로그인 상태를 확인하지 못했습니다.");
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
        setErrorMessage("모집자 로그인이 아직 설정되지 않았습니다.");
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
      setErrorMessage("이메일 또는 비밀번호가 올바르지 않습니다.");
      return;
    }
    setUser(data.user);
  }

  if (user === undefined) {
    return (
      <main className="app-shell app-shell--narrow auth-shell">
        <h1 className="brand-name">{appNameFor(locale)}</h1>
        <p role="status">
          {t("Checking sign-in status…", "로그인 상태를 확인하고 있습니다…")}
        </p>
      </main>
    );
  }
  if (user !== null) return children;

  return (
    <main className="app-shell app-shell--narrow auth-shell">
      <header className="page-header">
        <p className="eyebrow">{t("Recruiter workspace", "모집자 공간")}</p>
        <h1 className="brand-name">{appNameFor(locale)}</h1>
        <p className="lede">
          {t(
            "Review eligibility and applications without sorting through every chat.",
            "채팅을 일일이 살펴보지 않아도 지원 조건과 내용을 확인할 수 있습니다.",
          )}
        </p>
      </header>
      <form className="surface form-stack" onSubmit={signIn}>
        <h2>{t("Recruiter sign in", "모집자 로그인")}</h2>
        <div className="field">
          <label htmlFor="recruiter-email">{t("Email", "이메일")}</label>
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
          <label htmlFor="recruiter-password">
            {t("Password", "비밀번호")}
          </label>
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
          {submitting
            ? t("Signing in…", "로그인하고 있습니다…")
            : t("Sign in", "로그인")}
        </button>
        {errorMessage && (
          <p role="alert">{localizeAuthError(errorMessage, locale)}</p>
        )}
      </form>
    </main>
  );
}

function localizeAuthError(message: string, locale: "ko" | "en"): string {
  if (locale === "ko") return message;
  switch (message) {
    case "로그인 상태를 확인하지 못했습니다.":
      return "Could not check your sign-in status.";
    case "모집자 로그인이 아직 설정되지 않았습니다.":
      return "Recruiter sign-in is not configured yet.";
    case "이메일 또는 비밀번호가 올바르지 않습니다.":
      return "Incorrect email or password.";
    default:
      return message;
  }
}
