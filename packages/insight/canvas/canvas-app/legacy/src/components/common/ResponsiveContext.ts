import { createContext, useContext } from 'react';

export const ResponsiveContext = createContext<{ isMobile: boolean }>({ isMobile: false });

export const useResponsive = () => useContext(ResponsiveContext);
