import { lazy, Suspense, type ReactNode } from 'react';
import {
  createBrowserRouter,
  Navigate,
  Outlet,
  RouterProvider,
  useSearchParams,
} from 'react-router';

import { AppShell } from '@/components/layout/app-shell';
import { ProtectedRoute } from '@/components/layout/protected-route';
import { ErrorBoundary } from '@/components/error-boundary';
import { AuthProvider } from '@/contexts/auth-provider';
import { useAuth } from '@/contexts/auth-context';
import { config } from '@/lib/config';

const LoginPage = lazy(() =>
  import('@/pages/auth/login-page').then((m) => ({ default: m.LoginPage })),
);
const ForgotPasswordPage = lazy(() =>
  import('@/pages/auth/forgot-password-page').then((m) => ({
    default: m.ForgotPasswordPage,
  })),
);
const FirstTimeSetupPage = lazy(() =>
  import('@/pages/auth/first-time-setup-page').then((m) => ({
    default: m.FirstTimeSetupPage,
  })),
);
const DashboardPage = lazy(() =>
  import('@/pages/dashboard/dashboard-page').then((m) => ({
    default: m.DashboardPage,
  })),
);
const DepartmentsPage = lazy(() =>
  import('@/pages/organization/departments-page').then((m) => ({
    default: m.DepartmentsPage,
  })),
);
const PositionsPage = lazy(() =>
  import('@/pages/organization/positions-page').then((m) => ({
    default: m.PositionsPage,
  })),
);
const EmployeeListPage = lazy(() =>
  import('@/pages/employees/employee-list-page').then((m) => ({
    default: m.EmployeeListPage,
  })),
);
const EmployeeProfilePage = lazy(() =>
  import('@/pages/employees/employee-profile-page').then((m) => ({
    default: m.EmployeeProfilePage,
  })),
);
const EmployeeFormPage = lazy(() =>
  import('@/pages/employees/employee-form-page').then((m) => ({
    default: m.EmployeeFormPage,
  })),
);
const AuditLogPage = lazy(() =>
  import('@/pages/audit-log/audit-log-page').then((m) => ({
    default: m.AuditLogPage,
  })),
);
const RequisitionsPage = lazy(() =>
  import('@/pages/recruitment/requisitions-page').then((m) => ({
    default: m.RequisitionsPage,
  })),
);
const CandidatesPage = lazy(() =>
  import('@/pages/recruitment/candidates-page').then((m) => ({
    default: m.CandidatesPage,
  })),
);
const OnboardingPage = lazy(() =>
  import('@/pages/recruitment/onboarding-page').then((m) => ({
    default: m.OnboardingPage,
  })),
);
const InterviewsPage = lazy(() =>
  import('@/pages/recruitment/interviews-page').then((m) => ({
    default: m.InterviewsPage,
  })),
);
const OffersPage = lazy(() =>
  import('@/pages/recruitment/offers-page').then((m) => ({
    default: m.OffersPage,
  })),
);
const UserManagementPage = lazy(() =>
  import('@/pages/admin/user-management-page').then((m) => ({
    default: m.UserManagementPage,
  })),
);
const RetentionPoliciesPage = lazy(() =>
  import('@/pages/admin/compliance/retention-policies-page').then((m) => ({
    default: m.RetentionPoliciesPage,
  })),
);
const BreachRegisterPage = lazy(() =>
  import('@/pages/admin/compliance/breach-register-page').then((m) => ({
    default: m.BreachRegisterPage,
  })),
);
const DsarQueuePage = lazy(() =>
  import('@/pages/admin/compliance/dsar-queue-page').then((m) => ({
    default: m.DsarQueuePage,
  })),
);
const ConsentManagementPage = lazy(() =>
  import('@/pages/admin/compliance/consent-management-page').then((m) => ({
    default: m.ConsentManagementPage,
  })),
);
const KeyManagementPage = lazy(() =>
  import('@/pages/admin/compliance/key-management-page').then((m) => ({
    default: m.KeyManagementPage,
  })),
);
const DataSubjectRightsPage = lazy(() =>
  import('@/pages/admin/compliance/data-subject-rights-page').then((m) => ({
    default: m.DataSubjectRightsPage,
  })),
);
const MyDataPage = lazy(() =>
  import('@/pages/privacy/my-data-page').then((m) => ({ default: m.MyDataPage })),
);
const AttendanceLeavePage = lazy(() =>
  import('@/pages/attendance/attendance-leave-page').then((m) => ({
    default: m.AttendanceLeavePage,
  })),
);
const LeaveHolidaysPage = lazy(() =>
  import('@/pages/attendance/leave-holidays-page').then((m) => ({
    default: m.LeaveHolidaysPage,
  })),
);
const PerformancePage = lazy(() =>
  import('@/pages/performance/performance-page').then((m) => ({
    default: m.PerformancePage,
  })),
);
const OffboardingPage = lazy(() =>
  import('@/pages/offboarding/offboarding-page').then((m) => ({
    default: m.OffboardingPage,
  })),
);
const ProfilePage = lazy(() =>
  import('@/pages/profile/profile-page').then((m) => ({ default: m.ProfilePage })),
);
const AccountSettingsPage = lazy(() =>
  import('@/pages/settings/account-settings-page').then((m) => ({
    default: m.AccountSettingsPage,
  })),
);
const NotFoundPage = lazy(() =>
  import('@/pages/auth/not-found-page').then((m) => ({ default: m.NotFoundPage })),
);

