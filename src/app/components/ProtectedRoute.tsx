import { ReactNode } from 'react';
import { Navigate } from 'react-router';
import { useAuth } from '../context/AuthProvider';

interface ProtectedRouteProps {
  children: ReactNode;
  adminOnly?: boolean;
}

export function ProtectedRoute({ children, adminOnly = false }: ProtectedRouteProps) {
  const { user, loading, profileLoaded } = useAuth();

  if (loading) {
    return null;
  }

  if (!user) {
    return <Navigate to="/" replace />;
  }

  if (adminOnly) {
    // isAdmin is a placeholder until the profile fetch settles — deciding on
    // it early bounced admins off a directly-loaded /admin (SYL-55).
    if (!profileLoaded) {
      return null;
    }
    if (!user.isAdmin) {
      return <Navigate to="/dashboard" replace />;
    }
  }

  return <>{children}</>;
}
