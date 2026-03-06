import { createBrowserRouter, Navigate, Outlet } from 'react-router';
import { AuthScreen } from './pages/AuthScreen';
import { Dashboard } from './pages/Dashboard';
import { Courses } from './pages/Courses';
import { CourseDetail } from './pages/CourseDetail';
import { AdminPanel } from './pages/AdminPanel';
import { ProtectedRoute } from './components/ProtectedRoute';

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
        path: '*',
        Component: NotFound,
      },
    ],
  },
]);