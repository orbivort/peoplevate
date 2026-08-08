/**
 * Centralized mock registry.
 *
 * Maps each resource to its mock data source and (where applicable) its real
 * repository, so adding mock support for a new feature is a single,
 * discoverable entry. MSW handlers are derived from this registry, keeping the
 * wiring in one place and reducing drift between mock and real behavior.
 */
import type { MockStore } from './store';

export interface MockResource<T = unknown> {
  /** Human-readable resource name, e.g. 'departments'. */
  name: string;
  /** Selector that returns the current collection from the in-memory store. */
  select: (store: MockStore) => T[];
  /** Optional real repository reference (used for parity checks / docs). */
  repo?: unknown;
}

/**
 * The registry. Add a new entry here when wiring mock support for a feature.
 * The `select` function reads from the live in-memory store so CRUD mutations
 * are reflected in subsequent requests.
 */
export const mockRegistry: MockResource[] = [
  { name: 'departments', select: (s) => s.departments },
  { name: 'positions', select: (s) => s.positions },
  { name: 'employees', select: (s) => s.employees },
  { name: 'documents', select: (s) => s.documents },
  { name: 'employmentChanges', select: (s) => s.employmentChanges },
  { name: 'auditLog', select: (s) => s.auditLog },
  { name: 'expiryAlerts', select: (s) => s.expiryAlerts },
  { name: 'jobRequisitions', select: (s) => s.jobRequisitions },
  { name: 'candidates', select: (s) => s.candidates },
  { name: 'interviews', select: (s) => s.interviews },
  { name: 'offerLetters', select: (s) => s.offerLetters },
  { name: 'onboardingRecords', select: (s) => s.onboardingRecords },
  { name: 'evaluationCycles', select: (s) => s.evaluationCycles },
  { name: 'performanceReviews', select: (s) => s.performanceReviews },
  { name: 'retentionPolicies', select: (s) => s.mockRetentionPolicies },
  { name: 'legalHolds', select: (s) => s.mockLegalHolds },
  { name: 'dsars', select: (s) => s.mockDsars },
  { name: 'breaches', select: (s) => s.mockBreaches },
  { name: 'anomalyAlerts', select: (s) => s.mockAnomalyAlerts },
  { name: 'consentRecords', select: (s) => s.mockConsentRecords },
  { name: 'keyVersions', select: (s) => s.mockKeyVersions },
];

/** Look up a resource by name. */
export function getMockResource(name: string): MockResource | undefined {
  return mockRegistry.find((r) => r.name === name);
}
