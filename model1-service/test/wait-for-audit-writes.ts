// Shared by e2e specs' afterAll cleanup. AuditLogInterceptor's write is
// fire-and-forget (see writeAuditLogEntry) — it never blocks the HTTP
// response. That's correct for production, but it means a test's own
// cleanup can delete an app_user row moments before that user's own
// still-in-flight login/logout audit write lands, tripping
// audit_log_user_id_fkey. Call this right before deleting the app_user rows
// in afterAll to give any in-flight writes from this suite's own requests
// time to land first.
export async function waitForAuditWritesToSettle(ms = 300): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}
