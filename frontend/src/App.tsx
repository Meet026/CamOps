import { lazy, Suspense } from 'react'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { AuthProvider } from '@/contexts/AuthContext'
import { ThemeProvider } from '@/contexts/ThemeContext'
import { ProtectedRoute } from '@/components/shared/ProtectedRoute'
import { FullScreenLoader } from '@/components/shared/FullScreenLoader'
import { AppLayout } from '@/components/layout/AppLayout'
import { LoginPage } from '@/pages/login/LoginPage'

// Route-level code splitting: the map (react-leaflet + leaflet.heat) and
// charts (recharts) are the heaviest dependencies in this app, and there's
// no reason a user landing on Login or Overview should pay for them
// upfront. Every authenticated page is lazy — only the login shell and app
// chrome are in the initial bundle.
const OverviewPage = lazy(() => import('@/pages/overview/OverviewPage').then((m) => ({ default: m.OverviewPage })))
const CameraListPage = lazy(() => import('@/pages/cameras/CameraListPage').then((m) => ({ default: m.CameraListPage })))
const CameraFormPage = lazy(() => import('@/pages/cameras/CameraFormPage').then((m) => ({ default: m.CameraFormPage })))
const CameraDetailPage = lazy(() => import('@/pages/cameras/CameraDetailPage').then((m) => ({ default: m.CameraDetailPage })))
const BulkUploadPage = lazy(() => import('@/pages/cameras/BulkUploadPage').then((m) => ({ default: m.BulkUploadPage })))
const GisMapPage = lazy(() => import('@/pages/map/GisMapPage').then((m) => ({ default: m.GisMapPage })))
const VehicleSearchPage = lazy(() =>
  import('@/pages/vehicle-search/VehicleSearchPage').then((m) => ({ default: m.VehicleSearchPage })),
)
const VehicleSearchResultsPage = lazy(() =>
  import('@/pages/vehicle-search/VehicleSearchResultsPage').then((m) => ({ default: m.VehicleSearchResultsPage })),
)
const ScoringQueuePage = lazy(() => import('@/pages/scoring/ScoringQueuePage').then((m) => ({ default: m.ScoringQueuePage })))
const HealthDashboardPage = lazy(() => import('@/pages/health/HealthDashboardPage').then((m) => ({ default: m.HealthDashboardPage })))
const AuditLogPage = lazy(() => import('@/pages/audit-log/AuditLogPage').then((m) => ({ default: m.AuditLogPage })))
const SettingsPage = lazy(() => import('@/pages/settings/SettingsPage').then((m) => ({ default: m.SettingsPage })))

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      refetchOnWindowFocus: false,
      staleTime: 30_000,
    },
  },
})

function RouteFallback() {
  return <FullScreenLoader />
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <BrowserRouter>
          <AuthProvider>
            <Suspense fallback={<RouteFallback />}>
              <Routes>
                <Route path="/login" element={<LoginPage />} />

                <Route
                  element={
                    <ProtectedRoute>
                      <AppLayout />
                    </ProtectedRoute>
                  }
                >
                  <Route path="/" element={<OverviewPage />} />
                  <Route path="/cameras" element={<CameraListPage />} />
                  <Route
                    path="/cameras/new"
                    element={
                      <ProtectedRoute allowedRoles={['admin', 'field_officer']}>
                        <CameraFormPage mode="create" />
                      </ProtectedRoute>
                    }
                  />
                  <Route
                    path="/cameras/:cameraId/edit"
                    element={
                      <ProtectedRoute allowedRoles={['admin', 'field_officer']}>
                        <CameraFormPage mode="edit" />
                      </ProtectedRoute>
                    }
                  />
                  <Route path="/cameras/:cameraId" element={<CameraDetailPage />} />
                  <Route
                    path="/cameras/bulk-upload"
                    element={
                      <ProtectedRoute allowedRoles={['admin', 'field_officer']}>
                        <BulkUploadPage />
                      </ProtectedRoute>
                    }
                  />
                  <Route path="/map" element={<GisMapPage />} />
                  <Route
                    path="/vehicle-search"
                    element={
                      <ProtectedRoute allowedRoles={['admin', 'field_officer']}>
                        <VehicleSearchPage />
                      </ProtectedRoute>
                    }
                  />
                  <Route
                    path="/vehicle-search/results"
                    element={
                      <ProtectedRoute allowedRoles={['admin', 'field_officer']}>
                        <VehicleSearchResultsPage />
                      </ProtectedRoute>
                    }
                  />
                  <Route
                    path="/scoring"
                    element={
                      <ProtectedRoute allowedRoles={['admin', 'field_officer']}>
                        <ScoringQueuePage />
                      </ProtectedRoute>
                    }
                  />
                  <Route
                    path="/health"
                    element={
                      <ProtectedRoute allowedRoles={['admin', 'field_officer']}>
                        <HealthDashboardPage />
                      </ProtectedRoute>
                    }
                  />
                  <Route
                    path="/audit-log"
                    element={
                      <ProtectedRoute allowedRoles={['admin', 'auditor']}>
                        <AuditLogPage />
                      </ProtectedRoute>
                    }
                  />
                  <Route path="/settings" element={<SettingsPage />} />
                </Route>

                <Route path="*" element={<Navigate to="/" replace />} />
              </Routes>
            </Suspense>
          </AuthProvider>
        </BrowserRouter>
      </ThemeProvider>
    </QueryClientProvider>
  )
}

export default App
