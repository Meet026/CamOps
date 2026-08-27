import { createContext, useContext, useState, type ReactNode } from 'react'

interface PageHeaderState {
  title: string
  action: ReactNode | null
}

interface PageHeaderContextValue extends PageHeaderState {
  setPageHeader: (title: string, action?: ReactNode) => void
}

const PageHeaderContext = createContext<PageHeaderContextValue | null>(null)

export function PageHeaderProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<PageHeaderState>({ title: '', action: null })

  const setPageHeader = (title: string, action: ReactNode = null) => {
    setState({ title, action })
  }

  return (
    <PageHeaderContext.Provider value={{ ...state, setPageHeader }}>
      {children}
    </PageHeaderContext.Provider>
  )
}

export function usePageHeader(): PageHeaderContextValue {
  const ctx = useContext(PageHeaderContext)
  if (!ctx) throw new Error('usePageHeader must be used within a PageHeaderProvider')
  return ctx
}
