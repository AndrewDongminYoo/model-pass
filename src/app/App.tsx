import type { ReactNode } from "react";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { ApplyPage } from "../features/applications/routes/ApplyPage";
import { RecruiterAuthGate } from "../features/auth/components/RecruiterAuthGate";
import { NewOpportunityPage } from "../features/opportunities/routes/NewOpportunityPage";
import { ApplicationsPage } from "../features/recruiter/routes/ApplicationsPage";
import { HomePage } from "./HomePage";
import { I18nProvider } from "../i18n/I18nProvider";
import { LanguageSwitch } from "../i18n/LanguageSwitch";

function RecruiterOnly({ children }: { children: ReactNode }) {
  return <RecruiterAuthGate>{children}</RecruiterAuthGate>;
}

export function App() {
  const isAit = import.meta.env.VITE_APP_SURFACE === "ait";

  return (
    <I18nProvider>
      <BrowserRouter>
        <div className="language-toolbar">
          <LanguageSwitch />
        </div>
        <Routes>
          <Route path="/" element={<HomePage />} />
          <Route
            path="/opportunities/:opportunityId/apply"
            element={<ApplyPage />}
          />
          <Route
            path="/recruiter/opportunities/:opportunityId/applications"
            element={
              isAit ? (
                <Navigate to="/" replace />
              ) : (
                <RecruiterOnly>
                  <ApplicationsPage />
                </RecruiterOnly>
              )
            }
          />
          <Route
            path="/opportunities/new"
            element={
              isAit ? (
                <Navigate to="/" replace />
              ) : (
                <RecruiterOnly>
                  <NewOpportunityPage />
                </RecruiterOnly>
              )
            }
          />
          <Route path="*" element={<HomePage />} />
        </Routes>
      </BrowserRouter>
    </I18nProvider>
  );
}
