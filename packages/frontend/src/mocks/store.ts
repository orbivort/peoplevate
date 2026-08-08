/**
 * In-memory mock store.
 *
 * Seeds mutable copies of the static mock arrays from `src/data/mock-data.ts`
 * and supports create/update/delete so mock mode can exercise full user
 * journeys without a backend. The store is reset on reload (see `reset()`).
 *
 * This is demo-only state: it is not persisted and does not survive a page
 * refresh. It intentionally mirrors the backend's persistence semantics only
 * loosely.
 */
import {
  demoUsers,
  departments,
  positions,
  employees,
  documents,
  employmentChanges,
  auditLog,
  expiryAlerts,
  jobRequisitions,
  candidates,
  interviews,
  offerLetters,
  onboardingRecords,
  evaluationCycles,
  performanceReviews,
  mockRetentionPolicies,
  mockLegalHolds,
  mockDsars,
  mockBreaches,
  mockAnomalyAlerts,
  mockConsentRecords,
  mockKeyVersions,
  leaveTypes,
  leavePolicyGroups,
  leaveRequests,
  leaveBalances,
  holidays,
  attendanceSummaries,
  offboardingRecords,
} from '../data/mock-data';

export interface MockStore {
  demoUsers: typeof demoUsers;
  departments: typeof departments;
  positions: typeof positions;
  employees: typeof employees;
  documents: typeof documents;
  employmentChanges: typeof employmentChanges;
  auditLog: typeof auditLog;
  expiryAlerts: typeof expiryAlerts;
  jobRequisitions: typeof jobRequisitions;
  candidates: typeof candidates;
  interviews: typeof interviews;
  offerLetters: typeof offerLetters;
  onboardingRecords: typeof onboardingRecords;
  evaluationCycles: typeof evaluationCycles;
  performanceReviews: typeof performanceReviews;
  mockRetentionPolicies: typeof mockRetentionPolicies;
  mockLegalHolds: typeof mockLegalHolds;
  mockDsars: typeof mockDsars;
  mockBreaches: typeof mockBreaches;
  mockAnomalyAlerts: typeof mockAnomalyAlerts;
  mockConsentRecords: typeof mockConsentRecords;
  mockKeyVersions: typeof mockKeyVersions;
  leaveTypes: typeof leaveTypes;
  leavePolicyGroups: typeof leavePolicyGroups;
  leaveRequests: typeof leaveRequests;
  leaveBalances: typeof leaveBalances;
  holidays: typeof holidays;
  attendanceSummaries: typeof attendanceSummaries;
  offboardingRecords: typeof offboardingRecords;
}

function seed(): MockStore {
  return {
    demoUsers: [...demoUsers],
    departments: [...departments],
    positions: [...positions],
    employees: [...employees],
    documents: [...documents],
    employmentChanges: [...employmentChanges],
    auditLog: [...auditLog],
    expiryAlerts: [...expiryAlerts],
    jobRequisitions: [...jobRequisitions],
    candidates: [...candidates],
    interviews: [...interviews],
    offerLetters: [...offerLetters],
    onboardingRecords: [...onboardingRecords],
    evaluationCycles: [...evaluationCycles],
    performanceReviews: [...performanceReviews],
    mockRetentionPolicies: [...mockRetentionPolicies],
    mockLegalHolds: [...mockLegalHolds],
    mockDsars: [...mockDsars],
    mockBreaches: [...mockBreaches],
    mockAnomalyAlerts: [...mockAnomalyAlerts],
    mockConsentRecords: [...mockConsentRecords],
    mockKeyVersions: [...mockKeyVersions],
    leaveTypes: [...leaveTypes],
    leavePolicyGroups: [...leavePolicyGroups],
    leaveRequests: [...leaveRequests],
    leaveBalances: [...leaveBalances],
    holidays: [...holidays],
    attendanceSummaries: [...attendanceSummaries],
    offboardingRecords: [...offboardingRecords],
  };
}

let store: MockStore = seed();

/** Returns the current in-memory store (mutable). */
export function getStore(): MockStore {
  return store;
}

/** Re-seeds the store from the static mock arrays. */
export function resetStore(): void {
  store = seed();
}

/** Generic helpers for CRUD against a collection keyed by `id`. */
export function insert<T extends { id: string }>(collection: T[], record: T): T {
  collection.push(record);
  return record;
}

export function updateById<T extends { id: string }>(
  collection: T[],
  id: string,
  patch: Partial<T>,
): T | undefined {
  const index = collection.findIndex((item) => item.id === id);
  if (index === -1) return undefined;
  const updated = { ...collection[index], ...patch } as T;
  collection[index] = updated;
  return updated;
}

export function removeById<T extends { id: string }>(collection: T[], id: string): boolean {
  const index = collection.findIndex((item) => item.id === id);
  if (index === -1) return false;
  collection.splice(index, 1);
  return true;
}
