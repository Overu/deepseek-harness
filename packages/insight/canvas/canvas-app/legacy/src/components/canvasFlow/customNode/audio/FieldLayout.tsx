import type { ReactNode } from 'react';

interface FieldLayoutProps {
  id?: string;
  label: ReactNode;
  required?: boolean;
  extra?: ReactNode;
  children: ReactNode;
}

export const FieldLayout = ({ id, label, required = false, extra, children }: FieldLayoutProps) => {
  return (
    <div className='space-y-2'>
      <div className='flex items-center justify-between text-sm'>
        <label htmlFor={id}>
          {required && <span className='mr-1 text-red-400'>*</span>}
          {label}
        </label>
        {extra}
      </div>
      {children}
    </div>
  );
};

export default FieldLayout;
