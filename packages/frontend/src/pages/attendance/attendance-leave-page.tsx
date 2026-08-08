import { motion } from 'framer-motion';
import {
  BarChart3,
  Calendar,
  CalendarClock,
  CalendarDays,
  Check,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Clock4,
  Coffee,
  FileText,
  Fingerprint,
  Hourglass,
  LogIn,
  LogOut,
  Plane,
  Plus,
  Settings2,
  Timer,
  X,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router';

import { PageHeader } from '@/components/layout/page-header';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { EmptyState } from '@/components/ui/empty-state';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Separator } from '@/components/ui/separator';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { useAuth } from '@/contexts/auth-context';
import { useEmployees } from '@/data/data-layer';
import { attendanceRepo } from '@/lib/api/workflow-repositories';
import { cn, formatDate, formatRelative, initials } from '@/lib/utils';
import type {
  AttendanceRecord,
  AttendanceStatus,
  LeaveBalance,
  LeaveRequest,
  LeaveRequestStatus,
  LeaveType,
} from '@/types';

const STORAGE_CLOCK_KEY = 'elms-clock-state';

const attStatusConfig: Record<AttendanceStatus, { badge: string; dot: string }> = {
  Present: { badge: 'border-transparent bg-accent-100 text-accent-800', dot: 'bg-accent-500' },
  Late: { badge: 'border-transparent bg-amber-100 text-amber-800', dot: 'bg-amber-500' },
  Absent: { badge: 'border-transparent bg-red-100 text-red-700', dot: 'bg-red-500' },
  'Early Departure': {
    badge: 'border-transparent bg-orange-100 text-orange-700',
    dot: 'bg-orange-500',
  },
  'On Leave': { badge: 'border-transparent bg-blue-100 text-blue-700', dot: 'bg-blue-500' },
  Holiday: { badge: 'border-transparent bg-emerald-100 text-emerald-800', dot: 'bg-emerald-500' },
};

const leaveStatusConfig: Record<LeaveRequestStatus, { badge: string; dot: string }> = {
  'Pending Manager Approval': {
    badge: 'border-transparent bg-amber-100 text-amber-800',
    dot: 'bg-amber-500',
  },
  'Pending HR Approval': {
    badge: 'border-transparent bg-blue-100 text-blue-700',
    dot: 'bg-blue-500',
  },
  Approved: { badge: 'border-transparent bg-accent-100 text-accent-800', dot: 'bg-accent-500' },
  Rejected: { badge: 'border-transparent bg-red-100 text-red-700', dot: 'bg-red-500' },
  Withdrawn: { badge: 'border-transparent bg-ink-100 text-ink-600', dot: 'bg-ink-400' },
};

const leaveTypeColors: Record<LeaveType, string> = {
  Annual: 'bg-accent-100 text-accent-800',
  Sick: 'bg-red-100 text-red-700',
  Personal: 'bg-blue-100 text-blue-700',
  Unpaid: 'bg-ink-100 text-ink-700',
};

interface ClockState {
  clockedIn: boolean;
  clockInTime: string | null;
  clockOutTime: string | null;
  date: string;
}

interface LeaveForm {
  leaveType: LeaveType;
  startDate: string;
  endDate: string;
  reason: string;
  attachmentFilename: string;
}

function loadClockState(employeeId: string, today: string): ClockState {
  try {
    const raw = localStorage.getItem(`${STORAGE_CLOCK_KEY}-${employeeId}`);
    if (!raw) return { clockedIn: false, clockInTime: null, clockOutTime: null, date: today };
    const parsed = JSON.parse(raw) as ClockState;
    if (parsed.date !== today) {
      return { clockedIn: false, clockInTime: null, clockOutTime: null, date: today };
    }
    return parsed;
  } catch {
    return { clockedIn: false, clockInTime: null, clockOutTime: null, date: today };
  }
}

function saveClockState(employeeId: string, state: ClockState) {
  localStorage.setItem(`${STORAGE_CLOCK_KEY}-${employeeId}`, JSON.stringify(state));
}

function todayStr() {
  return new Date().toISOString().slice(0, 10);
}

function getDateStr(d: Date) {
  return d.toISOString().slice(0, 10);
}

