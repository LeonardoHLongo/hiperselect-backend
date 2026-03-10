import type { ICompanyRepository } from './repository';
import type { CompanyContext } from './types';

export class CompanyService {
  constructor(private repository: ICompanyRepository) {}

  async getContext(): Promise<CompanyContext | null> {
    const result = this.repository.getContext();
    return result instanceof Promise ? await result : result;
  }

  async updateContext(context: CompanyContext): Promise<void> {
    const result = this.repository.updateContext(context);
    if (result instanceof Promise) {
      await result;
    }
  }

  hasRequiredContext(): boolean {
    const context = this.repository.getContext();
    if (!context) {
      return false;
    }

    return !!(
      context.businessName &&
      context.address &&
      context.openingHours &&
      context.deliveryPolicy &&
      context.paymentMethods
    );
  }
}

