import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { Layout } from './components/Layout';
import { AuthProvider } from './context/AuthContext';
import { TrafficProvider } from './context/TrafficContext';
import { EventDetailPage } from './pages/EventDetailPage';
import { EventsPage } from './pages/EventsPage';
import { LoginPage } from './pages/LoginPage';
import { SystemLabPage } from './pages/SystemLabPage';

export default function App() {
  return (
    <AuthProvider>
      <TrafficProvider>
        <BrowserRouter>
          <Layout>
            <Routes>
              <Route path="/" element={<EventsPage />} />
              <Route path="/events/:id" element={<EventDetailPage />} />
              <Route path="/lab" element={<SystemLabPage />} />
              <Route path="/login" element={<LoginPage />} />
              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          </Layout>
        </BrowserRouter>
      </TrafficProvider>
    </AuthProvider>
  );
}
