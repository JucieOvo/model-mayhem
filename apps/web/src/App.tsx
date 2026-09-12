/**
 * 参考客户端路由。
 *
 * 作者：JucieOvo
 */

import { Route, Routes } from "react-router";
import { Layout } from "./components/Layout";
import { CollectionPage } from "./pages/CollectionPage";
import { DeckPage } from "./pages/DeckPage";
import { HomePage } from "./pages/HomePage";
import { MatchPage } from "./pages/MatchPage";
import { ReplayPage } from "./pages/ReplayPage";
import { ResearchPage } from "./pages/ResearchPage";
import { SandboxPage } from "./pages/SandboxPage";
import { SettingsPage } from "./pages/SettingsPage";
import { TutorialPage } from "./pages/TutorialPage";

export function App() {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<HomePage />} />
        <Route path="deck" element={<DeckPage />} />
        <Route path="research" element={<ResearchPage />} />
        <Route path="collection" element={<CollectionPage />} />
        <Route path="tutorial" element={<TutorialPage />} />
        <Route path="sandbox" element={<SandboxPage />} />
        <Route path="settings" element={<SettingsPage />} />
        <Route path="match/:matchId" element={<MatchPage />} />
        <Route path="replay/:matchId" element={<ReplayPage />} />
      </Route>
    </Routes>
  );
}
