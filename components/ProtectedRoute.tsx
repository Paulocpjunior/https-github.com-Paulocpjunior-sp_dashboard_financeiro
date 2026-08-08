import React, { useEffect, useState } from 'react';
import { Navigate } from 'react-router-dom';
import { AuthService } from '../services/authService';
import { auth } from '../services/firebaseConfig';
import { consultarGateDepartamento, type GateDepartamento } from '../services/departamentoGate';
import { logger } from '../utils/logger';

interface ProtectedRouteProps {
  children: React.ReactNode;
  roles?: string[];
}

const ProtectedRoute: React.FC<ProtectedRouteProps> = ({ children, roles }) => {
  const isAuthenticated = AuthService.isAuthenticated();
  const user = AuthService.getCurrentUser();

  // Gate de departamento do SaaS (08/08): pergunta ao cadastro central do CFI
  // se este usuário abre o módulo Financeiro. Em modo aviso nunca bloqueia;
  // falha do túnel LIBERA (indeterminado é log, não banner). A pergunta vai
  // com o e-mail do PERFIL — o do Firebase Auth pode ser credencial técnica
  // do login por username.
  const [gate, setGate] = useState<GateDepartamento | null>(null);
  useEffect(() => {
    if (!isAuthenticated || !user?.email) return;
    let vivo = true;
    consultarGateDepartamento(user.email, async () => {
      const u = auth.currentUser;
      if (!u) throw new Error('sem sessão Firebase');
      return await u.getIdToken();
    }).then((g) => {
      if (!vivo) return;
      if (g.indeterminado) logger.warn(`[departamento-gate] indeterminado: ${g.motivo}`);
      setGate(g);
    });
    return () => { vivo = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAuthenticated, user?.email]);

  if (!isAuthenticated) {
    return <Navigate to="/login" replace />;
  }

  if (roles && user) {
    // Normalização para garantir comparação correta (Admin vs admin)
    const userRole = (user.role || '').toLowerCase().trim();
    const allowedRoles = roles.map(r => r.toLowerCase().trim());

    if (!allowedRoles.includes(userRole)) {
      logger.warn(`[ProtectedRoute] Acesso negado. Role usuário: ${userRole}, Permitidos: ${allowedRoles.join(', ')}`);
      return <Navigate to="/" replace />; // Redirect unauthorized access to home
    }
  }

  if (gate && !gate.permitido) {
    // Modo bloqueio: quem vincula é o admin, no Gerenciar Usuários do CFI.
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24, textAlign: 'center' }}>
        <div style={{ maxWidth: 520 }}>
          <div style={{ fontSize: 40 }}>🔒</div>
          <h2 style={{ margin: '12px 0' }}>Sem vínculo com o módulo Financeiro</h2>
          <p style={{ lineHeight: 1.6, color: '#64748b' }}>{gate.motivo}</p>
        </div>
      </div>
    );
  }

  return (
    <>
      {gate?.aviso && (
        <div style={{ background: '#fffbeb', color: '#92400e', borderBottom: '1px solid #fde68a', padding: '10px 16px', fontSize: 13, textAlign: 'center' }}>
          ⚠ {gate.aviso}
        </div>
      )}
      {children}
    </>
  );
};

export default ProtectedRoute;
