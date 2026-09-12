import { Fragment, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { format } from "date-fns";
import { ClipboardList, Check, Copy, ChevronDown } from "lucide-react";
import { usePageTitle } from "@/hooks/usePageTitle";
import { useDebouncedValue } from "@/hooks/useDebouncedValue";
import { Input } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/shared/EmptyState";
import { SkeletonStack } from "@/components/ui/Skeleton";
import { cn } from "@/lib/utils";
import * as auditApi from "@/api/audit";
import type { AuditLogEntry } from "@/api/audit";

const PAGE_SIZE = 25;
const GRID_COLUMNS = "180px minmax(180px,1.2fr) minmax(120px,0.8fr) 150px minmax(200px,1.4fr) 20px";

// Tone-mapped by action-name convention (create_*/update_*/delete_*/etc.)
// rather than one literal per action string, so a newly-added @Audit(...)
// call elsewhere in the backend still renders sensibly here with no
// frontend change required.
function actionTone(action: string): { text: string; bg: string } {
  if (action.startsWith("create") || action === "login") {
    return {
      text: "var(--color-status-online)",
      bg: "var(--color-status-online-bg)",
    };
  }
  if (action.startsWith("delete") || action === "logout") {
    return {
      text: "var(--color-status-offline)",
      bg: "var(--color-status-offline-bg)",
    };
  }
  if (action.startsWith("verify")) {
    return { text: "var(--color-status-ai)", bg: "var(--color-status-ai-bg)" };
  }
  return {
    text: "var(--color-status-neutral)",
    bg: "var(--color-status-neutral-bg)",
  };
}

function ActionTag({ action }: { action: string }) {
  const tone = actionTone(action);
  return (
    <span
      className="inline-flex w-fit items-center whitespace-nowrap rounded-[6px] px-2 py-[2px] font-mono text-[11.5px] font-semibold"
      style={{ color: tone.text, backgroundColor: tone.bg }}>
      {action}
    </span>
  );
}

function CopyableId({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);
  const handleCopy = async (e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard access can be denied by the browser — the id is still
      // visible as text, so this is a nice-to-have, not a hard requirement.
    }
  };
  return (
    <button
      type="button"
      onClick={handleCopy}
      className="inline-flex items-center gap-1 font-mono text-[12.5px] text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
      title="Copy to clipboard">
      {value}
      {copied ? (
        <Check className="h-3 w-3 shrink-0 text-[var(--color-status-online)]" />
      ) : (
        <Copy className="h-3 w-3 shrink-0" />
      )}
    </button>
  );
}

