import { useEffect, useRef, type ReactNode } from 'react'
import { usePageHeader } from '@/contexts/PageHeaderContext'

/**
 * Declarative wrapper: call once per page to set the top bar's title +
 * primary action.
 *
 * `action` is commonly inline JSX (e.g. `usePageTitle('Cameras', <div>...
 * </div>)`), which is a brand-new object identity on every single render.
 * Naively including it in a useEffect dependency array causes an infinite
 * loop: new action -> effect fires -> setPageHeader -> context update ->
 * re-render -> new action identity again. (Caught via a real headless-
 * browser run, not by type-checking or unit tests — see verification
 * notes.) Fixed by keeping the latest action in a ref that's read on every
 * render (so it's always current) and only re-running the effect itself
 * when the primitive `title` changes.
 */
export function usePageTitle(title: string, action?: ReactNode) {
  const { setPageHeader } = usePageHeader()
  const actionRef = useRef(action)
  actionRef.current = action

  useEffect(() => {
    setPageHeader(title, actionRef.current)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [title])
}