function PageFallback() {
  return (
    <div className="flex h-screen items-center justify-center bg-ink-50">
      <span className="h-8 w-8 animate-spin rounded-full border-2 border-ink-200 border-t-accent-500" />
    </div>
  );
}

/**
 * Combines an error boundary with a Suspense fallback so that a render error or
 * a slow lazy chunk in one page never crashes the shared shell.
 */
function PageRoute({ children }: { children: ReactNode }) {
  return (
    <ErrorBoundary>
      <Suspense fallback={<PageFallback />}>{children}</Suspense>
    </ErrorBoundary>
  );
}

/**
 * Normalizes a deep-link path restored from the `p` query param. `404.html`
 * preserves the full requested path, which may or may not include the deployed
 * base path (e.g. `/peoplevate/login` vs `/login`). The router's basename
 * resolves routes relative to the base, so any base-path prefix must be
 * stripped here to avoid double-prefixing.
 */
function normalizePendingPath(pendingPath: string): string {
  const { basePath } = config;
  let path = pendingPath;
  if (basePath !== '/' && path.startsWith(basePath)) {
    path = path.slice(basePath.length);
  }
  return path === '' ? '/' : path;
}

/**
 * Redirects the root path to the login page (or the app when already
 * authenticated). Also restores a deep link delivered via the `p` query param,
 * which `404.html` sets when GitHub Pages intercepts a direct URL access (e.g.
 * refreshing on `/login`).
 */
function RootRedirect() {
  const { isAuthenticated, isLoading } = useAuth();
  const [searchParams] = useSearchParams();
  const pendingPath = searchParams.get('p');

  if (isLoading) {
    return <PageFallback />;
  }

  if (pendingPath) {
    return <Navigate to={normalizePendingPath(pendingPath)} replace />;
  }

  return <Navigate to={isAuthenticated ? '/app' : '/login'} replace />;
}

