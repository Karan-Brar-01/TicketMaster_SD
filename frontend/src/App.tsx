import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { Layout } from './components/Layout';
import { SystemDashboard } from './components/SystemDashboard';
import { AuthProvider } from './context/AuthContext';
import { TrafficProvider } from './context/TrafficContext';
import { EventDetailPage } from './pages/EventDetailPage';
import { EventsPage } from './pages/EventsPage';
import { LoginPage } from './pages/LoginPage';

export default function App() {
  return (
    <AuthProvider>
      <TrafficProvider>
        <BrowserRouter>
          <Layout>
            <Routes>
              <Route path="/" element={<EventsPage />} />
              <Route path="/events/:id" element={<EventDetailPage />} />
              <Route path="/login" element={<LoginPage />} />
              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          </Layout>
          <SystemDashboard />
        </BrowserRouter>
      </TrafficProvider>
    </AuthProvider>
  );
}
