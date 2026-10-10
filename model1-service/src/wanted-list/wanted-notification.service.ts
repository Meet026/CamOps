import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationQueryDto } from './dto/notification-query.dto';
import { WantedListNotificationRecord } from './wanted-list.types';

interface RawNotificationRow {
  notification_id: string;
  wanted_vehicle_id: string;
  source: string;
  matched_plate_number: string;
  is_read: boolean;
  created_at: Date;
  person_name: string;
  plate_number: string;
  crime_details: string;
  camera_id: string | null;
  camera_name: string | null;
  seen_at: Date | null;
  plate_confidence: number | string | null;
}

function mapRow(row: RawNotificationRow): WantedListNotificationRecord {
  return {
    notificationId: row.notification_id,
    wantedVehicleId: row.wanted_vehicle_id,
    source: row.source as WantedListNotificationRecord['source'],
    matchedPlateNumber: row.matched_plate_number,
    isRead: row.is_read,
    createdAt: row.created_at,
    personName: row.person_name,
    plateNumber: row.plate_number,
    crimeDetails: row.crime_details,
    cameraId: row.camera_id ?? null,
    cameraName: row.camera_name ?? null,
    seenAt: row.seen_at ?? null,
    plateConfidence:
      row.plate_confidence === null || row.plate_confidence === undefined ? null : Number(row.plate_confidence),
  };
}

// Joined against wanted_vehicle so the notification carries enough to
// display without a second round trip (person name, plate, crime details).
const NOTIFICATION_SELECT_SQL = `
  SELECT
    n.notification_id, n.wanted_vehicle_id, n.source, n.matched_plate_number,
    n.is_read, n.created_at,
    n.camera_id, n.seen_at, n.plate_confidence, c.name AS camera_name,
    wv.person_name, wv.plate_number, wv.crime_details
  FROM wanted_list_notification n
  JOIN wanted_vehicle wv ON wv.wanted_vehicle_id = n.wanted_vehicle_id
  LEFT JOIN camera c ON c.camera_id = n.camera_id
`;

@Injectable()
export class WantedNotificationService {
  constructor(private readonly prisma: PrismaService) {}

  // Called right after WantedListService.checkPlate finds a match during
  // Vehicle Search — one notification row per match, so an officer typing
  // the same wanted plate twice creates two notifications (each search is
  // its own event worth surfacing, not deduplicated).
  async createManualSearchNotification(
    wantedVehicleId: string,
    matchedPlateNumber: string,
  ): Promise<void> {
    await this.prisma.$queryRaw`
      INSERT INTO wanted_list_notification (wanted_vehicle_id, source, matched_plate_number)
      VALUES (${wantedVehicleId}::uuid, 'manual_search', ${matchedPlateNumber})
      RETURNING notification_id
    `;
  }

  // Runs once when a plate is added to the wanted list: alerts on every
  // camera that read this plate in the last 24h (latest sighting per
  // camera), catching a vehicle that passed before it was listed.
  // ON CONFLICT DO NOTHING relies on uq_wanted_notification_sighting, so a
  // sighting already alerted on is never alerted twice.
  async createLookbackNotifications(wantedVehicleId: string, plate: string): Promise<number> {
    const rows = await this.prisma.$queryRaw<{ inserted: number }[]>(Prisma.sql`
      WITH latest AS (
        SELECT DISTINCT ON (vs.camera_id)
          vs.vehicle_sighting_id, vs.camera_id, vs.detected_at, vs.plate_confidence
        FROM vehicle_sighting vs
        WHERE vs.matched_plate = ${plate}
          AND vs.detected_at > now() - interval '24 hours'
        ORDER BY vs.camera_id, vs.detected_at DESC
      ), ins AS (
        INSERT INTO wanted_list_notification
          (wanted_vehicle_id, source, matched_plate_number, camera_id, vehicle_sighting_id, seen_at, plate_confidence)
        SELECT ${wantedVehicleId}::uuid, 'camera_lookback', ${plate}, camera_id, vehicle_sighting_id, detected_at, plate_confidence
        FROM latest
        ON CONFLICT DO NOTHING
        RETURNING 1
      )
      SELECT count(*)::int AS inserted FROM ins
    `);
    return Number(rows[0]?.inserted ?? 0);
  }

  async listNotifications(
    query: Pick<NotificationQueryDto, 'page' | 'limit' | 'unreadOnly'>,
  ): Promise<WantedListNotificationRecord[]> {
    const whereClause = query.unreadOnly ? Prisma.sql`WHERE n.is_read = false` : Prisma.empty;
    const offset = (query.page - 1) * query.limit;

    const rows = await this.prisma.$queryRaw<RawNotificationRow[]>(
      Prisma.sql`${Prisma.raw(NOTIFICATION_SELECT_SQL)} ${whereClause} ORDER BY n.created_at DESC LIMIT ${query.limit} OFFSET ${offset}`,
    );

    return rows.map(mapRow);
  }

  async getUnreadCount(): Promise<number> {
    const rows = await this.prisma.$queryRaw<{ count: bigint }[]>(
      Prisma.sql`SELECT COUNT(*)::bigint AS count FROM wanted_list_notification WHERE is_read = false`,
    );
    return Number(rows[0]?.count ?? 0n);
  }

  async markRead(notificationId: string): Promise<void> {
    await this.prisma.$executeRaw(
      Prisma.sql`UPDATE wanted_list_notification SET is_read = true WHERE notification_id = ${notificationId}::uuid`,
    );
  }

  async markAllRead(): Promise<void> {
    await this.prisma.$executeRaw(
      Prisma.sql`UPDATE wanted_list_notification SET is_read = true WHERE is_read = false`,
    );
  }
}
