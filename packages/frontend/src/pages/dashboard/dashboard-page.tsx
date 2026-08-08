import { motion } from 'framer-motion';
import {
  AlertTriangle,
  ArrowUpRight,
  Building2,
  CalendarClock,
  FileText,
  TrendingUp,
  Users,
} from 'lucide-react';
import { Link } from 'react-router';

import { PageHeader } from '@/components/layout/page-header';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { StatusBadge } from '@/components/ui/status-badge';
import { useAuth } from '@/contexts/auth-context';
import {
  useAuditLog,
  useDepartments,
  useEmployees,
  useExpiryAlerts,
  usePositions,
} from '@/data/data-layer';
import type { AuditChange } from '@/types';
import { cn, formatDate, formatRelative, initials } from '@/lib/utils';

/** Build a compact one-line description of an entry's first field change. */
function firstChange(changes?: AuditChange[]): string | null {
  const first = (changes ?? [])[0];
  if (!first) return null;
  if (first.old !== null && first.new !== null) {
    return `${first.label}: ${first.old} → ${first.new}`;
  }
  if (first.new !== null) return `${first.label}: ${first.new}`;
  if (first.old !== null) return `${first.label}: ${first.old}`;
  return first.label;
}

export function DashboardPage() {
  const { user, employee, hasPermission } = useAuth();
  const { data: employees } = useEmployees();
  const { data: departments } = useDepartments();
  const { data: positions } = usePositions();
  const { data: expiryAlerts } = useExpiryAlerts();
  const { data: auditData } = useAuditLog({ page: 1, pageSize: 6 });
  const auditLog = auditData.logs;
  if (!user) return null;

  const displayName = employee
    ? `${employee.firstName} ${employee.lastName}`
    : user.email.split('@')[0];

  const isHrOrAdmin = user.role === 'Admin' || user.role === 'HR Manager';

  return (
    <div>
      <PageHeader
        title={`Welcome, ${(displayName ?? '').split(' ')[0] ?? ''}`}
        description={
          isHrOrAdmin
            ? 'Here is what is happening across your organization today.'
            : 'Here is a summary of your employment information.'
        }
      />

      {/* Stat cards */}
      {isHrOrAdmin ? (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard
            icon={Users}
            label="Total employees"
            value={employees.length.toString()}
            trend="+2 this month"
            delay={0}
          />
          <StatCard
            icon={Building2}
            label="Departments"
            value={departments.length.toString()}
            trend={`${positions.length} positions`}
            delay={0.05}
          />
          <StatCard
            icon={AlertTriangle}
            label="Expiring documents"
            value={expiryAlerts.filter((a) => !a.acknowledged).length.toString()}
            trend="Needs attention"
            tone={expiryAlerts.some((a) => !a.acknowledged) ? 'warning' : 'neutral'}
            delay={0.1}
          />
          <StatCard
            icon={TrendingUp}
            label="On probation"
            value={employees.filter((e) => e.status === 'Probation').length.toString()}
            trend="Review due"
            delay={0.15}
          />
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <StatCard
            icon={FileText}
            label="My documents"
            value="3"
            trend="1 expiring soon"
            tone="warning"
            delay={0}
          />
          <StatCard
            icon={CalendarClock}
            label="Tenure"
            value={
              employee ? formatDate(employee.hireDate, { year: 'numeric', month: 'short' }) : '—'
            }
            trend="2 years, 6 months"
            delay={0.05}
          />
          <StatCard
            icon={Users}
            label="Reports to"
            value={employee?.managerName ?? '—'}
            trend={employee?.positionName ?? ''}
            delay={0.1}
          />
        </div>
      )}

      <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-3">
        {/* Recent activity (audit log) */}
        <Card className="lg:col-span-2">
          <CardHeader className="flex flex-row items-center justify-between space-y-0">
            <CardTitle>Recent activity</CardTitle>
            {hasPermission('viewAuditLog') && (
              <Button variant="ghost" size="sm" asChild>
                <Link to="/app/audit-log">
                  View all
                  <ArrowUpRight className="h-3.5 w-3.5" />
                </Link>
              </Button>
            )}
          </CardHeader>
          <CardContent className="space-y-1">
            {auditLog.slice(0, 6).map((entry, i) => (
              <motion.div
                key={entry.id}
                initial={{ opacity: 0, x: -8 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: 0.1 + i * 0.04, duration: 0.3 }}
                className="flex items-center gap-3 rounded-lg px-2 py-2.5 transition-colors hover:bg-ink-50"
              >
                <Avatar className="h-8 w-8">
                  <AvatarFallback className="bg-ink-100 text-[11px] text-ink-600">
                    {initials(entry.actorName)}
                  </AvatarFallback>
                </Avatar>
                <div className="min-w-0 flex-1">
                  <p className="text-sm text-ink-800">
                    <span className="font-medium">{entry.actorName}</span>{' '}
                    <span className="text-ink-500">{entry.action.toLowerCase()}d</span>{' '}
                    <span className="font-medium">{entry.entityLabel || entry.entity}</span>
                    {firstChange(entry.changes) && (
                      <span className="text-ink-500"> — {firstChange(entry.changes)}</span>
                    )}
                  </p>
                  <p className="text-xs text-ink-400">{formatRelative(entry.timestamp)}</p>
                </div>
                <Badge variant="outline" className="shrink-0 font-mono text-[10px]">
                  {entry.action}
                </Badge>
              </motion.div>
            ))}
          </CardContent>
        </Card>

        {/* Document expiry alerts (HR/Admin only) */}
        {isHrOrAdmin && (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <AlertTriangle className="h-4 w-4 text-amber-500" />
                Document alerts
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {expiryAlerts
                .filter((a) => !a.acknowledged)
                .slice(0, 4)
                .map((alert, i) => (
                  <motion.div
                    key={alert.id}
                    initial={{ opacity: 0, y: 6 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.1 + i * 0.05, duration: 0.3 }}
                    className="flex items-start gap-3 rounded-lg border border-ink-200 p-3"
                  >
                    <div
                      className={cn(
                        'mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg',
                        alert.severity === 'expired' ? 'bg-red-100' : 'bg-amber-100',
                      )}
                    >
                      <FileText
                        className={cn(
                          'h-4 w-4',
                          alert.severity === 'expired' ? 'text-red-600' : 'text-amber-600',
                        )}
                      />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium text-ink-900">{alert.employeeName}</p>
                      <p className="text-xs text-ink-500">
                        {alert.documentType} ·{' '}
                        {alert.severity === 'expired'
                          ? `Expired ${Math.abs(alert.daysUntilExpiry)}d ago`
                          : `Expires in ${alert.daysUntilExpiry}d`}
                      </p>
                    </div>
                  </motion.div>
                ))}
            </CardContent>
          </Card>
        )}

        {/* My profile summary (Employee/Manager) */}
        {!isHrOrAdmin && employee && (
          <Card>
            <CardHeader>
              <CardTitle>My employment</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center gap-3">
                <Avatar className="h-12 w-12">
                  <AvatarFallback className="bg-ink-900 text-ink-50">
                    {initials(`${employee.firstName} ${employee.lastName}`)}
                  </AvatarFallback>
                </Avatar>
                <div>
                  <p className="font-medium text-ink-900">
                    {employee.firstName} {employee.lastName}
                  </p>
                  <p className="text-sm text-ink-500">{employee.positionName}</p>
                </div>
              </div>
              <div className="space-y-2 rounded-lg bg-ink-50 p-3">
                <Row label="Employee ID" value={employee.employeeNo} />
                <Row label="Department" value={employee.departmentName} />
                <Row label="Type" value={employee.employmentType} />
                <div className="flex items-center justify-between">
                  <span className="text-xs text-ink-500">Status</span>
                  <StatusBadge status={employee.status} />
                </div>
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-xs text-ink-500">{label}</span>
      <span className="text-xs font-medium text-ink-800">{value}</span>
    </div>
  );
}

function StatCard({
  icon: Icon,
  label,
  value,
  trend,
  tone = 'neutral',
  delay = 0,
}: {
  icon: typeof Users;
  label: string;
  value: string;
  trend: string;
  tone?: 'neutral' | 'warning';
  delay?: number;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay, duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
    >
      <Card className="overflow-hidden">
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium tracking-wide text-ink-500 uppercase">
              {label}
            </span>
            <div
              className={cn(
                'flex h-8 w-8 items-center justify-center rounded-lg',
                tone === 'warning'
                  ? 'bg-amber-100 text-amber-600'
                  : 'bg-accent-100 text-accent-700',
              )}
            >
              <Icon className="h-4 w-4" />
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <div className="font-display text-2xl font-semibold tracking-tight text-ink-900">
            {value}
          </div>
          <div
            className={cn('mt-1 text-xs', tone === 'warning' ? 'text-amber-600' : 'text-ink-500')}
          >
            {trend}
          </div>
        </CardContent>
      </Card>
    </motion.div>
  );
}
