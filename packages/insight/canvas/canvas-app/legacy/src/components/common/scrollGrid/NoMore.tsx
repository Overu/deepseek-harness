import type { ReactNode } from 'react';
interface NoMoreProps {
  show: boolean;
  text: string;
  children?: ReactNode;
}

const NoMore = ({ show, children, text }: NoMoreProps) => {
  if (!show) return null;

  return <div className='col-span-full text-center text-white/65 py-4 text-sm'>{children || text}</div>;
};

export default NoMore;
