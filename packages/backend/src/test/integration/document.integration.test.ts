import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { DocumentType, EmploymentStatus, EmploymentType, UserRole } from '#prisma';
import {
  createTestApp,
  createUser,
  loginForToken,
  resetDatabase,
  disconnectDb,
  prisma,
} from './helpers.js';

let employeeSeq = 0;
async function seedEmployee(role: UserRole, email: string) {
  employeeSeq += 1;
  const department = await prisma.department.create({ data: { name: 'Legal' } });
  const position = await prisma.position.create({
    data: { name: 'Legal', grade: 'L4', department_id: department.id },
  });
  const employee = await prisma.employee.create({
    data: {
      employee_no: `EMP-DOC-${String(employeeSeq).padStart(4, '0')}`,
      first_name: 'Dani',
      last_name: 'Docs',
      email,
      department_id: department.id,
      position_id: position.id,
      hire_date: new Date('2024-01-15'),
      employment_type: EmploymentType.FULL_TIME,
      status: EmploymentStatus.ACTIVE,
    },
  });
  const user = await createUser({ role, email, employeeId: employee.id });
  return { employee, user };
}

const pdfBuffer = Buffer.from('%PDF-1.4 fake pdf content for integration test');

describe('document management integration', () => {
  let app: Express;

  beforeAll(() => {
    app = createTestApp();
  });

  beforeEach(async () => {
    await resetDatabase();
  });

  afterAll(async () => {
    await disconnectDb();
  });

  async function hrToken(): Promise<string> {
    const hr = await createUser({ role: UserRole.HR_MANAGER, email: 'hr@example.com' });
    return loginForToken(app, hr.email, hr.password);
  }

  it('uploads a valid PDF and lists it with expiry status', async () => {
    const { employee, user } = await seedEmployee(UserRole.EMPLOYEE, 'dani@example.com');
    const empToken = await loginForToken(app, user.email, user.password);
    const token = await hrToken();

    const upload = await request(app)
      .post(`/api/documents/employee/${employee.id}`)
      .set('Authorization', `Bearer ${token}`)
      .attach('file', pdfBuffer, { filename: 'contract.pdf', contentType: 'application/pdf' })
      .field('type', DocumentType.CONTRACT)
      .field('expiryDate', new Date(Date.now() + 120 * 86400000).toISOString());
    expect(upload.status).toBe(201);
    expect(upload.body).toMatchObject({ id: expect.any(String) });

    const list = await request(app)
      .get(`/api/documents/employee/${employee.id}`)
      .set('Authorization', `Bearer ${empToken}`);
    expect(list.status).toBe(200);
    expect(list.body.documents).toHaveLength(1);
    expect(list.body.documents[0]).toMatchObject({
      type: DocumentType.CONTRACT,
      originalFilename: 'contract.pdf',
      mimeType: 'application/pdf',
      expiryStatus: 'valid',
    });
  });

  it('rejects an unsupported file type with 400', async () => {
    const { employee } = await seedEmployee(UserRole.EMPLOYEE, 'dani@example.com');
    const token = await hrToken();

    const upload = await request(app)
      .post(`/api/documents/employee/${employee.id}`)
      .set('Authorization', `Bearer ${token}`)
      .attach('file', Buffer.from('#!/bin/sh\necho hi'), {
        filename: 'malware.sh',
        contentType: 'text/x-shellscript',
      })
      .field('type', DocumentType.OTHER);
    expect(upload.status).toBe(400);

    const docs = await prisma.document.findMany({ where: { employee_id: employee.id } });
    expect(docs).toHaveLength(0);
  });

  it('reports an expiring document as soon', async () => {
    const { employee } = await seedEmployee(UserRole.EMPLOYEE, 'dani@example.com');
    const token = await hrToken();

    const upload = await request(app)
      .post(`/api/documents/employee/${employee.id}`)
      .set('Authorization', `Bearer ${token}`)
      .attach('file', pdfBuffer, { filename: 'pass.pdf', contentType: 'application/pdf' })
      .field('type', DocumentType.NATIONAL_ID)
      .field('expiryDate', new Date(Date.now() + 10 * 86400000).toISOString());
    expect(upload.status).toBe(201);

    const list = await request(app)
      .get(`/api/documents/employee/${employee.id}`)
      .set('Authorization', `Bearer ${token}`);
    expect(list.body.documents[0].expiryStatus).toBe('soon');
  });

  it('downloads an uploaded document with the correct content-type', async () => {
    const { employee, user } = await seedEmployee(UserRole.EMPLOYEE, 'dani@example.com');
    const empToken = await loginForToken(app, user.email, user.password);
    const token = await hrToken();

    const upload = await request(app)
      .post(`/api/documents/employee/${employee.id}`)
      .set('Authorization', `Bearer ${token}`)
      .attach('file', pdfBuffer, { filename: 'a.pdf', contentType: 'application/pdf' })
      .field('type', DocumentType.CONTRACT);
    const docId = (upload.body as { id: string }).id;

    const download = await request(app)
      .get(`/api/documents/${docId}/download`)
      .set('Authorization', `Bearer ${empToken}`);
    expect(download.status).toBe(200);
    expect(download.headers['content-type']).toContain('application/pdf');
  });

  it('soft-deletes a document so it disappears from the list and download 404s', async () => {
    const { employee, user } = await seedEmployee(UserRole.EMPLOYEE, 'dani@example.com');
    const empToken = await loginForToken(app, user.email, user.password);
    const token = await hrToken();

    const upload = await request(app)
      .post(`/api/documents/employee/${employee.id}`)
      .set('Authorization', `Bearer ${token}`)
      .attach('file', pdfBuffer, { filename: 'b.pdf', contentType: 'application/pdf' })
      .field('type', DocumentType.CONTRACT);
    const docId = (upload.body as { id: string }).id;

    const del = await request(app)
      .delete(`/api/documents/${docId}`)
      .set('Authorization', `Bearer ${token}`);
    expect(del.status).toBe(200);

    const list = await request(app)
      .get(`/api/documents/employee/${employee.id}`)
      .set('Authorization', `Bearer ${empToken}`);
    expect(list.body.documents).toHaveLength(0);

    const download = await request(app)
      .get(`/api/documents/${docId}/download`)
      .set('Authorization', `Bearer ${empToken}`);
    expect(download.status).toBe(404);
  });

  it('forbids an EMPLOYEE from accessing another employee’s documents', async () => {
    const { employee } = await seedEmployee(UserRole.EMPLOYEE, 'dani@example.com');
    const { user: other } = await seedEmployee(UserRole.EMPLOYEE, 'other@example.com');
    const otherToken = await loginForToken(app, other.email, other.password);

    const list = await request(app)
      .get(`/api/documents/employee/${employee.id}`)
      .set('Authorization', `Bearer ${otherToken}`);
    expect(list.status).toBe(403);
  });
});