export function AuditLogPage() {
  usePageTitle("Audit Log");
  const navigate = useNavigate();

  const [page, setPage] = useState(1);
  const [action, setAction] = useState("");
  const [entityType, setEntityType] = useState("");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const debouncedAction = useDebouncedValue(action, 400);
  const debouncedEntityType = useDebouncedValue(entityType, 400);

  const query: auditApi.AuditLogQuery = useMemo(
    () => ({
      page,
      limit: PAGE_SIZE,
      action: debouncedAction.trim() || undefined,
      entityType: debouncedEntityType.trim() || undefined,
      fromDate: fromDate || undefined,
      toDate: toDate || undefined,
    }),
    [page, debouncedAction, debouncedEntityType, fromDate, toDate],
  );

  const {
    data: rows,
    isLoading,
    isFetching,
  } = useQuery({
    queryKey: ["audit-log", query],
    queryFn: () => auditApi.listAuditLog(query),
  });

  const hasActiveFilters = Boolean(action || entityType || fromDate || toDate);
  const clearFilters = () => {
    setAction("");
    setEntityType("");
    setFromDate("");
    setToDate("");
    setPage(1);
  };

  return (
    <div className="p-6">
      {/* Filter bar — same visual pattern as CameraListPage */}
      <div className="mb-5 flex flex-wrap items-center gap-3">
        <Input
          value={action}
          onChange={(e) => {
            setAction(e.target.value);
            setPage(1);
          }}
          placeholder="Search action…"
          className="w-48"
        />
        <Input
          value={entityType}
          onChange={(e) => {
            setEntityType(e.target.value);
            setPage(1);
          }}
          placeholder="Search entity type…"
          className="w-48"
        />
        <Input
          type="date"
          value={fromDate}
          onChange={(e) => {
            setFromDate(e.target.value);
            setPage(1);
          }}
          className="w-40"
        />
        <span className="text-xs text-[var(--text-secondary)]">to</span>
        <Input
          type="date"
          value={toDate}
          onChange={(e) => {
            setToDate(e.target.value);
            setPage(1);
          }}
          className="w-40"
        />
      </div>

      {isLoading ? (
        <SkeletonStack count={6} rowClassName="h-12" />
      ) : !rows || rows.length === 0 ? (
        <EmptyState
          icon={ClipboardList}
          title={
            hasActiveFilters
              ? "No audit log entries match these filters"
              : "No audit log entries yet"
          }
          action={
            hasActiveFilters ? (
              <Button variant="outline" onClick={clearFilters}>
                Clear filters
              </Button>
            ) : undefined
          }
        />
      ) : (
        <>
          <div className="overflow-hidden rounded-[10px] border border-[var(--border-default)] bg-[var(--bg-surface)]">
            <div className="overflow-x-auto">
              <div
                className="grid min-w-[1080px] gap-6 border-b border-[var(--border-default)] px-5 py-3 text-[11.5px] font-semibold uppercase tracking-wide text-[var(--text-secondary)]"
                style={{ gridTemplateColumns: GRID_COLUMNS }}>
                <div>Timestamp</div>
                <div>Actor</div>
                <div>Department</div>
                <div>Action</div>
                <div>Entity</div>
                <div />
              </div>
              {rows.map((row) => (
                <AuditRow
                  key={row.auditId}
                  row={row}
                  isExpanded={expandedId === row.auditId}
                  onToggle={() =>
                    setExpandedId((id) =>
                      id === row.auditId ? null : row.auditId,
                    )
                  }
                  onEntityClick={() => {
                    if (row.entityType === "camera" && row.entityId)
                      navigate(`/cameras/${row.entityId}`);
                  }}
                />
              ))}
            </div>
          </div>

          <div className="mt-4 flex items-center justify-between text-sm text-[var(--text-secondary)]">
            <span>Page {page}</span>
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                disabled={page === 1}
                onClick={() => setPage((p) => p - 1)}>
                Previous
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={isFetching || rows.length < PAGE_SIZE}
                onClick={() => setPage((p) => p + 1)}>
                Next
              </Button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function AuditRow({
  row,
  isExpanded,
  onToggle,
  onEntityClick,
}: {
  row: AuditLogEntry;
  isExpanded: boolean;
  onToggle: () => void;
  onEntityClick: () => void;
}) {
  const hasDiff = Boolean(row.metadata?.before || row.metadata?.after);
  // Correlation id moved out of the listing grid into this expanded detail
  // area — still available for cross-referencing server logs, just not
  // taking up a whole column every row needs to scroll past.
  const hasDetail = Boolean(
    hasDiff || row.metadata?.ipAddress || row.metadata?.userAgent || row.metadata?.correlationId,
  );
  const isCameraEntity = row.entityType === "camera" && Boolean(row.entityId);

  return (
    <div className="border-b border-[var(--border-default)] last:border-b-0">
      <div
        onClick={onToggle}
        className="grid min-w-[1080px] cursor-pointer items-center gap-6 px-5 py-4 font-mono text-[12.5px] hover:bg-[var(--bg-surface-raised)]"
        style={{ gridTemplateColumns: GRID_COLUMNS }}>
        <div className="text-[var(--text-secondary)]">
          {format(new Date(row.createdAt), "yyyy-MM-dd HH:mm:ss")}
        </div>
        <div className="min-w-0 font-sans">
          {row.actor ? (
            <div className="flex flex-col gap-0.5 leading-tight">
              <span className="truncate">{row.actor.email}</span>
              <span className="truncate text-[11px] text-[var(--text-secondary)]">
                {row.actor.role}
              </span>
            </div>
          ) : (
            <span className="text-[var(--text-secondary)]">system</span>
          )}
        </div>
        <div className="truncate font-sans text-[var(--text-secondary)]">
          {row.actor?.departmentName ?? "—"}
        </div>
        <div>
          <ActionTag action={row.action} />
        </div>
        <div className="min-w-0 truncate font-sans">
          {isCameraEntity ? (
            <button
              onClick={(e) => {
                e.stopPropagation();
                onEntityClick();
              }}
              className="font-mono text-[12.5px] text-[var(--color-brand)] hover:underline">
              {row.entityLabel ?? row.entityType}
            </button>
          ) : (
            <span className="text-[var(--text-secondary)]">
              {row.entityLabel ?? row.entityType}
            </span>
          )}
        </div>
        <div className="font-sans text-[var(--text-secondary)]">
          {hasDetail && (
            <ChevronDown
              className={cn(
                "h-4 w-4 transition-transform duration-150",
                isExpanded && "rotate-180",
              )}
            />
          )}
        </div>
      </div>
      {isExpanded && hasDetail && (
        <div className="flex flex-col gap-3 bg-[var(--bg-surface-sunken)] px-[18px] pb-[18px] pt-3.5">
          {hasDiff ? (
            <DiffView before={row.metadata?.before} after={row.metadata?.after} />
          ) : (
            <p className="text-xs text-[var(--text-secondary)]">
              No field-level changes recorded.
            </p>
          )}
          {(row.metadata?.correlationId || row.metadata?.ipAddress || row.metadata?.userAgent) && (
            <div className="flex flex-wrap items-center gap-x-6 gap-y-1 font-mono text-[11.5px] text-[var(--text-secondary)]">
              {row.metadata?.correlationId && (
                <span className="flex items-center gap-1">
                  Correlation id: <CopyableId value={row.metadata.correlationId} />
                </span>
              )}
              {row.metadata?.ipAddress && <span>IP: {row.metadata.ipAddress}</span>}
              {row.metadata?.userAgent && (
                <span className="truncate">User agent: {row.metadata.userAgent}</span>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function DiffView({
  before,
  after,
}: {
  before?: Record<string, unknown> | null;
  after?: Record<string, unknown>;
}) {
  const fields = Array.from(
    new Set([...Object.keys(before ?? {}), ...Object.keys(after ?? {})]),
  ).sort();

  if (fields.length === 0) {
    return (
      <p className="text-xs text-[var(--text-secondary)]">
        No field-level changes recorded.
      </p>
    );
  }

  return (
    <div
      className="grid gap-px overflow-hidden rounded-lg border border-[var(--border-default)] bg-[var(--border-default)] text-[12.5px]"
      style={{ gridTemplateColumns: "160px 1fr 1fr" }}>
      <div className="bg-[var(--bg-surface)] px-3 py-2 text-[11.5px] font-semibold uppercase tracking-wide text-[var(--text-secondary)]">
        Field
      </div>
      <div className="bg-[var(--bg-surface)] px-3 py-2 text-[11.5px] font-semibold uppercase tracking-wide text-[var(--text-secondary)]">
        Before
      </div>
      <div className="bg-[var(--bg-surface)] px-3 py-2 text-[11.5px] font-semibold uppercase tracking-wide text-[var(--text-secondary)]">
        After
      </div>
      {fields.map((field) => (
        <Fragment key={field}>
          <div className="bg-[var(--bg-surface)] px-3 py-[9px] text-[var(--text-secondary)]">
            {field}
          </div>
          <div className="bg-[var(--bg-surface)] px-3 py-[9px] font-mono text-[var(--color-status-offline)]">
            {before === null ? "(new)" : formatDiffValue(before?.[field])}
          </div>
          <div className="bg-[var(--bg-surface)] px-3 py-[9px] font-mono text-[var(--color-status-online)]">
            {formatDiffValue(after?.[field])}
          </div>
        </Fragment>
      ))}
    </div>
  );
}

function formatDiffValue(value: unknown): string {
  if (value === undefined) return "—";
  if (value === null) return "null";
  return String(value);
}
