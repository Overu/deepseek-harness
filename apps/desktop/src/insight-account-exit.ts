/** Account resource release required before restarting the Insight application. */

/** Main-owned operations for closing one immutable account process. */
export interface InsightAccountExitOperations {
  /** Reject new requests and remove renderer access before stopping resources. */
  revoke(): void
  /** Confirm every account-owned resource has stopped. */
  stop: readonly (() => Promise<void>)[]
  /** Clear authentication without deleting account homes or history. */
  clearAuthentication(): Promise<void>
}

/**
 * Close admission immediately and await all resource releases, even when one fails.
 * @param operations - Account-owned shutdown operations; none may start a replacement Host.
 * @returns Completion only after all resources stop and authentication clears; failures prevent restart.
 */
export async function closeInsightAccount(operations: InsightAccountExitOperations): Promise<void> {
  const errors: unknown[] = []
  try { operations.revoke() } catch (error) { errors.push(error) }
  const results = await Promise.allSettled(operations.stop.map(async (stop) => { await stop() }))
  for (const result of results) if (result.status === 'rejected') errors.push(result.reason)
  try { await operations.clearAuthentication() } catch (error) { errors.push(error) }
  if (errors.length > 0) throw new AggregateError(errors, 'Insight account shutdown could not be confirmed')
}
