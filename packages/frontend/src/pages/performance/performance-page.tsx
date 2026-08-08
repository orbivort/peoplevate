import { motion } from 'framer-motion';
import {
  Award,
  CalendarRange,
  CheckCircle2,
  ClipboardCheck,
  FileBarChart,
  Lock,
  MessageSquare,
  PenLine,
  Plus,
  Star,
  Target,
  TrendingUp,
  UserCheck,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';

import { PageHeader } from '@/components/layout/page-header';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { EmptyState } from '@/components/ui/empty-state';
import { Label } from '@/components/ui/label';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import { useAuth } from '@/contexts/auth-context';
import { performanceRepo } from '@/lib/api/workflow-repositories';
import { cn, formatDate, initials } from '@/lib/utils';
import type { EvaluationCycle, PerformanceReview, Rating, ReviewStatus } from '@/types';

const ratingColors: Record<Rating, string> = {
  1: 'text-red-600 bg-red-100',
  2: 'text-orange-600 bg-orange-100',
  3: 'text-amber-600 bg-amber-100',
  4: 'text-accent-700 bg-accent-100',
  5: 'text-accent-800 bg-accent-200',
};

const ratingLabels: Record<Rating, string> = {
  1: 'Below expectations',
  2: 'Needs improvement',
  3: 'Meets expectations',
  4: 'Exceeds expectations',
  5: 'Outstanding',
};

const phaseConfig: Record<string, { dot: string; badge: string }> = {
  'Not Started': { dot: 'bg-gray-400', badge: 'border-transparent bg-gray-100 text-gray-600' },
  'Self-Evaluation': { dot: 'bg-blue-500', badge: 'border-transparent bg-blue-100 text-blue-700' },
  'Manager Evaluation': {
    dot: 'bg-amber-500',
    badge: 'border-transparent bg-amber-100 text-amber-800',
  },
  'HR Review': { dot: 'bg-purple-500', badge: 'border-transparent bg-purple-100 text-purple-700' },
  Completed: { dot: 'bg-green-500', badge: 'border-transparent bg-green-100 text-green-700' },
  Closed: { dot: 'bg-ink-400', badge: 'border-transparent bg-ink-100 text-ink-600' },
};

const reviewStatusConfig: Record<ReviewStatus, string> = {
  'Not Started': 'border-transparent bg-ink-100 text-ink-600',
  'Self-Evaluation': 'border-transparent bg-blue-100 text-blue-700',
  'Manager Evaluation': 'border-transparent bg-amber-100 text-amber-800',
  'HR Review': 'border-transparent bg-purple-100 text-purple-700',
  Completed: 'border-transparent bg-accent-100 text-accent-800',
};

export function PerformancePage() {
  const { employee, hasPermission } = useAuth();
  const canManagePerf = hasPermission('managePerformance');
  const canConductReviews = hasPermission('conductReviews');
  const isHrOrAdmin = canManagePerf;
  const isManager = canConductReviews && !canManagePerf;

  const [tab, setTab] = useState('cycles');
  const [reviews, setReviews] = useState<PerformanceReview[]>([]);
  const [cycles, setCycles] = useState<EvaluationCycle[]>([]);
  const [loading, setLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [activeReviewId, setActiveReviewId] = useState<string | null>(null);
  const [ratingDialogFor, setRatingDialogFor] = useState<{
    reviewId: string;
    competency: string;
    role: 'self' | 'manager';
  } | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [toastError, setToastError] = useState<string | null>(null);
  const [createDialogOpen, setCreateDialogOpen] = useState(false);

  useEffect(() => {
    if (!toast && !toastError) return;
    const t = setTimeout(() => {
      setToast(null);
      setToastError(null);
    }, 3000);
    return () => clearTimeout(t);
  }, [toast, toastError]);

  const load = useCallback(async () => {
    try {
      const [cycleList, reviewList] = await Promise.all([
        performanceRepo.listCycles(),
        performanceRepo.listReviews(),
      ]);
      setCycles(cycleList);
      setReviews(reviewList);
    } catch (_err) {
      setToastError('Failed to load data. Please refresh the page.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    queueMicrotask(() => {
      if (!cancelled) void load();
    });
    return () => {
      cancelled = true;
    };
  }, [load]);

  const visibleReviews = useMemo(() => {
    if (isHrOrAdmin) return reviews;
    if (isManager) {
      const reportIds = new Set(
        reviews
          .filter((r) => r.managerName === `${employee?.firstName} ${employee?.lastName}`)
          .map((r) => r.employeeId),
      );
      return reviews.filter((r) => reportIds.has(r.employeeId) || r.employeeId === employee?.id);
    }
    return reviews.filter((r) => r.employeeId === employee?.id);
  }, [reviews, employee, isHrOrAdmin, isManager]);

  const activeReview = reviews.find((r) => r.id === activeReviewId) ?? null;
  const activeCycle = activeReview
    ? (cycles.find((c) => c.id === activeReview.cycleId) ?? null)
    : null;

  const handleSetRating = (rating: Rating) => {
    if (!ratingDialogFor) return;
    setReviews((prev) =>
      prev.map((rev) =>
        rev.id === ratingDialogFor.reviewId
          ? {
              ...rev,
              competencies: rev.competencies.map((c) =>
                c.competency === ratingDialogFor.competency
                  ? {
                      ...c,
                      selfRating: ratingDialogFor.role === 'self' ? rating : c.selfRating,
                      managerRating: ratingDialogFor.role === 'manager' ? rating : c.managerRating,
                    }
                  : c,
              ),
            }
          : rev,
      ),
    );
    setRatingDialogFor(null);
  };

  const handleSubmitSelfEval = async (
    reviewId: string,
    values?: { achievements?: string; goals?: string },
  ) => {
    setIsSubmitting(true);
    const review = reviews.find((r) => r.id === reviewId);
    if (!review) return setIsSubmitting(false);
    // Send competencies as an array of { name, selfRating } so the API adapter
    // can read them back symmetrically (see adaptPerformanceReview).
    const competencies = review.competencies
      .filter((c) => c.selfRating)
      .map((c) => ({ name: c.competency, selfRating: c.selfRating }));
    const achievements = values?.achievements ?? review.achievements ?? '';
    const goals = values?.goals ?? review.goals ?? '';
    try {
      await performanceRepo.submitSelf(reviewId, {
        competencies,
        achievements,
        goals,
      });
      setReviews((prev) =>
        prev.map((r) =>
          r.id === reviewId
            ? {
                ...r,
                achievements,
                goals,
                selfEvaluationSubmitted: true,
                selfEvaluationSubmittedAt: new Date().toISOString(),
                status: 'Manager Evaluation',
              }
            : r,
        ),
      );
      setToast('Self-evaluation submitted successfully');
    } catch (err) {
      setToastError(err instanceof Error ? err.message : 'Failed to submit self-evaluation');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleSubmitManagerEval = async (reviewId: string, comments: string) => {
    setIsSubmitting(true);
    const review = reviews.find((r) => r.id === reviewId);
    if (!review) return setIsSubmitting(false);
    // Send manager ratings as an array of { name, managerRating } so the API
    // adapter can read them back symmetrically (see adaptPerformanceReview).
    const competencies = review.competencies
      .filter((c) => c.managerRating)
      .map((c) => ({ name: c.competency, managerRating: c.managerRating }));
    try {
      await performanceRepo.submitManager(reviewId, {
        competencies,
        comments,
      });
      setReviews((prev) =>
        prev.map((r) =>
          r.id === reviewId
            ? {
                ...r,
                managerComments: comments,
                managerEvaluationSubmitted: true,
                managerEvaluationSubmittedAt: new Date().toISOString(),
                status: 'HR Review',
              }
            : r,
        ),
      );
      setToast('Manager evaluation submitted successfully');
    } catch (err) {
      setToastError(err instanceof Error ? err.message : 'Failed to submit manager evaluation');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleHrFinalize = async (reviewId: string, overall: Rating, hrComments?: string) => {
    setIsSubmitting(true);
    try {
      await performanceRepo.finalize(reviewId, overall, hrComments);
      setReviews((prev) =>
        prev.map((r) =>
          r.id === reviewId
            ? {
                ...r,
                hrFinalized: true,
                hrFinalizedAt: new Date().toISOString(),
                overallRating: overall,
                hrComments: hrComments ?? r.hrComments,
                status: 'Completed',
              }
            : r,
        ),
      );
      setToast('Review finalized successfully');
    } catch (err) {
      setToastError(err instanceof Error ? err.message : 'Failed to finalize review');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleSubmitRebuttal = async (reviewId: string, rebuttal: string) => {
    if (!rebuttal.trim()) return;
    setIsSubmitting(true);
    try {
      await performanceRepo.addRebuttal(reviewId, rebuttal.trim());
      setReviews((prev) =>
        prev.map((r) => (r.id === reviewId ? { ...r, rebuttal: rebuttal.trim() } : r)),
      );
      setToast('Rebuttal submitted successfully');
    } catch (err) {
      setToastError(err instanceof Error ? err.message : 'Failed to submit rebuttal');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleOpenCycle = async (cycleId: string) => {
    setIsSubmitting(true);
    try {
      await performanceRepo.openCycle(cycleId);
      await load();
      setToast('Cycle opened successfully');
    } catch (err) {
      setToastError(err instanceof Error ? err.message : 'Failed to open cycle');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleCloseCycle = async (cycleId: string) => {
    setIsSubmitting(true);
    try {
      await performanceRepo.closeCycle(cycleId);
      await load();
      setToast('Cycle closed successfully');
    } catch (err) {
      setToastError(err instanceof Error ? err.message : 'Failed to close cycle');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div>
      {/* Toast notifications */}
      {toast && (
        <div className="fixed top-4 right-4 z-50 rounded-lg border border-green-200 bg-green-50 px-4 py-3 text-sm font-medium text-green-800 shadow-lg">
          {toast}
        </div>
      )}
      {toastError && (
        <div className="fixed top-4 right-4 z-50 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm font-medium text-red-800 shadow-lg">
          {toastError}
        </div>
      )}

      {/* Create cycle dialog */}
      {createDialogOpen && (
        <CreateCycleDialog
          onClose={() => setCreateDialogOpen(false)}
          onCreated={() => {
            setCreateDialogOpen(false);
            load();
            setToast('Cycle created successfully');
          }}
          onError={(msg) => setToastError(msg)}
          isSubmitting={isSubmitting}
          setIsSubmitting={setIsSubmitting}
        />
      )}

      <PageHeader
        title="Performance"
        description={
          isHrOrAdmin
            ? 'Manage evaluation cycles, review submissions, and finalize results.'
            : isManager
              ? 'Conduct performance evaluations for your direct reports.'
              : 'Complete your self-evaluation and view your results.'
        }
      />

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="cycles">
            <CalendarRange className="h-3.5 w-3.5" />
            Cycles
          </TabsTrigger>
          <TabsTrigger value="reviews">
            <FileBarChart className="h-3.5 w-3.5" />
            Reviews
          </TabsTrigger>
        </TabsList>

        {/* Cycles tab */}
        <TabsContent value="cycles" className="mt-4">
          <div className="mb-4 flex items-center justify-between">
            <div>
              {isHrOrAdmin && (
                <Button onClick={() => setCreateDialogOpen(true)} disabled={isSubmitting}>
                  <Plus className="h-4 w-4" />
                  Create Cycle
                </Button>
              )}
            </div>
          </div>
          {loading ? (
            <div className="flex h-40 items-center justify-center text-sm text-ink-500">
              Loading evaluation cycles…
            </div>
          ) : cycles.length === 0 ? (
            <Card>
              <EmptyState
                icon={CalendarRange}
                title="No evaluation cycles"
                description="Evaluation cycles will appear here once created."
              />
            </Card>
          ) : (
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
              {cycles.map((cycle: EvaluationCycle, i) => {
                const cycleReviews = reviews.filter((r) => r.cycleId === cycle.id);
                const completed = cycleReviews.filter((r) => r.status === 'Completed').length;
                const phase = phaseConfig[cycle.currentPhase] ?? phaseConfig.Closed!;
                return (
                  <motion.div
                    key={cycle.id}
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: i * 0.06, duration: 0.35 }}
                  >
                    <Card className="h-full">
                      <CardHeader>
                        <div className="flex items-center justify-between">
                          <Badge
                            className={cn(
                              'border-transparent',
                              cycle.status === 'Open'
                                ? 'bg-accent-100 text-accent-800'
                                : cycle.status === 'Draft'
                                  ? 'bg-ink-100 text-ink-600'
                                  : 'bg-ink-200 text-ink-700',
                            )}
                          >
                            {cycle.status}
                          </Badge>
                          <Badge className={cn('gap-1.5', phase.badge)}>
                            <span className={cn('h-1.5 w-1.5 rounded-full', phase.dot)} />
                            {cycle.currentPhase}
                          </Badge>
                        </div>
                        <CardTitle className="flex items-center gap-2">
                          <Target className="h-4 w-4 text-ink-400" />
                          {cycle.type}
                        </CardTitle>
                        <p className="text-xs text-ink-500">
                          {formatDate(cycle.periodStart, { month: 'short', day: 'numeric' })} –{' '}
                          {formatDate(cycle.periodEnd, { month: 'short', day: 'numeric' })}
                        </p>
                      </CardHeader>
                      <CardContent className="space-y-3">
                        <div className="space-y-1.5 text-xs">
                          <PhaseRow
                            label="Self-evaluation"
                            start={cycle.selfEvalStart}
                            end={cycle.selfEvalEnd}
                            active={cycle.currentPhase === 'Self-Evaluation'}
                          />
                          <PhaseRow
                            label="Manager evaluation"
                            start={cycle.managerEvalStart}
                            end={cycle.managerEvalEnd}
                            active={cycle.currentPhase === 'Manager Evaluation'}
                          />
                          <PhaseRow
                            label="HR review"
                            start={cycle.hrReviewStart}
                            end={cycle.hrReviewEnd}
                            active={cycle.currentPhase === 'HR Review'}
                          />
                        </div>
                        <div className="flex items-center justify-between border-t border-ink-100 pt-3">
                          <span className="text-xs text-ink-500">
                            {completed}/{cycleReviews.length} completed
                          </span>
                          <div className="flex gap-2">
                            {isHrOrAdmin && cycle.status === 'Draft' && (
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={() => handleOpenCycle(cycle.id)}
                                disabled={isSubmitting}
                              >
                                Open
                              </Button>
                            )}
                            {isHrOrAdmin && cycle.status === 'Open' && (
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={() => handleCloseCycle(cycle.id)}
                                disabled={isSubmitting}
                              >
                                Close
                              </Button>
                            )}
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => {
                                setTab('reviews');
                              }}
                            >
                              View reviews
                            </Button>
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

        {/* Reviews tab */}
        <TabsContent value="reviews" className="mt-4">
          {activeReview ? (
            <ReviewDetail
              review={activeReview}
              onSubmitRebuttal={handleSubmitRebuttal}
              canEditSelf={
                !activeReview.selfEvaluationSubmitted &&
                activeReview.employeeId === employee?.id &&
                activeCycle?.currentPhase === 'Self-Evaluation'
              }
              canEditManager={
                !activeReview.managerEvaluationSubmitted &&
                isManager &&
                activeReview.managerName === `${employee?.firstName} ${employee?.lastName}` &&
                activeCycle?.currentPhase === 'Manager Evaluation'
              }
              canHrFinalize={
                isHrOrAdmin && !activeReview.hrFinalized && activeReview.status === 'HR Review'
              }
              onRate={(competency, role) =>
                setRatingDialogFor({
                  reviewId: activeReview.id,
                  competency,
                  role,
                })
              }
              onSubmitSelf={(values) => handleSubmitSelfEval(activeReview.id, values)}
              onSubmitManager={(comments) => handleSubmitManagerEval(activeReview.id, comments)}
              onHrFinalize={(overall, comments) =>
                handleHrFinalize(activeReview.id, overall, comments)
              }
              onBack={() => setActiveReviewId(null)}
            />
          ) : (
            <Card>
              <CardHeader>
                <CardTitle>Performance reviews</CardTitle>
              </CardHeader>
              <CardContent className="p-0">
                {loading ? (
                  <div className="flex h-32 items-center justify-center text-sm text-ink-500">
                    Loading reviews…
                  </div>
                ) : visibleReviews.length === 0 ? (
                  <EmptyState
                    icon={ClipboardCheck}
                    title="No reviews assigned"
                    description="You have no performance reviews in the current cycle."
                  />
                ) : (
                  <div className="divide-y divide-ink-100">
                    {visibleReviews.map((rev, i) => (
                      <motion.button
                        key={rev.id}
                        initial={{ opacity: 0, x: -6 }}
                        animate={{ opacity: 1, x: 0 }}
                        transition={{ delay: i * 0.04, duration: 0.25 }}
                        onClick={() => setActiveReviewId(rev.id)}
                        className="flex w-full items-center gap-3 px-6 py-4 text-left transition-colors hover:bg-ink-50"
                      >
                        <Avatar className="h-10 w-10 shrink-0">
                          <AvatarFallback className="bg-ink-900 text-xs text-ink-50">
                            {initials(rev.employeeName)}
                          </AvatarFallback>
                        </Avatar>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            <span className="font-medium text-ink-900">{rev.employeeName}</span>
                            <Badge className={cn('text-[10px]', reviewStatusConfig[rev.status])}>
                              {rev.status}
                            </Badge>
                          </div>
                          <p className="mt-0.5 text-xs text-ink-500">
                            {rev.cycleName} · Reports to {rev.managerName}
                          </p>
                        </div>
                        <div className="flex items-center gap-4">
                          {/* Phase indicators */}
                          <div className="hidden items-center gap-2 sm:flex">
                            <PhaseDot active={rev.selfEvaluationSubmitted} label="Self" />
                            <PhaseDot active={rev.managerEvaluationSubmitted} label="Manager" />
                            <PhaseDot active={rev.hrFinalized} label="HR" />
                          </div>
                          {rev.overallRating && <RatingPill rating={rev.overallRating} />}
                        </div>
                      </motion.button>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          )}
        </TabsContent>
      </Tabs>

      {/* Rating picker dialog */}
      <RatingDialog
        open={!!ratingDialogFor}
        onOpenChange={(open) => !open && setRatingDialogFor(null)}
        onPick={handleSetRating}
      />
    </div>
  );
}

function PhaseRow({
  label,
  start,
  end,
  active,
}: {
  label: string;
  start: string;
  end: string;
  active: boolean;
}) {
  return (
    <div className="flex items-center justify-between">
      <span
        className={cn(
          'flex items-center gap-1.5',
          active ? 'font-medium text-ink-900' : 'text-ink-500',
        )}
      >
        {active && <span className="h-1.5 w-1.5 rounded-full bg-accent-500" />}
        {label}
      </span>
      <span className="text-ink-400">
        {formatDate(start, { month: 'numeric', day: 'numeric' })} –{' '}
        {formatDate(end, { month: 'numeric', day: 'numeric' })}
      </span>
    </div>
  );
}

function PhaseDot({ active, label }: { active: boolean; label: string }) {
  return (
    <div className="flex items-center gap-1">
      <div
        className={cn(
          'flex h-5 w-5 items-center justify-center rounded-full',
          active ? 'bg-accent-500 text-white' : 'bg-ink-100 text-ink-400',
        )}
      >
        {active ? (
          <CheckCircle2 className="h-3 w-3" />
        ) : (
          <span className="h-1.5 w-1.5 rounded-full bg-ink-300" />
        )}
      </div>
      <span className="text-[10px] text-ink-500">{label}</span>
    </div>
  );
}

function RatingPill({ rating }: { rating: Rating }) {
  return (
    <div
      className={cn(
        'flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-bold',
        ratingColors[rating],
      )}
    >
      <Star className="h-3 w-3 fill-current" />
      {rating}
    </div>
  );
}

function ReviewDetail({
  review,
  canEditSelf,
  canEditManager,
  canHrFinalize,
  onRate,
  onSubmitSelf,
  onSubmitManager,
  onHrFinalize,
  onSubmitRebuttal,
  onBack,
}: {
  review: PerformanceReview;
  canEditSelf: boolean;
  canEditManager: boolean;
  canHrFinalize: boolean;
  onRate: (competency: string, role: 'self' | 'manager') => void;
  onSubmitSelf: (values: { achievements?: string; goals?: string }) => void;
  onSubmitManager: (comments: string) => void;
  onHrFinalize: (overall: Rating, comments?: string) => void;
  onSubmitRebuttal: (reviewId: string, rebuttal: string) => void;
  onBack: () => void;
}) {
  const [achievements, setAchievements] = useState(review.achievements ?? '');
  const [goals, setGoals] = useState(review.goals ?? '');
  const [selfEvalError, setSelfEvalError] = useState('');
  const [managerComments, setManagerComments] = useState(review.managerComments ?? '');
  const [managerEvalError, setManagerEvalError] = useState('');
  const [hrComments, setHrComments] = useState(review.hrComments ?? '');
  const [hrEvalError, setHrEvalError] = useState('');
  const [finalizeOverall, setFinalizeOverall] = useState<Rating>(review.overallRating ?? 3);
  const [showFinalize, setShowFinalize] = useState(false);

  return (
    <div>
      <button
        onClick={onBack}
        className="mb-4 inline-flex items-center gap-1.5 text-sm font-medium text-ink-600 transition-colors hover:text-ink-900"
      >
        ← Back to reviews
      </button>

      {/* Header */}
      <Card className="mb-6 overflow-hidden">
        <div className="relative h-20 bg-gradient-to-r from-ink-900 to-ink-700">
          <div className="absolute inset-0 opacity-20">
            <div className="absolute -top-8 right-12 h-32 w-32 rounded-full bg-accent-500/40 blur-3xl" />
          </div>
        </div>
        <div className="px-6 pb-6">
          <div className="flex items-end gap-4">
            <Avatar className="-mt-8 h-16 w-16 border-4 border-white shadow-md">
              <AvatarFallback className="bg-ink-900 text-lg text-ink-50">
                {initials(review.employeeName)}
              </AvatarFallback>
            </Avatar>
            <div className="pb-1">
              <div className="flex items-center gap-3">
                <h2 className="font-display text-xl font-semibold tracking-tight text-ink-900">
                  {review.employeeName}
                </h2>
                <Badge className={cn('text-[10px]', reviewStatusConfig[review.status])}>
                  {review.status}
                </Badge>
              </div>
              <p className="mt-1 text-sm text-ink-500">
                {review.cycleName} · Manager: {review.managerName}
              </p>
            </div>
          </div>
        </div>
      </Card>

      {/* Competency matrix */}
      <Card className="mb-6">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Award className="h-4 w-4 text-ink-400" />
            Competency ratings
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <div className="divide-y divide-ink-100">
            <div className="grid grid-cols-12 gap-2 bg-ink-50 px-6 py-2 text-[10px] font-semibold tracking-wide text-ink-400 uppercase">
              <div className="col-span-5">Competency</div>
              <div className="col-span-3 text-center">Self</div>
              <div className="col-span-3 text-center">Manager</div>
              <div className="col-span-1"></div>
            </div>
            {review.competencies.map((comp) => (
              <div key={comp.competency} className="grid grid-cols-12 items-center gap-2 px-6 py-3">
                <div className="col-span-5">
                  <p className="text-sm font-medium text-ink-900">{comp.competency}</p>
                  {comp.comments && <p className="mt-0.5 text-xs text-ink-500">{comp.comments}</p>}
                </div>
                <div className="col-span-3 flex justify-center">
                  {comp.selfRating ? (
                    <RatingPill rating={comp.selfRating} />
                  ) : canEditSelf ? (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => onRate(comp.competency, 'self')}
                    >
                      Rate
                    </Button>
                  ) : (
                    <span className="text-xs text-ink-400">—</span>
                  )}
                </div>
                <div className="col-span-3 flex justify-center">
                  {comp.managerRating ? (
                    <RatingPill rating={comp.managerRating} />
                  ) : canEditManager ? (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => onRate(comp.competency, 'manager')}
                    >
                      Rate
                    </Button>
                  ) : (
                    <span className="text-xs text-ink-400">—</span>
                  )}
                </div>
                <div className="col-span-1 text-right">
                  {comp.selfRating && comp.managerRating ? (
                    <CheckCircle2 className="ml-auto h-4 w-4 text-accent-500" />
                  ) : null}
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* Self-evaluation section */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <PenLine className="h-4 w-4 text-ink-400" />
              Self-evaluation
              {review.selfEvaluationSubmitted ? (
                <Badge className="border-transparent bg-ink-100 text-[10px] text-ink-600">
                  <Lock className="h-3 w-3" />
                  Immutable
                </Badge>
              ) : null}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-1.5">
              <Label className="flex items-center gap-1">
                Achievements
                {canEditSelf && <span className="text-danger-600">*</span>}
              </Label>
              <Textarea
                value={achievements}
                onChange={(e) => {
                  setSelfEvalError('');
                  setAchievements(e.target.value);
                }}
                disabled={!canEditSelf}
                placeholder="Key achievements this period…"
                rows={3}
              />
            </div>
            <div className="space-y-1.5">
              <Label className="flex items-center gap-1">
                Goals
                {canEditSelf && <span className="text-danger-600">*</span>}
              </Label>
              <Textarea
                value={goals}
                onChange={(e) => {
                  setSelfEvalError('');
                  setGoals(e.target.value);
                }}
                disabled={!canEditSelf}
                placeholder="Goals for next period…"
                rows={3}
              />
            </div>
            {review.selfEvaluationSubmittedAt && (
              <p className="text-xs text-ink-400">
                Submitted {formatDate(review.selfEvaluationSubmittedAt)}
              </p>
            )}
            {canEditSelf ? (
              <>
                <p className="text-xs text-ink-500">
                  Before submitting, add your self-ratings in the “Competency ratings” table above,
                  then click the button below. Your submission is immutable and moves the review to
                  the manager evaluation phase.
                </p>
                {selfEvalError && (
                  <div className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
                    <span className="mt-0.5">⚠</span>
                    <span>{selfEvalError}</span>
                  </div>
                )}
                <Button
                  onClick={() => {
                    if (!achievements.trim() || !goals.trim()) {
                      setSelfEvalError('Achievements and Goals are required before submitting.');
                      return;
                    }
                    setSelfEvalError('');
                    onSubmitSelf({ achievements, goals });
                  }}
                  className="w-full"
                >
                  Submit self-evaluation
                </Button>
              </>
            ) : review.selfEvaluationSubmitted ? (
              <p className="text-xs text-ink-500">
                Your self-evaluation has been submitted and can no longer be edited.
              </p>
            ) : null}
          </CardContent>
        </Card>

        {/* Manager evaluation section */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <UserCheck className="h-4 w-4 text-ink-400" />
              Manager evaluation
              {review.managerEvaluationSubmitted ? (
                <Badge className="border-transparent bg-ink-100 text-[10px] text-ink-600">
                  <Lock className="h-3 w-3" />
                  Immutable
                </Badge>
              ) : null}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-1.5">
              <Label className="flex items-center gap-1">
                Manager comments
                {canEditManager && <span className="text-danger-600">*</span>}
              </Label>
              <Textarea
                value={managerComments}
                onChange={(e) => {
                  setManagerEvalError('');
                  setManagerComments(e.target.value);
                }}
                disabled={review.managerEvaluationSubmitted || !canEditManager}
                placeholder="Overall assessment…"
                rows={5}
              />
            </div>
            {review.managerEvaluationSubmittedAt && (
              <p className="text-xs text-ink-400">
                Submitted {formatDate(review.managerEvaluationSubmittedAt)}
              </p>
            )}
            {canEditManager ? (
              <>
                <p className="text-xs text-ink-500">
                  Add your manager ratings in the “Competency ratings” table above, then click the
                  button below. Your submission is immutable and moves the review to the HR review
                  phase.
                </p>
                {managerEvalError && (
                  <div className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
                    <span className="mt-0.5">⚠</span>
                    <span>{managerEvalError}</span>
                  </div>
                )}
                <Button
                  onClick={() => {
                    if (!managerComments.trim()) {
                      setManagerEvalError('Manager comments are required before submitting.');
                      return;
                    }
                    setManagerEvalError('');
                    onSubmitManager(managerComments);
                  }}
                  className="w-full"
                >
                  Submit manager evaluation
                </Button>
              </>
            ) : review.managerEvaluationSubmitted ? (
              <p className="text-xs text-ink-500">
                The manager evaluation has been submitted and can no longer be edited.
              </p>
            ) : null}
          </CardContent>
        </Card>
      </div>

      {/* HR finalization */}
      <Card className="mt-6">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <TrendingUp className="h-4 w-4 text-ink-400" />
            HR final review
            {review.hrFinalized && (
              <Badge className="border-transparent bg-accent-100 text-[10px] text-accent-800">
                <Lock className="h-3 w-3" />
                Finalized
              </Badge>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {review.hrComments && (
            <div className="rounded-lg bg-ink-50 p-3 text-sm text-ink-700">
              <div className="mb-1 flex items-center gap-1.5 text-xs font-medium text-ink-500">
                <MessageSquare className="h-3 w-3" />
                HR comments
              </div>
              {review.hrComments}
            </div>
          )}
          {review.rebuttal && (
            <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
              <div className="mb-1 flex items-center gap-1.5 text-xs font-medium">
                <MessageSquare className="h-3 w-3" />
                Employee rebuttal
              </div>
              {review.rebuttal}
            </div>
          )}
          {canHrFinalize ? (
            <div className="space-y-3">
              <div className="space-y-1.5">
                <Label className="flex items-center gap-1">
                  HR comments
                  <span className="text-danger-600">*</span>
                </Label>
                <Textarea
                  value={hrComments}
                  onChange={(e) => {
                    setHrEvalError('');
                    setHrComments(e.target.value);
                  }}
                  placeholder="Final review comments…"
                  rows={3}
                />
              </div>
              {!showFinalize ? (
                <Button onClick={() => setShowFinalize(true)}>Finalize review</Button>
              ) : (
                <div className="space-y-3 rounded-lg border border-ink-200 p-4">
                  <Label>Select overall rating</Label>
                  <div className="flex gap-2">
                    {([1, 2, 3, 4, 5] as Rating[]).map((r) => (
                      <button
                        key={r}
                        onClick={() => setFinalizeOverall(r)}
                        className={cn(
                          'flex flex-1 flex-col items-center gap-1 rounded-lg border py-2 transition-all',
                          finalizeOverall === r
                            ? 'border-accent-500 bg-accent-50'
                            : 'border-ink-200 hover:border-ink-300',
                        )}
                      >
                        <div
                          className={cn(
                            'flex h-8 w-8 items-center justify-center rounded-full text-sm font-bold',
                            ratingColors[r],
                          )}
                        >
                          {r}
                        </div>
                        <span className="text-[9px] text-ink-500">
                          {ratingLabels[r].split(' ')[0]}
                        </span>
                      </button>
                    ))}
                  </div>
                  <p className="text-xs text-ink-500">{ratingLabels[finalizeOverall]}</p>
                  {hrEvalError && (
                    <div className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
                      <span className="mt-0.5">⚠</span>
                      <span>{hrEvalError}</span>
                    </div>
                  )}
                  <div className="flex gap-2">
                    <Button variant="outline" onClick={() => setShowFinalize(false)}>
                      Cancel
                    </Button>
                    <Button
                      onClick={() => {
                        if (!hrComments.trim()) {
                          setHrEvalError('HR comments are required before finalizing the review.');
                          return;
                        }
                        setHrEvalError('');
                        onHrFinalize(finalizeOverall, hrComments);
                      }}
                    >
                      Confirm finalization
                    </Button>
                  </div>
                </div>
              )}
            </div>
          ) : review.overallRating ? (
            <div className="flex items-center gap-3">
              <RatingPill rating={review.overallRating} />
              <span className="text-sm text-ink-600">{ratingLabels[review.overallRating]}</span>
              {review.hrFinalizedAt && (
                <span className="ml-auto text-xs text-ink-400">
                  Finalized {formatDate(review.hrFinalizedAt)}
                </span>
              )}
            </div>
          ) : null}
        </CardContent>
      </Card>

      {/* Rebuttal section — available to employee after finalization */}
      {review.hrFinalized && !review.rebuttal && (
        <Card className="mt-6">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <MessageSquare className="h-4 w-4 text-ink-400" />
              Employee rebuttal
            </CardTitle>
            <CardDescription>
              If you disagree with the evaluation, you can submit a rebuttal. This will be visible
              to HR and management.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <RebuttalSection reviewId={review.id} onSubmitRebuttal={onSubmitRebuttal} />
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function RebuttalSection({
  reviewId,
  onSubmitRebuttal,
}: {
  reviewId: string;
  onSubmitRebuttal: (reviewId: string, rebuttal: string) => void;
}) {
  const [rebuttalText, setRebuttalText] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async () => {
    if (!rebuttalText.trim() || isSubmitting) return;
    setIsSubmitting(true);
    try {
      await onSubmitRebuttal(reviewId, rebuttalText.trim());
      setRebuttalText('');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="space-y-3">
      <Textarea
        value={rebuttalText}
        onChange={(e) => setRebuttalText(e.target.value)}
        placeholder="Explain why you disagree with the evaluation…"
        rows={4}
        disabled={isSubmitting}
      />
      <Button
        onClick={handleSubmit}
        variant="outline"
        className="w-full"
        disabled={!rebuttalText.trim() || isSubmitting}
      >
        {isSubmitting ? 'Submitting…' : 'Submit rebuttal'}
      </Button>
    </div>
  );
}

function RatingDialog({
  open,
  onOpenChange,
  onPick,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onPick: (rating: Rating) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Select rating</DialogTitle>
          <DialogDescription>
            Choose a rating from 1 (below expectations) to 5 (outstanding).
          </DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-5 gap-2 py-2">
          {([1, 2, 3, 4, 5] as Rating[]).map((r) => (
            <button
              key={r}
              onClick={() => onPick(r)}
              className="flex flex-col items-center gap-2 rounded-lg border border-ink-200 p-3 transition-all hover:border-accent-400 hover:bg-accent-50"
            >
              <div
                className={cn(
                  'flex h-10 w-10 items-center justify-center rounded-full text-base font-bold',
                  ratingColors[r],
                )}
              >
                {r}
              </div>
              <span className="text-center text-[10px] leading-tight text-ink-500">
                {ratingLabels[r]}
              </span>
            </button>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function CreateCycleDialog({
  onClose,
  onCreated,
  onError,
  isSubmitting,
  setIsSubmitting,
}: {
  onClose: () => void;
  onCreated: () => void;
  onError: (msg: string) => void;
  isSubmitting: boolean;
  setIsSubmitting: (v: boolean) => void;
}) {
  const [type, setType] = useState<'PROBATION' | 'MID_YEAR' | 'END_YEAR'>('MID_YEAR');
  const [periodStart, setPeriodStart] = useState('');
  const [periodEnd, setPeriodEnd] = useState('');
  const [selfEvalStart, setSelfEvalStart] = useState('');
  const [selfEvalEnd, setSelfEvalEnd] = useState('');
  const [managerEvalStart, setManagerEvalStart] = useState('');
  const [managerEvalEnd, setManagerEvalEnd] = useState('');
  const [hrReviewStart, setHrReviewStart] = useState('');
  const [hrReviewEnd, setHrReviewEnd] = useState('');
  const [validationError, setValidationError] = useState('');
  const [probationEligible, setProbationEligible] = useState<
    Array<{ id: string; firstName: string; lastName: string; email: string; probationEnd: string }>
  >([]);

  useEffect(() => {
    let cancelled = false;
    if (type === 'PROBATION') {
      performanceRepo
        .listProbationEligible()
        .then((list) => {
          if (!cancelled) setProbationEligible(list);
        })
        .catch(() => {
          if (!cancelled) setProbationEligible([]);
        });
    } else {
      queueMicrotask(() => {
        if (!cancelled) setProbationEligible([]);
      });
    }
    return () => {
      cancelled = true;
    };
  }, [type]);

  const parseDate = (value: string) => new Date(value).getTime();

  const validateDates = (): string => {
    if (
      !periodStart ||
      !periodEnd ||
      !selfEvalStart ||
      !selfEvalEnd ||
      !managerEvalStart ||
      !managerEvalEnd ||
      !hrReviewStart ||
      !hrReviewEnd
    ) {
      return 'All date fields are required';
    }
    const pStart = parseDate(periodStart);
    const pEnd = parseDate(periodEnd);
    const sStart = parseDate(selfEvalStart);
    const sEnd = parseDate(selfEvalEnd);
    const mStart = parseDate(managerEvalStart);
    const mEnd = parseDate(managerEvalEnd);
    const hStart = parseDate(hrReviewStart);
    const hEnd = parseDate(hrReviewEnd);

    if (pStart >= pEnd) return 'Period start must be before period end';
    if (sStart >= sEnd) return 'Self-evaluation start must be before end';
    if (mStart >= mEnd) return 'Manager evaluation start must be before end';
    if (hStart >= hEnd) return 'HR review start must be before end';
    if (sStart < pStart) return 'Self-evaluation phase must start within the evaluation period';
    if (sEnd > mStart)
      return 'Self-evaluation phase must end before manager evaluation phase starts';
    if (mEnd > hStart) return 'Manager evaluation phase must end before HR review phase starts';
    if (hEnd > pEnd) return 'HR review phase must end within the evaluation period';
    return '';
  };

  const handleCreate = async () => {
    const error = validateDates();
    if (error) {
      setValidationError(error);
      return;
    }
    setValidationError('');
    setIsSubmitting(true);
    try {
      await performanceRepo.createCycle({
        type,
        periodStart: new Date(periodStart).toISOString(),
        periodEnd: new Date(periodEnd).toISOString(),
        selfEvalStart: new Date(selfEvalStart).toISOString(),
        selfEvalEnd: new Date(selfEvalEnd).toISOString(),
        managerEvalStart: new Date(managerEvalStart).toISOString(),
        managerEvalEnd: new Date(managerEvalEnd).toISOString(),
        hrReviewStart: new Date(hrReviewStart).toISOString(),
        hrReviewEnd: new Date(hrReviewEnd).toISOString(),
      });
      onCreated();
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Failed to create cycle');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Dialog open={true} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>Create evaluation cycle</DialogTitle>
          <DialogDescription>
            Configure the evaluation cycle details and phase dates.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="space-y-1.5">
            <Label>Cycle type</Label>
            <select
              value={type}
              onChange={(e) => setType(e.target.value as typeof type)}
              className="w-full rounded-lg border border-ink-200 bg-white px-3 py-2 text-sm"
            >
              <option value="PROBATION">Probation</option>
              <option value="MID_YEAR">Mid-Year</option>
              <option value="END_YEAR">End-Year</option>
            </select>
          </div>
          {type === 'PROBATION' && (
            <div className="rounded-lg border border-accent-200 bg-accent-50 p-3 text-sm">
              <p className="mb-1 flex items-center gap-1.5 font-medium text-accent-800">
                <CalendarRange className="h-3.5 w-3.5" />
                Probation cycle participants
              </p>
              {probationEligible.length === 0 ? (
                <p className="text-xs text-ink-600">
                  No employees currently on probation are ending their probation period within the
                  configured window. This cycle will enroll eligible on-probation employees whose
                  probation ends on or before the evaluation period.
                </p>
              ) : (
                <ul className="space-y-1 text-xs text-ink-700">
                  {probationEligible.map((emp) => (
                    <li key={emp.id} className="flex items-center justify-between">
                      <span>
                        {emp.firstName} {emp.lastName} ({emp.email})
                      </span>
                      <span className="text-ink-400">Ends {formatDate(emp.probationEnd)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label>Period start</Label>
              <input
                type="date"
                value={periodStart}
                onChange={(e) => {
                  setValidationError('');
                  setPeriodStart(e.target.value);
                }}
                className="w-full rounded-lg border border-ink-200 bg-white px-3 py-2 text-sm"
              />
            </div>
            <div className="space-y-1.5">
              <Label>Period end</Label>
              <input
                type="date"
                value={periodEnd}
                onChange={(e) => {
                  setValidationError('');
                  setPeriodEnd(e.target.value);
                }}
                className="w-full rounded-lg border border-ink-200 bg-white px-3 py-2 text-sm"
              />
            </div>
          </div>
          <div className="border-t border-ink-100 pt-3">
            <p className="mb-2 text-xs font-medium text-ink-500">Phase dates</p>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label>Self-evaluation start</Label>
                <input
                  type="date"
                  value={selfEvalStart}
                  onChange={(e) => {
                    setValidationError('');
                    setSelfEvalStart(e.target.value);
                  }}
                  className="w-full rounded-lg border border-ink-200 bg-white px-3 py-2 text-sm"
                />
              </div>
              <div className="space-y-1.5">
                <Label>Self-evaluation end</Label>
                <input
                  type="date"
                  value={selfEvalEnd}
                  onChange={(e) => {
                    setValidationError('');
                    setSelfEvalEnd(e.target.value);
                  }}
                  className="w-full rounded-lg border border-ink-200 bg-white px-3 py-2 text-sm"
                />
              </div>
              <div className="space-y-1.5">
                <Label>Manager eval start</Label>
                <input
                  type="date"
                  value={managerEvalStart}
                  onChange={(e) => {
                    setValidationError('');
                    setManagerEvalStart(e.target.value);
                  }}
                  className="w-full rounded-lg border border-ink-200 bg-white px-3 py-2 text-sm"
                />
              </div>
              <div className="space-y-1.5">
                <Label>Manager eval end</Label>
                <input
                  type="date"
                  value={managerEvalEnd}
                  onChange={(e) => {
                    setValidationError('');
                    setManagerEvalEnd(e.target.value);
                  }}
                  className="w-full rounded-lg border border-ink-200 bg-white px-3 py-2 text-sm"
                />
              </div>
              <div className="space-y-1.5">
                <Label>HR review start</Label>
                <input
                  type="date"
                  value={hrReviewStart}
                  onChange={(e) => {
                    setValidationError('');
                    setHrReviewStart(e.target.value);
                  }}
                  className="w-full rounded-lg border border-ink-200 bg-white px-3 py-2 text-sm"
                />
              </div>
              <div className="space-y-1.5">
                <Label>HR review end</Label>
                <input
                  type="date"
                  value={hrReviewEnd}
                  onChange={(e) => {
                    setValidationError('');
                    setHrReviewEnd(e.target.value);
                  }}
                  className="w-full rounded-lg border border-ink-200 bg-white px-3 py-2 text-sm"
                />
              </div>
            </div>
          </div>
        </div>
        {validationError && (
          <div className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
            <span className="mt-0.5">⚠</span>
            <span>{validationError}</span>
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={isSubmitting}>
            Cancel
          </Button>
          <Button onClick={handleCreate} disabled={isSubmitting}>
            {isSubmitting ? 'Creating…' : 'Create cycle'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
