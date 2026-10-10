// Shared by create/update (what gets stored) and check-plate (what gets
// looked up) so "GJ01AB1234", "gj 01 ab 1234", and "GJ-01-AB-1234" all
// normalize to the same stored/queried value — an exact-match lookup that
// silently failed on formatting alone would be a real, install undetected,
// false negative for something that's supposed to be a matching feature.
export function normalizePlateNumber(plate: string): string {
  // Letters and digits only — exactly what a camera's plate read contains,
  // so a wanted entry typed with dots/slashes/underscores still matches.
  return plate.toUpperCase().replace(/[^A-Z0-9]/g, '');
}
