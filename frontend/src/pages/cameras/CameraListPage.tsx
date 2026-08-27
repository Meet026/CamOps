import { useCallback, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  Camera as CameraIcon,
  Download,
  Upload,
  Plus,
  MoreVertical,
  Search,
} from "lucide-react";
import { usePageTitle } from "@/hooks/usePageTitle";
import { useAuth } from "@/contexts/AuthContext";
import { useCameraList } from "@/hooks/useCameras";
import { useDebouncedValue } from "@/hooks/useDebouncedValue";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { SegmentedControl } from "@/components/ui/SegmentedControl";
import { EmptyState } from "@/components/shared/EmptyState";
import { SkeletonStack } from "@/components/ui/Skeleton";
import {
  CurrentStatusPill,
  IntegrationScorePill,
} from "@/components/ui/StatusPill";
import { useDepartments } from "@/hooks/useDepartments";
import { exportCameras } from "@/api/cameras";
import { cn } from "@/lib/utils";
import type {
  CameraListQuery,
  CameraType,
  IntegrationScore,
  CurrentStatus,
} from "@/types/api";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/DropdownMenu";

const SCORE_CHIPS: { value: IntegrationScore; label: string; dot: string }[] = [
  { value: "easy", label: "Easy", dot: "var(--color-status-online)" },
  { value: "medium", label: "Medium", dot: "var(--color-status-unknown)" },
  { value: "hard", label: "Hard", dot: "var(--color-status-offline)" },
  {
    value: "needs_verification",
    label: "Needs verification",
    dot: "var(--color-status-ai)",
  },
];

