// Load .env from the backend package root before any module that validates
// process.env (e.g. src/config/env.ts via src/config/prisma.ts) is evaluated.
// This must be a side-effect import so it executes before the '#prisma' import.
import './load-env.js';

import {
  UserRole,
  UserStatus,
  EmploymentType,
  EmploymentStatus,
  Gender,
  RetentionDataCategory,
  RetentionAction,
  KeyPurpose,
  KeyStatus,
} from '#prisma';
import { prisma } from '../src/config/prisma.js';
import { hashPassword } from '../src/utils/password.js';
import { generateToken, hashToken } from '../src/utils/token.js';

// Find-or-create helpers used by entities whose @@unique key includes a nullable
// column (Department.[name, parent_id] and LeaveType.[name, deleted_at]). Prisma
// v7 cannot look those rows up by a null key inside upsert(), so we resolve them
// explicitly. This keeps the seed idempotent and safe to re-run.
async function findOrCreateDepartment(name: string, description: string) {
  const existing = await prisma.department.findFirst({ where: { name, parent_id: null } });
  if (existing) return existing;
  return prisma.department.create({ data: { name, description } });
}

async function findOrCreateLeaveType(data: {
  name: string;
  accrual_rate: number;
  carry_forward_policy: string;
  max_consecutive_days: number | null;
  approval_levels: number;
  auto_approve_sick_days: number;
}) {
  const existing = await prisma.leaveType.findFirst({
    where: { name: data.name, deleted_at: null },
  });
  if (existing) return existing;
  return prisma.leaveType.create({ data });
}

