import { describe, it, expect, beforeEach } from 'vitest';

import { getStore, resetStore, insert, updateById, removeById } from './store';

describe('mock store', () => {
  beforeEach(() => {
    resetStore();
  });

  it('seeds collections from the static mock data', () => {
    const store = getStore();
    expect(store.departments.length).toBeGreaterThan(0);
    expect(store.employees.length).toBeGreaterThan(0);
    expect(store.demoUsers.length).toBeGreaterThan(0);
  });

  it('reset re-seeds the store', () => {
    const store = getStore();
    const before = store.departments.length;
    insert(store.departments, { id: 'dept-extra', name: 'Extra' } as never);
    expect(getStore().departments.length).toBe(before + 1);

    resetStore();
    expect(getStore().departments.length).toBe(before);
  });

  it('insert adds a record to a collection', () => {
    const store = getStore();
    const record = { id: 'dept-new', name: 'New Dept' } as never;
    insert(store.departments, record);
    expect(store.departments).toContain(record);
  });

  it('updateById patches an existing record', () => {
    const store = getStore();
    const target = store.departments[0];
    const updated = updateById(store.departments, target.id, { name: 'Renamed' } as never);
    expect(updated).toBeDefined();
    expect(updated?.name).toBe('Renamed');
  });

  it('updateById returns undefined for a missing id', () => {
    const store = getStore();
    expect(updateById(store.departments, 'missing', { name: 'x' } as never)).toBeUndefined();
  });

  it('removeById deletes a record', () => {
    const store = getStore();
    const target = store.departments[0];
    const removed = removeById(store.departments, target.id);
    expect(removed).toBe(true);
    expect(store.departments.find((d) => d.id === target.id)).toBeUndefined();
  });

  it('removeById returns false for a missing id', () => {
    const store = getStore();
    expect(removeById(store.departments, 'missing')).toBe(false);
  });
});