const router = createBrowserRouter(
  [
    {
      element: (
        <AuthProvider>
          <Outlet />
        </AuthProvider>
      ),
      children: [
        {
          index: true,
          element: <RootRedirect />,
        },
        {
          path: '/login',
          element: (
            <PageRoute>
              <LoginPage />
            </PageRoute>
          ),
        },
        {
          path: '/forgot-password',
          element: (
            <PageRoute>
              <ForgotPasswordPage />
            </PageRoute>
          ),
        },
        {
          path: '/setup',
          element: (
            <PageRoute>
              <FirstTimeSetupPage />
            </PageRoute>
          ),
        },
        {
          element: <ProtectedRoute />,
          children: [
            {
              element: <AppShell />,
              children: [
                // ---- Unrestricted: accessible to all authenticated users ----
                {
                  path: '/app',
                  element: (
                    <PageRoute>
                      <DashboardPage />
                    </PageRoute>
                  ),
                },
                {
                  path: '/app/profile',
                  element: (
                    <PageRoute>
                      <ProfilePage />
                    </PageRoute>
                  ),
                },
                {
                  path: '/app/settings',
                  element: (
                    <PageRoute>
                      <AccountSettingsPage />
                    </PageRoute>
                  ),
                },
                {
                  path: '/app/my-data',
                  element: (
                    <PageRoute>
                      <MyDataPage />
                    </PageRoute>
                  ),
                },
                {
                  path: '/app/employees',
                  element: (
                    <PageRoute>
                      <EmployeeListPage />
                    </PageRoute>
                  ),
                },
                {
                  path: '/app/leave-holidays',
                  element: (
                    <PageRoute>
                      <LeaveHolidaysPage />
                    </PageRoute>
                  ),
                },
                // ---- Admin/HR only: Create employee ----
                {
                  element: <ProtectedRoute roles={['Admin', 'HR Manager']} />,
                  children: [
                    {
                      path: '/app/employees/new',
                      element: (
                        <PageRoute>
                          <EmployeeFormPage />
                        </PageRoute>
                      ),
                    },
                  ],
                },
                {
                  path: '/app/employees/:id',
                  element: (
                    <PageRoute>
                      <EmployeeProfilePage />
                    </PageRoute>
                  ),
                },
                // ---- Admin/HR only: Edit employee ----
                {
                  element: <ProtectedRoute roles={['Admin', 'HR Manager']} />,
                  children: [
                    {
                      path: '/app/employees/:id/edit',
                      element: (
                        <PageRoute>
                          <EmployeeFormPage />
                        </PageRoute>
                      ),
                    },
                  ],
                },
                // ---- Admin/HR only: Organization management ----
                {
                  element: <ProtectedRoute roles={['Admin', 'HR Manager']} />,
                  children: [
                    {
                      path: '/app/departments',
                      element: (
                        <PageRoute>
                          <DepartmentsPage />
                        </PageRoute>
                      ),
                    },
                    {
                      path: '/app/positions',
                      element: (
                        <PageRoute>
                          <PositionsPage />
                        </PageRoute>
                      ),
                    },
                    {
                      path: '/app/audit-log',
                      element: (
                        <PageRoute>
                          <AuditLogPage />
                        </PageRoute>
                      ),
                    },
                  ],
                },
                {
                  path: '/app/recruitment',
                  element: (
                    <PageRoute>
                      <RequisitionsPage />
                    </PageRoute>
                  ),
                },
                {
                  path: '/app/recruitment/candidates',
                  element: (
                    <PageRoute>
                      <CandidatesPage />
                    </PageRoute>
                  ),
                },
                {
                  path: '/app/recruitment/onboarding',
                  element: (
                    <PageRoute>
                      <OnboardingPage />
                    </PageRoute>
                  ),
                },
                {
                  path: '/app/recruitment/interviews',
                  element: (
                    <PageRoute>
                      <InterviewsPage />
                    </PageRoute>
                  ),
                },
                {
                  path: '/app/recruitment/offers',
                  element: (
                    <PageRoute>
                      <OffersPage />
                    </PageRoute>
                  ),
                },
                // ---- Admin only: User Management ----
                {
                  element: <ProtectedRoute roles={['Admin']} />,
                  children: [
                    {
                      path: '/app/users',
                      element: (
                        <PageRoute>
                          <UserManagementPage />
                        </PageRoute>
                      ),
                    },
                  ],
                },
                {
                  path: '/app/attendance',
                  element: (
                    <PageRoute>
                      <AttendanceLeavePage />
                    </PageRoute>
                  ),
                },
                {
                  path: '/app/performance',
                  element: (
                    <PageRoute>
                      <PerformancePage />
                    </PageRoute>
                  ),
                },
                {
                  path: '/app/offboarding',
                  element: (
                    <PageRoute>
                      <OffboardingPage />
                    </PageRoute>
                  ),
                },
                // ---- Admin/HR only: GDPR compliance ----
                {
                  element: <ProtectedRoute roles={['Admin', 'HR Manager']} />,
                  children: [
                    {
                      path: '/app/compliance/retention',
                      element: (
                        <PageRoute>
                          <RetentionPoliciesPage />
                        </PageRoute>
                      ),
                    },
                    {
                      path: '/app/compliance/breach',
                      element: (
                        <PageRoute>
                          <BreachRegisterPage />
                        </PageRoute>
                      ),
                    },
                    {
                      path: '/app/compliance/dsar',
                      element: (
                        <PageRoute>
                          <DsarQueuePage />
                        </PageRoute>
                      ),
                    },
                    {
                      path: '/app/compliance/consent',
                      element: (
                        <PageRoute>
                          <ConsentManagementPage />
                        </PageRoute>
                      ),
                    },
                    {
                      path: '/app/compliance/keys',
                      element: (
                        <PageRoute>
                          <KeyManagementPage />
                        </PageRoute>
                      ),
                    },
                    {
                      path: '/app/compliance/data-subject-rights',
                      element: (
                        <PageRoute>
                          <DataSubjectRightsPage />
                        </PageRoute>
                      ),
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
    },
    {
      path: '*',
      element: (
        <PageRoute>
          <NotFoundPage />
        </PageRoute>
      ),
    },
  ],
  // GitHub Pages project sites serve the SPA under a subpath
  // (https://<owner>.github.io/<repo>/), so all routes must be scoped to that
  // base. `basePath` is derived from VITE_BASE_PATH and kept in sync with the
  // Vite `base` used for asset URLs.
  { basename: config.basePath },
);

export function AppRouter() {
  return <RouterProvider router={router} />;
}
