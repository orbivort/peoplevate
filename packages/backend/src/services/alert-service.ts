import { prisma } from '../config/prisma.js';
import { logger } from '../config/logger.js';
import { sendEmail } from './email-service.js';
import { AlertSeverity, EmploymentStatus } from '#prisma';

export async function runExpiryCheck(): Promise<void> {
  logger.info('Running document expiry check...');

  const now = new Date();
  const thirtyDaysFromNow = new Date();
  thirtyDaysFromNow.setDate(thirtyDaysFromNow.getDate() + 30);

  // Find documents expiring within 30 days or already expired
  const documents = await prisma.document.findMany({
    where: {
      deleted_at: null,
      expiry_date: { lte: thirtyDaysFromNow },
    },
    include: {
      employee: {
        select: { id: true, first_name: true, last_name: true, status: true, email: true },
      },
    },
  });

  let alertsCreated = 0;

  for (const doc of documents) {
    // Check idempotency: skip if an alert already exists for this document today
    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);

    const existing = await prisma.expiryAlert.findFirst({
      where: {
        document_id: doc.id,
        created_at: { gte: startOfDay },
      },
    });
    if (existing) continue;

    const daysUntilExpiry = Math.ceil(
      (doc.expiry_date!.getTime() - now.getTime()) / (1000 * 60 * 60 * 24),
    );
    const severity = doc.expiry_date! < now ? AlertSeverity.EXPIRED : AlertSeverity.SOON;
    const employeeName = `${doc.employee.first_name} ${doc.employee.last_name}`;

    await prisma.expiryAlert.create({
      data: {
        document_id: doc.id,
        employee_id: doc.employee.id,
        employee_name: employeeName,
        document_type: doc.type,
        expiry_date: doc.expiry_date!,
        days_until_expiry: daysUntilExpiry,
        severity,
        acknowledged: false,
      },
    });
    alertsCreated++;

    // Send email notification (skip if employee is terminated)
    if (doc.employee.status !== EmploymentStatus.TERMINATED) {
      const subject =
        severity === AlertSeverity.EXPIRED
          ? `Document Expired: ${doc.type}`
          : `Document Expiring Soon: ${doc.type}`;
      const html = `
        <h2>Document ${severity === AlertSeverity.EXPIRED ? 'Expired' : 'Expiring Soon'}</h2>
        <p><strong>Employee:</strong> ${employeeName}</p>
        <p><strong>Document Type:</strong> ${doc.type}</p>
        <p><strong>Expiry Date:</strong> ${doc.expiry_date!.toLocaleDateString()}</p>
        <p><strong>Days ${severity === AlertSeverity.EXPIRED ? 'Since Expiry' : 'Until Expiry'}:</strong> ${Math.abs(daysUntilExpiry)}</p>
      `;
      await sendEmail(doc.employee.email, subject, html);
    }
  }

  logger.info(`Expiry check complete: ${alertsCreated} alerts created.`);
}

export async function getAlerts(params: {
  acknowledged?: boolean | undefined;
}): Promise<unknown[]> {
  const where: Record<string, unknown> = {};
  if (params.acknowledged !== undefined) {
    where.acknowledged = params.acknowledged;
  }

  const alerts = await prisma.expiryAlert.findMany({
    where,
    orderBy: [{ severity: 'asc' }, { days_until_expiry: 'asc' }],
  });

  return alerts;
}

export async function acknowledgeAlert(alertId: string): Promise<void> {
  await prisma.expiryAlert.update({
    where: { id: alertId },
    data: { acknowledged: true },
  });
}
