import { Routes, Route, Navigate } from 'react-router-dom';
import { useAuthStore } from './store/auth.store';
import Layout from './components/Layout';
import Login from './pages/Login';
import Dashboard from './pages/Dashboard';
import TierBoard from './pages/DMS/TierBoard';
import Actions from './pages/DMS/Actions';
import OEE from './pages/Analytics/OEE';
import Loss from './pages/Analytics/Loss';
import AndonDashboard from './pages/Andon/Dashboard';
import SPCCharts from './pages/Quality/SPC';
import AssetTelemetry from './pages/Assets/Telemetry';
import { useEffect } from 'react';
import { useOffline } from './hooks/useOffline';

function App() {
  const { isAuthenticated, checkAuth } = useAuthStore();
  const isOffline = useOffline();

  useEffect(() => {
    checkAuth();
  }, [checkAuth]);

  if (!isAuthenticated) {
    return <Login />;
  }

  return (
    <>
      {isOffline && (
        <div className="bg-yellow-500 text-white text-center py-2">
          Offline Mode - Data will sync when connection is restored
        </div>
      )}
      <Layout>
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/dms/tier-board" element={<TierBoard />} />
          <Route path="/dms/actions" element={<Actions />} />
          <Route path="/analytics/oee" element={<OEE />} />
          <Route path="/analytics/loss" element={<Loss />} />
          <Route path="/andon" element={<AndonDashboard />} />
          <Route path="/quality/spc" element={<SPCCharts />} />
          <Route path="/assets/telemetry" element={<AssetTelemetry />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </Layout>
    </>
  );
}

export default App;