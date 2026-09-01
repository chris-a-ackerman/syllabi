import { createBrowserRouter, Navigate, Outlet } from 'react-router';
import { AuthScreen } from './pages/AuthScreen';
import { AuthCallback } from './pages/AuthCallback';
import { Dashboard } from './pages/Dashboard';
import { Courses } from './pages/Courses';
import { CourseDetail } from './pages/CourseDetail';
import { AdminPanel } from './pages/AdminPanel';
import { Onboarding } from './pages/Onboarding';
import { CanvasSettings } from './pages/CanvasSettings';
import { Agenda } from './pages/Agenda';
import { ProtectedRoute } from './components/ProtectedRoute';
import { useAuth } from './context/AuthProvider';

// Root layout: renders child routes
function RootLayout() {
  return <Outlet />;
}

// Single guard for every signed-in route (SYL-42); the /admin subtree adds
// the admin check on top.
function ProtectedLayout({ adminOnly = false }: { adminOnly?: boolean }) {
  return (
    <ProtectedRoute adminOnly={adminOnly}>
      <Outlet />
    </ProtectedRoute>
  );
}

function ProtectedOnboarding() {
  const { user, loading, profileLoaded } = useAuth();
  if (loading) return null;
  if (!user) return <Navigate to="/" replace />;
  // onboardingCompleted is a placeholder until the profile fetch settles;
  // don't render (or skip) onboarding off the placeholder (SYL-55).
  if (!profileLoaded) return null;
  if (user.onboardingCompleted) return <Navigate to="/dashboard" replace />;
  return <Onboarding />;
}

function NotFound() {
  return <Navigate to="/" replace />;
}

export const router = createBrowserRouter([
  {
    Component: RootLayout,
    children: [
      {
        path: '/',
        Component: AuthScreen,
      },
      {
        path: '/auth/callback',
        Component: AuthCallback,
      },
      {
        path: '/onboarding',
        Component: ProtectedOnboarding,
      },
      {
        Component: ProtectedLayout,
        children: [
          { path: '/dashboard', Component: Dashboard },
          { path: '/courses', Component: Courses },
          { path: '/course/:id', Component: CourseDetail },
          { path: '/settings/canvas', Component: CanvasSettings },
          { path: '/agenda', Component: Agenda },
        ],
      },
      {
        element: <ProtectedLayout adminOnly />,
        children: [{ path: '/admin', Component: AdminPanel }],
      },
      {
        path: '*',
        Component: NotFound,
      },
    ],
  },
]);