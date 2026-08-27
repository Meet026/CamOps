import { Fragment, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { format } from "date-fns";
import { ClipboardList, Check, Copy, ChevronDown } from "lucide-react";
import { usePageTitle } from "@/hooks/usePageTitle";
import { useAuth } from "@/contexts/AuthContext";
import { useDebouncedValue } from "@/hooks/useDebouncedValue";
import { Input } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/shared/EmptyState";
import { SkeletonStack } from "@/components/ui/Skeleton";
import { cn } from "@/lib/utils";
import * as auditApi from "@/api/audit";
import * as usersApi from "@/api/users";
import type { AuditLogEntry } from "@/api/audit";

const PAGE_SIZE = 25;
const GRID_COLUMNS = "200px 250px 250px 190px minmax(150px,1fr) 20px";

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
  const { user } = useAuth();

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

  // GET /users is admin-only server-side, so only resolve actor emails when
  // the signed-in user is an admin — auditors still see the page (with raw
  // user ids in the Actor column) rather than a 403 breaking the fetch.
  const usersQuery = useQuery({
    queryKey: ["users", "audit-log-actor-lookup"],
    queryFn: () => usersApi.listUsers({ page: 1, limit: 100 }),
    enabled: user?.role === "admin",
    staleTime: 60_000,
  });
  const actorEmail = (userId: string | null) => {
    if (!userId) return "system";
    return usersQuery.data?.find((u) => u.userId === userId)?.email ?? userId;
  };

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
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Input
          value={action}
          onChange={(e) => {
            setAction(e.target.value);
            setPage(1);
          }}
          placeholder="Filter by action…"
          className="w-48"
        />
        <Input
          value={entityType}
          onChange={(e) => {
            setEntityType(e.target.value);
            setPage(1);
          }}
          placeholder="Filter by entity type…"
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
                className="grid min-w-[1040px] gap-3 border-b border-[var(--border-default)] px-[18px] py-2.5 text-[11.5px] font-semibold uppercase tracking-wide text-[var(--text-secondary)]"
                style={{ gridTemplateColumns: GRID_COLUMNS }}>
                <div>Timestamp</div>
                <div>Actor</div>
                <div>Action</div>
                <div>Entity</div>
                <div>Correlation id</div>
                <div />
              </div>
              {rows.map((row) => (
                <AuditRow
                  key={row.auditId}
                  row={row}
                  actor={actorEmail(row.userId)}
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
  actor,
  isExpanded,
  onToggle,
  onEntityClick,
}: {
  row: AuditLogEntry;
  actor: string;
  isExpanded: boolean;
  onToggle: () => void;
  onEntityClick: () => void;
}) {
  const hasDiff = Boolean(row.metadata?.before || row.metadata?.after);
  const isCameraEntity = row.entityType === "camera" && row.entityId;

  return (
    <div className="border-b border-[var(--border-default)] last:border-b-0">
      <div
        onClick={onToggle}
        className="grid min-w-[1040px] cursor-pointer items-center gap-3 px-[18px] py-[11px] font-mono text-[12.5px] hover:bg-[var(--bg-surface-raised)]"
        style={{ gridTemplateColumns: GRID_COLUMNS }}>
        <div className="text-[var(--text-secondary)]">
          {format(new Date(row.createdAt), "yyyy-MM-dd HH:mm:ss")}
        </div>
        <div className="truncate font-sans">{actor}</div>
        <div>
          <ActionTag action={row.action} />
        </div>
        <div className="truncate font-sans">
          {isCameraEntity ? (
            <button
              onClick={(e) => {
                e.stopPropagation();
                onEntityClick();
              }}
              className="font-mono text-[12.5px] text-[var(--color-brand)] hover:underline">
              {row.entityType}:{row.entityId!.slice(0, 8)}
            </button>
          ) : (
            <span className="text-[var(--text-secondary)]">
              {row.entityType}
              {row.entityId ? `:${row.entityId.slice(0, 8)}` : ""}
            </span>
          )}
        </div>
        <div className="min-w-0 text-[var(--text-secondary)]">
          {row.metadata?.correlationId ? (
            <CopyableId value={row.metadata.correlationId} />
          ) : (
            "—"
          )}
        </div>
        <div className="font-sans text-[var(--text-secondary)]">
          {hasDiff && (
            <ChevronDown
              className={cn(
                "h-4 w-4 transition-transform duration-150",
                isExpanded && "rotate-180",
              )}
            />
          )}
        </div>
      </div>
      {isExpanded && hasDiff && (
        <div className="bg-[var(--bg-surface-sunken)] px-[18px] pb-[18px] pt-3.5">
          <DiffView before={row.metadata?.before} after={row.metadata?.after} />
        </div>
      )}
    </div>
  );
}

function DiffView({
  before,
  after,
}: {
  before?: Record<string, unknown>;
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
            {formatDiffValue(before?.[field])}
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
