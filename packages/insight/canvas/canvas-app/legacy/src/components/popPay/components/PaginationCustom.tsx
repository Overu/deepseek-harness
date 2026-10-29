// src/components/PaginationCustom.tsx
import { PaginationItem, PaginationLink, PaginationPrevious, PaginationNext, PaginationEllipsis } from '@/components/ui/pagination';
import React from 'react';

// 定义组件属性类型
interface PaginationCustomProps {
  currentPage: number; // 当前页
  totalPages: number; // 总页数
  onPageChange: (page: number) => void; // 页码变更回调
}

// 抽离后的分页组件
const PaginationCustom: React.FC<PaginationCustomProps> = ({ currentPage, totalPages, onPageChange }) => {
  // 生成分页页码列表（原 generatePaginationItems 核心逻辑）
  const generatePaginationItems = () => {
    const items = [];
    const current = currentPage;
    const total = totalPages;

    // 上一页
    items.push(
      <PaginationItem key='prev' onClick={() => onPageChange(current - 1)} className={current === 1 ? 'pointer-events-none opacity-50' : ''}>
        <PaginationPrevious className='hover:bg-white/10 w-9 h-9' href='#' />
      </PaginationItem>
    );

    // 页码逻辑
    if (total <= 5) {
      // 总页数 ≤ 5：显示所有页码
      for (let i = 1; i <= total; i++) {
        items.push(
          <PaginationItem key={i} className={current === i ? 'active bg-white/5 border border-white/15 rounded-lg' : ''}>
            <PaginationLink
              href='#'
              className='hover:bg-white/10 w-9 h-9'
              onClick={e => {
                e.preventDefault();
                onPageChange(i);
              }}
            >
              {i}
            </PaginationLink>
          </PaginationItem>
        );
      }
    } else {
      // 总页数 > 5：显示「首页 + 当前页前后1页 + 尾页」+ 省略号
      // 首页
      items.push(
        <PaginationItem key={1} className={current === 1 ? 'active bg-white/5 border border-white/15 rounded-lg' : ''}>
          <PaginationLink
            href='#'
            className='hover:bg-white/10 w-9 h-9'
            onClick={e => {
              e.preventDefault();
              onPageChange(1);
            }}
          >
            1
          </PaginationLink>
        </PaginationItem>
      );

      // 左侧省略号
      if (current > 3) {
        items.push(
          <PaginationItem key='ellipsis-left'>
            <PaginationEllipsis />
          </PaginationItem>
        );
      }

      // 中间页码
      const start = Math.max(2, current - 1);
      const end = Math.min(total - 1, current + 1);
      for (let i = start; i <= end; i++) {
        items.push(
          <PaginationItem key={i} className={current === i ? 'active bg-white/5 border border-white/15 rounded-lg' : ''}>
            <PaginationLink
              href='#'
              className='hover:bg-white/10 w-9 h-9'
              onClick={e => {
                e.preventDefault();
                onPageChange(i);
              }}
            >
              {i}
            </PaginationLink>
          </PaginationItem>
        );
      }

      // 右侧省略号
      if (current < total - 2) {
        items.push(
          <PaginationItem key='ellipsis-right'>
            <PaginationEllipsis />
          </PaginationItem>
        );
      }

      // 尾页
      items.push(
        <PaginationItem key={total} className={current === total ? 'active bg-white/5 border border-white/15 rounded-lg' : ''}>
          <PaginationLink
            href='#'
            className='hover:bg-white/10 w-9 h-9'
            onClick={e => {
              e.preventDefault();
              onPageChange(total);
            }}
          >
            {total}
          </PaginationLink>
        </PaginationItem>
      );
    }

    // 下一页
    items.push(
      <PaginationItem key='next' onClick={() => onPageChange(current + 1)} className={current === totalPages ? 'pointer-events-none opacity-50' : ''}>
        <PaginationNext className='hover:bg-white/10 w-9 h-9' href='#' />
      </PaginationItem>
    );

    return items;
  };

  return (
    <div className='flex items-center justify-between w-full'>
      <div className='text-sm text-white'>
        第 {currentPage} 页，共 {totalPages} 页
      </div>
      <div className='flex items-center space-x-1'>{generatePaginationItems()}</div>
    </div>
  );
};

export default PaginationCustom;
