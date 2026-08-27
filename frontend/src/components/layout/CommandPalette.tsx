import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Search } from 'lucide-react'
import { useQuery } from '@tanstack/react-query'
import { useAuth } from '@/contexts/AuthContext'
import { NAV_ITEMS, SETTINGS_NAV_ITEM } from './nav-config'
import * as camerasApi from '@/api/cameras'

interface CommandPaletteProps {
  open: boolean
  onClose: () => void
}

// Pixel-matched to the reference (Sentinel.dc.html): a centered modal over a
// blurred scrim, opened by ⌘K/Ctrl+K from anywhere in the app (see TopBar's
// keydown listener) or by clicking the header's search trigger. Two result
// groups — "jump to page" (static, role-filtered) and real camera matches
// (debounced query against the live API) — same shape as the reference's
// `paletteResults`, just backed by real data instead of mock rows.
export function CommandPalette({ open, onClose }: CommandPaletteProps) {
  const navigate = useNavigate()
  const { user } = useAuth()
  const [query, setQuery] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (open) {
      setQuery('')
      // Focus after the modal has actually mounted, not before.
      requestAnimationFrame(() => inputRef.current?.focus())
    }
  }, [open])

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  const cameraResults = useQuery({
    queryKey: ['command-palette', 'cameras', query],
    queryFn: () => camerasApi.listCameras({ page: 1, limit: 6, search: query }),
    enabled: open && query.trim().length > 0,
  })

  const jumpResults = useMemo(() => {
    if (!user) return []
    const q = query.trim().toLowerCase()
    return [...NAV_ITEMS, SETTINGS_NAV_ITEM]
      .filter((item) => item.roles.includes(user.role))
      .filter((item) => !q || item.label.toLowerCase().includes(q))
      .map((item) => ({
        key: `nav-${item.path}`,
        tag: '→',
        label: `Go to ${item.label}`,
        meta: 'page',
        go: () => {
          navigate(item.path)
          onClose()
        },
      }))
  }, [user, query, navigate, onClose])

  const cameraMatches = useMemo(() => {
    if (!query.trim() || !cameraResults.data) return []
    return cameraResults.data.slice(0, 6).map((camera) => ({
      key: `cam-${camera.cameraId}`,
      tag: '◉',
      label: camera.name,
      meta: camera.cameraId.slice(0, 8),
      go: () => {
        navigate(`/cameras/${camera.cameraId}`)
        onClose()
      },
    }))
  }, [query, cameraResults.data, navigate, onClose])

  const results = [...jumpResults, ...cameraMatches].slice(0, 8)

  if (!open) return null

  return (
    <div
      onClick={onClose}
      className="fixed inset-0 z-[70] flex justify-center bg-black/50 pt-[14vh] backdrop-blur-[3px] animate-in fade-in-0 duration-150">
      <div
        onClick={(e) => e.stopPropagation()}
        className="h-fit w-[600px] max-w-[92vw] overflow-hidden rounded-xl border border-[var(--border-strong)] bg-[var(--bg-surface)] shadow-[var(--shadow-float)] animate-in fade-in-0 zoom-in-95 duration-200">
        <div className="flex items-center gap-[11px] border-b border-[var(--border-default)] px-4 py-3.5">
          <Search className="h-[17px] w-[17px] text-[var(--text-secondary)]" strokeWidth={1.9} />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search cameras, or jump to a page…"
            className="flex-1 border-0 bg-transparent text-[15px] outline-none placeholder:text-[var(--text-secondary)]"
          />
          <span className="rounded border border-[var(--border-default)] px-1.5 py-0.5 font-mono text-[11px] text-[var(--text-secondary)]">
            ESC
          </span>
        </div>
        <div className="max-h-[52vh] overflow-auto p-2">
          {results.length === 0 ? (
            <p className="px-3 py-6 text-center text-sm text-[var(--text-secondary)]">
              No matches for "{query}"
            </p>
          ) : (
            results.map((r) => (
              <button
                key={r.key}
                onClick={r.go}
                className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left transition-colors duration-100 hover:bg-[var(--bg-surface-raised)]">
                <span className="flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-md bg-[var(--bg-surface-sunken)] text-[11px] font-semibold text-[var(--text-secondary)]">
                  {r.tag}
                </span>
                <span className="flex-1 truncate text-[13.5px]">{r.label}</span>
                <span className="font-mono text-xs text-[var(--text-secondary)]">{r.meta}</span>
              </button>
            ))
          )}
        </div>
      </div>
    </div>
  )
}
