import type { CompanyContext } from './types';

export interface ICompanyRepository {
  getContext(): CompanyContext | null;
  updateContext(context: CompanyContext): void;
}

class InMemoryCompanyRepository implements ICompanyRepository {
  private context: CompanyContext | null = null;

  getContext(): CompanyContext | null {
    return this.context;
  }

  updateContext(context: CompanyContext): void {
    this.context = { ...context };
  }
}

export const createCompanyRepository = (): ICompanyRepository => {
  return new InMemoryCompanyRepository();
};

