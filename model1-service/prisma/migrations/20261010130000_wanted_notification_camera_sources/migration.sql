-- Allow camera-originated wanted-list alerts. The previous migration
-- (20260912123000_simplify_wanted_list) restricted source to manual_search
-- when camera matching was out of scope; it is now in scope.
ALTER TABLE "wanted_list_notification" DROP CONSTRAINT "wanted_list_notification_source_check";
ALTER TABLE "wanted_list_notification" ADD CONSTRAINT "wanted_list_notification_source_check"
  CHECK ("source" IN ('manual_search', 'camera_live', 'camera_lookback'));
