import React, { useState, useEffect, useMemo } from 'react';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger, DropdownMenuPortal } from '@/components/ui/dropdown-menu';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger, SheetFooter } from '@/components/ui/sheet';
import { Checkbox } from '@/components/ui/checkbox';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Calendar } from '@/components/ui/calendar';
import { Button } from '@/components/ui/button';
import { format } from 'date-fns';
import { zhCN } from 'date-fns/locale';
import { CalendarClock, Search, ChevronDown, ArrowDownWideNarrow, ArrowUpNarrowWide, X, CalendarIcon, Layers, Check, Filter, LayoutGrid } from 'lucide-react';
import { ASSET_SOURCE, AUDIO_CONTENT_CATEGORY, type AssetType, type AudioContentCategory, type SourceFilter } from '../types';
import { typeMap } from '../util';
import { useAssetLibraryContext } from '../contexts/AssetLibraryContext';
import { IconButton } from './IconButton';

export type AssetFilterBarVariant = 'dialog' | 'page';

export interface AssetFilterBarProps {
  /** 控制主 Tab、筛选项文字等样式：dialog 紧凑，page 为大标题 */
  variant: AssetFilterBarVariant;
  /** 仅 page 使用：为 true 时隐藏「批量操作」按钮 */
  readOnly?: boolean;
}

const ASSET_TYPES: AssetType[] = ['image', 'video', 'audio', 'collection'];

const SOURCE_OPTIONS: { label: string; value: SourceFilter }[] = [
  { label: '全部', value: 'all' },
  { label: '上传资产', value: ASSET_SOURCE.UPLOAD },
  { label: '生成资产', value: ASSET_SOURCE.AIGC },
];

const AUDIO_CATEGORY_OPTIONS: { label: string; value: AudioContentCategory }[] = [
  { label: '全部', value: 'all' },
  { label: '语音', value: AUDIO_CONTENT_CATEGORY.TTS },
  { label: '音乐', value: AUDIO_CONTENT_CATEGORY.MUSIC },
];

