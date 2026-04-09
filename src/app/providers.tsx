'use client';

import { type ReactNode } from 'react';
import { DemoProvider } from '@enterpriseaigroup/demo';
import type { EAIConfig } from '@enterpriseaigroup/core';

interface ProvidersProps {
  children: ReactNode;
  tenants: Record<string, EAIConfig>;
}

export function Providers({ children, tenants }: ProvidersProps) {
  return (
    <DemoProvider tenants={tenants}>
      {children}
    </DemoProvider>
  );
}
