import { useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useMutation, useQuery } from '@tanstack/react-query'
import { CheckCircle2, Download, UploadCloud, XCircle } from 'lucide-react'
import { usePageTitle } from '@/hooks/usePageTitle'
import { Button } from '@/components/ui/Button'
import * as camerasApi from '@/api/cameras'
import { getApiErrorMessage } from '@/api/client'

const CSV_TEMPLATE = `name,departmentCode,latitude,longitude,cameraType,brand,model,addressText,installedAt
Main Gate Camera,HOME,23.0225,72.5714,ip,,,,`

const CSV_COLUMNS = 'name, departmentCode, latitude, longitude, cameraType, brand, model, addressText, installedAt'

// Pixel-matched to the reference (Sentinel.dc.html) Bulk upload screen: a
// dashed drop-zone (idle) → spinner + job id + dual-color progress bar
// (running) → check-badge summary + "Row errors" grid table (done), all
// centered in a 760px column with a "Columns: ..." + template-download
// caption row above the drop-zone.
export function BulkUploadPage() {
  usePageTitle('Bulk Upload')
  const navigate = useNavigate()
  const [jobId, setJobId] = useState<string | null>(null)
  const [fileError, setFileError] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  const uploadMutation = useMutation({
    mutationFn: (file: File) => camerasApi.startBulkUpload(file),
    onSuccess: (data) => setJobId(data.jobId),
    onError: (err) => setFileError(getApiErrorMessage(err, 'The upload could not be processed.')),
  })

  const jobQuery = useQuery({
    queryKey: ['cameras', 'bulk-job', jobId],
    queryFn: () => camerasApi.getBulkUploadJobStatus(jobId as string),
    enabled: Boolean(jobId),
    refetchInterval: (query) => {
      const status = query.state.data?.status
      return status === 'pending' || status === 'processing' ? 1500 : false
    },
  })

  const handleFile = (file: File) => {
    setFileError(null)
    if (file.type !== 'text/csv' && !file.name.endsWith('.csv')) {
      setFileError('Please choose a .csv file.')
      return
    }
    uploadMutation.mutate(file)
  }

  const downloadTemplate = () => {
    const blob = new Blob([CSV_TEMPLATE], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = 'camera-bulk-upload-template.csv'
    link.click()
    URL.revokeObjectURL(url)
  }

  const downloadErrorReport = () => {
    if (!jobQuery.data?.rowErrors?.length) return
    const rows = ['row,error', ...jobQuery.data.rowErrors.map((e) => `${e.row},"${e.error.replace(/"/g, '""')}"`)]
    const blob = new Blob([rows.join('\n')], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `bulk-upload-errors-${jobId}.csv`
    link.click()
    URL.revokeObjectURL(url)
  }

  const job = jobQuery.data
  const isDone = job?.status === 'completed' || job?.status === 'failed'

  return (
    <div className="max-w-[760px] p-6 pb-14">
      <div className="mb-5">
        <p className="text-[22px] font-semibold tracking-tight">Bulk upload</p>
        <p className="text-[13px] text-[var(--text-secondary)]">CSV import with upsert on name + department.</p>
      </div>

      <div className="mb-2.5 flex items-center justify-between gap-4">
        <p className="text-[12.5px] text-[var(--text-secondary)]">
          Columns: <span className="font-mono text-xs">{CSV_COLUMNS}</span>
        </p>
        <button onClick={downloadTemplate} className="shrink-0 text-[12.5px] font-medium text-[var(--color-brand)] hover:underline">
          Download CSV template
        </button>
      </div>

      {!jobId ? (
        <>
          <label className="flex cursor-pointer flex-col items-center justify-center rounded-[10px] border border-dashed border-[var(--border-strong)] bg-[var(--bg-surface)] px-14 py-14 text-center transition-colors duration-150 hover:border-[var(--color-brand)]">
            <UploadCloud className="mb-2 h-[26px] w-[26px] text-[var(--text-secondary)]" strokeWidth={1.5} />
            <p className="text-[15px] font-semibold">Drop your CSV here</p>
            <p className="mt-1 text-[12.5px] text-[var(--text-secondary)]">
              Header and row count are checked before upload. Max 10,000 rows per job.
            </p>
            <input
              ref={inputRef}
              type="file"
              accept=".csv"
              className="hidden"
              onChange={(e) => e.target.files?.[0] && handleFile(e.target.files[0])}
            />
          </label>
          {fileError && <p className="mt-3 text-sm text-[var(--color-status-offline)]">{fileError}</p>}
          {uploadMutation.isPending && <p className="mt-3 text-sm text-[var(--text-secondary)]">Uploading…</p>}
        </>
      ) : !isDone ? (
        <ProgressView job={job} jobId={jobId} />
      ) : job?.status === 'failed' ? (
        <div className="rounded-[10px] border border-[var(--border-default)] bg-[var(--bg-surface)] p-5 text-center">
          <XCircle className="mx-auto h-8 w-8 text-[var(--color-status-offline)]" />
          <p className="mt-2 text-sm font-medium">The upload couldn't be processed</p>
          <Button className="mt-4" variant="outline" size="sm" onClick={() => setJobId(null)}>
            Try again
          </Button>
        </div>
      ) : (
        <div className="overflow-hidden rounded-[10px] border border-[var(--border-default)] bg-[var(--bg-surface)]">
          <div className="flex items-center gap-3.5 border-b border-[var(--border-default)] px-[22px] py-5">
            <span className="flex h-[30px] w-[30px] shrink-0 items-center justify-center rounded-full bg-[var(--color-status-online-bg)] text-[var(--color-status-online)]">
              <CheckCircle2 className="h-4 w-4" strokeWidth={2.6} />
            </span>
            <div className="flex-1">
              <p className="text-[15px] font-semibold">Import complete</p>
              <p className="text-[12.5px] text-[var(--text-secondary)]">
                {job?.succeededCount ?? 0} succeeded · {job?.failedCount ?? 0} failed · {job?.totalRows ?? 0} total
              </p>
            </div>
            {(job?.failedCount ?? 0) > 0 && (
              <button
                onClick={downloadErrorReport}
                className="flex items-center gap-1.5 rounded-lg border border-[var(--border-default)] bg-[var(--bg-surface-raised)] px-3 py-[7px] text-[12.5px] font-medium transition-colors duration-150 hover:border-[var(--border-strong)]">
                <Download className="h-3.5 w-3.5" /> Download error report
              </button>
            )}
            <button
              onClick={() => navigate('/cameras')}
              className="rounded-lg border border-[var(--border-default)] bg-[var(--bg-surface-raised)] px-3 py-[7px] text-[12.5px] font-medium transition-colors duration-150 hover:border-[var(--border-strong)]">
              View cameras
            </button>
          </div>

          {(job?.failedCount ?? 0) > 0 && (
            <>
              <div className="border-b border-[var(--border-default)] px-[22px] py-3.5 text-[13px] font-semibold">
                Row errors <span className="font-normal text-[var(--text-secondary)]">({job?.failedCount ?? 0})</span>
              </div>
              <div
                className="grid gap-3 border-b border-[var(--border-default)] px-[22px] py-2 text-[11.5px] font-semibold uppercase tracking-wide text-[var(--text-secondary)]"
                style={{ gridTemplateColumns: '80px 1fr' }}>
                <div>Row</div>
                <div>Error</div>
              </div>
              <div className="max-h-[340px] overflow-y-auto">
                {job?.rowErrors?.map((e, i) => (
                  <div
                    key={i}
                    className="grid gap-3 border-b border-[var(--border-default)] px-[22px] py-2.5 text-[12.5px] last:border-b-0"
                    style={{ gridTemplateColumns: '80px 1fr' }}>
                    <div className="font-mono text-[var(--text-secondary)]">{e.row}</div>
                    <div>{e.error}</div>
                  </div>
                ))}
              </div>
            </>
          )}

          <button
            onClick={() => setJobId(null)}
            className="w-full px-[22px] py-3.5 text-left text-[12.5px] font-medium text-[var(--color-brand)] hover:underline">
            Upload another file
          </button>
        </div>
      )}
    </div>
  )
}

function ProgressView({
  job,
  jobId,
}: {
  job: ReturnType<typeof useQuery<Awaited<ReturnType<typeof camerasApi.getBulkUploadJobStatus>>>>['data']
  jobId: string
}) {
  const total = job?.totalRows ?? 0
  const processed = job?.processedRows ?? 0
  const succeeded = job?.succeededCount ?? 0
  const failed = job?.failedCount ?? 0
  const percent = total > 0 ? Math.round((processed / total) * 100) : 0

  return (
    <div className="rounded-[10px] border border-[var(--border-default)] bg-[var(--bg-surface)] p-[22px]">
      <div className="mb-4 flex items-center gap-3">
        <span className="h-4 w-4 shrink-0 animate-spin rounded-full border-2 border-[var(--border-strong)] border-t-[var(--color-brand)]" />
        <div className="flex-1">
          <p className="text-sm font-semibold">
            Processing row {processed.toLocaleString()} of {total.toLocaleString()}
          </p>
          <p className="font-mono text-[12.5px] text-[var(--text-secondary)]">
            job {jobId.slice(0, 8)} · status: {job?.status ?? 'processing'}
          </p>
        </div>
        <p className="font-mono text-[22px] font-semibold tabular-nums">{percent}%</p>
      </div>
      <div className="mb-3.5 flex h-2.5 overflow-hidden rounded-full bg-[var(--bg-surface-sunken)]">
        <div className="bg-[var(--color-status-online)] transition-all duration-300" style={{ width: `${total > 0 ? (succeeded / total) * 100 : 0}%` }} />
        <div className="bg-[var(--color-status-offline)] transition-all duration-300" style={{ width: `${total > 0 ? (failed / total) * 100 : 0}%` }} />
      </div>
      <div className="flex gap-6 text-[12.5px]">
        <span className="text-[var(--color-status-online)]">● Succeeded {succeeded.toLocaleString()}</span>
        <span className="text-[var(--color-status-offline)]">● Failed {failed.toLocaleString()}</span>
        <span className="text-[var(--text-secondary)]">Polling every 1.5s</span>
      </div>
    </div>
  )
}
