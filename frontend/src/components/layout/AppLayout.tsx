import { Outlet } from 'react-router-dom'
import { Sidebar } from './Sidebar'
import { TopBar } from './TopBar'
import { MobileTabBar } from './MobileTabBar'
import { PageHeaderProvider } from '@/contexts/PageHeaderContext'

export function AppLayout() {
  return (
    <PageHeaderProvider>
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
    </PageHeaderProvider>
  )
}
