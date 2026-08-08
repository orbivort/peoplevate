import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

type Status = 'Active' | 'Probation' | 'On Leave' | 'Terminated' | 'New Hire';

const statusConfig: Record<Status, { variant: string; dot: string }> = {
  Active: { variant: 'border-transparent bg-accent-100 text-accent-800', dot: 'bg-accent-500' },
  Probation: { variant: 'border-transparent bg-blue-100 text-blue-700', dot: 'bg-blue-500' },
  'On Leave': { variant: 'border-transparent bg-amber-100 text-amber-800', dot: 'bg-amber-500' },
  Terminated: { variant: 'border-transparent bg-red-100 text-red-700', dot: 'bg-red-500' },
  'New Hire': { variant: 'border-transparent bg-ink-100 text-ink-700', dot: 'bg-ink-400' },
};

export function StatusBadge({
  status,
  className,
}: {
  status: Status | string;
  className?: string;
}) {
  const config = statusConfig[status as Status] ?? statusConfig['New Hire'];
  return (
    <Badge className={cn(config.variant, 'gap-1.5 capitalize', className)}>
      <span className={cn('h-1.5 w-1.5 rounded-full', config.dot)} />
      {status}
    </Badge>
  );
}