async function main() {
  console.log('Seeding database...');

  // NOTE: every create() below is an upsert so the seed is idempotent and can be
  // re-run safely against a database that was not freshly dropped (e.g. when the
  // E2E orchestrator is invoked with E2E_SKIP_DB_RESET=true, or a previous run
  // left a partial state). A non-idempotent seed would crash with a unique
  // constraint violation and leave the E2E accounts missing or the HR account
  // stuck in a locked state — which is what previously broke login in CI.

  // Create departments. The @@unique([name, parent_id]) includes a nullable
  // column, so a plain upsert() cannot look the row up by a null key in Prisma
  // v7 — we find-or-create explicitly instead (keeps the seed idempotent).
  const engineering = await findOrCreateDepartment('Engineering', 'Software development team');
  const hrDept = await findOrCreateDepartment('Human Resources', 'HR department');
  const management = await findOrCreateDepartment('Management', 'Executive management');

  // Create positions
  const ceoPos = await prisma.position.upsert({
    where: { name_department_id: { name: 'CEO', department_id: management.id } },
    update: { grade: 'L10' },
    create: { name: 'CEO', grade: 'L10', department_id: management.id },
  });
  const hrManagerPos = await prisma.position.upsert({
    where: { name_department_id: { name: 'HR Manager', department_id: hrDept.id } },
    update: { grade: 'L7' },
    create: { name: 'HR Manager', grade: 'L7', department_id: hrDept.id },
  });
  const engineeringManagerPos = await prisma.position.upsert({
    where: { name_department_id: { name: 'Engineering Manager', department_id: engineering.id } },
    update: { grade: 'L7' },
    create: { name: 'Engineering Manager', grade: 'L7', department_id: engineering.id },
  });
  const developerPos = await prisma.position.upsert({
    where: { name_department_id: { name: 'Software Developer', department_id: engineering.id } },
    update: { grade: 'L4' },
    create: { name: 'Software Developer', grade: 'L4', department_id: engineering.id },
  });

  // Create admin user. The account is always forced back to a clean, unlocked,
  // ACTIVE state so a previously-locked (or deactivated) seeded account can never
  // block the E2E login flow.
  const adminPassword = await hashPassword('Admin@12345!');
  const admin = await prisma.user.upsert({
    where: { email: 'admin@example.com' },
    update: {
      password_hash: adminPassword,
      role: UserRole.ADMIN,
      status: UserStatus.ACTIVE,
      failed_login_count: 0,
      locked_until: null,
    },
    create: {
      email: 'admin@example.com',
      password_hash: adminPassword,
      role: UserRole.ADMIN,
      status: UserStatus.ACTIVE,
    },
  });

  // Create HR user
  const hrPassword = await hashPassword('HR@12345!');
  const hrUser = await prisma.user.upsert({
    where: { email: 'hr@example.com' },
    update: {
      password_hash: hrPassword,
      role: UserRole.HR_MANAGER,
      status: UserStatus.ACTIVE,
      failed_login_count: 0,
      locked_until: null,
    },
    create: {
      email: 'hr@example.com',
      password_hash: hrPassword,
      role: UserRole.HR_MANAGER,
      status: UserStatus.ACTIVE,
    },
  });

  // Create manager user
  const managerPassword = await hashPassword('Manager@12345!');
  const managerUser = await prisma.user.upsert({
    where: { email: 'manager@example.com' },
    update: {
      password_hash: managerPassword,
      role: UserRole.MANAGER,
      status: UserStatus.ACTIVE,
      failed_login_count: 0,
      locked_until: null,
    },
    create: {
      email: 'manager@example.com',
      password_hash: managerPassword,
      role: UserRole.MANAGER,
      status: UserStatus.ACTIVE,
    },
  });

  // Create employee user
  const empPassword = await hashPassword('Employee@12345!');
  const empUser = await prisma.user.upsert({
    where: { email: 'employee@example.com' },
    update: {
      password_hash: empPassword,
      role: UserRole.EMPLOYEE,
      status: UserStatus.ACTIVE,
      failed_login_count: 0,
      locked_until: null,
    },
    create: {
      email: 'employee@example.com',
      password_hash: empPassword,
      role: UserRole.EMPLOYEE,
      status: UserStatus.ACTIVE,
    },
  });

  // Create employees (upsert on employee_no so the seed is re-runnable)
  const ceo = await prisma.employee.upsert({
    where: { employee_no: 'EMP-2026-0001' },
    update: {
      first_name: 'Admin',
      last_name: 'User',
      email: 'admin@example.com',
      department_id: management.id,
      position_id: ceoPos.id,
      employment_type: EmploymentType.FULL_TIME,
      status: EmploymentStatus.ACTIVE,
      user_id: admin.id,
    },
    create: {
      employee_no: 'EMP-2026-0001',
      first_name: 'Admin',
      last_name: 'User',
      email: 'admin@example.com',
      department_id: management.id,
      position_id: ceoPos.id,
      hire_date: new Date('2020-01-01'),
      employment_type: EmploymentType.FULL_TIME,
      status: EmploymentStatus.ACTIVE,
      user_id: admin.id,
    },
  });

  const hrEmployee = await prisma.employee.upsert({
    where: { employee_no: 'EMP-2026-0002' },
    update: {
      first_name: 'HR',
      last_name: 'Manager',
      email: 'hr@example.com',
      department_id: hrDept.id,
      position_id: hrManagerPos.id,
      employment_type: EmploymentType.FULL_TIME,
      status: EmploymentStatus.ACTIVE,
      user_id: hrUser.id,
    },
    create: {
      employee_no: 'EMP-2026-0002',
      first_name: 'HR',
      last_name: 'Manager',
      email: 'hr@example.com',
      department_id: hrDept.id,
      position_id: hrManagerPos.id,
      hire_date: new Date('2021-03-15'),
      employment_type: EmploymentType.FULL_TIME,
      status: EmploymentStatus.ACTIVE,
      user_id: hrUser.id,
    },
  });

  const engManager = await prisma.employee.upsert({
    where: { employee_no: 'EMP-2026-0003' },
    update: {
      first_name: 'Engineering',
      last_name: 'Manager',
      email: 'manager@example.com',
      department_id: engineering.id,
      position_id: engineeringManagerPos.id,
      employment_type: EmploymentType.FULL_TIME,
      status: EmploymentStatus.ACTIVE,
      user_id: managerUser.id,
    },
    create: {
      employee_no: 'EMP-2026-0003',
      first_name: 'Engineering',
      last_name: 'Manager',
      email: 'manager@example.com',
      department_id: engineering.id,
      position_id: engineeringManagerPos.id,
      hire_date: new Date('2021-06-01'),
      employment_type: EmploymentType.FULL_TIME,
      status: EmploymentStatus.ACTIVE,
      user_id: managerUser.id,
    },
  });

  const developer = await prisma.employee.upsert({
    where: { employee_no: 'EMP-2026-0004' },
    update: {
      first_name: 'Software',
      last_name: 'Developer',
      email: 'employee@example.com',
      gender: Gender.FEMALE,
      department_id: engineering.id,
      position_id: developerPos.id,
      manager_id: engManager.id,
      employment_type: EmploymentType.FULL_TIME,
      status: EmploymentStatus.ACTIVE,
      user_id: empUser.id,
    },
    create: {
      employee_no: 'EMP-2026-0004',
      first_name: 'Software',
      last_name: 'Developer',
      email: 'employee@example.com',
      gender: Gender.FEMALE,
      department_id: engineering.id,
      position_id: developerPos.id,
      manager_id: engManager.id,
      hire_date: new Date('2023-01-15'),
      employment_type: EmploymentType.FULL_TIME,
      status: EmploymentStatus.ACTIVE,
      user_id: empUser.id,
    },
  });

  // ── Phase 2: Default leave types ─────────────────────────────
  // @@unique([name, deleted_at]) includes a nullable column, so look up by
  // find-or-create (idempotent, Prisma v7 compatible).
  const annualLeave = await findOrCreateLeaveType({
    name: 'Annual',
    accrual_rate: 1.67,
    carry_forward_policy: 'up-to-5-days',
    max_consecutive_days: 30,
    approval_levels: 1,
    auto_approve_sick_days: 0,
  });
  await findOrCreateLeaveType({
    name: 'Sick',
    accrual_rate: 0.83,
    carry_forward_policy: 'none',
    max_consecutive_days: 10,
    approval_levels: 1,
    auto_approve_sick_days: 2,
  });
  await findOrCreateLeaveType({
    name: 'Personal',
    accrual_rate: 0,
    carry_forward_policy: 'none',
    max_consecutive_days: 5,
    approval_levels: 1,
    auto_approve_sick_days: 0,
  });
  await findOrCreateLeaveType({
    name: 'Unpaid',
    accrual_rate: 0,
    carry_forward_policy: 'none',
    max_consecutive_days: null,
    approval_levels: 2,
    auto_approve_sick_days: 0,
  });

  // ── Phase 2b: Preset leave policy groups ────────────────────
  const year = new Date().getFullYear();
  const allLeaveTypes = await prisma.leaveType.findMany({ where: { deleted_at: null } });
  const ltByName = (name: string) => allLeaveTypes.find((lt) => lt.name === name)!;

  const presets = [
    {
      name: 'Full-Time Standard',
      description: 'Standard entitlement for all full-time employees',
      employment_type: EmploymentType.FULL_TIME,
      grades: ['L4'],
      entitlements: { Annual: 15, Sick: 15, Personal: 2, Unpaid: 15 },
    },
    {
      name: 'Full-Time Senior',
      description: 'Enhanced entitlement for senior full-time employees',
      employment_type: EmploymentType.FULL_TIME,
      grades: ['L7'],
      entitlements: { Annual: 20, Sick: 20, Personal: 3, Unpaid: 15 },
    },
    {
      name: 'Full-Time Executive',
      description: 'Premium entitlement for executive full-time employees',
      employment_type: EmploymentType.FULL_TIME,
      grades: ['L10'],
      entitlements: { Annual: 25, Sick: 20, Personal: 3, Unpaid: 15 },
    },
  ];

  // These preset policy groups are seeded here (not via migration SQL) so the
  // seed remains the single source of truth. Upsert on the [name, year] unique
  // key keeps the seed idempotent.
  for (const p of presets) {
    const groupData = {
      description: p.description,
      employment_type: p.employment_type,
      grades: p.grades,
      proration_enabled: true,
    };

    const group = await prisma.leavePolicyGroup.upsert({
      where: { name_year: { name: p.name, year } },
      update: groupData,
      create: { name: p.name, year, ...groupData },
    });

    for (const [ltName, days] of Object.entries(p.entitlements)) {
      const leaveTypeId = ltByName(ltName).id;
      await prisma.leavePolicyGroupEntitlement.upsert({
        where: {
          policy_group_id_leave_type_id: {
            policy_group_id: group.id,
            leave_type_id: leaveTypeId,
          },
        },
        update: { annual_days: days },
        create: {
          policy_group_id: group.id,
          leave_type_id: leaveTypeId,
          annual_days: days,
        },
      });
    }
  }

  // ── Phase 2: Default leave entitlements for seeded employees ─
  // Entitlements are materialised for EVERY leave type defined in the employee's
  // matching policy group (matched by position grade), so the seeded balances
  // always mirror the latest Leave Policies. Personal/Sick/Unpaid must be
  // materialised too — otherwise `deductBalance` (getAvailableDays) computes an
  // available balance of zero for those types and a manager approval would throw
  // 'Insufficient leave balance' and roll back, leaving requests stuck pending.
  // Note: no leaveBalance/accrued (carry-forward) records are created because
  // annual leave is not carried over into the next year.
  const groups = await prisma.leavePolicyGroup.findMany({
    where: { year, deleted_at: null },
    include: {
      entitlements: { where: { deleted_at: null } },
    },
  });
  const groupsByGrade = new Map<string, (typeof groups)[number]>();
  for (const g of groups) {
    for (const grade of g.grades) groupsByGrade.set(grade, g);
  }

  for (const emp of [ceo, hrEmployee, engManager, developer]) {
    const position = await prisma.position.findUnique({
      where: { id: emp.position_id },
      select: { grade: true },
    });
    const grade = position?.grade ?? '';
    const matchedGroup = groupsByGrade.get(grade);
    // Defaults mirror the "Full-Time Standard" preset when no group matches.
    const entitlements = matchedGroup?.entitlements ?? [
      { id: '', leave_type_id: annualLeave.id, annual_days: 20 },
    ];

    for (const ent of entitlements) {
      await prisma.leaveEntitlement.upsert({
        where: {
          employee_id_leave_type_id_year: {
            employee_id: emp.id,
            leave_type_id: ent.leave_type_id,
            year,
          },
        },
        update: {
          annual_entitlement: ent.annual_days,
          source: 'POLICY',
          policy_group_id: matchedGroup?.id ?? null,
        },
        create: {
          employee_id: emp.id,
          leave_type_id: ent.leave_type_id,
          annual_entitlement: ent.annual_days,
          year,
          source: 'POLICY',
          policy_group_id: matchedGroup?.id ?? null,
        },
      });
    }
  }

  console.log('Seed data created:');
  console.log('  Admin:    admin@example.com / Admin@12345!');
  console.log('  HR:       hr@example.com / HR@12345!');
  console.log('  Manager:  manager@example.com / Manager@12345!');
  console.log('  Employee: employee@example.com / Employee@12345!');
  console.log(`  Departments: ${[engineering.name, hrDept.name, management.name].join(', ')}`);
  console.log(`  Positions: 4 created`);
  console.log(`  Employees: 4 created`);
  console.log(`  Leave types: 4 created`);
  console.log(`  Policy groups: 3 created`);
  console.log(`  Leave entitlements: 4 created`);

  // ── GDPR Compliance: Default retention policies ──
  const retentionPolicies = [
    {
      data_category: RetentionDataCategory.TERMINATED_EMPLOYEE_RECORDS,
      retention_years: 7,
      action: RetentionAction.HARD_DELETE,
      description: 'Default 7-year retention for terminated employee records',
      is_default: true,
    },
    {
      data_category: RetentionDataCategory.CANDIDATE_RESUMES,
      retention_years: 2,
      action: RetentionAction.ANONYMIZE,
      description: '2-year retention for candidate resumes, then anonymized',
      is_default: true,
    },
    {
      data_category: RetentionDataCategory.CONTRACTS,
      retention_years: 7,
      action: RetentionAction.HARD_DELETE,
      description: '7-year retention for employment contracts',
      is_default: true,
    },
    {
      data_category: RetentionDataCategory.ATTENDANCE_RECORDS,
      retention_years: 3,
      action: RetentionAction.HARD_DELETE,
      description: '3-year retention for attendance records',
      is_default: true,
    },
    {
      data_category: RetentionDataCategory.LEAVE_RECORDS,
      retention_years: 7,
      action: RetentionAction.HARD_DELETE,
      description: '7-year retention for leave records',
      is_default: true,
    },
    {
      data_category: RetentionDataCategory.SALARY_RECORDS,
      retention_years: 7,
      action: RetentionAction.HARD_DELETE,
      description: '7-year retention for salary records',
      is_default: true,
    },
    {
      data_category: RetentionDataCategory.AUDIT_LOGS,
      retention_years: 7,
      action: RetentionAction.HARD_DELETE,
      description: '7-year retention for audit logs',
      is_default: true,
    },
  ];

  for (const p of retentionPolicies) {
    await prisma.retentionPolicy.upsert({
      where: { data_category: p.data_category },
      update: {},
      create: p,
    });
  }
  console.log(`  Retention policies: ${retentionPolicies.length} created`);

  // ── GDPR Compliance: Bootstrap encryption key versions ──
  for (const purpose of [KeyPurpose.DATA_ENCRYPTION, KeyPurpose.TOKEN_SIGNING]) {
    const existing = await prisma.encryptionKeyVersion.findFirst({
      where: { purpose, status: KeyStatus.ACTIVE },
    });
    if (!existing) {
      await prisma.encryptionKeyVersion.create({
        data: {
          key_id: `${purpose.toLowerCase()}-v1`,
          purpose,
          status: KeyStatus.ACTIVE,
        },
      });
    }
  }
  console.log(`  Encryption key versions: bootstrapped`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
