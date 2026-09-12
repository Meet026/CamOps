export type WantedVehicleStatus = 'active' | 'resolved';
export type NotificationSource = 'manual_search';

// Read-only mirror — this table has no create/update/delete API in this
// app; departments maintain wanted-list records in their own systems.
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
}

export interface CheckPlateResult {
  matched: boolean;
  wantedVehicle: WantedVehicleRecord | null;
}
