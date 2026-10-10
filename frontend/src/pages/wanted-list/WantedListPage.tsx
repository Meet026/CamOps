import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { formatDistanceToNow } from 'date-fns'
import { CheckCircle2, Loader2, Plus, ShieldAlert } from 'lucide-react'
import { usePageTitle } from '@/hooks/usePageTitle'
import { getApiErrorMessage } from '@/api/client'
import * as wantedListApi from '@/api/wantedList'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'
import { looksLikeIndianPlate, normalizePlate } from '@/lib/plate'
import type { WantedVehicle } from '@/types/api'

type Tab = 'active' | 'resolved'

const fieldClass =
  'h-10 w-full rounded-lg border border-[var(--border-default)] bg-[var(--bg-canvas)] px-3 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-secondary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-brand)]'

export function WantedListPage() {
  usePageTitle('Wanted List')
  const [tab, setTab] = useState<Tab>('active')
  const [toResolve, setToResolve] = useState<WantedVehicle | null>(null)
  const queryClient = useQueryClient()

  const { data: vehicles, isLoading, isError } = useQuery({
    queryKey: ['wanted-list', tab],
    queryFn: () => wantedListApi.listWanted(tab),
  })

  const resolveMutation = useMutation({
    mutationFn: (id: string) => wantedListApi.resolveWanted(id),
    onSuccess: () => {
      setToResolve(null)
      queryClient.invalidateQueries({ queryKey: ['wanted-list'] })
    },
  })

  return (
    <div className="p-4 pb-[72px] sm:p-9">
      <div className="mx-auto max-w-[960px]">
        <div className="mb-1.5 flex items-center gap-2.5">
          <ShieldAlert className="h-5 w-5 text-[var(--color-status-offline)]" />
          <p className="text-[22px] font-semibold tracking-tight">Wanted list</p>
        </div>
        <p className="mb-6 max-w-[64ch] text-[13.5px] text-[var(--text-secondary)]">
          Every camera checks the plates it reads against this list. Adding a plate takes effect
          within seconds, and also checks the last 24 hours of sightings for it.
        </p>

        <AddWantedForm />

        <div className="mt-7 mb-3 flex items-center justify-between gap-3">
          <div role="tablist" aria-label="Status" className="inline-flex rounded-[10px] border border-[var(--border-default)] bg-[var(--bg-surface-sunken)] p-1">
            {(['active', 'resolved'] as Tab[]).map((t) => (
              <button
                key={t}
                type="button"
                role="tab"
                aria-selected={tab === t}
                onClick={() => setTab(t)}
                className="rounded-[7px] px-3.5 py-1.5 text-[13px] font-medium capitalize"
                style={{
                  background: tab === t ? 'var(--bg-surface)' : 'transparent',
                  color: tab === t ? 'var(--text-primary)' : 'var(--text-secondary)',
                }}
              >
                {t}
              </button>
            ))}
          </div>
          {vehicles && (
            <span className="text-[12.5px] text-[var(--text-secondary)]">
              {vehicles.length} {tab} {vehicles.length === 1 ? 'entry' : 'entries'}
            </span>
          )}
        </div>

        <div className="overflow-hidden rounded-[12px] border border-[var(--border-default)] bg-[var(--bg-surface)]">
          {isLoading && (
            <div className="flex items-center justify-center gap-2 p-10 text-[13px] text-[var(--text-secondary)]">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading…
            </div>
          )}
          {isError && <p className="p-6 text-[13px] text-[var(--color-status-offline)]">Couldn't load the wanted list.</p>}
          {vehicles && vehicles.length === 0 && (
            <p className="p-10 text-center text-[13px] text-[var(--text-secondary)]">
              {tab === 'active' ? 'No vehicles are currently wanted.' : 'No resolved entries yet.'}
            </p>
          )}
          {vehicles && vehicles.length > 0 && (
            <ul>
              {vehicles.map((v) => (
                <li key={v.wantedVehicleId} className="flex flex-wrap items-center gap-x-4 gap-y-1.5 border-b border-[var(--border-default)] px-5 py-3.5 last:border-b-0">
                  <span className="rounded-md border border-[var(--border-strong)] bg-[var(--bg-canvas)] px-2 py-0.5 font-mono text-[13.5px] font-semibold tracking-wide">
                    {v.plateNumber}
                  </span>
                  <div className="min-w-[180px] flex-1">
                    <p className="text-[13.5px] font-medium">{v.personName}</p>
                    <p className="text-[12.5px] text-[var(--text-secondary)]">{v.crimeDetails}</p>
                  </div>
                  <span className="text-[12px] text-[var(--text-secondary)]">
                    {tab === 'active'
                      ? `added ${formatDistanceToNow(new Date(v.createdAt), { addSuffix: true })}`
                      : `resolved ${v.resolvedAt ? formatDistanceToNow(new Date(v.resolvedAt), { addSuffix: true }) : ''}`}
                  </span>
                  {tab === 'active' && (
                    <button
                      type="button"
                      onClick={() => setToResolve(v)}
                      className="flex items-center gap-1.5 rounded-lg border border-[var(--border-default)] bg-[var(--bg-surface-raised)] px-3 py-1.5 text-[12.5px] font-medium"
                    >
                      <CheckCircle2 className="h-3.5 w-3.5" />
                      Mark resolved
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      <ConfirmDialog
        isOpen={toResolve !== null}
        title={`Mark ${toResolve?.plateNumber ?? ''} as resolved?`}
        description="Cameras will stop alerting on this plate within a few seconds. The entry stays in the Resolved tab for history."
        confirmLabel="Mark resolved"
        onConfirm={() => toResolve && resolveMutation.mutate(toResolve.wantedVehicleId)}
        onCancel={() => setToResolve(null)}
        isConfirming={resolveMutation.isPending}
      />
    </div>
  )
}

function AddWantedForm() {
  const queryClient = useQueryClient()
  const [plateInput, setPlateInput] = useState('')
  const [personName, setPersonName] = useState('')
  const [crimeDetails, setCrimeDetails] = useState('')
  const [notice, setNotice] = useState<string | null>(null)

  const plate = normalizePlate(plateInput)
  const plateLooksWrong = plate.length >= 4 && !looksLikeIndianPlate(plate)
  const canSubmit = plate.length > 0 && personName.trim() !== '' && crimeDetails.trim() !== ''

  const createMutation = useMutation({
    mutationFn: () => wantedListApi.createWanted({ plateNumber: plate, personName, crimeDetails }),
    onSuccess: (created) => {
      setNotice(
        created.lookbackAlerts === null
          ? `${created.plateNumber} added — cameras will alert when they read this plate. (The check of earlier sightings failed; it was logged.)`
          : created.lookbackAlerts > 0
          ? `${created.plateNumber} added — seen by ${created.lookbackAlerts} camera${created.lookbackAlerts === 1 ? '' : 's'} in the last 24 hours. Check notifications.`
          : `${created.plateNumber} added — cameras will alert when they read this plate.`,
      )
      setPlateInput('')
      setPersonName('')
      setCrimeDetails('')
      queryClient.invalidateQueries({ queryKey: ['wanted-list'] })
      queryClient.invalidateQueries({ queryKey: ['notifications'] })
    },
  })

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault()
        if (canSubmit) createMutation.mutate()
      }}
      className="rounded-[12px] border border-[var(--border-default)] bg-[var(--bg-surface)] p-5"
    >
      <p className="mb-3 text-[14px] font-semibold">Add a wanted vehicle</p>
      <div className="grid gap-3 sm:grid-cols-[200px_1fr]">
        <div>
          <label htmlFor="wanted-plate" className="mb-1.5 block text-[12.5px] font-medium">Number plate</label>
          <input
            id="wanted-plate"
            value={plateInput}
            onChange={(e) => {
              setPlateInput(e.target.value)
              setNotice(null)
              createMutation.reset()
            }}
            placeholder="GJ01AB1234"
            autoComplete="off"
            spellCheck={false}
            className={`${fieldClass} font-mono uppercase tracking-wide placeholder:normal-case placeholder:tracking-normal`}
          />
        </div>
        <div>
          <label htmlFor="wanted-person" className="mb-1.5 block text-[12.5px] font-medium">Person</label>
          <input
            id="wanted-person"
            value={personName}
            onChange={(e) => setPersonName(e.target.value)}
            placeholder="Full name"
            maxLength={200}
            className={fieldClass}
          />
        </div>
      </div>
      <div className="mt-3">
        <label htmlFor="wanted-crime" className="mb-1.5 block text-[12.5px] font-medium">Crime details</label>
        <input
          id="wanted-crime"
          value={crimeDetails}
          onChange={(e) => setCrimeDetails(e.target.value)}
          placeholder="e.g. Theft (IPC 379) — FIR 112/2026, Navrangpura PS"
          maxLength={1000}
          className={fieldClass}
        />
      </div>
      {plateLooksWrong && (
        <p className="mt-2 text-[11.5px] text-[var(--color-status-unknown)]">
          "{plate}" doesn't look like an Indian plate — check for typos. You can still add it.
        </p>
      )}
      <div className="mt-4 flex flex-wrap items-center gap-3">
        <button
          type="submit"
          disabled={!canSubmit || createMutation.isPending}
          className="flex h-10 items-center gap-2 rounded-lg bg-[var(--color-brand)] px-4 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50"
        >
          {createMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
          Add to wanted list
        </button>
        {createMutation.isError && (
          <p className="text-[12.5px] text-[var(--color-status-offline)]">
            {getApiErrorMessage(createMutation.error, "Couldn't add this vehicle.")}
          </p>
        )}
        {notice && <p className="text-[12.5px] text-[var(--color-status-online)]">{notice}</p>}
      </div>
    </form>
  )
}
