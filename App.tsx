import React, { Suspense } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import ProtectedRoute from './components/ProtectedRoute';
import { VersionUpdateNotice } from './components/VersionUpdateNotice';

const DashboardToolbarPreview = import.meta.env.DEV ? React.lazy(() => import('./pages/DashboardToolbarPreview')) : null;
const MaintenancePreview = import.meta.env.DEV ? React.lazy(() => import('./pages/MaintenancePreview')) : null;
const PayablesPreview = import.meta.env.DEV ? React.lazy(() => import('./pages/PayablesPreview')) : null;
const NativeEntryPreview = import.meta.env.DEV ? React.lazy(() => import('./pages/NativeEntryPreview')) : null;
const Login = React.lazy(() => import('./pages/Login'));
const Dashboard = React.lazy(() => import('./pages/Dashboard'));
const Reports = React.lazy(() => import('./pages/Reports'));
const BillingForecast = React.lazy(() => import('./pages/BillingForecast'));
const ItauStatement = React.lazy(() => import('./pages/ItauStatement'));
const BoletoDashboard = React.lazy(() => import('./pages/BoletoDashboard'));
const Admin = React.lazy(() => import('./pages/Admin'));

const App: React.FC = () => {
  return (
    <BrowserRouter>
      <VersionUpdateNotice />
      <Suspense fallback={null}>
        <Routes>
          {DashboardToolbarPreview && <Route path="/dev/painel-acoes" element={<DashboardToolbarPreview />} />}
          {MaintenancePreview && <Route path="/dev/manutencao" element={<MaintenancePreview />} />}
          {PayablesPreview && <Route path="/dev/pagar" element={<PayablesPreview />} />}
          {NativeEntryPreview && <Route path="/dev/lancamentos" element={<NativeEntryPreview />} />}
          <Route path="/login" element={<Login />} />
          <Route
            path="/"
            element={
              <ProtectedRoute>
                <Dashboard />
              </ProtectedRoute>
            }
          />
          <Route
            path="/relatorios"
            element={
              <ProtectedRoute>
                <Reports />
              </ProtectedRoute>
            }
          />
          <Route
            path="/faturamento"
            element={
              <ProtectedRoute>
                <BillingForecast />
              </ProtectedRoute>
            }
          />
          <Route
            path="/admin"
            element={
              <ProtectedRoute roles={['admin']}>
                <Admin />
              </ProtectedRoute>
            }
          />
          <Route path="/extrato-itau" element={<ProtectedRoute><ItauStatement /></ProtectedRoute>} />
          <Route path="/boletos" element={<ProtectedRoute><BoletoDashboard /></ProtectedRoute>} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </Suspense>
    </BrowserRouter>
  );
};

export default App;
