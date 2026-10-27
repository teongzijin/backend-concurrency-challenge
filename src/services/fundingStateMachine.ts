import { FundingStatus } from '../db/models/fundingTransaction';
import { AppError } from '../lib/errors';

const TRANSITIONS: Record<FundingStatus, readonly FundingStatus[]> = {
  pending: ['completed', 'failed'],
  completed: [],
  failed: [],
};

export function assertTransition(from: FundingStatus, to: FundingStatus): void {
  if (!TRANSITIONS[from].includes(to)) {
    throw new AppError(409, 'invalid_transition', `Cannot move funding transaction from ${from} to ${to}`);
  }
}