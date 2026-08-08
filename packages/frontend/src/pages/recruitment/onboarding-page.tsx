import { motion } from 'framer-motion';
import {
  CheckCircle2,
  ClipboardCheck,
  Clock,
  Laptop,
  MonitorCog,
  Plus,
  UserCheck,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router';

import { PageHeader } from '@/components/layout/page-header';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { useAuth } from '@/contexts/auth-context';
import { useEmployees } from '@/data/data-layer';
import { recruitmentRepo } from '@/lib/api/workflow-repositories';
import { cn, formatDate, daysUntil } from '@/lib/utils';
import type { OnboardingRecord, OnboardingTask, OnboardingTaskType } from '@/types';

const taskTypeConfig: Record<
  OnboardingTaskType,
  { icon: typeof Laptop; color: string; bg: string }
> = {
  'Document Submission': {
    icon: ClipboardCheck,
    color: 'text-blue-600',
    bg: 'bg-blue-100',
  },
  'Equipment Assignment': {
    icon: Laptop,
    color: 'text-accent-700',
    bg: 'bg-accent-100',
  },
  'Orientation Session': {
    icon: UserCheck,
    color: 'text-purple-700',
    bg: 'bg-purple-100',
  },
  'System Access Setup': {
    icon: MonitorCog,
    color: 'text-amber-700',
    bg: 'bg-amber-100',
  },
};

export function OnboardingPage() {
  const { employee, hasPermission } = useAuth();
  const isHrOrAdmin = hasPermission('manageRecruitment');
  const canManageDept = hasPermission('manageRecruitmentDept');
  const [records, setRecords] = useState<OnboardingRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const { data: employees } = useEmployees();

  const load = useCallback(async () => {
    try {
      const all: OnboardingRecord[] = [];
      await Promise.all(
        employees.map(async (emp) => {
          try {
            const tasks = await recruitmentRepo.listOnboarding(emp.id);
            if (tasks.length === 0) return;
            const completedTasks = tasks.filter((t) => t.status === 'Complete').length;
            all.push({
              id: emp.id,
              employeeId: emp.id,
              employeeName: `${emp.firstName} ${emp.lastName}`,
              startDate: emp.hireDate,
              status: completedTasks === tasks.length ? 'Complete' : 'In Progress',
              tasks,
              completedTasks,
              totalTasks: tasks.length,
            });
          } catch {
            // Skip employees without onboarding tasks.
          }
        }),
      );
      setRecords(all);
    } catch {
      // Swallow load errors; the empty state is shown instead.
    } finally {
      setLoading(false);
    }
  }, [employees]);

  useEffect(() => {
    let cancelled = false;
    queueMicrotask(() => {
      if (!cancelled) void load();
    });
    return () => {
      cancelled = true;
    };
  }, [load]);

  // Scope: HR/Admin sees all; Manager sees employees in their department
  const visibleRecords = useMemo(() => {
    if (isHrOrAdmin) return records;
    if (canManageDept && employee) {
      const deptEmployeeIds = new Set(
        employees.filter((e) => e.departmentId === employee.departmentId).map((e) => e.id),
      );
      return records.filter((r) => deptEmployeeIds.has(r.employeeId));
    }
    // Employee sees only their own onboarding record
    return records.filter((r) => r.employeeId === employee?.id);
  }, [records, isHrOrAdmin, canManageDept, employee, employees]);

  const myAssigneeName = employee ? `${employee.firstName} ${employee.lastName}` : '';

  const toggleTask = async (recordId: string, taskId: string) => {
    // Only HR/Admin can toggle tasks
    if (!isHrOrAdmin) return;
    const rec = records.find((r) => r.id === recordId);
    const task = rec?.tasks.find((t) => t.id === taskId);
    if (!rec || !task) return;
    const nextStatus = task.status === 'Complete' ? 'PENDING' : 'COMPLETE';
    try {
      await recruitmentRepo.updateOnboardingTask(taskId, { status: nextStatus });
      setRecords((prev) =>
        prev.map((r) => {
          if (r.id !== recordId) return r;
          const updatedTasks = r.tasks.map((t) => {
            if (t.id !== taskId) return t;
            const isComplete = t.status === 'Complete';
            return {
              ...t,
              status: (isComplete ? 'Pending' : 'Complete') as OnboardingTask['status'],
              completedAt: isComplete ? null : new Date().toISOString(),
            } as OnboardingTask;
          });
          const completed = updatedTasks.filter((t) => t.status === 'Complete').length;
          return {
            ...r,
            tasks: updatedTasks,
            completedTasks: completed,
            status: completed === r.totalTasks ? ('Complete' as const) : ('In Progress' as const),
          };
        }),
      );
    } catch {
      // Ignore update failure; the task stays in its previous state.
    }
  };

  return (
    <div>
      <PageHeader
        title="Onboarding"
        description={
          isHrOrAdmin
            ? 'Onboarding checklists are auto-generated when a candidate accepts an offer. Each task is assigned to a responsible party.'
            : canManageDept
              ? 'View onboarding progress for employees in your department. Only HR can mark tasks as complete.'
              : 'View your onboarding checklist and track progress.'
        }
      />

      {loading ? (
        <Card>
          <div className="flex h-40 items-center justify-center text-sm text-ink-500">
            Loading onboarding records…
          </div>
        </Card>
      ) : visibleRecords.length === 0 ? (
        <Card>
          <EmptyState
            icon={ClipboardCheck}
            title="No onboarding records"
            description="Onboarding checklists will appear here when candidates are converted to employees."
          />
        </Card>
      ) : (
        <div className="space-y-6">
          {visibleRecords.map((rec, ri) => {
            const progress = Math.round((rec.completedTasks / rec.totalTasks) * 100);
            return (
              <motion.div
                key={rec.id}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: ri * 0.08, duration: 0.35 }}
              >
                <Card>
                  <CardHeader>
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                      <div className="flex items-center gap-3">
                        <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-accent-100">
                          <ClipboardCheck className="h-5 w-5 text-accent-700" />
                        </div>
                        <div>
                          <CardTitle className="flex items-center gap-2">
                            <Link
                              to={`/app/employees/${rec.employeeId}`}
                              className="transition-colors hover:text-accent-700"
                            >
                              {rec.employeeName}
                            </Link>
                            {rec.status === 'Complete' ? (
                              <Badge className="border-transparent bg-accent-100 text-accent-800">
                                <CheckCircle2 className="h-3 w-3" />
                                Complete
                              </Badge>
                            ) : (
                              <Badge className="border-transparent bg-amber-100 text-amber-800">
                                <Clock className="h-3 w-3" />
                                In Progress
                              </Badge>
                            )}
                          </CardTitle>
                          <p className="mt-0.5 text-xs text-ink-500">
                            Started {formatDate(rec.startDate, { month: 'short', day: 'numeric' })}{' '}
                            · {rec.completedTasks}/{rec.totalTasks} tasks complete
                          </p>
                        </div>
                      </div>
                      <div className="flex items-center gap-3">
                        <div className="w-32">
                          <div className="mb-1 flex justify-between text-[10px] text-ink-500">
                            <span>Progress</span>
                            <span className="font-medium">{progress}%</span>
                          </div>
                          <div className="h-2 overflow-hidden rounded-full bg-ink-100">
                            <motion.div
                              className={cn(
                                'h-full rounded-full',
                                progress === 100 ? 'bg-accent-500' : 'bg-accent-400',
                              )}
                              initial={{ width: 0 }}
                              animate={{ width: `${progress}%` }}
                              transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
                            />
                          </div>
                        </div>
                      </div>
                    </div>
                  </CardHeader>
                  <CardContent>
                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                      {rec.tasks.map((task) => {
                        const cfg = taskTypeConfig[task.type];
                        const Icon = cfg.icon;
                        const isOverdue = task.status === 'Pending' && daysUntil(task.dueDate) < 0;
                        const isMine = task.assignee === myAssigneeName;
                        return (
                          <div
                            key={task.id}
                            className={cn(
                              'flex items-start gap-3 rounded-lg border p-3 transition-colors',
                              task.status === 'Complete'
                                ? 'border-accent-200 bg-accent-50/40'
                                : isOverdue
                                  ? 'border-red-200 bg-red-50/40'
                                  : 'border-ink-200 bg-white hover:bg-ink-50',
                            )}
                          >
                            <div
                              className={cn(
                                'flex h-8 w-8 shrink-0 items-center justify-center rounded-lg',
                                cfg.bg,
                              )}
                            >
                              <Icon className={cn('h-4 w-4', cfg.color)} />
                            </div>
                            <div className="min-w-0 flex-1">
                              <div className="flex items-center justify-between gap-2">
                                <p className="text-sm font-medium text-ink-900">{task.type}</p>
                                <button
                                  type="button"
                                  disabled={!isHrOrAdmin || (task.status === 'Complete' && !isMine)}
                                  onClick={() => toggleTask(rec.id, task.id)}
                                  className={cn(
                                    'flex h-5 w-5 items-center justify-center rounded border transition-all',
                                    task.status === 'Complete'
                                      ? 'border-accent-500 bg-accent-500 text-white'
                                      : 'border-ink-300 hover:border-accent-500 hover:bg-accent-50',
                                  )}
                                >
                                  {task.status === 'Complete' && (
                                    <CheckCircle2 className="h-3.5 w-3.5" />
                                  )}
                                </button>
                              </div>
                              <div className="mt-1 flex items-center gap-3 text-xs text-ink-500">
                                <span>Assigned to {task.assignee}</span>
                                <span>·</span>
                                <span className={cn(isOverdue && 'font-medium text-red-600')}>
                                  Due {formatDate(task.dueDate, { month: 'short', day: 'numeric' })}
                                  {isOverdue && ' · Overdue'}
                                </span>
                              </div>
                              {task.completedAt && (
                                <p className="mt-1 text-[11px] text-accent-700">
                                  Completed {formatDate(task.completedAt)}
                                </p>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </CardContent>
                </Card>
              </motion.div>
            );
          })}
        </div>
      )}

      <div className="mt-4 flex items-start gap-2 rounded-lg border border-ink-200 bg-white p-3 text-xs text-ink-500">
        <Plus className="mt-0.5 h-4 w-4 shrink-0 text-ink-400" />
        <p>
          Onboarding checklists contain four default task types: Document Submission, Equipment
          Assignment, Orientation Session, and System Access Setup.{' '}
          {isHrOrAdmin
            ? 'Custom tasks can be added by HR. Overdue tasks are flagged automatically.'
            : 'Only HR can mark tasks as complete. Overdue tasks are flagged automatically.'}
        </p>
      </div>
    </div>
  );
}
