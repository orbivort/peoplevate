import { motion } from 'framer-motion';
import { Plus, Search, Users, X } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router';

import { PageHeader } from '@/components/layout/page-header';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { StatusBadge } from '@/components/ui/status-badge';
import { useAuth } from '@/contexts/auth-context';
import { useDepartments, useEmployees } from '@/data/data-layer';
import { formatDate, initials } from '@/lib/utils';
import type { EmploymentStatus } from '@/types';

const statusOptions: (EmploymentStatus | 'All')[] = [
  'All',
  'Active',
  'Probation',
  'On Leave',
  'Terminated',
];

export function EmployeeListPage() {
  const { user, hasPermission, canViewEmployee } = useAuth();
  const navigate = useNavigate();
  const { data: allEmployees, error, mode } = useEmployees();
  const { data: departments } = useDepartments();
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('All');
  const [deptFilter, setDeptFilter] = useState<string>('all');

  // Scope employees by role
  const scopedEmployees = useMemo(() => {
    return allEmployees.filter((e) => canViewEmployee(e));
  }, [allEmployees, canViewEmployee]);

  const filtered = useMemo(() => {
    return scopedEmployees.filter((e) => {
      if (statusFilter !== 'All' && e.status !== statusFilter) return false;
      if (deptFilter !== 'all' && e.departmentId !== deptFilter) return false;
      if (search) {
        const q = search.toLowerCase();
        const haystack =
          `${e.firstName} ${e.lastName} ${e.email} ${e.employeeNo} ${e.positionName}`.toLowerCase();
        if (!haystack.includes(q)) return false;
      }
      return true;
    });
  }, [scopedEmployees, statusFilter, deptFilter, search]);

  const canManage = hasPermission('viewAllEmployees'); // Admin/HR
  const isEmployee = user?.role === 'Employee';
  const showFilters = !isEmployee; // Filters are useless for Employees — they only see their own profile

  const hasActiveFilters = search !== '' || statusFilter !== 'All' || deptFilter !== 'all';

  const clearFilters = () => {
    setSearch('');
    setStatusFilter('All');
    setDeptFilter('all');
  };

  return (
    <div>
      <PageHeader
        title="Employees"
        description={
          user?.role === 'Employee'
            ? 'View your employment record.'
            : user?.role === 'Manager'
              ? 'Your direct reports.'
              : 'All employees in your organization.'
        }
        actions={
          canManage && (
            <Button onClick={() => navigate('/app/employees/new')}>
              <Plus className="h-4 w-4" />
              Add employee
            </Button>
          )
        }
      />

      {/* Error banner — e.g. session expired or the backend rejected the request */}
      {error && (
        <div
          role="alert"
          className="mb-4 flex items-start gap-2.5 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700"
        >
          <span className="mt-0.5 h-2 w-2 shrink-0 rounded-full bg-red-500" />
          <span>
            Failed to load employees: {error}. If your session has expired, please log in again.
          </span>
        </div>
      )}

      {/* Demo-data notice — shown when the backend is unreachable and mock data is displayed */}
      {!error && mode === 'fallback' && (
        <div
          role="note"
          className="mb-4 flex items-start gap-2.5 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800"
        >
          <span className="mt-0.5 h-2 w-2 shrink-0 rounded-full bg-amber-500" />
          <span>
            The server is currently unavailable, so you're seeing demo data. Real employee records
            may differ.
          </span>
        </div>
      )}

      {/* Filters — only shown when user can see multiple employees */}
      {showFilters && (
        <div className="mb-6 flex flex-wrap items-center gap-3 rounded-xl border border-ink-200 bg-white px-4 py-3 shadow-sm">
          <div className="relative flex-1 sm:max-w-xs">
            <Search className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-ink-400" />
            <Input
              placeholder="Search by name, email, ID…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="h-9 pl-10 text-sm"
            />
          </div>
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="h-9 w-36 text-sm">
              <SelectValue placeholder="All statuses" />
            </SelectTrigger>
            <SelectContent>
              {statusOptions.map((s) => (
                <SelectItem key={s} value={s}>
                  {s === 'All' ? 'All statuses' : s}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {canManage && (
            <Select value={deptFilter} onValueChange={setDeptFilter}>
              <SelectTrigger className="h-9 w-48 text-sm">
                <SelectValue placeholder="All departments" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All departments</SelectItem>
                {departments.map((d) => (
                  <SelectItem key={d.id} value={d.id}>
                    {d.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          {hasActiveFilters && (
            <>
              <div className="h-5 w-px bg-ink-200" />
              <Button
                variant="ghost"
                size="sm"
                onClick={clearFilters}
                className="h-8 gap-1.5 text-xs text-ink-500 hover:text-ink-700"
              >
                <X className="h-3.5 w-3.5" />
                Clear filters
              </Button>
            </>
          )}
          <Badge className="ml-auto border-transparent bg-accent-100 text-[11px] text-accent-800">
            {filtered.length} {filtered.length === 1 ? 'employee' : 'employees'}
          </Badge>
        </div>
      )}

      {/* Employee grid */}
      {filtered.length === 0 ? (
        <Card>
          <EmptyState
            icon={Users}
            title="No employees found"
            description="Try adjusting your search or filters."
          />
        </Card>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {filtered.map((emp, i) => (
            <motion.div
              key={emp.id}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.03, duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
            >
              <Link to={`/app/employees/${emp.id}`} className="block">
                <Card className="group h-full cursor-pointer p-5 transition-all hover:-translate-y-0.5 hover:border-ink-300 hover:shadow-md">
                  <div className="flex items-start gap-3">
                    <Avatar className="h-12 w-12">
                      <AvatarFallback className="bg-ink-900 text-ink-50">
                        {initials(`${emp.firstName} ${emp.lastName}`)}
                      </AvatarFallback>
                    </Avatar>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center justify-between gap-2">
                        <h3 className="truncate font-medium text-ink-900">
                          {emp.firstName} {emp.lastName}
                        </h3>
                        <StatusBadge status={emp.status} />
                      </div>
                      <p className="mt-0.5 truncate text-sm text-ink-500">{emp.positionName}</p>
                    </div>
                  </div>

                  <div className="mt-4 grid grid-cols-2 gap-3 border-t border-ink-100 pt-4 text-xs">
                    <div>
                      <div className="text-ink-400">Department</div>
                      <div className="mt-0.5 truncate font-medium text-ink-700">
                        {emp.departmentName}
                      </div>
                    </div>
                    <div>
                      <div className="text-ink-400">Employee ID</div>
                      <div className="mt-0.5 font-mono text-ink-700">{emp.employeeNo}</div>
                    </div>
                    <div>
                      <div className="text-ink-400">Hire date</div>
                      <div className="mt-0.5 font-medium text-ink-700">
                        {formatDate(emp.hireDate, { year: 'numeric', month: 'short' })}
                      </div>
                    </div>
                    <div>
                      <div className="text-ink-400">Type</div>
                      <div className="mt-0.5">
                        <Badge variant="outline" className="text-[10px]">
                          {emp.employmentType}
                        </Badge>
                      </div>
                    </div>
                  </div>
                </Card>
              </Link>
            </motion.div>
          ))}
        </div>
      )}
    </div>
  );
}
