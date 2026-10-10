export type WantedVehicleStatus = 'active' | 'resolved';
// manual_search: an officer typed the plate. camera_live: a camera read it.
// camera_lookback: a camera read it in the 24h before it was added to the list.
export type NotificationSource = 'manual_search' | 'camera_live' | 'camera_lookback';

export interface WantedVehicleRecord {
  wantedVehicleId: string;
  personName: string;
  plateNumber: string;
  crimeDetails: string;
  status: WantedVehicleStatus;
  departmentId: string | null;
  createdAt: Date;
  updatedAt: Date;
  resolvedAt: Date | null;
}

export interface WantedListNotificationRecord {
  notificationId: string;
  wantedVehicleId: string;
  source: NotificationSource;
  matchedPlateNumber: string;
  isRead: boolean;
  createdAt: Date;
  // Denormalized for display — avoids the caller needing a second lookup.
  personName: string;
  plateNumber: string;
  crimeDetails: string;
  // Camera alerts only; null for manual_search.
  cameraId: string | null;
  cameraName: string | null;
  seenAt: Date | null;
  plateConfidence: number | null;
}

// What POST /wanted-list returns: the new record plus how many earlier
// camera sightings the 24h look-back alerted on.
// lookbackAlerts is null when the look-back failed (the add itself still succeeded).
export type CreatedWantedVehicle = WantedVehicleRecord & { lookbackAlerts: number | null };

export interface CheckPlateResult {
  matched: boolean;
  wantedVehicle: WantedVehicleRecord | null;
}
