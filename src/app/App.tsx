import { BrowserRouter, Route, Routes } from "react-router-dom";
import { NewOpportunityPage } from "../features/opportunities/routes/NewOpportunityPage";

export function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="*" element={<NewOpportunityPage />} />
      </Routes>
    </BrowserRouter>
  );
}
