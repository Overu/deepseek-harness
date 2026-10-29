import { useEffect, useState } from 'react';
import { zodResolver } from '@hookform/resolvers/zod';
import { Loader2, X } from 'lucide-react';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';
import {
  addInvoiceEntity,
  applyInvoiceApplication,
  deleteInvoiceEntity,
  getInvoiceEntityList,
  InvoiceScope,
  reissueInvoiceApplication,
  updateInvoiceEntity,
  type InvoiceConsumeItem,
  type InvoiceEntity,
} from '@/api/invoice';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { useUserStore } from '@/store/userStore';
import { cn } from '@/lib/utils';
import {
  getInvoiceEntityDisplayName,
  getInvoiceEntityTypeLabel,
  getInvoiceTypeLabel,
  getPreferredInvoiceEntity,
  hasInvoiceEntityFormChanged,
  INVOICE_DEFAULT_STATUS_VALUE,
  INVOICE_ENTITY_FORM_DEFAULTS,
  INVOICE_ENTITY_TYPE_OPTIONS,
  INVOICE_ENTITY_TYPE_VALUE,
  INVOICE_TYPE_OPTIONS,
  INVOICE_TYPE_VALUE,
  invoiceEntityFormSchema,
  normalizeInvoiceEntityForm,
  sanitizeInvoiceEntityForm,
  toInvoiceEntityParams,
  toUpdateInvoiceEntityParams,
  type InvoiceEntityFormValues,
} from './invoiceUtils';

const INFO_OVERLAY_Z_INDEX = 70;
const INFO_CONTENT_Z_INDEX = 71;
const FORM_OVERLAY_Z_INDEX = 72;
const FORM_CONTENT_Z_INDEX = 73;
const ALERT_OVERLAY_Z_INDEX = 74;
const ALERT_CONTENT_Z_INDEX = 75;
const INVOICE_FLOATING_Z_INDEX = 76;

const isPersonalEntity = (entity?: InvoiceEntity | null) => String(entity?.entity_type) === INVOICE_ENTITY_TYPE_VALUE.Personal;

interface InvoiceInfoDialogProps {
  open: boolean;
  item: InvoiceConsumeItem | null;
  mode: 'apply' | 'reissue';
  onOpenChange: (open: boolean) => void;
  onApplied: (consumeItemId: number) => void;
}

interface InvoiceEntityFormDialogProps {
  open: boolean;
  mode: 'add' | 'edit';
  entity: InvoiceEntity | null;
  entityCount: number;
  onOpenChange: (open: boolean) => void;
  onSaved: () => Promise<void> | void;
}

const invoiceInputClassName =
  'mt-2 h-9 border-0 bg-white/10 text-sm text-white shadow-none placeholder:text-white/25 focus-visible:ring-1 focus-visible:ring-white/25 focus-visible:ring-offset-0';

const renderFieldError = (message?: string) => {
  if (!message) return null;
  return <p className='mt-1 text-[11px] leading-none text-[#ff8a8a]'>{message}</p>;
};

interface InvoiceMutationResponse {
  code?: string | number;
  msg?: string;
  success?: boolean;
}

const isInvoiceSuccessCode = (code?: string | number) => code == null || code === 'SUCCESS' || code === 200 || String(code) === '0';

const assertInvoiceSuccess = (response: InvoiceMutationResponse | undefined, fallbackMessage: string) => {
  if (!response || (response.success !== false && isInvoiceSuccessCode(response.code))) return;

  throw new Error(response.msg || fallbackMessage);
};

const getInvoiceErrorMessage = (error: unknown, fallbackMessage: string) => {
  if (error instanceof Error && error.message) return error.message;
  if (typeof error === 'object' && error && 'msg' in error && typeof error.msg === 'string') return error.msg;

  return fallbackMessage;
};

