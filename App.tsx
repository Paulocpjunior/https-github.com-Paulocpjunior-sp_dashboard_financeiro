import React, { Suspense } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthService } from './services/authService';
import ProtectedRoute from './components/ProtectedRoute';
import { VersionUpdateNotice } from './components/VersionUpdateNotice';

const Login = React.lazy(() => import('./pages/Login'));
const Dashboard = React.lazy(() => import('./pages/Dashboard'));
const Reports = React.lazy(() => import('./pages/Reports'));
const BillingForecast = React.lazy(() => import('./pages/BillingForecast'));
const ItauStatement = React.lazy(() => import('./pages/ItauStatement'));
const Receivables = React.lazy(() => import('./pages/Receivables'));
const Reconciliation = React.lazy(() => import('./pages/Reconciliation'));
const FinancialHome = () => AuthService.getCurrentUser()?.role === 'admin' ? <Dashboard /> : <Receivables />;
const Admin = React.lazy(() => import('./pages/Admin'));

const App: React.FC = () => {
  return (
    <BrowserRouter>
      <VersionUpdateNotice />
      <Suspense fallback={null}>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route
            path="/"
            element={
              <ProtectedRoute>
                <FinancialHome />
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
          <Route path="/extrato-itau" element={<ProtectedRoute roles={['admin']}><ItauStatement /></ProtectedRoute>} />
          <Route path="/conciliacao" element={<ProtectedRoute roles={['admin']}><Reconciliation /></ProtectedRoute>} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </Suspense>
    </BrowserRouter>
  );
};

export default App;