function formatDateDisplay(iso: string) {
  return new Date(iso).toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

function formatTimeDisplay(iso: string | null) {
  if (!iso) return '—';
  return new Date(iso).toLocaleTimeString('en-US', {
    hour: '2-digit',
    minute: '2-digit',
  });
}

function computeAttendanceStatus(
  clockIn: string | null,
  clockOut: string | null,
  clockedIn: boolean,
): AttendanceStatus {
  if (clockedIn && clockIn) return 'Present';
  if (clockIn && clockOut) {
    const inH = new Date(clockIn).getHours();
    const outH = new Date(clockOut).getHours();
    if (inH >= 9) return 'Late';
    if (outH < 16) return 'Early Departure';
    return 'Present';
  }
  if (clockIn && !clockOut) return 'Present';
  return 'Absent';
}

function computeHours(clockIn: string | null, clockOut: string | null): number | null {
  if (!clockIn) return null;
  const end = clockOut ? new Date(clockOut).getTime() : Date.now();
  const start = new Date(clockIn).getTime();
  return Math.max(0, Math.round(((end - start) / 3600000) * 100) / 100);
}

function computeLate(clockIn: string | null): boolean {
  if (!clockIn) return false;
  return new Date(clockIn).getHours() >= 9 && new Date(clockIn).getMinutes() > 0;
}

export function AttendanceLeavePage() {
  const { employee, hasPermission } = useAuth();
  const isHrOrAdmin = hasPermission('viewAllEmployees');
  const canViewTeam = hasPermission('viewTeamAttendance');
  const isManager = canViewTeam && !isHrOrAdmin;

  const [tab, setTab] = useState('clock');
  const todayDate = todayStr();

  // ---- Clock state persisted in localStorage ----
  const [clockState, setClockState] = useState<ClockState>(() =>
    loadClockState(employee?.id ?? '', todayDate),
  );

  useEffect(() => {
    if (employee?.id) {
      saveClockState(employee.id, clockState);
    }
  }, [clockState, employee?.id]);

  // Reset clock state on new day
  useEffect(() => {
    if (employee?.id && clockState.date !== todayDate) {
      const fresh: ClockState = {
        clockedIn: false,
        clockInTime: null,
        clockOutTime: null,
        date: todayDate,
      };
      queueMicrotask(() => setClockState(fresh));
      saveClockState(employee.id, fresh);
    }
  }, [todayDate, clockState.date, employee?.id]);

  const handleClockIn = async () => {
    try {
      await attendanceRepo.clock('IN');
      setClockState({
        clockedIn: true,
        clockInTime: new Date().toISOString(),
        clockOutTime: null,
        date: todayDate,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to clock in.');
    }
  };

  const handleClockOut = async () => {
    try {
      await attendanceRepo.clock('OUT');
      setClockState((prev) => ({
        ...prev,
        clockedIn: false,
        clockOutTime: new Date().toISOString(),
      }));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to clock out.');
    }
  };

  const todayStatus = useMemo(
    () =>
      computeAttendanceStatus(
        clockState.clockInTime,
        clockState.clockOutTime,
        clockState.clockedIn,
      ),
    [clockState],
  );

  const todayHours = useMemo(
    () => computeHours(clockState.clockInTime, clockState.clockOutTime),
    [clockState],
  );

  const isLate = useMemo(() => computeLate(clockState.clockInTime), [clockState]);

  // ---- Attendance records with user's live clock merged ----
  const { data: employees } = useEmployees();
  const [attendanceRecords, setAttendanceRecords] = useState<AttendanceRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [attendanceDate, setAttendanceDate] = useState(todayDate);

  const mergedAttendance = useMemo(() => {
    let seed = attendanceRecords.filter((r) => r.date === attendanceDate);
    // Scope: Managers see only direct reports' attendance
    if (isManager && employee) {
      const reportIds = new Set(
        employees.filter((e) => e.managerId === employee.id).map((e) => e.id),
      );
      reportIds.add(employee.id); // Also see self
      seed = seed.filter((r) => reportIds.has(r.employeeId));
    }
    // Employee sees only their own attendance (handled by existing filtering below)
    if (!isHrOrAdmin && !isManager && employee) {
      seed = seed.filter((r) => r.employeeId === employee.id);
    }
    if (!employee) return seed;
    // Merge current user's live clock data into the attendance view
    const existingIdx = seed.findIndex((r) => r.employeeId === employee.id);
    const liveRec: AttendanceRecord = {
      id: `att-live-${employee.id}`,
      employeeId: employee.id,
      employeeName: `${employee.firstName} ${employee.lastName}`,
      date: attendanceDate,
      clockIn: clockState.clockInTime,
      clockOut: clockState.clockOutTime,
      totalHours: todayHours,
      status: todayStatus,
      ipAddress: '192.168.1.1',
    };
    if (existingIdx >= 0) {
      const updated = [...seed];
      updated[existingIdx] = liveRec;
      return updated;
    }
    return [liveRec, ...seed];
  }, [
    attendanceRecords,
    attendanceDate,
    employee,
    clockState,
    todayStatus,
    todayHours,
    isHrOrAdmin,
    isManager,
    employees,
  ]);

  // ---- Leave state ----
  const [leaveDialogOpen, setLeaveDialogOpen] = useState(false);
  const [leaveRequests, setLeaveRequests] = useState<LeaveRequest[]>([]);
  const [leaveForm, setLeaveForm] = useState<LeaveForm>({
    leaveType: 'Annual',
    startDate: '',
    endDate: '',
    reason: '',
    attachmentFilename: '',
  });
  const [error, setError] = useState<string | null>(null);

  // ---- Leave balances with dynamic deduction ----
  const [liveBalances, setLiveBalances] = useState<LeaveBalance[]>([]);
  const [leaveTypes, setLeaveTypes] = useState<{ id: string; name: string }[]>([]);

  // Load attendance summary, leave requests and balances from the backend.
  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const [summary, reqs, rawBalances, types] = await Promise.all([
          attendanceRepo.summary(
            employee?.id
              ? { employeeId: employee.id, date: attendanceDate }
              : { date: attendanceDate },
          ),
          attendanceRepo.listLeaveRequests(),
          attendanceRepo.balance(),
          attendanceRepo.listLeaveTypes(),
        ]);
        if (!cancelled) setLeaveTypes(types);
        if (cancelled) return;
        const records = (summary ?? []).map((a) => ({
          id: a.id,
          employeeId: a.employeeId,
          employeeName: a.employeeName,
          date: a.date || attendanceDate,
          clockIn: a.clockIn,
          clockOut: a.clockOut,
          totalHours: a.totalHours,
          status: a.status as AttendanceStatus,
          ipAddress: a.ipAddress,
        }));
        setAttendanceRecords(records);
        setLeaveRequests(reqs);
        // `rawBalances` is already a flattened list of LeaveBalance records
        // (the repo flattens the backend's per-employee wrapper).
        setLiveBalances(rawBalances ?? []);
      } catch (err) {
        if (!cancelled)
          setError(err instanceof Error ? err.message : 'Failed to load attendance data.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    load();
    return () => {
      cancelled = true;
    };
  }, [employee?.id, attendanceDate]);

  // "My leave" always shows only the current logged-in user's own requests,
  // regardless of role. HR/Admin/Manager see team-wide requests via Approvals.
  const myLeaveRequests = useMemo(
    () => leaveRequests.filter((lr) => lr.employeeId === employee?.id),
    [leaveRequests, employee],
  );

  const myApprovals = useMemo(() => {
    if (isHrOrAdmin) {
      return leaveRequests.filter((lr) => lr.status === 'Pending HR Approval');
    }
    if (isManager) {
      const reports = employees.filter((e) => e.managerId === employee?.id);
      const reportIds = new Set(reports.map((e) => e.id));
      return leaveRequests.filter(
        (lr) => reportIds.has(lr.employeeId) && lr.status === 'Pending Manager Approval',
      );
    }
    return [];
  }, [leaveRequests, employee, isHrOrAdmin, isManager, employees]);

  // Employee's own balances, rendered in a fixed leave-type order so the
  // "My Balance" cards always appear as Annual, Personal, Sick, Unpaid.
  const myBalances = useMemo(() => {
    const myBalanceOrder: LeaveType[] = ['Annual', 'Personal', 'Sick', 'Unpaid'];
    if (!employee) return [];
    return liveBalances
      .filter((lb) => lb.employeeId === employee.id)
      .sort((a, b) => {
        const ia = myBalanceOrder.indexOf(a.leaveType as LeaveType);
        const ib = myBalanceOrder.indexOf(b.leaveType as LeaveType);
        return (ia === -1 ? myBalanceOrder.length : ia) - (ib === -1 ? myBalanceOrder.length : ib);
      });
  }, [liveBalances, employee]);

  // Balances visible on the "Balances" tab:
  //  - HR/Admin: all employees
  //  - Manager: employees in their own department (plus self)
  const visibleBalances = useMemo(() => {
    if (!employee) return [];
    if (isHrOrAdmin) return liveBalances;
    if (isManager) {
      const deptEmpIds = new Set(
        employees.filter((e) => e.departmentId === employee.departmentId).map((e) => e.id),
      );
      deptEmpIds.add(employee.id); // Also include self
      return liveBalances.filter((lb) => deptEmpIds.has(lb.employeeId));
    }
    return [];
  }, [liveBalances, employee, isHrOrAdmin, isManager, employees]);

  // Group the flat balance records by employee so the "Balances" view renders
  // ONE row per person with a compact per-leave-type breakdown.
  const groupedBalances = useMemo(() => {
    const map = new Map<string, Record<string, LeaveBalance>>();
    for (const lb of visibleBalances) {
      const byType = map.get(lb.employeeId) ?? {};
      byType[lb.leaveType] = lb;
      map.set(lb.employeeId, byType);
    }
    // Preserve employee ordering from `employees` where possible.
    return Array.from(map.entries());
  }, [visibleBalances]);

  // Distinct leave types present in the balances, rendered in a fixed
  // column order: Annual – Personal – Sick – Unpaid.
  const uniqueLeaveTypes = useMemo(() => {
    const balanceColumnOrder: LeaveType[] = ['Annual', 'Personal', 'Sick', 'Unpaid'];
    const seen = new Set(visibleBalances.map((lb) => lb.leaveType as LeaveType));
    return balanceColumnOrder.filter((lt) => seen.has(lt));
  }, [visibleBalances]);

  const openLeaveDialog = () => {
    setLeaveForm({
      leaveType: 'Annual',
      startDate: '',
      endDate: '',
      reason: '',
      attachmentFilename: '',
    });
    setError(null);
    setLeaveDialogOpen(true);
  };

  const handleLeaveSubmit = async () => {
    setError(null);
    if (!leaveForm.startDate || !leaveForm.endDate) {
      setError('Start and end dates are required.');
      return;
    }
    if (leaveForm.endDate < leaveForm.startDate) {
      setError('End date cannot be before start date.');
      return;
    }
    if (!leaveForm.reason.trim()) {
      setError('A reason is required.');
      return;
    }

    const days = Math.max(
      1,
      Math.round(
        (new Date(leaveForm.endDate).getTime() - new Date(leaveForm.startDate).getTime()) /
          86400000,
      ) + 1,
    );

    // Check balance
    if (employee) {
      const bal = liveBalances.find(
        (lb) => lb.employeeId === employee.id && lb.leaveType === leaveForm.leaveType,
      );
      if (bal) {
        const available = bal.available;
        if (available < days && leaveForm.leaveType !== 'Unpaid') {
          setError(
            `Insufficient ${leaveForm.leaveType} leave balance. Available: ${available} days, requested: ${days} days.`,
          );
          return;
        }
      }
    }

    const leaveTypeDef = leaveTypes.find((lt) => lt.name === leaveForm.leaveType);
    try {
      await attendanceRepo.submitLeaveRequest({
        leaveTypeId: leaveTypeDef?.id ?? leaveForm.leaveType,
        startDate: leaveForm.startDate,
        endDate: leaveForm.endDate,
        reason: leaveForm.reason,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to submit leave request.');
      return;
    }

    const newReq: LeaveRequest = {
      id: `lr-${Date.now()}`,
      employeeId: employee?.id ?? '',
      employeeName: employee ? `${employee.firstName} ${employee.lastName}` : 'Unknown',
      leaveType: leaveForm.leaveType,
      startDate: leaveForm.startDate,
      endDate: leaveForm.endDate,
      days,
      reason: leaveForm.reason,
      attachmentFilename: leaveForm.attachmentFilename || undefined,
      status: 'Pending Manager Approval',
      submittedBy: employee ? `${employee.firstName} ${employee.lastName}` : 'Self',
      submittedAt: new Date().toISOString(),
      approvals: [
        {
          level: 1,
          approver: employee?.managerName ?? 'Manager',
          decision: 'Pending',
          at: new Date().toISOString(),
        },
      ],
    };
    setLeaveRequests((prev) => [newReq, ...prev]);

    // Update pending balance
    setLiveBalances((prev) =>
      prev.map((lb) => {
        if (lb.employeeId === employee?.id && lb.leaveType === leaveForm.leaveType) {
          return { ...lb, pending: lb.pending + days };
        }
        return lb;
      }),
    );

    setLeaveDialogOpen(false);
    // Redirect to the "My leave" page so the user immediately sees their new request.
    setTab('leave');
  };

  const handleApproval = async (
    reqId: string,
    decision: 'Approved' | 'Rejected',
    comment: string,
  ) => {
    try {
      if (decision === 'Approved') {
        await attendanceRepo.approveLeave(reqId, comment || undefined);
      } else {
        await attendanceRepo.rejectLeave(reqId, comment || undefined);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to process leave approval.');
      return;
    }
    setLeaveRequests((prev) => {
      let updatedReq: LeaveRequest | undefined;
      const updated = prev.map((lr) => {
        if (lr.id !== reqId) return lr;
        const isHrLevel = lr.status === 'Pending HR Approval';
        const newStatus: LeaveRequestStatus =
          decision === 'Rejected'
            ? 'Rejected'
            : isHrLevel
              ? 'Approved'
              : lr.leaveType === 'Annual'
                ? 'Pending HR Approval'
                : 'Approved';
        const result = {
          ...lr,
          status: newStatus,
          approvals: [
            ...lr.approvals,
            {
              level: isHrLevel ? 2 : 1,
              approver: employee
                ? `${employee.firstName} ${employee.lastName}`
                : isHrLevel
                  ? 'HR'
                  : 'Manager',
              decision,
              comment: comment || undefined,
              at: new Date().toISOString(),
            },
          ],
        };
        updatedReq = result;
        return result;
      });

      // Update balances based on decision
      if (updatedReq) {
        setLiveBalances((prevBal) =>
          prevBal.map((lb) => {
            if (
              lb.employeeId === updatedReq!.employeeId &&
              lb.leaveType === updatedReq!.leaveType
            ) {
              if (decision === 'Approved' && updatedReq!.status === 'Approved') {
                // Fully approved: move from pending to used
                return {
                  ...lb,
                  pending: lb.pending - updatedReq!.days,
                  used: lb.used + updatedReq!.days,
                };
              }
              if (decision === 'Rejected') {
                // Rejected: remove from pending
                return { ...lb, pending: Math.max(0, lb.pending - updatedReq!.days) };
              }
            }
            return lb;
          }),
        );
      }

      return updated;
    });
  };

  // ---- Date navigation helpers ----
  const changeAttDate = useCallback(
    (dir: -1 | 1) => {
      setAttendanceDate((prev) => {
        const d = new Date(prev + 'T00:00:00');
        d.setDate(d.getDate() + dir);
        return getDateStr(d);
      });
    },
    [setAttendanceDate],
  );

  return (
    <div>
      <PageHeader
        title="Attendance & Leave"
        description={
          isHrOrAdmin
            ? 'Organization-wide attendance, leave requests, and approvals.'
            : isManager
              ? 'View team attendance, approve leave requests, and manage your own time.'
              : 'Clock in, request leave, and view your balances.'
        }
        actions={
          <Button onClick={openLeaveDialog}>
            <Plus className="h-4 w-4" />
            Request leave
          </Button>
        }
      />

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="clock">
            <Fingerprint className="h-3.5 w-3.5" />
            Clock
          </TabsTrigger>
          <TabsTrigger value="attendance">
            <CalendarDays className="h-3.5 w-3.5" />
            Attendance
          </TabsTrigger>
          <TabsTrigger value="leave">
            <Plane className="h-3.5 w-3.5" />
            My leave
          </TabsTrigger>
          <TabsTrigger value="my-balance">
            <BarChart3 className="h-3.5 w-3.5" />
            My Balance
          </TabsTrigger>
          {(isHrOrAdmin || isManager) && (
            <TabsTrigger value="balances">
              <Hourglass className="h-3.5 w-3.5" />
              Balances
            </TabsTrigger>
          )}
          {isHrOrAdmin || isManager ? (
            <TabsTrigger value="approvals">
              <CheckCircle2 className="h-3.5 w-3.5" />
              Approvals
              {myApprovals.length > 0 && (
                <span className="ml-1.5 rounded-full bg-amber-200 px-1.5 py-0.5 text-[10px] font-semibold text-amber-800">
                  {myApprovals.length}
                </span>
              )}
            </TabsTrigger>
          ) : null}
        </TabsList>

        {/* Clock in/out */}
        <TabsContent value="clock" className="mt-4">
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
            {/* Clock widget */}
            <Card className="lg:col-span-2">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Clock4 className="h-4 w-4 text-ink-400" />
                  Time tracking
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="flex flex-col items-center gap-6 py-8">
                  <div className="relative">
                    <div
                      className={cn(
                        'flex h-32 w-32 items-center justify-center rounded-full border-4 transition-all',
                        clockState.clockedIn
                          ? 'border-accent-500 bg-accent-50'
                          : 'border-ink-200 bg-ink-50',
                      )}
                    >
                      <div className="text-center">
                        <Timer
                          className={cn(
                            'mx-auto h-6 w-6',
                            clockState.clockedIn ? 'text-accent-600' : 'text-ink-400',
                          )}
                        />
                        <div className="mt-1 font-display text-lg font-semibold text-ink-900">
                          {new Date().toLocaleTimeString('en-US', {
                            hour: '2-digit',
                            minute: '2-digit',
                          })}
                        </div>
                        <div className="text-[10px] tracking-wide text-ink-500 uppercase">
                          {formatDateDisplay(new Date().toISOString())}
                        </div>
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    <Button
                      variant={clockState.clockedIn ? 'outline' : 'accent'}
                      size="lg"
                      onClick={handleClockIn}
                      disabled={clockState.clockedIn}
                      className="gap-2"
                    >
                      <LogIn className="h-5 w-5" />
                      Clock in
                    </Button>
                    <Button
                      variant={clockState.clockedIn ? 'danger' : 'outline'}
                      size="lg"
                      onClick={handleClockOut}
                      disabled={!clockState.clockedIn}
                      className="gap-2"
                    >
                      <LogOut className="h-5 w-5" />
                      Clock out
                    </Button>
                  </div>
                  {clockState.clockInTime && (
                    <motion.p
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      className="text-sm text-accent-700"
                    >
                      {clockState.clockOutTime ? (
                        <>
                          Clocked out at{' '}
                          {new Date(clockState.clockOutTime).toLocaleTimeString('en-US', {
                            hour: '2-digit',
                            minute: '2-digit',
                          })}{' '}
                          — have a good day
                        </>
                      ) : (
                        <>
                          Clocked in at{' '}
                          {new Date(clockState.clockInTime).toLocaleTimeString('en-US', {
                            hour: '2-digit',
                            minute: '2-digit',
                          })}
                        </>
                      )}
                    </motion.p>
                  )}
                  {isLate && (
                    <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-center text-sm text-amber-700">
                      <Clock4 className="mr-1.5 inline-block h-4 w-4" />
                      You clocked in late today. Late arrivals may affect your attendance record.
                    </div>
                  )}
                  {employee?.status === 'On Leave' && (
                    <div className="rounded-lg border border-blue-200 bg-blue-50 p-3 text-center text-sm text-blue-700">
                      You are on approved leave today — clock-in is blocked.
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>

            {/* Today summary */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Coffee className="h-4 w-4 text-ink-400" />
                  Today
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <SummaryRow
                  label="Status"
                  value={
                    <Badge className={attStatusConfig[todayStatus].badge}>
                      {todayStatus === 'Absent' ? 'Not clocked in' : todayStatus}
                    </Badge>
                  }
                />
                <SummaryRow label="Clock in" value={formatTimeDisplay(clockState.clockInTime)} />
                <SummaryRow label="Clock out" value={formatTimeDisplay(clockState.clockOutTime)} />
                <SummaryRow
                  label="Hours so far"
                  value={todayHours !== null ? `${todayHours.toFixed(1)}h` : '0.0h'}
                />
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        {/* Attendance summary */}
        <TabsContent value="attendance" className="mt-4">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0">
              <div className="flex items-center gap-2">
                <CardTitle>Daily attendance</CardTitle>
                <div className="flex items-center gap-1">
                  <Button
                    variant="outline"
                    size="icon"
                    className="h-7 w-7 rounded-full"
                    onClick={() => changeAttDate(-1)}
                  >
                    <ChevronLeft className="h-3.5 w-3.5" />
                  </Button>
                  <div className="flex items-center gap-2 rounded-lg border bg-ink-50 px-3 py-1.5">
                    <Calendar className="h-3.5 w-3.5 text-ink-500" />
                    <input
                      type="date"
                      value={attendanceDate}
                      onChange={(e) => setAttendanceDate(e.target.value)}
                      className="bg-transparent text-sm font-medium text-ink-800 [color-scheme:light] outline-none"
                    />
                  </div>
                  <Button
                    variant="outline"
                    size="icon"
                    className="h-7 w-7 rounded-full"
                    onClick={() => changeAttDate(1)}
                    disabled={attendanceDate >= todayDate}
                  >
                    <ChevronRight className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </div>
              <Badge variant="outline" className="text-xs">
                {mergedAttendance.length} records
              </Badge>
            </CardHeader>
            <CardContent className="p-0">
              {loading ? (
                <div className="flex h-32 items-center justify-center text-sm text-ink-500">
                  Loading attendance…
                </div>
              ) : mergedAttendance.length === 0 ? (
                <EmptyState
                  icon={Calendar}
                  title="No attendance records"
                  description="No records found for this date."
                />
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Employee</TableHead>
                      <TableHead>Clock in</TableHead>
                      <TableHead>Clock out</TableHead>
                      <TableHead>Hours</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>IP</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {mergedAttendance.map((rec, i) => {
                      const cfg = attStatusConfig[rec.status];
                      return (
                        <TableRow key={rec.id}>
                          <TableCell>
                            <motion.div
                              initial={{ opacity: 0, x: -6 }}
                              animate={{ opacity: 1, x: 0 }}
                              transition={{ delay: i * 0.03, duration: 0.2 }}
                              className="flex items-center gap-2.5"
                            >
                              <Avatar className="h-8 w-8">
                                <AvatarFallback className="bg-ink-900 text-[11px] text-ink-50">
                                  {initials(rec.employeeName)}
                                </AvatarFallback>
                              </Avatar>
                              <Link
                                to={`/app/employees/${rec.employeeId}`}
                                className="font-medium text-ink-900 transition-colors hover:text-accent-700"
                              >
                                {rec.employeeName}
                              </Link>
                            </motion.div>
                          </TableCell>
                          <TableCell className="font-mono text-sm text-ink-600">
                            {rec.clockIn
                              ? new Date(rec.clockIn).toLocaleTimeString('en-US', {
                                  hour: '2-digit',
                                  minute: '2-digit',
                                })
                              : '—'}
                          </TableCell>
                          <TableCell className="font-mono text-sm text-ink-600">
                            {rec.clockOut
                              ? new Date(rec.clockOut).toLocaleTimeString('en-US', {
                                  hour: '2-digit',
                                  minute: '2-digit',
                                })
                              : '—'}
                          </TableCell>
                          <TableCell className="font-mono text-sm">
                            {rec.totalHours ? `${rec.totalHours.toFixed(1)}h` : '—'}
                          </TableCell>
                          <TableCell>
                            <Badge className={cn('gap-1.5', cfg.badge)}>
                              <span className={cn('h-1.5 w-1.5 rounded-full', cfg.dot)} />
                              {rec.status}
                            </Badge>
                          </TableCell>
                          <TableCell className="font-mono text-xs text-ink-400">
                            {rec.ipAddress ?? '—'}
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Leave requests */}
        <TabsContent value="leave" className="mt-4">
          <Card>
            <CardHeader>
              <CardTitle>My leave requests</CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              {loading ? (
                <div className="flex h-32 items-center justify-center text-sm text-ink-500">
                  Loading leave requests…
                </div>
              ) : myLeaveRequests.length === 0 ? (
                <EmptyState
                  icon={Plane}
                  title="No leave requests"
                  description="Submit a leave request to see it here."
                />
              ) : (
                <div className="divide-y divide-ink-100">
                  {myLeaveRequests.map((lr, i) => {
                    const cfg = leaveStatusConfig[lr.status];
                    return (
                      <motion.div
                        key={lr.id}
                        initial={{ opacity: 0, y: 4 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ delay: i * 0.04, duration: 0.25 }}
                        className="flex flex-col gap-3 px-6 py-4 sm:flex-row sm:items-center sm:justify-between"
                      >
                        <div className="flex items-start gap-3">
                          <div
                            className={cn(
                              'flex h-9 w-9 shrink-0 items-center justify-center rounded-lg',
                              leaveTypeColors[lr.leaveType],
                            )}
                          >
                            <Plane className="h-4 w-4" />
                          </div>
                          <div>
                            <div className="flex items-center gap-2">
                              <Badge
                                className={cn(
                                  'border-transparent text-[10px]',
                                  leaveTypeColors[lr.leaveType],
                                )}
                              >
                                {lr.leaveType}
                              </Badge>
                              <span className="text-sm font-medium text-ink-900">
                                {lr.days} {lr.days === 1 ? 'day' : 'days'}
                              </span>
                            </div>
                            <p className="mt-1 text-xs text-ink-500">
                              {formatDate(lr.startDate)} → {formatDate(lr.endDate)}
                            </p>
                            <p className="mt-1 text-xs text-ink-500">{lr.reason}</p>
                            {lr.attachmentFilename && (
                              <p className="mt-1 flex items-center gap-1 text-[11px] text-ink-400">
                                <FileText className="h-3 w-3" />
                                {lr.attachmentFilename}
                              </p>
                            )}
                          </div>
                        </div>
                        <div className="flex flex-col items-start gap-2 sm:items-end">
                          <Badge className={cn('gap-1.5', cfg.badge)}>
                            <span className={cn('h-1.5 w-1.5 rounded-full', cfg.dot)} />
                            {lr.status}
                          </Badge>
                          <span className="text-[11px] text-ink-400">
                            Submitted {formatRelative(lr.submittedAt)}
                          </span>
                        </div>
                      </motion.div>
                    );
                  })}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Balances (HR: all employees / Manager: own department) */}
        {(isHrOrAdmin || isManager) && (
          <TabsContent value="balances" className="mt-4">
            <Card>
              <CardHeader className="flex flex-row items-start justify-between space-y-0">
                <CardTitle>
                  Leave balances —{' '}
                  {isHrOrAdmin ? 'all employees' : (employee?.departmentName ?? 'my department')}
                </CardTitle>
                {isHrOrAdmin && (
                  <Button variant="outline" size="sm" asChild>
                    <Link to="/app/leave-holidays">
                      <Settings2 className="h-3.5 w-3.5" />
                      Manage policy groups
                    </Link>
                  </Button>
                )}
              </CardHeader>
              <CardContent className="p-0">
                {groupedBalances.length === 0 ? (
                  <div className="flex h-24 items-center justify-center px-6 text-sm text-ink-500">
                    No leave balance data available. Apply a policy group under Organization → Leave
                    & Holidays to provision balances.
                  </div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full border-collapse text-sm">
                      <thead>
                        <tr className="border-b border-ink-200 bg-ink-50/70 text-left">
                          <th className="px-4 py-3 font-medium text-ink-500">Employee</th>
                          <th className="px-4 py-3 font-medium text-ink-500">Policy</th>
                          {uniqueLeaveTypes.map((lt) => (
                            <th
                              key={lt}
                              className="min-w-[96px] px-3 py-3 text-center font-medium text-ink-500"
                            >
                              <span
                                className={cn(
                                  'inline-block rounded-full px-2 py-0.5 text-[10px] font-semibold tracking-wide uppercase',
                                  leaveTypeColors[lt as LeaveType],
                                )}
                              >
                                {lt}
                              </span>
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {groupedBalances.map(([empId, byType], rowIdx) => {
                          const emp = employees.find((e) => e.id === empId);
                          const name = emp ? `${emp.firstName} ${emp.lastName}` : empId;
                          const isProvisioned = Object.values(byType).some(
                            (lb) => lb.entitlement > 0,
                          );
                          return (
                            <tr
                              key={empId}
                              className={cn(
                                'border-b border-ink-100 transition-colors hover:bg-ink-50/60',
                                rowIdx % 2 === 1 && 'bg-ink-50/30',
                              )}
                            >
                              {/* Employee cell */}
                              <td className="px-4 py-3">
                                <div className="flex items-center gap-3">
                                  <Avatar className="h-8 w-8">
                                    <AvatarFallback className="bg-ink-100 text-[10px] text-ink-600">
                                      {initials(name)}
                                    </AvatarFallback>
                                  </Avatar>
                                  <div className="min-w-0">
                                    <div className="truncate font-medium text-ink-900">{name}</div>
                                    {!isProvisioned && (
                                      <div className="text-[11px] text-ink-400">
                                        Not provisioned
                                      </div>
                                    )}
                                  </div>
                                </div>
                              </td>

                              {/* Policy group cell */}
                              <td className="px-4 py-3">
                                {(() => {
                                  const firstBal = Object.values(byType)[0];
                                  const pgName = firstBal?.policyGroupName;
                                  if (!pgName && !isProvisioned) {
                                    return <span className="text-xs text-ink-300">-</span>;
                                  }
                                  return pgName ? (
                                    <span className="truncate text-xs font-medium text-ink-700">
                                      {pgName}
                                    </span>
                                  ) : (
                                    <span className="text-xs text-ink-400">—</span>
                                  );
                                })()}
                              </td>

                              {/* Per leave-type mini columns: entitlement / available */}
                              {uniqueLeaveTypes.map((lt) => {
                                const lb = byType[lt as LeaveType];
                                const available = lb ? Math.max(lb.available, 0) : 0;
                                const notProvisioned = !lb || lb.entitlement === 0;
                                const probation = lb?.probation;
                                return (
                                  <td key={lt} className="px-3 py-3 text-center">
                                    {notProvisioned && !probation ? (
                                      <span className="text-ink-300">—</span>
                                    ) : probation ? (
                                      <div className="flex flex-col items-center gap-0.5">
                                        <span className="font-mono text-xs text-ink-400">
                                          {lb?.used ?? 0}
                                          <span className="text-ink-300">/0</span>
                                          <span
                                            className="text-blue-600"
                                            title="No leave entitlement during probation"
                                          >
                                            ◐
                                          </span>
                                        </span>
                                        <span className="font-mono text-xs text-ink-400">
                                          {probation.probationEndDate
                                            ? `ends ${formatDate(probation.probationEndDate)}`
                                            : 'probation'}
                                        </span>
                                      </div>
                                    ) : (
                                      <div className="flex flex-col items-center gap-0.5">
                                        <span className="font-mono text-xs text-ink-400">
                                          {lb.used}
                                          <span className="text-ink-300">/{lb.entitlement}</span>
                                          {lb.prorated && (
                                            <span
                                              className="text-accent-600"
                                              title="Pro-rated for mid-year joiner"
                                            >
                                              *
                                            </span>
                                          )}
                                        </span>
                                        <span className="font-mono text-sm font-semibold text-accent-700">
                                          {available}
                                        </span>
                                      </div>
                                    )}
                                  </td>
                                );
                              })}
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
                {groupedBalances.length > 0 && (
                  <div className="flex flex-wrap items-center gap-x-5 gap-y-1 border-t border-ink-100 px-4 py-2.5 text-[11px] text-ink-500">
                    <span className="flex items-center gap-1.5">
                      <span className="font-mono text-xs text-ink-400">
                        <span className="font-semibold text-ink-700">used</span>
                        <span className="text-ink-300">/entitlement</span>
                      </span>
                      = days used out of policy entitlement
                    </span>
                    <span className="flex items-center gap-1.5">
                      <span className="font-mono font-semibold text-accent-700">*</span>
                      entitlement pro-rated for a mid-year joiner
                    </span>
                    <span className="flex items-center gap-1.5">
                      pro-rata = full × remaining days ÷ {new Date().getFullYear()} (365/366),
                      rounded to nearest 0.5 day
                    </span>
                    <span className="flex items-center gap-1.5">
                      <span className="text-blue-600">◐</span>
                      employee under probation — no entitlement until probation ends
                    </span>
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>
        )}

        {/* My Balance (all roles) */}
        <TabsContent value="my-balance" className="mt-4">
          {myBalances.length === 0 ? (
            <Card>
              <CardContent className="py-12">
                <EmptyState
                  icon={BarChart3}
                  title="No balance data"
                  description="Your leave balances are not configured yet. Please contact HR."
                />
              </CardContent>
            </Card>
          ) : (
            <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
              {myBalances.map((lb, idx) => {
                // "My Balance" reflects the global leave policy for the
                // employee: entitlement (from policy group) minus used and
                // pending days. The backend calculates `available` so the
                // frontend stays consistent with the "Balances" matrix.
                const total = lb.entitlement;
                const available = Math.max(lb.available, 0);
                const usedPercent = Math.round((lb.used / Math.max(total, 1)) * 100);
                const pendingPercent = Math.round((lb.pending / Math.max(total, 1)) * 100);
                return (
                  <motion.div
                    key={lb.leaveType}
                    initial={{ opacity: 0, y: 16 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: idx * 0.08, duration: 0.3 }}
                  >
                    <Card className="overflow-hidden border-ink-200 transition-shadow hover:shadow-md">
                      <CardHeader className="pb-2">
                        <CardTitle className="flex items-center justify-between gap-2 text-sm">
                          <Badge
                            className={cn(
                              'border-transparent text-[10px]',
                              leaveTypeColors[lb.leaveType],
                            )}
                          >
                            {lb.leaveType}
                          </Badge>
                          {lb.probation ? (
                            <span className="inline-block rounded-full bg-blue-100 px-2 py-0.5 text-[10px] font-semibold tracking-wide text-blue-700 uppercase">
                              Probation
                            </span>
                          ) : lb.prorated ? (
                            <span className="inline-block rounded-full bg-accent-100 px-2 py-0.5 text-[10px] font-semibold tracking-wide text-accent-800 uppercase">
                              Pro-rated
                            </span>
                          ) : (
                            lb.policyGroupName && (
                              <span className="truncate text-[11px] font-normal text-ink-400">
                                {lb.policyGroupName}
                              </span>
                            )
                          )}
                        </CardTitle>
                      </CardHeader>
                      <CardContent className="space-y-4">
                        {/* Probation notice — no leave entitlement until probation ends */}
                        {lb.probation && (
                          <div className="rounded-lg border border-blue-100 bg-blue-50 p-3 text-center">
                            <p className="text-sm font-semibold text-blue-800">
                              No leave entitlement during probation
                            </p>
                            <p className="mt-1 text-xs text-blue-600">
                              Entitlement unlocks on{' '}
                              <span className="font-semibold">
                                {formatDate(lb.probation.probationEndDate)}
                              </span>{' '}
                              after your {lb.probation.probationMonths}-month probation.
                            </p>
                            {lb.probation.remainingDays > 0 && (
                              <p className="mt-1 text-[11px] text-blue-500">
                                {lb.probation.remainingDays} day
                                {lb.probation.remainingDays === 1 ? '' : 's'} remaining
                              </p>
                            )}
                          </div>
                        )}

                        {/* Big available number */}
                        <div className="text-center">
                          <p className="text-4xl font-bold text-ink-900 tabular-nums">
                            {available}
                          </p>
                          <p className="text-xs font-medium tracking-wide text-ink-400 uppercase">
                            {available === 1 ? 'day' : 'days'} available
                          </p>
                        </div>

                        {/* Progress bar */}
                        <div className="space-y-1.5">
                          <div className="flex h-2.5 w-full overflow-hidden rounded-full bg-ink-100">
                            {usedPercent > 0 && (
                              <div
                                className="bg-ink-400 transition-all"
                                style={{ width: `${usedPercent}%` }}
                              />
                            )}
                            {pendingPercent > 0 && (
                              <div
                                className="bg-amber-300 transition-all"
                                style={{ width: `${pendingPercent}%` }}
                              />
                            )}
                            <div
                              className="bg-accent-400 transition-all"
                              style={{
                                width: `${Math.max(0, 100 - usedPercent - pendingPercent)}%`,
                              }}
                            />
                          </div>
                          <div className="flex items-center justify-between text-[11px] text-ink-500">
                            <span className="flex items-center gap-1">
                              <span className="h-2 w-2 rounded-full bg-ink-400" />
                              Used: {lb.used}
                            </span>
                            {lb.pending > 0 && (
                              <span className="flex items-center gap-1">
                                <span className="h-2 w-2 rounded-full bg-amber-300" />
                                Pending: {lb.pending}
                              </span>
                            )}
                            <span className="flex items-center gap-1">
                              <span className="h-2 w-2 rounded-full bg-accent-400" />
                              Available: {available}
                            </span>
                          </div>
                        </div>

                        {/* Detail rows */}
                        <div className="space-y-2 rounded-lg border bg-ink-50/50 p-3">
                          <div className="flex items-center justify-between text-xs">
                            <span className="text-ink-500">
                              {lb.policyGroupName ? lb.policyGroupName : 'Entitlement'}
                            </span>
                            <span className="font-mono font-medium text-ink-800">
                              {lb.entitlement} days
                            </span>
                          </div>

                          {/* Pro-rated breakdown for mid-year joiners */}
                          {lb.prorated && lb.proration && (
                            <div className="space-y-1.5 rounded-md border bg-white/60 p-2.5">
                              <div className="flex items-center gap-1.5">
                                <span className="inline-block rounded-full bg-accent-100 px-2 py-0.5 text-[10px] font-semibold tracking-wide text-accent-800 uppercase">
                                  Pro-rated
                                </span>
                                <span className="text-[11px] text-ink-400">
                                  Joined {formatDate(lb.proration.hireDate)}
                                </span>
                              </div>
                              <div className="flex items-center justify-between text-[11px]">
                                <span className="text-ink-500">
                                  Full annual entitlement × remaining portion
                                </span>
                                <span className="font-mono text-ink-700">
                                  {lb.proration.fullEntitlement} ×{' '}
                                  {Math.round(lb.proration.fraction * 100)}%
                                </span>
                              </div>
                              <div className="flex items-center justify-between text-[11px]">
                                <span className="text-ink-500">
                                  {lb.proration.remainingDays} of {lb.proration.totalDays} days
                                  remaining
                                </span>
                                <span className="font-mono text-ink-700">
                                  ≈ {lb.proration.proratedEntitlement}
                                </span>
                              </div>
                              <div className="flex items-center justify-between text-[11px]">
                                <span className="text-ink-500">Rounded to nearest 0.5 day</span>
                                <span className="font-mono text-ink-700">
                                  = {lb.entitlement} days
                                </span>
                              </div>
                            </div>
                          )}

                          <div className="flex items-center justify-between text-xs">
                            <span className="text-ink-500">Used</span>
                            <span className="font-mono font-medium text-ink-700">
                              {lb.used} days
                            </span>
                          </div>
                          <Separator className="my-1" />
                          <div className="flex items-center justify-between text-xs font-semibold">
                            <span className="text-ink-800">Remaining</span>
                            <span className="font-mono text-accent-700">{available} days</span>
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  </motion.div>
                );
              })}
            </div>
          )}
        </TabsContent>

        {/* Approvals */}
        {(isHrOrAdmin || isManager) && (
          <TabsContent value="approvals" className="mt-4">
            <Card>
              <CardHeader>
                <CardTitle>Leave approvals queue</CardTitle>
              </CardHeader>
              <CardContent className="p-0">
                {myApprovals.length === 0 ? (
                  <EmptyState
                    icon={CheckCircle2}
                    title="All caught up"
                    description="No leave requests pending your approval."
                  />
                ) : (
                  <div className="divide-y divide-ink-100">
                    {myApprovals.map((lr) => {
                      const cfg = leaveStatusConfig[lr.status];
                      return (
                        <ApprovalRow
                          key={lr.id}
                          request={lr}
                          badgeClass={cfg.badge}
                          dotClass={cfg.dot}
                          onApprove={(comment) => handleApproval(lr.id, 'Approved', comment)}
                          onReject={(comment) => handleApproval(lr.id, 'Rejected', comment)}
                        />
                      );
                    })}
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>
        )}
      </Tabs>

      {/* Leave request dialog */}
      <Dialog open={leaveDialogOpen} onOpenChange={setLeaveDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Request leave</DialogTitle>
            <DialogDescription>
              Your request will be routed to your manager for approval. Some leave types may require
              HR final approval.
            </DialogDescription>
          </DialogHeader>
          {error && (
            <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
              {error}
            </div>
          )}
          <div className="space-y-4 py-1">
            <div className="space-y-1.5">
              <Label>Leave type</Label>
              <Select
                value={leaveForm.leaveType}
                onValueChange={(v) => setLeaveForm((f) => ({ ...f, leaveType: v as LeaveType }))}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="Annual">Annual</SelectItem>
                  <SelectItem value="Personal">Personal</SelectItem>
                  <SelectItem value="Sick">Sick</SelectItem>
                  <SelectItem value="Unpaid">Unpaid</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label htmlFor="leave-start">Start date *</Label>
                <Input
                  id="leave-start"
                  type="date"
                  value={leaveForm.startDate}
                  onChange={(e) => setLeaveForm((f) => ({ ...f, startDate: e.target.value }))}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="leave-end">End date *</Label>
                <Input
                  id="leave-end"
                  type="date"
                  value={leaveForm.endDate}
                  onChange={(e) => setLeaveForm((f) => ({ ...f, endDate: e.target.value }))}
                />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="leave-reason">Reason *</Label>
              <Textarea
                id="leave-reason"
                value={leaveForm.reason}
                onChange={(e) => setLeaveForm((f) => ({ ...f, reason: e.target.value }))}
                placeholder="Briefly explain the reason for your leave."
                rows={3}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="leave-attach">Attachment (optional)</Label>
              <Input
                id="leave-attach"
                value={leaveForm.attachmentFilename}
                onChange={(e) =>
                  setLeaveForm((f) => ({ ...f, attachmentFilename: e.target.value }))
                }
                placeholder="e.g. medical-certificate.pdf"
              />
              <p className="text-xs text-ink-400">
                Required for sick leave exceeding 2 days (medical certificate).
              </p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setLeaveDialogOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleLeaveSubmit}>
              <CalendarClock className="h-4 w-4" />
              Submit request
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function SummaryRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-xs text-ink-500">{label}</span>
      <span className="text-sm font-medium text-ink-900">{value}</span>
    </div>
  );
}

function ApprovalRow({
  request,
  badgeClass,
  dotClass,
  onApprove,
  onReject,
}: {
  request: LeaveRequest;
  badgeClass: string;
  dotClass: string;
  onApprove: (comment: string) => void;
  onReject: (comment: string) => void;
}) {
  const [comment, setComment] = useState('');
  return (
    <div className="px-6 py-4">
      <div className="flex items-start gap-3">
        <Avatar className="h-9 w-9 shrink-0">
          <AvatarFallback className="bg-ink-900 text-xs text-ink-50">
            {initials(request.employeeName)}
          </AvatarFallback>
        </Avatar>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-medium text-ink-900">{request.employeeName}</span>
            <Badge
              className={cn('border-transparent text-[10px]', leaveTypeColors[request.leaveType])}
            >
              {request.leaveType}
            </Badge>
            <span className="text-sm text-ink-500">
              {request.days} {request.days === 1 ? 'day' : 'days'}
            </span>
            <Badge className={cn('gap-1.5', badgeClass)}>
              <span className={cn('h-1.5 w-1.5 rounded-full', dotClass)} />
              {request.status}
            </Badge>
          </div>
          <p className="mt-1 text-xs text-ink-500">
            {formatDate(request.startDate)} → {formatDate(request.endDate)}
          </p>
          <p className="mt-1 text-sm text-ink-700">{request.reason}</p>
          {request.attachmentFilename && (
            <p className="mt-1 flex items-center gap-1 text-[11px] text-ink-400">
              <FileText className="h-3 w-3" />
              {request.attachmentFilename}
            </p>
          )}
          <div className="mt-3 flex items-center gap-2">
            <Input
              placeholder="Comment (optional)…"
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              className="h-8 text-xs"
            />
            <Button size="sm" variant="accent" onClick={() => onApprove(comment)} className="gap-1">
              <Check className="h-3.5 w-3.5" />
              Approve
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => onReject(comment)}
              className="gap-1 text-red-600 hover:bg-red-50"
            >
              <X className="h-3.5 w-3.5" />
              Reject
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
