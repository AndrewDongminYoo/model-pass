import { BrowserRouter, Route, Routes } from "react-router-dom";
import { ApplyPage } from "../features/applications/routes/ApplyPage";
import { NewOpportunityPage } from "../features/opportunities/routes/NewOpportunityPage";

export function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route
          path="/opportunities/:opportunityId/apply"
          element={<ApplyPage />}
        />
        <Route path="/opportunities/new" element={<NewOpportunityPage />} />
        <Route path="*" element={<NewOpportunityPage />} />
      </Routes>
    </BrowserRouter>
  );
}
