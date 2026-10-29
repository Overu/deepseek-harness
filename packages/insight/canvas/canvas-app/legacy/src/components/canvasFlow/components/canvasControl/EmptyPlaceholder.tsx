import React from 'react';

interface EmptyPlaceholderProps {
  show: boolean;
}

const EmptyPlaceholder: React.FC<EmptyPlaceholderProps> = ({ show }) => {
  if (!show) return null;

  return (
    <div className='absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 bg-[#141414] border border-[#595959] rounded-lg p-3 text-center text-white text-sm'>
      双击空白处或点击左侧栏添加新节点
    </div>
  );
};

export default EmptyPlaceholder;