export const AssetFilterBar: React.FC<AssetFilterBarProps> = ({ variant, readOnly = false }) => {
  const {
    primaryTab,
    secondaryTab,
    searchQuery,
    sortOrder,
    isFavoriteFilter,
    cascadeSelections,
    cascadeFilters,
    date,
    isBatchMode,
    sourceFilter,
    contentCategoryFilter,
    isCurrentCanvasFilter,
    viewMode,
    hideCanvasFilter,
    canvasId,
    setSearchQuery,
    setSortOrder,
    setIsFavoriteFilter,
    setDate,
    handlePrimaryTabChange,
    handleSecondaryTabChange,
    handleCascadeSelect,
    setIsBatchMode,
    exitBatchMode,
    filterTree,
    handleSourceFilterChange,
    setContentCategoryFilter,
    setIsCurrentCanvasFilter,
    setViewMode,
  } = useAssetLibraryContext();

  const [isSheetOpen, setIsSheetOpen] = useState(false);
  const [tempIsFavorite, setTempIsFavorite] = useState(isFavoriteFilter);
  const [tempIsCurrentCanvas, setTempIsCurrentCanvas] = useState(isCurrentCanvasFilter);
  const [tempSource, setTempSource] = useState<SourceFilter>(sourceFilter);
  const [tempAudioCategory, setTempAudioCategory] = useState<AudioContentCategory>(contentCategoryFilter);
  const [tempCascadeSelections, setTempCascadeSelections] = useState<Record<number, number | null>>({});

  useEffect(() => {
    if (isSheetOpen) {
      setTempIsFavorite(isFavoriteFilter);
      setTempIsCurrentCanvas(isCurrentCanvasFilter);
      setTempSource(sourceFilter);
      setTempAudioCategory(contentCategoryFilter);
      const record: Record<number, number | null> = {};
      cascadeSelections.forEach((val, idx) => {
        if (val != null) record[idx] = val;
      });
      setTempCascadeSelections(record);
    }
  }, [isSheetOpen, isFavoriteFilter, isCurrentCanvasFilter, sourceFilter, contentCategoryFilter, cascadeSelections]);

  const tempCascadeFilters = useMemo(() => {
    const tabLabel = typeMap[secondaryTab];
    const tabNode = filterTree?.find((n: any) => n.label === tabLabel);
    if (!tabNode) return [];

    const result: { type: string; options: any[]; level: number }[] = [];
    let currentNode: any = tabNode;
    let level = 0;
    while (currentNode?.type && currentNode?.children?.length) {
      result.push({ type: currentNode.type, options: currentNode.children, level });
      const selectedId = tempCascadeSelections[level] ?? null;
      if (selectedId == null) break;
      currentNode = currentNode.children.find((c: any) => c.id === selectedId);
      level++;
    }
    return result;
  }, [secondaryTab, filterTree, tempCascadeSelections]);

  const applySheetFilters = () => {
    setIsFavoriteFilter(tempIsFavorite);
    setIsCurrentCanvasFilter(tempIsCurrentCanvas);
    handleSourceFilterChange(tempSource);
    if (tempSource === ASSET_SOURCE.AIGC) {
      setContentCategoryFilter(tempAudioCategory);
    } else {
      setContentCategoryFilter('all');
    }
    tempCascadeFilters.forEach(f => {
      const selectedId = tempCascadeSelections[f.level] ?? null;
      handleCascadeSelect(f.level, selectedId);
    });
    setIsSheetOpen(false);
  };

  const isDialog = variant === 'dialog';
  const primaryTabSizeClass = isDialog ? 'text-base' : 'text-2xl';
  const showBatchButton = isDialog || !readOnly;

  const currentSourceLabel = SOURCE_OPTIONS.find(o => o.value === sourceFilter)?.label ?? '全部';
  const currentAudioCategoryLabel = AUDIO_CATEGORY_OPTIONS.find(o => o.value === contentCategoryFilter)?.label ?? '全部';

  const showSourceFilter = primaryTab === 'my' && secondaryTab !== 'collection';
  const showAudioCategoryFilter = showSourceFilter && secondaryTab === 'audio' && sourceFilter === ASSET_SOURCE.AIGC;
  const showCurrentCanvasFilter = !hideCanvasFilter && primaryTab === 'my' && secondaryTab !== 'collection' && canvasId != null;

  return (
    <>
      {/* 公共资产 / 我的资产 */}
      <div className='flex gap-6 mb-4 shrink-0 items-center'>
        <button
          onClick={() => handlePrimaryTabChange('my')}
          className={`${primaryTabSizeClass} font-medium transition-colors ${primaryTab === 'my' ? 'text-white/95' : 'text-white/65 hover:text-white/95'}`}
        >
          我的资产
        </button>
        <button
          onClick={() => handlePrimaryTabChange('public')}
          className={`${primaryTabSizeClass} font-medium transition-colors ${primaryTab === 'public' ? 'text-white/95' : 'text-white/65 hover:text-white/95'}`}
        >
          公共资产
        </button>
      </div>

      {/* 类型 Tab + 搜索 */}
      <div className='flex mb-4 justify-between items-center shrink-0 mobile:flex-col-reverse mobile:items-start gap-3'>
        <div className='flex gap-2 mobile:w-full overflow-auto no-scrollbar'>
          {ASSET_TYPES.map(type => (
            <button
              key={type}
              onClick={() => handleSecondaryTabChange(type)}
              className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors text-nowrap ${
                secondaryTab === type ? 'bg-white/10 text-white border border-white/20' : 'bg-transparent hover:text-white hover:bg-white/5 text-white/60'
              }`}
            >
              {typeMap[type]}
            </button>
          ))}
        </div>
        <div className='relative w-72 mobile:w-full'>
          <Search className='absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-white/40' />
          <input
            type='text'
            placeholder='输入名称搜索'
            className='w-full bg-[#1A1A1A] border-none rounded-lg py-2 pl-10 pr-4 text-sm focus:ring-1 focus:ring-white/20 outline-none'
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
          />
        </div>
      </div>

      {/* 筛选 + 日期 + 收藏 + 本画布 + 视图模式/排序 */}
      <div className='flex items-center justify-between mb-4 shrink-0'>
        <div className='flex items-center gap-2'>
          <div className='flex items-center gap-2 mobile:hidden'>
            {/* 公共资产级联筛选 */}
            {primaryTab === 'public' &&
              cascadeFilters.map(filter => {
                const selectedId = cascadeSelections[filter.level] ?? null;
                const selectedLabel = selectedId != null ? (filter.options.find(o => o.id === selectedId)?.label ?? '全部') : '全部';
                return (
                  <div key={`cascade-${filter.level}`} className='flex items-center gap-1.5'>
                    <span className='text-sm text-white/60'>{filter.type}:</span>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <div className='flex items-center justify-between gap-2 px-3 h-9 rounded-md cursor-pointer min-w-[90px] outline-none hover:bg-white/10 data-[state=open]:bg-white/10 transition-colors'>
                          <span className='text-sm'>{selectedLabel}</span>
                          <ChevronDown className='w-4 h-4 opacity-40' />
                        </div>
                      </DropdownMenuTrigger>
                      <DropdownMenuPortal>
                        <DropdownMenuContent className='w-40 bg-[#1A1A1A] border border-white/10 rounded-lg shadow-2xl z-[50] p-1 animate-in fade-in zoom-in-95' align='start'>
                          <DropdownMenuItem
                            onSelect={() => handleCascadeSelect(filter.level, null)}
                            className='px-3 py-2 hover:bg-white/5 outline-none rounded-md text-sm cursor-pointer flex items-center justify-between data-[highlighted]:bg-white/5'
                          >
                            <span className={selectedId == null ? 'text-blue-400' : ''}>全部</span>
                            {selectedId == null && <Check className='w-3.5 h-3.5 text-blue-400' />}
                          </DropdownMenuItem>
                          {filter.options.map(opt => (
                            <DropdownMenuItem
                              key={opt.id}
                              onSelect={() => handleCascadeSelect(filter.level, opt.id)}
                              className='px-3 py-2 hover:bg-white/5 outline-none rounded-md text-sm cursor-pointer flex items-center justify-between data-[highlighted]:bg-white/5'
                            >
                              <span className={selectedId === opt.id ? 'text-blue-400' : ''}>{opt.label}</span>
                              {selectedId === opt.id && <Check className='w-3.5 h-3.5 text-blue-400' />}
                            </DropdownMenuItem>
                          ))}
                        </DropdownMenuContent>
                      </DropdownMenuPortal>
                    </DropdownMenu>
                  </div>
                );
              })}

            {/* 我的资产：来源筛选 */}
            {showSourceFilter && (
              <div className='flex items-center gap-1.5'>
                <span className='text-sm text-white/60'>来源:</span>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <div className='flex items-center justify-between gap-1.5 px-3 h-9 rounded-md cursor-pointer min-w-[90px] outline-none hover:bg-white/10 data-[state=open]:bg-white/10 transition-colors'>
                      <span className='text-sm text-white/90'>{currentSourceLabel}</span>
                      <ChevronDown className='w-4 h-4 opacity-40' />
                    </div>
                  </DropdownMenuTrigger>
                  <DropdownMenuPortal>
                    <DropdownMenuContent className='w-36 bg-[#1A1A1A] border border-white/10 rounded-lg shadow-2xl z-[50] p-1 animate-in fade-in zoom-in-95' align='start'>
                      {SOURCE_OPTIONS.map(opt => (
                        <DropdownMenuItem
                          key={opt.value}
                          onSelect={() => handleSourceFilterChange(opt.value)}
                          className='px-3 py-2 hover:bg-white/5 outline-none rounded-md text-sm cursor-pointer flex items-center justify-between data-[highlighted]:bg-white/5'
                        >
                          <span className={sourceFilter === opt.value ? 'text-blue-400' : ''}>{opt.label}</span>
                          {sourceFilter === opt.value && <Check className='w-3.5 h-3.5 text-blue-400' />}
                        </DropdownMenuItem>
                      ))}
                    </DropdownMenuContent>
                  </DropdownMenuPortal>
                </DropdownMenu>
              </div>
            )}

            {/* 我的资产：音频类型筛选（仅音频+生成资产） */}
            {showAudioCategoryFilter && (
              <div className='flex items-center gap-1.5'>
                <span className='text-sm text-white/60'>音频类型:</span>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <div className='flex items-center justify-between gap-1.5 px-3 h-9 rounded-md cursor-pointer min-w-[80px] outline-none hover:bg-white/10 data-[state=open]:bg-white/10 transition-colors'>
                      <span className='text-sm text-white/90'>{currentAudioCategoryLabel}</span>
                      <ChevronDown className='w-4 h-4 opacity-40' />
                    </div>
                  </DropdownMenuTrigger>
                  <DropdownMenuPortal>
                    <DropdownMenuContent className='w-32 bg-[#1A1A1A] border border-white/10 rounded-lg shadow-2xl z-[50] p-1 animate-in fade-in zoom-in-95' align='start'>
                      {AUDIO_CATEGORY_OPTIONS.map(opt => (
                        <DropdownMenuItem
                          key={opt.value}
                          onSelect={() => setContentCategoryFilter(opt.value)}
                          className='px-3 py-2 hover:bg-white/5 outline-none rounded-md text-sm cursor-pointer flex items-center justify-between data-[highlighted]:bg-white/5'
                        >
                          <span className={contentCategoryFilter === opt.value ? 'text-blue-400' : ''}>{opt.label}</span>
                          {contentCategoryFilter === opt.value && <Check className='w-3.5 h-3.5 text-blue-400' />}
                        </DropdownMenuItem>
                      ))}
                    </DropdownMenuContent>
                  </DropdownMenuPortal>
                </DropdownMenu>
              </div>
            )}

            {(primaryTab === 'public' ? cascadeFilters.length > 0 : showSourceFilter) && <div className='h-4 w-[1px] bg-white/10 mx-1' />}
          </div>

          <Popover>
            <PopoverTrigger asChild>
              <Button
                variant='outline'
                id={isDialog ? undefined : 'date-picker-range'}
                className={`justify-start h-9 px-3 py-1.5 font-normal gap-2 bg-transparent border-none rounded-md hover:bg-white/10 transition-colors data-[state=open]:bg-white/10 ${!isDialog ? 'relative' : ''}`}
              >
                <CalendarIcon className='w-4 h-4 shrink-0' />
                <span className='min-w-0 flex-1 truncate text-left'>
                  {date?.from ? (
                    date.to ? (
                      <>
                        {format(date.from, 'yyyy.MM.dd')} - {format(date.to, 'yyyy.MM.dd')}
                      </>
                    ) : (
                      format(date.from, 'yyyy.MM.dd')
                    )
                  ) : (
                    <span>日期筛选</span>
                  )}
                </span>
                {date?.from && (
                  <span
                    role='button'
                    tabIndex={0}
                    className='shrink-0 p-0.5 rounded-sm opacity-60 hover:opacity-100 hover:bg-white/10 transition-colors cursor-pointer'
                    onClick={e => {
                      e.preventDefault();
                      e.stopPropagation();
                      setDate(undefined);
                    }}
                  >
                    <X size={16} />
                  </span>
                )}
              </Button>
            </PopoverTrigger>
            <PopoverContent className='w-auto p-0' align='start'>
              <Calendar mode='range' defaultMonth={date?.from} selected={date} onSelect={setDate} numberOfMonths={2} locale={zhCN} />
            </PopoverContent>
          </Popover>

          <div className='h-4 w-[1px] bg-white/10 mx-1 mobile:hidden' />

          <label className='flex items-center gap-2 cursor-pointer group mobile:hidden ml-2'>
            <Checkbox
              checked={isFavoriteFilter}
              onCheckedChange={checked => setIsFavoriteFilter(checked === true)}
              className='w-4 h-4 rounded-full border border-white/20 data-[state=checked]:bg-blue-600 data-[state=checked]:border-blue-600 transition-all flex items-center justify-center group-hover:border-white/40 outline-none'
            />
            <span className='text-sm group-hover:text-white transition-colors text-white/60'>收藏</span>
          </label>

          {showCurrentCanvasFilter && (
            <label className='flex items-center gap-2 cursor-pointer group mobile:hidden ml-2'>
              <Checkbox
                checked={isCurrentCanvasFilter}
                onCheckedChange={checked => setIsCurrentCanvasFilter(checked === true)}
                className='w-4 h-4 rounded-full border border-white/20 data-[state=checked]:bg-blue-600 data-[state=checked]:border-blue-600 transition-all flex items-center justify-center group-hover:border-white/40 outline-none'
              />
              <span className='text-sm group-hover:text-white transition-colors text-white/60'>当前画布</span>
            </label>
          )}
        </div>

        <div className='flex items-center gap-2'>
          {showBatchButton && (
            <IconButton
              onClick={() => (isBatchMode ? exitBatchMode() : setIsBatchMode(true))}
              className={`h-9 px-3 rounded-lg text-sm font-medium transition-colors ${isBatchMode ? 'bg-white/10' : 'hover:bg-white/10'}`}
              icon={isBatchMode ? <X className='w-4 h-4' /> : <Layers className='w-4 h-4' />}
              label={isBatchMode ? '退出批量' : '批量操作'}
            />
          )}

          {/* 排序方式切换：平铺 / 时序 */}
          {secondaryTab !== 'collection' && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <IconButton
                  onClick={() => setSortOrder(o => (o === 'desc' ? 'asc' : 'desc'))}
                  className='h-9 px-3 rounded-lg text-sm hover:bg-white/10 transition-colors'
                  icon={viewMode === 'timeline' ? <CalendarClock className='w-4 h-4' /> : <LayoutGrid className='w-4 h-4' />}
                  label={viewMode === 'timeline' ? '时序' : '平铺'}
                />
              </DropdownMenuTrigger>
              <DropdownMenuPortal>
                <DropdownMenuContent className='w-32 bg-[#1A1A1A] border border-white/10 rounded-lg shadow-2xl z-[50] p-1 animate-in fade-in zoom-in-95' align='end'>
                  <DropdownMenuItem
                    onSelect={() => setViewMode('grid')}
                    className='px-3 py-2 hover:bg-white/5 outline-none rounded-md text-sm cursor-pointer flex items-center justify-between data-[highlighted]:bg-white/5'
                  >
                    <span className='flex items-center gap-2'>
                      <LayoutGrid className='w-4 h-4' />
                      <span>平铺</span>
                    </span>
                    {viewMode === 'grid' && <Check className='w-3.5 h-3.5 text-blue-400' />}
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onSelect={() => setViewMode('timeline')}
                    className='px-3 py-2 hover:bg-white/5 outline-none rounded-md text-sm cursor-pointer flex items-center justify-between data-[highlighted]:bg-white/5'
                  >
                    <span className='flex items-center gap-2'>
                      <CalendarClock className='w-4 h-4' />
                      <span>时序</span>
                    </span>
                    {viewMode === 'timeline' && <Check className='w-3.5 h-3.5 text-blue-400' />}
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenuPortal>
            </DropdownMenu>
          )}

          <IconButton
            onClick={() => setSortOrder(o => (o === 'desc' ? 'asc' : 'desc'))}
            className='h-9 px-3 rounded-lg text-sm hover:bg-white/10 transition-colors'
            icon={sortOrder === 'desc' ? <ArrowDownWideNarrow className='w-4 h-4' /> : <ArrowUpNarrowWide className='w-4 h-4' />}
            label={sortOrder === 'desc' ? '时间降序' : '时间升序'}
          />

          <div className='hidden mobile:flex'>
            <Sheet open={isSheetOpen} onOpenChange={setIsSheetOpen}>
              <SheetTrigger asChild>
                <IconButton className='h-9 px-3 rounded-lg text-sm hover:bg-white/10 transition-colors' icon={<Filter className='w-4 h-4' />} label='筛选' />
              </SheetTrigger>
              <SheetContent side='right' className='bg-[#1A1A1A] border-l border-white/10 p-0 flex flex-col w-[85vw] max-w-sm text-white'>
                <SheetHeader className='p-4 border-b border-white/10 text-left'>
                  <SheetTitle className='text-base font-medium text-white'>综合筛选</SheetTitle>
                </SheetHeader>
                <div className='flex-1 overflow-y-auto p-4 flex flex-col gap-6'>
                  {/* 快捷勾选 */}
                  <div className='flex flex-col gap-2'>
                    <button
                      onClick={() => setTempIsFavorite(!tempIsFavorite)}
                      className={`h-10 rounded-lg text-sm font-medium transition-colors ${tempIsFavorite ? 'bg-blue-600/20 text-blue-400 border border-blue-600/30' : 'bg-white/5 text-white/70 border border-transparent'}`}
                    >
                      我的收藏
                    </button>
                    {showCurrentCanvasFilter && (
                      <button
                        onClick={() => setTempIsCurrentCanvas(!tempIsCurrentCanvas)}
                        className={`h-10 rounded-lg text-sm font-medium transition-colors ${tempIsCurrentCanvas ? 'bg-blue-600/20 text-blue-400 border border-blue-600/30' : 'bg-white/5 text-white/70 border border-transparent'}`}
                      >
                        当前画布
                      </button>
                    )}
                  </div>

                  {/* 来源筛选 */}
                  {showSourceFilter && (
                    <div className='flex flex-col gap-3'>
                      <span className='text-sm text-white/60'>来源</span>
                      <div className='grid grid-cols-3 gap-2'>
                        {SOURCE_OPTIONS.map(opt => (
                          <button
                            key={opt.value}
                            onClick={() => setTempSource(opt.value)}
                            className={`h-9 rounded-lg text-sm transition-colors ${tempSource === opt.value ? 'bg-[#3b82f6] text-white' : 'bg-white/5 text-white/70 hover:bg-white/10'}`}
                          >
                            {opt.label}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* 音频类型筛选 */}
                  {showSourceFilter && secondaryTab === 'audio' && tempSource === ASSET_SOURCE.AIGC && (
                    <div className='flex flex-col gap-3'>
                      <span className='text-sm text-white/60'>音频类型</span>
                      <div className='grid grid-cols-3 gap-2'>
                        {AUDIO_CATEGORY_OPTIONS.map(opt => (
                          <button
                            key={opt.value}
                            onClick={() => setTempAudioCategory(opt.value)}
                            className={`h-9 rounded-lg text-sm transition-colors ${tempAudioCategory === opt.value ? 'bg-[#3b82f6] text-white' : 'bg-white/5 text-white/70 hover:bg-white/10'}`}
                          >
                            {opt.label}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* 级联筛选 */}
                  {primaryTab === 'public' &&
                    tempCascadeFilters.map(filter => {
                      const selectedId = tempCascadeSelections[filter.level] ?? null;
                      return (
                        <div key={filter.level} className='flex flex-col gap-3'>
                          <span className='text-sm text-white/60'>{filter.type}</span>
                          <div className='grid grid-cols-2 gap-2'>
                            <button
                              onClick={() => setTempCascadeSelections(prev => ({ ...prev, [filter.level]: null }))}
                              className={`h-9 rounded-lg text-sm transition-colors ${selectedId === null ? 'bg-[#3b82f6] text-white' : 'bg-white/5 text-white/70 hover:bg-white/10'}`}
                            >
                              全部
                            </button>
                            {filter.options.map(opt => (
                              <button
                                key={opt.id}
                                onClick={() => setTempCascadeSelections(prev => ({ ...prev, [filter.level]: opt.id }))}
                                className={`h-9 rounded-lg text-sm transition-colors ${selectedId === opt.id ? 'bg-[#3b82f6] text-white' : 'bg-white/5 text-white/70 hover:bg-white/10'}`}
                              >
                                {opt.label}
                              </button>
                            ))}
                          </div>
                        </div>
                      );
                    })}
                </div>
                <SheetFooter className='p-4 border-t border-white/10 flex flex-row gap-3 sm:justify-start'>
                  <button
                    onClick={() => {
                      setTempIsFavorite(false);
                      setTempIsCurrentCanvas(false);
                      setTempSource('all');
                      setTempAudioCategory('all');
                      setTempCascadeSelections({});
                    }}
                    className='flex-1 h-10 rounded-lg text-sm bg-white/5 text-white/70 hover:bg-white/10 transition-colors'
                  >
                    重置
                  </button>
                  <button onClick={applySheetFilters} className='flex-1 h-10 rounded-lg text-sm bg-blue-600 text-white hover:bg-blue-700 transition-colors'>
                    确定
                  </button>
                </SheetFooter>
              </SheetContent>
            </Sheet>
          </div>
        </div>
      </div>
    </>
  );
};
