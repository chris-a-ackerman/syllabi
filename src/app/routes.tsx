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

// Wrapper components for protected routes
function ProtectedDashboard() {
  return (
    <ProtectedRoute>
      <Dashboard />
    </ProtectedRoute>
  );
}

function ProtectedCourses() {
  return (
    <ProtectedRoute>
      <Courses />
    </ProtectedRoute>
  );
}

function ProtectedCourseDetail() {
  return (
    <ProtectedRoute>
      <CourseDetail />
    </ProtectedRoute>
  );
}

function ProtectedAdminPanel() {
  return (
    <ProtectedRoute adminOnly>
      <AdminPanel />
    </ProtectedRoute>
  );
}

function ProtectedCanvasSettings() {
  return (
    <ProtectedRoute>
      <CanvasSettings />
    </ProtectedRoute>
  );
}

function ProtectedAgenda() {
  return (
    <ProtectedRoute>
      <Agenda />
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
        path: '/dashboard',
        Component: ProtectedDashboard,
      },
      {
        path: '/courses',
        Component: ProtectedCourses,
      },
      {
        path: '/course/:id',
        Component: ProtectedCourseDetail,
      },
      {
        path: '/admin',
        Component: ProtectedAdminPanel,
      },
      {
        path: '/settings/canvas',
        Component: ProtectedCanvasSettings,
      },
      {
        path: '/agenda',
        Component: ProtectedAgenda,
      },
      {
        path: '*',
        Component: NotFound,
      },
    ],
  },
]);