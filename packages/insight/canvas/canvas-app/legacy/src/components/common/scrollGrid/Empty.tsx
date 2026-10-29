import React from 'react';

interface EmptyProps {
  data?: any[]; // 传入的数据数组
  message?: string; // 自定义显示的消息，默认为"暂无数据"
}

const Empty: React.FC<EmptyProps> = ({ data = [], message = '暂无数据' }) => {
  // 如果数据数组为空，则显示"暂无数据"提示
  if (!data || data.length === 0) {
    return <div className='w-full h-full flex items-center justify-center text-sm text-white/65'>{message}</div>;
  }

  // 如果数据不为空，则不显示任何内容
  return null;
};

export default Empty;
