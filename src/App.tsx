import { Navigate, Route, Routes } from 'react-router-dom';
import Layout from './components/Layout';
import Dashboard from './pages/Dashboard';
import Members from './pages/Members';
import RouteCreate from './pages/RouteCreate';
import RouteResult from './pages/RouteResult';
import FacilitySettings from './pages/FacilitySettings';

export default function App() {
  return (
    <Layout>
      <Routes>
        <Route path="/" element={<Dashboard />} />
        <Route path="/members" element={<Members />} />
        <Route path="/create" element={<RouteCreate />} />
        <Route path="/result" element={<RouteResult />} />
        <Route path="/facility" element={<FacilitySettings />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Layout>
  );
}
