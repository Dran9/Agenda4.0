import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import BookingFlow from './pages/BookingFlow';

// Admin pages - lazy loaded to reduce initial bundle
import { lazy, Suspense } from 'react';
const AdminLogin = lazy(() => import('./pages/Admin/Login'));
const AdminDashboard = lazy(() => import('./pages/Admin/Dashboard'));
const AdminClients = lazy(() => import('./pages/Admin/Clients'));
const AdminAppointments = lazy(() => import('./pages/Admin/Appointments'));
const AdminQuickActions = lazy(() => import('./pages/Admin/QuickActions'));
const AdminConfig = lazy(() => import('./pages/Admin/Config'));
const AdminAnalytics = lazy(() => import('./pages/Admin/Analytics'));
const AdminWhatsApp = lazy(() => import('./pages/Admin/WhatsApp'));
const AdminFinance = lazy(() => import('./pages/Admin/Finance'));
const AdminPreview = lazy(() => import('./pages/Admin/Preview'));
const VoiceAssistant = lazy(() => import('./pages/VoiceAssistant'));

function AdminFallback() {
  return (
    <div className="min-h-screen flex items-center justify-center">
      <div className="text-gray-400">Cargando...</div>
    </div>
  );
}

function AdminEntryRedirect() {
  const token = typeof window !== 'undefined' ? window.localStorage.getItem('auth_token') : null;
  return <Navigate to={token ? '/admin/quick-actions' : '/admin/login'} replace />;
}

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        {/* Public: Booking Flow */}
        <Route path="/" element={<BookingFlow />} />

        {/* Admin login */}
        <Route path="/admin/login" element={
          <Suspense fallback={<AdminFallback />}>
            <AdminLogin />
          </Suspense>
        } />

        {/* Admin routes */}
        <Route path="/admin" element={
          <AdminEntryRedirect />
        } />
        <Route path="/admin/dashboard" element={
          <Suspense fallback={<AdminFallback />}>
            <AdminDashboard />
          </Suspense>
        } />
        <Route path="/admin/clients" element={
          <Suspense fallback={<AdminFallback />}>
            <AdminClients />
          </Suspense>
        } />
        <Route path="/admin/appointments" element={
          <Suspense fallback={<AdminFallback />}>
            <AdminAppointments />
          </Suspense>
        } />
        <Route path="/admin/quick-actions" element={
          <Suspense fallback={<AdminFallback />}>
            <AdminQuickActions />
          </Suspense>
        } />
        <Route path="/admin/config" element={
          <Suspense fallback={<AdminFallback />}>
            <AdminConfig />
          </Suspense>
        } />
        <Route path="/admin/analytics" element={
          <Suspense fallback={<AdminFallback />}>
            <AdminAnalytics />
          </Suspense>
        } />
        <Route path="/admin/whatsapp" element={
          <Suspense fallback={<AdminFallback />}>
            <AdminWhatsApp />
          </Suspense>
        } />
        <Route path="/admin/finance" element={
          <Suspense fallback={<AdminFallback />}>
            <AdminFinance />
          </Suspense>
        } />
        <Route path="/admin-preview" element={
          <Suspense fallback={<AdminFallback />}>
            <AdminPreview />
          </Suspense>
        } />
        <Route path="/voice" element={
          <Suspense fallback={<AdminFallback />}>
            <VoiceAssistant />
          </Suspense>
        } />

        {/* Catch-all */}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}
