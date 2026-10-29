import { type ReactNode } from 'react';
import { useBreakpoint } from '@/hooks/useBreakpoint';
import { ResponsiveContext } from './ResponsiveContext';

interface ResponsiveViewProps {
  children?: ReactNode;
  mobileWrapper: (children: ReactNode) => ReactNode;
  pcWrapper: (children: ReactNode) => ReactNode;
  breakpoint?: number;
}

export function ResponsiveView({ children, mobileWrapper, pcWrapper, breakpoint = 768 }: ResponsiveViewProps) {
  const isMobile = useBreakpoint(breakpoint);

  return <ResponsiveContext.Provider value={{ isMobile }}>{isMobile ? mobileWrapper(children) : pcWrapper(children)}</ResponsiveContext.Provider>;
}
