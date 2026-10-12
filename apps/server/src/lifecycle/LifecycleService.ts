import type { MailMessage } from '../mail/mailer';
import type { MailOutbox } from '../mail/outbox';
import type { LifecycleRepository } from '../repos/LifecycleRepository';
import {
  dueStep,
  isBusinessHours,
  type Phase,
  phaseOf,
  startOfDaySaoPaulo,
  type Variant,
} from './schedule';

export interface LifecycleMailInput {
  phase: Phase;
  step: 1 | 2;
  variant: Variant;
  name: string;
  accountId: string;
  unsubscribeUrl: string;
}

export class LifecycleService {
  constructor(
    private readonly deps: {
      repo: LifecycleRepository;
      outbox: MailOutbox;
      startAt: Date | null;
      render: (input: LifecycleMailInput) => Omit<MailMessage, 'to'>;
      unsubscribeUrl: (userId: string) => string;
    },
  ) {}

  // Queues the e-mails that are due now; returns how many.
  async runDue(now: Date): Promise<number> {
    const { repo, outbox, startAt } = this.deps;
    if (!startAt || now < startAt || !isBusinessHours(now)) return 0;
    const today = startOfDaySaoPaulo(now);
    const sentNow = new Set<string>();
    let queued = 0;
    for (const c of repo.candidates()) {
      if (sentNow.has(c.userId) || repo.sentSince(c.userId, today)) continue;
      const found = phaseOf(c);
      if (!found) continue;
      const step = dueStep(found.phase, found.anchor, now);
      if (!step) continue;
      const mail = this.deps.render({
        phase: found.phase,
        step,
        variant: found.variant,
        name: c.name,
        accountId: c.accountId,
        unsubscribeUrl: this.deps.unsubscribeUrl(c.userId),
      });
      const send = {
        userId: c.userId,
        accountId: c.accountId,
        phase: found.phase,
        step,
        variant: found.variant,
        anchorAt: found.anchor,
      };
      if (repo.recordAndQueue(send, { ...mail, to: c.email }, outbox, now)) {
        sentNow.add(c.userId);
        queued += 1;
      }
    }
    return queued;
  }
}