function InvoiceEntityFormDialog({ open, mode, entity, entityCount, onOpenChange, onSaved }: InvoiceEntityFormDialogProps) {
  const [initialValues, setInitialValues] = useState<InvoiceEntityFormValues>(INVOICE_ENTITY_FORM_DEFAULTS);
  const [submitting, setSubmitting] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [closeConfirmOpen, setCloseConfirmOpen] = useState(false);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);

  const form = useForm<InvoiceEntityFormValues>({
    resolver: zodResolver(invoiceEntityFormSchema),
    mode: 'onChange',
    reValidateMode: 'onChange',
    defaultValues: INVOICE_ENTITY_FORM_DEFAULTS,
  });

  const entityType = form.watch('entity_type');
  const isPersonal = entityType === INVOICE_ENTITY_TYPE_VALUE.Personal;
  const errors = form.formState.errors;
  const disabled = submitting || deleting;
  const canSwitchEntityType = mode === 'add' && !disabled;

  useEffect(() => {
    if (!open) return;

    const nextValues = mode === 'edit' ? normalizeInvoiceEntityForm(entity) : INVOICE_ENTITY_FORM_DEFAULTS;
    setInitialValues(nextValues);
    form.reset(nextValues);
    setCloseConfirmOpen(false);
    setDeleteConfirmOpen(false);
  }, [entity, form, mode, open]);

  useEffect(() => {
    if (isPersonal) {
      form.setValue('invoice_type', INVOICE_TYPE_VALUE.Normal, { shouldDirty: false, shouldValidate: true });
    }
  }, [form, isPersonal]);

  const requestClose = () => {
    if (disabled) return;

    if (hasInvoiceEntityFormChanged(initialValues, form.getValues())) {
      setCloseConfirmOpen(true);
      return;
    }

    onOpenChange(false);
  };

  const handleSubmit = async (values: InvoiceEntityFormValues) => {
    setSubmitting(true);
    const fallbackMessage = mode === 'edit' ? '保存失败，请稍后重试' : '新增失败，请稍后重试';

    try {
      if (mode === 'edit' && entity) {
        const response = await updateInvoiceEntity(toUpdateInvoiceEntityParams(entity.id, values));
        assertInvoiceSuccess(response, fallbackMessage);
        toast.success('保存成功');
      } else {
        const response = await addInvoiceEntity(toInvoiceEntityParams(values));
        assertInvoiceSuccess(response, fallbackMessage);
        toast.success('新增成功');
      }

      const savedValues = sanitizeInvoiceEntityForm(values);
      setInitialValues(savedValues);
      form.reset(savedValues);
      await onSaved();
      onOpenChange(false);
    } catch (error) {
      toast.error(getInvoiceErrorMessage(error, fallbackMessage));
    } finally {
      setSubmitting(false);
    }
  };

  const handleInvalidSubmit = () => {
    toast.error('请检查发票信息后再提交');
  };

  const handleDelete = async () => {
    if (!entity) return;

    setDeleting(true);
    try {
      const response = await deleteInvoiceEntity({ id: entity.id });
      assertInvoiceSuccess(response, '删除失败，请稍后重试');
      toast.success('删除成功');
      await onSaved();
      onOpenChange(false);
    } catch (error) {
      toast.error(getInvoiceErrorMessage(error, '删除失败，请稍后重试'));
    } finally {
      setDeleting(false);
      setDeleteConfirmOpen(false);
    }
  };

  return (
    <>
      <Dialog open={open} onOpenChange={nextOpen => !nextOpen && requestClose()}>
        <DialogContent
          showCloseButton={false}
          overlayClassName='bg-black/70'
          overlayStyle={{ zIndex: FORM_OVERLAY_Z_INDEX }}
          style={{ zIndex: FORM_CONTENT_Z_INDEX }}
          className='max-h-[calc(100vh-32px)] w-[520px] max-w-[calc(100vw-32px)] gap-0 overflow-hidden rounded-md border border-white/10 bg-[#242424] p-0 text-white'
        >
          <DialogTitle className='sr-only'>发票信息</DialogTitle>
          <form className='relative flex h-full flex-col px-5 pb-5 pt-4' onSubmit={form.handleSubmit(handleSubmit, handleInvalidSubmit)} noValidate>
            <Button
              type='button'
              variant='ghost'
              size='icon'
              className='absolute right-5 top-4 h-7 w-7 rounded-md p-0 text-white/75 hover:bg-white/10 hover:text-white'
              onClick={requestClose}
              disabled={disabled}
              aria-label='关闭'
            >
              <X size={18} />
            </Button>

            <h3 className='text-sm font-semibold text-white'>发票信息</h3>
            <div className='mt-2 border-b border-white/10 pb-5 text-center text-xs font-semibold text-white'>{mode === 'edit' ? '编辑主体' : '新增主体'}</div>

            <div className='mt-3 flex-1 space-y-3 overflow-y-auto px-1 min-h-[470px]'>
              <RadioGroup
                className='flex items-center gap-4 py-2'
                value={entityType}
                disabled={!canSwitchEntityType}
                onValueChange={value => {
                  if (!canSwitchEntityType) return;
                  form.setValue('entity_type', value as InvoiceEntityFormValues['entity_type'], { shouldDirty: true, shouldTouch: true, shouldValidate: true });
                }}
              >
                {INVOICE_ENTITY_TYPE_OPTIONS.map(option => (
                  <div key={option.value} className='flex items-center gap-1.5'>
                    <RadioGroupItem
                      id={`invoice-entity-type-${option.value}`}
                      value={option.value}
                      className='h-3.5 w-3.5 border-white/45 text-[#6682ff]'
                      disabled={!canSwitchEntityType}
                    />
                    <Label
                      htmlFor={`invoice-entity-type-${option.value}`}
                      className={cn('cursor-pointer text-xs font-normal text-white/75', !canSwitchEntityType && 'cursor-not-allowed text-white/45')}
                    >
                      {option.label}
                    </Label>
                  </div>
                ))}
              </RadioGroup>

              {!isPersonal && (
                <label className='block text-xs font-semibold text-white/85'>
                  <span className='text-[#ff7f7f]'>* </span>发票类型
                  <Select
                    value={form.watch('invoice_type')}
                    onValueChange={value =>
                      form.setValue('invoice_type', value as InvoiceEntityFormValues['invoice_type'], { shouldDirty: true, shouldTouch: true, shouldValidate: true })
                    }
                    disabled={disabled}
                  >
                    <SelectTrigger className={cn(invoiceInputClassName, 'justify-between')}>
                      <SelectValue placeholder='请选择' />
                    </SelectTrigger>
                    <SelectContent className='border-white/10 bg-[#202020] text-white' style={{ zIndex: INVOICE_FLOATING_Z_INDEX }}>
                      {INVOICE_TYPE_OPTIONS.map(option => (
                        <SelectItem key={option.value} value={option.value} className='focus:bg-white/10 focus:text-white'>
                          {option.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </label>
              )}

              <label className='block text-xs font-semibold text-white/85'>
                <span className='text-[#ff7f7f]'>* </span>抬头名称
                <Input {...form.register('entity_name')} placeholder='请输入' maxLength={200} disabled={disabled} className={invoiceInputClassName} />
                {renderFieldError(errors.entity_name?.message)}
              </label>

              {!isPersonal && (
                <>
                  <label className='block text-xs font-semibold text-white/85'>
                    <span className='text-[#ff7f7f]'>* </span>单位税号
                    <Input {...form.register('tax_no')} placeholder='请输入' maxLength={100} disabled={disabled} className={invoiceInputClassName} />
                    {renderFieldError(errors.tax_no?.message)}
                  </label>

                  <label className='block text-xs font-semibold text-white/85'>
                    开户银行
                    <Input {...form.register('bank_name')} placeholder='请输入' maxLength={200} disabled={disabled} className={invoiceInputClassName} />
                    {renderFieldError(errors.bank_name?.message)}
                  </label>

                  <label className='block text-xs font-semibold text-white/85'>
                    银行账户
                    <Input {...form.register('bank_account')} inputMode='numeric' placeholder='请输入' maxLength={100} disabled={disabled} className={invoiceInputClassName} />
                    {renderFieldError(errors.bank_account?.message)}
                  </label>
                </>
              )}

              <label className='block text-xs font-semibold text-white/85'>
                <span className='text-[#ff7f7f]'>* </span>发票接收邮箱
                <Input {...form.register('receive_email')} inputMode='email' placeholder='请输入' maxLength={200} disabled={disabled} className={invoiceInputClassName} />
                {renderFieldError(errors.receive_email?.message)}
              </label>
            </div>

            <div className='mt-5 flex items-center justify-between gap-3'>
              <div className='flex items-center gap-5'>
                {mode === 'edit' && entityCount > 1 && (
                  <Button
                    type='button'
                    variant='ghost'
                    className='h-8 rounded-md bg-white/10 px-4 text-sm hover:bg-white/15 text-[#ff6b6b] hover:text-[#ff8b8b]'
                    onClick={() => setDeleteConfirmOpen(true)}
                    disabled={disabled}
                  >
                    删除主体
                  </Button>
                )}
              </div>

              <div className='flex items-center gap-2'>
                <div className='flex items-center gap-2 text-xs text-white/70'>
                  <Checkbox
                    id='invoice-default-status'
                    checked={form.watch('is_default') === INVOICE_DEFAULT_STATUS_VALUE.Yes}
                    onCheckedChange={checked =>
                      form.setValue('is_default', checked ? INVOICE_DEFAULT_STATUS_VALUE.Yes : INVOICE_DEFAULT_STATUS_VALUE.No, {
                        shouldDirty: true,
                        shouldTouch: true,
                        shouldValidate: true,
                      })
                    }
                    disabled={disabled}
                    className='h-3.5 w-3.5'
                  />
                  <Label htmlFor='invoice-default-status' className={cn('cursor-pointer text-xs font-normal text-white/70', disabled && 'cursor-not-allowed opacity-50')}>
                    设为默认主体
                  </Label>
                </div>
                <Button type='button' variant='ghost' className='h-8 rounded-md bg-white/10 px-4 text-sm text-white hover:bg-white/15' onClick={requestClose} disabled={disabled}>
                  {mode === 'edit' ? '取消编辑' : '取消新增'}
                </Button>
                <Button type='submit' className='h-8 btn ins-btn-primary rounded-md px-4 text-sm' disabled={disabled}>
                  {submitting && <Loader2 className='mr-1 h-3.5 w-3.5 animate-spin' />}
                  {mode === 'edit' ? '确认保存' : '确认新增'}
                </Button>
              </div>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      <AlertDialog open={closeConfirmOpen} onOpenChange={setCloseConfirmOpen}>
        <AlertDialogContent
          overlayClassName='bg-black/70'
          overlayStyle={{ zIndex: ALERT_OVERLAY_Z_INDEX }}
          style={{ zIndex: ALERT_CONTENT_Z_INDEX }}
          className='border-white/10 bg-[#242424] text-white'
        >
          <AlertDialogHeader>
            <AlertDialogTitle>是否关闭发票信息弹窗？</AlertDialogTitle>
            <AlertDialogDescription className='text-white/60'>您当前填写的内容均未保存，关闭后将无法恢复</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className='border-white/10 bg-white/10 text-white hover:bg-white/15 hover:text-white'>取消</AlertDialogCancel>
            <AlertDialogAction
              className='bg-[#4868ff] text-white hover:bg-[#5a78ff]'
              onClick={() => {
                setCloseConfirmOpen(false);
                onOpenChange(false);
              }}
            >
              确认关闭
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={deleteConfirmOpen} onOpenChange={setDeleteConfirmOpen}>
        <AlertDialogContent
          overlayClassName='bg-black/70'
          overlayStyle={{ zIndex: ALERT_OVERLAY_Z_INDEX }}
          style={{ zIndex: ALERT_CONTENT_Z_INDEX }}
          className='border-white/10 bg-[#242424] text-white'
        >
          <AlertDialogHeader>
            <AlertDialogTitle>是否删除该发票主体？</AlertDialogTitle>
            <AlertDialogDescription className='text-white/60'>删除后，该主体将无法用于新的开票申请。</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className='border-white/10 bg-white/10 text-white hover:bg-white/15 hover:text-white' disabled={deleting}>
              取消
            </AlertDialogCancel>
            <AlertDialogAction className='bg-[#d94d4d] text-white hover:bg-[#e45b5b]' onClick={handleDelete} disabled={deleting}>
              {deleting && <Loader2 className='mr-1 h-3.5 w-3.5 animate-spin' />}
              确认删除
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

export function InvoiceInfoDialog({ open, item, mode, onOpenChange, onApplied }: InvoiceInfoDialogProps) {
  const userInfo = useUserStore(state => state.userInfo);
  const [entities, setEntities] = useState<InvoiceEntity[]>([]);
  const [selectedEntityId, setSelectedEntityId] = useState('');
  const [remark, setRemark] = useState('');
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [formOpen, setFormOpen] = useState(false);
  const [formMode, setFormMode] = useState<'add' | 'edit'>('add');
  const [editingEntity, setEditingEntity] = useState<InvoiceEntity | null>(null);

  const selectedEntity = entities.find(entity => String(entity.id) === selectedEntityId) || null;

  const fetchEntities = async () => {
    setLoading(true);
    try {
      const response = await getInvoiceEntityList();
      assertInvoiceSuccess(response, '发票主体加载失败，请稍后重试');
      const nextEntities = Array.isArray(response.data) ? response.data : [];
      const preferred = getPreferredInvoiceEntity(nextEntities);

      setEntities(nextEntities);
      setSelectedEntityId(preferred ? String(preferred.id) : '');
    } catch (error) {
      toast.error(getInvoiceErrorMessage(error, '发票主体加载失败，请稍后重试'));
      setEntities([]);
      setSelectedEntityId('');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!open) return;

    setRemark('');
    void fetchEntities();
  }, [open]);

  const openAddForm = () => {
    setFormMode('add');
    setEditingEntity(null);
    setFormOpen(true);
  };

  const openEditForm = () => {
    if (!selectedEntity) {
      toast.error('请先选择开票主体');
      return;
    }

    setFormMode('edit');
    setEditingEntity(selectedEntity);
    setFormOpen(true);
  };

  const handleApply = async () => {
    if (!item || !selectedEntity) {
      toast.error('请选择开票主体');
      return;
    }

    const contactPhone = userInfo?.phoneNo?.trim();
    if (!contactPhone) {
      toast.error('用户手机号缺失，请完善账号信息后重试');
      return;
    }

    setSubmitting(true);
    try {
      if (mode === 'reissue') {
        if (!item.current_application_id) {
          toast.error('缺少原发票申请ID，无法重开');
          return;
        }

        const response = await reissueInvoiceApplication({
          original_application_id: item.current_application_id,
          invoice_entity_id: selectedEntity.id,
          invoice_scope: InvoiceScope.Order,
          contact_phone: contactPhone,
          remark: remark.trim(),
        });
        assertInvoiceSuccess(response, '重开发票申请失败，请稍后重试');
      } else {
        const response = await applyInvoiceApplication({
          invoice_entity_id: selectedEntity.id,
          consume_item_ids: [item.consume_item_id],
          invoice_scope: InvoiceScope.Order,
          contact_phone: contactPhone,
          remark: remark.trim(),
        });
        assertInvoiceSuccess(response, '开票申请失败，请稍后重试');
      }

      toast.success('正在进行开票流程...开票成功后会自动发送至你的邮箱');
      onApplied(item.consume_item_id);
      onOpenChange(false);
    } catch (error) {
      toast.error(getInvoiceErrorMessage(error, mode === 'reissue' ? '重开发票申请失败，请稍后重试' : '开票申请失败，请稍后重试'));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent
          showCloseButton={false}
          overlayClassName='bg-black/70'
          overlayStyle={{ zIndex: INFO_OVERLAY_Z_INDEX }}
          style={{ zIndex: INFO_CONTENT_Z_INDEX }}
          className='max-h-[calc(100vh-32px)] w-[464px] max-w-[calc(100vw-32px)] gap-0 overflow-hidden rounded-md border border-white/10 bg-[#242424] p-0 text-white shadow-[0_24px_80px_rgba(0,0,0,0.55)]'
        >
          <DialogTitle className='sr-only'>发票信息</DialogTitle>
          <div className='relative flex h-full flex-col px-5 pb-5 pt-4'>
            <Button
              type='button'
              variant='ghost'
              size='icon'
              className='absolute right-5 top-4 h-7 w-7 rounded-md p-0 text-white/75 hover:bg-white/10 hover:text-white'
              onClick={() => onOpenChange(false)}
              disabled={submitting}
              aria-label='关闭'
            >
              <X size={18} />
            </Button>

            <h3 className='text-sm font-semibold text-white'>发票信息</h3>

            <div className='mt-7 flex items-center justify-between text-xs'>
              <span className='font-semibold text-white'>开票主体</span>
              <div className='flex items-center gap-3'>
                <Button
                  type='button'
                  variant='ghost'
                  className='h-auto p-0 text-xs text-white/85 underline-offset-2 hover:bg-transparent hover:text-white hover:underline'
                  onClick={openAddForm}
                  disabled={submitting}
                >
                  新增主体
                </Button>
                <Button
                  type='button'
                  variant='ghost'
                  className='h-auto p-0 text-xs text-white/85 underline-offset-2 hover:bg-transparent hover:text-white hover:underline disabled:text-white/35'
                  onClick={openEditForm}
                  disabled={!selectedEntity || submitting}
                >
                  编辑
                </Button>
              </div>
            </div>

            <Select value={selectedEntityId} onValueChange={setSelectedEntityId} disabled={loading || entities.length === 0 || submitting}>
              <SelectTrigger className='mt-2 h-9 border-0 bg-white/10 text-sm text-white shadow-none focus:ring-1 focus:ring-white/25 focus:ring-offset-0'>
                <SelectValue placeholder={loading ? '加载中...' : '请选择发票主体'} />
              </SelectTrigger>
              <SelectContent className='border-white/10 bg-[#202020] text-white' style={{ zIndex: INVOICE_FLOATING_Z_INDEX }}>
                {entities.map(entity => (
                  <SelectItem key={entity.id} value={String(entity.id)} className='focus:bg-white/10 focus:text-white'>
                    {getInvoiceEntityDisplayName(entity)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <div className='min-h-0 flex-1 overflow-y-auto p-1'>
              {loading && (
                <div className='mt-8 flex items-center justify-center gap-2 text-sm text-white/55'>
                  <Loader2 className='h-4 w-4 animate-spin' />
                  正在加载发票主体
                </div>
              )}

              {!loading && !selectedEntity && <div className='mt-8 rounded-md bg-white/5 px-3 py-8 text-center text-sm text-white/45'>暂无发票主体，请先新增主体</div>}

              {!loading && selectedEntity && (
                <div className='mt-5 space-y-4 text-sm text-white'>
                  <div>
                    <span className='text-white/65'>开具类型：</span>
                    {getInvoiceEntityTypeLabel(selectedEntity.entity_type)}
                  </div>
                  {!isPersonalEntity(selectedEntity) && (
                    <div>
                      <span className='text-white/65'>发票类型：</span>
                      {getInvoiceTypeLabel(selectedEntity.invoice_type)}
                    </div>
                  )}
                  <div>
                    <span className='text-white/65'>抬头名称：</span>
                    {selectedEntity.entity_name}
                  </div>
                  {!isPersonalEntity(selectedEntity) && (
                    <>
                      <div>
                        <span className='text-white/65'>单位税号：</span>
                        {selectedEntity.tax_no || '-'}
                      </div>
                      <div>
                        <span className='text-white/65'>开户银行：</span>
                        {selectedEntity.bank_name || '-'}
                      </div>
                      <div>
                        <span className='text-white/65'>银行账户：</span>
                        {selectedEntity.bank_account || '-'}
                      </div>
                    </>
                  )}
                  <div>
                    <span className='text-white/65'>发票接收邮箱：</span>
                    {selectedEntity.receive_email || '-'}
                  </div>

                  <label className='block pt-2 text-xs font-semibold text-white'>
                    备注
                    <Textarea
                      value={remark}
                      onChange={event => setRemark(event.target.value.slice(0, 500))}
                      placeholder='请输入开票备注，选填'
                      maxLength={500}
                      disabled={submitting}
                      rows={3}
                      className='mt-2 resize-none bg-white/10 text-sm'
                    />
                  </label>
                </div>
              )}
            </div>

            <div className='mt-6 flex justify-end gap-2'>
              <Button type='button' variant='ghost' className='h-8 bg-white/10 px-4 text-xs text-white hover:bg-white/15' onClick={() => onOpenChange(false)} disabled={submitting}>
                取消
              </Button>
              <Button type='button' className='h-8 btn ins-btn-primary text-xs' onClick={handleApply} disabled={!selectedEntity || submitting}>
                {submitting && <Loader2 className='mr-1 h-3.5 w-3.5 animate-spin' />}
                确认
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <InvoiceEntityFormDialog open={formOpen} mode={formMode} entity={editingEntity} entityCount={entities.length} onOpenChange={setFormOpen} onSaved={fetchEntities} />
    </>
  );
}
