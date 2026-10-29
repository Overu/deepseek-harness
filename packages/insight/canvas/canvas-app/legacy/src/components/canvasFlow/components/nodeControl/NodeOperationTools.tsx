import type { ReactNode } from 'react';
import { ChevronDown } from 'lucide-react';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import { isToolUsable, type ToolNodePermissionMap } from '../../utils/modelPermission';
import type { ToolListItem } from '../../settings/toolListConfig';
import { resolveNodeOperationToolEntries } from './nodeOperationToolLayout';

interface NodeOperationToolsProps {
  nodeType: string;
  value: unknown;
  tools: ToolListItem[];
  toolNodePermission: ToolNodePermissionMap | null;
  onAddNextTool?: (toolType: string) => void;
  renderToolItem?: (tool: ToolListItem, disabled: boolean) => ReactNode;
}

const operationBtnClass = 'flex items-center justify-center rounded-lg transition-colors hover:bg-white/10';

const NodeOperationTools = ({ value, nodeType, tools, toolNodePermission, onAddNextTool, renderToolItem }: NodeOperationToolsProps) => {
  if (tools.length === 0) return null;

  const entries = resolveNodeOperationToolEntries(nodeType, tools);
  const hasToolGroups = entries.some(entry => entry.kind === 'group');

  const renderStandaloneTool = (tool: ToolListItem) => {
    const greyDisabled = tool.unsable != null ? tool.unsable(value) : !isToolUsable(toolNodePermission, tool.type);

    const customContent = renderToolItem?.(tool, greyDisabled);
    if (customContent) return customContent;

    const content = (
      <div
        onClick={e => {
          e.stopPropagation();
          if (greyDisabled) return;
          onAddNextTool?.(tool.type);
        }}
        className={cn('h-8 gap-1 px-2 text-white/85', operationBtnClass, greyDisabled ? 'cursor-not-allowed opacity-40' : 'cursor-pointer')}
      >
        <span className='shrink-0'>{tool.icon}</span>
        <span className={cn('text-xs whitespace-nowrap', greyDisabled && 'text-white/50')}>{tool.abbreviation || tool.type}</span>
      </div>
    );

    return (
      <Tooltip delayDuration={100}>
        <TooltipTrigger asChild>{content}</TooltipTrigger>
        {greyDisabled && (
          <TooltipContent>
            <p>升级会员解锁此功能</p>
          </TooltipContent>
        )}
      </Tooltip>
    );
  };

  return (
    <div className='flex items-center gap-1 pl-1 ml-1 border-l border-white/10'>
      {entries.map(entry => {
        if (entry.kind === 'tool') {
          return (
            <div key={entry.tool.type} className={cn('flex items-center', entry.separatorBefore && hasToolGroups && 'ml-1 border-l border-white/10 pl-1')}>
              {renderStandaloneTool(entry.tool)}
            </div>
          );
        }

        return (
          <DropdownMenu key={entry.key}>
            <DropdownMenuTrigger asChild>
              <button
                type='button'
                onClick={e => e.stopPropagation()}
                className={cn('group h-8 gap-1 px-2 text-xs text-white/85 outline-none data-[state=open]:bg-white/10', operationBtnClass)}
              >
                <span className='whitespace-nowrap'>{entry.label}</span>
                <ChevronDown size={14} className='transition-transform group-data-[state=open]:rotate-180' />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent
              side='top'
              align='start'
              sideOffset={4}
              onPointerDown={e => e.stopPropagation()}
              onClick={e => e.stopPropagation()}
              className='min-w-40 rounded-lg border-0 bg-[#262626] p-1 text-white shadow-xl'
            >
              {entry.items.map(({ tool, label }) => {
                const greyDisabled = tool.unsable != null ? tool.unsable(value) : !isToolUsable(toolNodePermission, tool.type);
                const menuItem = (
                  <DropdownMenuItem
                    aria-disabled={greyDisabled}
                    onSelect={e => {
                      if (greyDisabled) {
                        e.preventDefault();
                        return;
                      }
                      onAddNextTool?.(tool.type);
                    }}
                    className={cn(
                      'h-8 rounded-lg px-2 py-0 text-sm text-white/85 focus:bg-white/10 focus:text-white',
                      greyDisabled ? 'cursor-not-allowed opacity-40 focus:bg-transparent' : 'cursor-pointer'
                    )}
                  >
                    {tool.icon}
                    <span>{label || tool.title}</span>
                  </DropdownMenuItem>
                );

                return (
                  <Tooltip key={tool.type} delayDuration={100}>
                    <TooltipTrigger asChild>{menuItem}</TooltipTrigger>
                    {greyDisabled && (
                      <TooltipContent>
                        <p>升级会员解锁此功能</p>
                      </TooltipContent>
                    )}
                  </Tooltip>
                );
              })}
            </DropdownMenuContent>
          </DropdownMenu>
        );
      })}
    </div>
  );
};

export default NodeOperationTools;
