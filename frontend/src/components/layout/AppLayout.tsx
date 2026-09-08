import { Outlet } from 'react-router-dom'
import { Sidebar } from './Sidebar'
import { TopBar } from './TopBar'
import { MobileTabBar } from './MobileTabBar'
import { AlertToast } from './AlertBell'
import { PageHeaderProvider } from '@/contexts/PageHeaderContext'
import { AlertFeedProvider } from '@/contexts/AlertFeedContext'

export function AppLayout() {
  return (
    <PageHeaderProvider>
      {/* Wraps the whole authenticated app so watchlist alerts keep
          arriving regardless of which page is open. */}
      <AlertFeedProvider>
        <div className="flex h-screen overflow-hidden bg-[var(--bg-canvas)]">
          <Sidebar />
          <div className="flex min-w-0 flex-1 flex-col">
            <TopBar />
            <main className="flex-1 overflow-y-auto pb-16 md:pb-0">
              <Outlet />
            </main>
          </div>
          <MobileTabBar />
        </div>
        <AlertToast />
      </AlertFeedProvider>
    </PageHeaderProvider>
  )
}