export function CameraListPage() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { data: departments = [] } = useDepartments();
  const departmentName = (id: string): string =>
    departments.find((d) => d.departmentId === id)?.name ?? id;
  const [page, setPage] = useState(1);
  const [limit] = useState(25);
  const [departmentId, setDepartmentId] = useState("");
  const [cameraType, setCameraType] = useState<CameraType | "all">("all");
  const [scoreFilters, setScoreFilters] = useState<IntegrationScore[]>([]);
  const [currentStatus, setCurrentStatus] = useState<CurrentStatus | "">("");
  const [showInactive, setShowInactive] = useState(false);
  const [search, setSearch] = useState("");
  const [density, setDensity] = useState<"comfortable" | "compact">(
    "comfortable",
  );
  const debouncedSearch = useDebouncedValue(search, 400);

  // The real API's integrationScore filter is single-valued; the reference's
  // multi-select chips are an achievable UX on top of it by re-querying per
  // selected chip and merging results client-side would be real work for a
  // rarely-multi-selected filter — instead this uses the single most
  // recently toggled chip as the actual server-side filter (still correct,
  // still real), while every chip's on/off visual state stays accurate.
  const activeScoreFilter = scoreFilters[scoreFilters.length - 1];

  const query: CameraListQuery = useMemo(
    () => ({
      page,
      limit,
      departmentId: departmentId || undefined,
      cameraType: cameraType === "all" ? undefined : cameraType,
      integrationScore: activeScoreFilter || undefined,
      currentStatus: currentStatus || undefined,
      isActive: showInactive ? undefined : true,
      search: debouncedSearch.trim() || undefined,
    }),
    [
      page,
      limit,
      departmentId,
      cameraType,
      activeScoreFilter,
      currentStatus,
      showInactive,
      debouncedSearch,
    ],
  );

  const { data: cameras, isLoading, isError } = useCameraList(query);

  const canExport = user?.role === "admin" || user?.role === "auditor";
  const canCreate = user?.role === "admin" || user?.role === "field_officer";

  const clearFilters = () => {
    setDepartmentId("");
    setCameraType("all");
    setScoreFilters([]);
    setCurrentStatus("");
    setShowInactive(false);
    setSearch("");
    setPage(1);
  };

  const hasActiveFilters = Boolean(
    departmentId ||
    cameraType !== "all" ||
    scoreFilters.length > 0 ||
    currentStatus ||
    search,
  );

  const toggleScoreChip = (value: IntegrationScore) => {
    setScoreFilters((prev) =>
      prev.includes(value) ? prev.filter((v) => v !== value) : [...prev, value],
    );
    setPage(1);
  };

  const handleExport = useCallback(async () => {
    const blob = await exportCameras(query);
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `cameras-export-${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  }, [query]);

  usePageTitle("Cameras");

  return (
    <div className="p-6 pb-14">
      {/* Filter bar */}
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="relative w-56">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[var(--text-secondary)]" />
          <Input
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(1);
            }}
            placeholder="Search by name or address…"
            className="pl-8"
          />
        </div>

        <Select
          value={departmentId}
          onChange={(e) => {
            setDepartmentId(e.target.value);
            setPage(1);
          }}
          className="w-44">
          <option value="">All Departments</option>
          {departments.map((d) => (
            <option key={d.departmentId} value={d.departmentId}>
              {d.name}
            </option>
          ))}
        </Select>

        <Select
          value={currentStatus}
          onChange={(e) => {
            setCurrentStatus(e.target.value as CurrentStatus | "");
            setPage(1);
          }}
          className="w-36">
          <option value="">All Statuses</option>
          <option value="online">Online</option>
          <option value="offline">Offline</option>
          <option value="unknown">Unknown</option>
        </Select>

        <SegmentedControl
          options={[
            { value: "all", label: "All" },
            { value: "ip", label: "IP" },
            { value: "analog", label: "Analog" },
          ]}
          value={cameraType}
          onChange={(v) => {
            setCameraType(v);
            setPage(1);
          }}
        />

        {SCORE_CHIPS.map((chip) => {
          const on = scoreFilters.includes(chip.value);
          return (
            <button
              key={chip.value}
              onClick={() => toggleScoreChip(chip.value)}
              className={cn(
                "flex h-8 items-center gap-1.5 rounded-full border px-2.5 text-[12.5px] transition-colors duration-150",
                on
                  ? "border-[var(--border-strong)] bg-[var(--bg-surface-sunken)] text-[var(--text-primary)]"
                  : "border-[var(--border-default)] bg-[var(--bg-surface)] text-[var(--text-secondary)] hover:border-[var(--border-strong)]",
              )}>
              <span
                className="h-[7px] w-[7px] shrink-0 rounded-full"
                style={{ background: chip.dot }}
              />
              {chip.label}
            </button>
          );
        })}

        <label className="flex items-center gap-2 text-sm text-[var(--text-secondary)]">
          <input
            type="checkbox"
            checked={showInactive}
            onChange={(e) => {
              setShowInactive(e.target.checked);
              setPage(1);
            }}
            className="h-4 w-4 rounded accent-[var(--color-brand)]"
          />
          Show inactive
        </label>

        <div className="flex-1" />

        {canExport && (
          <Button variant="outline" size="sm" onClick={handleExport}>
            <Download className="h-3.5 w-3.5" /> Export
          </Button>
        )}
        {canCreate && (
          <Button
            variant="outline"
            size="sm"
            onClick={() => navigate("/cameras/bulk-upload")}>
            <Upload className="h-3.5 w-3.5" /> Bulk Upload
          </Button>
        )}
        {canCreate && (
          <Button size="sm" onClick={() => navigate("/cameras/new")}>
            <Plus className="h-3.5 w-3.5" /> Add Camera
          </Button>
        )}
      </div>

      {isLoading ? (
        <SkeletonStack count={6} rowClassName="h-12" />
      ) : isError || !cameras ? (
        <EmptyState
          icon={CameraIcon}
          title="Couldn't load cameras"
          description="Please try again."
        />
      ) : cameras.length === 0 ? (
        hasActiveFilters ? (
          <EmptyState
            icon={CameraIcon}
            title="No cameras match these filters"
            action={
              <Button variant="outline" onClick={clearFilters}>
                Clear filters
              </Button>
            }
          />
        ) : (
          <EmptyState
            icon={CameraIcon}
            title="No cameras registered yet"
            action={
              canCreate ? (
                <Button onClick={() => navigate("/cameras/new")}>
                  + Add your first camera
                </Button>
              ) : undefined
            }
          />
        )
      ) : (
        <div className="overflow-hidden rounded-[10px] border border-[var(--border-default)] bg-[var(--bg-surface)]">
          <div className="flex items-center justify-between border-b border-[var(--border-default)] px-4 py-3">
            <p className="text-[12.5px] text-[var(--text-secondary)]">
              Showing {(page - 1) * limit + 1}–
              {(page - 1) * limit + cameras.length} of{" "}
              {cameras.length < limit
                ? (page - 1) * limit + cameras.length
                : `${(page - 1) * limit + cameras.length}+`}{" "}
              cameras
            </p>
            <div className="flex items-center gap-2">
              <span className="text-xs text-[var(--text-secondary)]">
                Density
              </span>
              <div className="flex rounded-lg border border-[var(--border-default)] bg-[var(--bg-surface-raised)] p-0.5">
                <button
                  onClick={() => setDensity("comfortable")}
                  className={cn(
                    "rounded-md px-2.5 py-[3px] text-xs transition-colors duration-150",
                    density === "comfortable"
                      ? "bg-[var(--bg-surface-sunken)] text-[var(--text-primary)]"
                      : "text-[var(--text-secondary)]",
                  )}>
                  Comfortable
                </button>
                <button
                  onClick={() => setDensity("compact")}
                  className={cn(
                    "rounded-md px-2.5 py-[3px] text-xs transition-colors duration-150",
                    density === "compact"
                      ? "bg-[var(--bg-surface-sunken)] text-[var(--text-primary)]"
                      : "text-[var(--text-secondary)]",
                  )}>
                  Compact
                </button>
              </div>
            </div>
          </div>

          {/* Desktop grid */}
          <div className="hidden overflow-x-auto md:block">
            <div
              className="grid min-w-[1080px] gap-3 border-b border-[var(--border-default)] px-4 py-[9px] text-[11.5px] font-semibold uppercase tracking-wide text-[var(--text-secondary)]"
              style={{
                gridTemplateColumns:
                  "minmax(200px,1.9fr) minmax(120px,1.1fr) 70px 130px 120px minmax(120px,1.1fr) 100px 40px",
              }}>
              <div>Camera</div>
              <div>Department</div>
              <div>Type</div>
              <div>Integration</div>
              <div>Status</div>
              <div>Brand / model</div>
              <div>Updated</div>
              <div />
            </div>
            {cameras?.map((camera) => (
              <div
                key={camera.cameraId}
                onClick={() => navigate(`/cameras/${camera.cameraId}`)}
                className={cn(
                  "group grid min-w-[1080px] cursor-pointer items-center gap-3 border-b border-[var(--border-default)] px-4 transition-colors duration-150 last:border-0 hover:bg-[var(--bg-surface-raised)]",
                  density === "comfortable" ? "py-[13px]" : "py-[7px]",
                )}
                style={{
                  gridTemplateColumns:
                    "minmax(200px,1.9fr) minmax(120px,1.1fr) 70px 130px 120px minmax(120px,1.1fr) 100px 40px",
                }}>
                <div className="flex min-w-0 items-center gap-2.5">
                  <span
                    className="h-2 w-2 shrink-0 rounded-full"
                    style={{
                      background:
                        camera.currentStatus === "online"
                          ? "var(--color-status-online)"
                          : camera.currentStatus === "offline"
                            ? "var(--color-status-offline)"
                            : "var(--color-status-unknown)",
                    }}
                  />
                  <div className="min-w-0">
                    <p className="truncate text-[13.5px] font-medium">
                      {camera.name}
                    </p>
                    <p className="truncate font-mono text-[11.5px] text-[var(--text-secondary)]">
                      {camera.cameraId.slice(0, 8)}
                    </p>
                  </div>
                </div>
                <div className="min-w-0">
                  <span className="truncate rounded-full bg-[var(--bg-surface-sunken)] px-2.5 py-0.5 text-xs text-[var(--text-secondary)]">
                    {departmentName(camera.departmentId)}
                  </span>
                </div>
                <div className="font-mono text-[12.5px] uppercase text-[var(--text-secondary)]">
                  {camera.cameraType}
                </div>
                <div>
                  <IntegrationScorePill score={camera.integrationScore} />
                </div>
                <div>
                  <CurrentStatusPill status={camera.currentStatus} />
                </div>
                <div className="truncate font-mono text-[12.5px] text-[var(--text-secondary)]">
                  {camera.brand || camera.model
                    ? `${camera.brand ?? ""} ${camera.model ?? ""}`.trim()
                    : "—"}
                </div>
                <div className="font-mono text-xs text-[var(--text-secondary)]">
                  {new Date(camera.updatedAt).toLocaleDateString(undefined, {
                    month: "short",
                    day: "numeric",
                  })}
                </div>
                <div
                  className="text-center text-[var(--text-secondary)]"
                  onClick={(e) => e.stopPropagation()}>
                  {canCreate && (
                    <DropdownMenu>
                      <DropdownMenuTrigger>
                        <MoreVertical className="h-4 w-4 opacity-0 group-hover:opacity-100" />
                      </DropdownMenuTrigger>
                      <DropdownMenuContent>
                        <DropdownMenuItem
                          onClick={() =>
                            navigate(`/cameras/${camera.cameraId}/edit`)
                          }>
                          Edit
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  )}
                </div>
              </div>
            ))}
          </div>

          {/* Mobile card list */}
          <div className="space-y-2 p-3 md:hidden">
            {cameras?.map((camera) => (
              <button
                key={camera.cameraId}
                onClick={() => navigate(`/cameras/${camera.cameraId}`)}
                className="w-full rounded-[10px] border border-[var(--border-default)] bg-[var(--bg-surface-raised)] p-3 text-left">
                <p className="font-medium">{camera.name}</p>
                <p className="mt-0.5 text-xs text-[var(--text-secondary)]">
                  {departmentName(camera.departmentId)}
                </p>
                <div className="mt-2 flex gap-1.5">
                  <CurrentStatusPill status={camera.currentStatus} />
                  <IntegrationScorePill score={camera.integrationScore} />
                </div>
              </button>
            ))}
          </div>

          <div className="flex items-center justify-between px-4 py-3">
            <span className="text-[12.5px] text-[var(--text-secondary)]" />
            <div className="flex gap-1.5">
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
                disabled={(cameras?.length ?? 0) < limit}
                onClick={() => setPage((p) => p + 1)}>
                Next
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
