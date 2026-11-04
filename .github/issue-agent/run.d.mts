/**
 * Match the prepared request to its workflow webhook before publication.
 * @param request Trusted input artifact.
 * @param event Current webhook payload.
 * @param repository Current workflow repository.
 * @param eventName GitHub event name.
 * @returns Whether the request belongs to this event and target.
 */
export function matchesEventRequest(request: Record<string, unknown>, event: object, repository: string, eventName: string): boolean
