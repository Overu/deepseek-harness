import { useCallback, useEffect, useMemo, useState } from 'react'
import { motion } from 'framer-motion'
import { RefreshCcw, X } from 'lucide-react'
import { toast } from 'sonner'
import { queryPointPackages, type PaymentMethod, type PointPackageItem, type PointPackagesResponse } from '@/api/order'
import { Avatar, AvatarImage } from '@/components/ui/avatar'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent } from '@/components/ui/dialog'
import { Skeleton } from '@/components/ui/skeleton'
import { usePointStore } from '@/store/pointStore'
import { useUserStore } from '@/store/userStore'
import { cn } from '@/lib/utils'
import { ResponsiveView } from '@/components/common/ResponsiveView'
import PopPointPayCodeV2 from './PopPointPayCodeV2'
import { PAYMENT_NESTED_CONTENT_Z_INDEX, PAYMENT_NESTED_OVERLAY_Z_INDEX } from './payLayer'
import { getDefaultPaymentMethod } from './paymentMethod'
import { MobileFullscreenDialogHeader } from '../common/MobileFullscreenDialog'

type RechargeMode = 'FIXED' | 'RATIO'

const RECHARGE_MODES: RechargeMode[] = ['FIXED', 'RATIO']
const RECHARGE_MODE_LABELS: Record<RechargeMode, string> = {
  FIXED: '固定充值',
  RATIO: '自定义充值',
}
const DEFAULT_RATIO_AMOUNT = '100'
const DEFAULT_RATIO_POINTS_PER_YUAN = 10

const getPricingMode = (item: PointPackageItem): RechargeMode => (item.pricing_mode === 'RATIO' ? 'RATIO' : 'FIXED')

const getPositiveNumber = (value?: number) => {
  const numericValue = Number(value)
  return Number.isFinite(numericValue) && numericValue > 0 ? numericValue : 0
}

const formatYuanAmount = (value: number) => {
  if (!Number.isFinite(value) || value <= 0) {
    return '0.00'
  }

  return Number.isInteger(value) ? value.toFixed(0) : value.toFixed(2).replace(/0+$/, '').replace(/\.$/, '')
}

const getDefaultRatioAmount = (item: PointPackageItem) => {
  const salePrice = getPositiveNumber(item.sale_price)
  return salePrice > 0 ? formatYuanAmount(salePrice / 100) : DEFAULT_RATIO_AMOUNT
}

const getRatioPointsPerYuan = (item: PointPackageItem) => {
  const explicitRatio = getPositiveNumber(item.point_ratio) || getPositiveNumber(item.ratio)
  if (explicitRatio > 0) {
    return explicitRatio
  }

  const salePrice = getPositiveNumber(item.sale_price)
  const points = getPositiveNumber(item.points)
  if (salePrice > 0 && points > 0) {
    return points / (salePrice / 100)
  }

  return DEFAULT_RATIO_POINTS_PER_YUAN
}

const formatPoint = (value?: number) => {
  const numericValue = Number(value)
  return Number.isFinite(numericValue) ? numericValue.toLocaleString() : '0'
}

export function UserPointDisplay({ point }: { point?: number }) {
  return (
    <div className='text-right mobile:text-center mobile:mt-14 mobile:mb-12'>
      <span className='text-xs text-white/75'>我的赛点</span>
      <strong className='ml-3 text-[32px] font-black tracking-[2px] text-white'>{formatPoint(point)}</strong>
    </div>
  )
}

export default function PopPointV2({ insufficientPoints = false, onClose }: { insufficientPoints?: boolean; onClose?: () => void }) {
  const [payWayData] = useState<PaymentMethod>(() => getDefaultPaymentMethod())
  const [packages, setPackages] = useState<PointPackageItem[]>([])
  const [selectedPackageId, setSelectedPackageId] = useState<number | null>(null)
  const [activeMode, setActiveMode] = useState<RechargeMode>('FIXED')
  const [customAmount, setCustomAmount] = useState('')
  const [canPurchase, setCanPurchase] = useState(true)
  const [purchaseReason, setPurchaseReason] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [payVisible, setPayVisible] = useState(false)
  const { point } = usePointStore(state => state)
  const { updateUserPoint } = usePointStore(state => state.actions)
  const { userInfo } = useUserStore(state => state)

  const fixedPackages = useMemo(() => packages.filter(item => getPricingMode(item) === 'FIXED'), [packages])
  const ratioPackage = useMemo(() => packages.find(item => getPricingMode(item) === 'RATIO') || null, [packages])
  const selectedPackage = useMemo(() => fixedPackages.find(item => item.id === selectedPackageId) || null, [fixedPackages,
    selectedPackageId])
  const showModeTabs = Boolean(ratioPackage && fixedPackages.length > 0)
  const ratioPointsPerYuan = useMemo(() =>
    (ratioPackage ? getRatioPointsPerYuan(ratioPackage) : DEFAULT_RATIO_POINTS_PER_YUAN), [ratioPackage])
  /* 起充额（元，数值）；0 表示接口未下发或为 0，不做校验 */
  const minimumRechargeYuan = useMemo(() => {
    if (!ratioPackage) return 0
    const fen = getPositiveNumber(ratioPackage.minimum_recharge_amount)
    return fen > 0 ? fen / 100 : 0
  }, [ratioPackage])
  const customAmountValue = Number(customAmount)
  const customAmountFen = Number.isFinite(customAmountValue) && customAmountValue > 0 ? Math.round(customAmountValue * 100) : 0
  const minimumRechargeFen = Math.round(minimumRechargeYuan * 100)
  const customPoints = customAmountFen > 0 ? Math.floor(customAmountValue * ratioPointsPerYuan) : 0
  const activePayPackage = activeMode === 'RATIO' ? ratioPackage : selectedPackage
  /* 自定义充值金额必须 ≥ 起充额（有起充额时）；固定充值仍然只看有没有选中套餐 */
  const canPay = canPurchase && (activeMode === 'RATIO' ? Boolean(ratioPackage && customAmountFen > 0 && customAmountFen >= minimumRechargeFen) : Boolean(selectedPackage))

  const formatFenPrice = (value?: number) => {
    const fen = Number.isFinite(Number(value)) ? Number(value) : 0
    const yuan = fen / 100
    return yuan.toFixed(2)
  }

  const loadPointPackages = useCallback(async () => {
    setLoading(true)
    setError('')

    try {
      const response = (await queryPointPackages()) as PointPackagesResponse
      const sortedItems = [...(response.data?.items || [])]
      const fixedItems = sortedItems.filter(item => getPricingMode(item) === 'FIXED')
      const ratioItem = sortedItems.find(item => getPricingMode(item) === 'RATIO') || null

      setPackages(sortedItems)
      setCanPurchase(response.data?.can_purchase !== false)
      setPurchaseReason(response.data?.reason || '')
      setSelectedPackageId(prev => (prev && fixedItems.some(item => item.id === prev) ? prev : fixedItems[0]?.id || null))
      setActiveMode((prev) => {
        if (prev === 'RATIO' && ratioItem) {
          return 'RATIO'
        }

        if (fixedItems.length > 0) {
          return 'FIXED'
        }

        return ratioItem ? 'RATIO' : 'FIXED'
      })
    } catch (fetchError) {
      console.error('Failed to query point packages:', fetchError)
      setError('赛点包加载失败，请稍后重试')
      toast.error('赛点包加载失败')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    loadPointPackages()
  }, [loadPointPackages])

  useEffect(() => {
    if (!ratioPackage) {
      return
    }

    // 默认值优先起充额（接口下发 minimum_recharge_amount）；否则沿用 sale_price；兜底 100
    const fen = getPositiveNumber(ratioPackage.minimum_recharge_amount)
    const defaultAmount = fen > 0 ? formatYuanAmount(fen / 100) : getDefaultRatioAmount(ratioPackage)

    setCustomAmount(prev => prev || defaultAmount)
  }, [ratioPackage])

  useEffect(() => {
    if (!point) {
      updateUserPoint()
    }
  }, [point, updateUserPoint])

  const handleCustomAmountChange = (value: string) => {
    // 只允许正整数（最多 7 位），禁止小数点及小数位
    if (value !== '' && !/^\d+$/.test(value)) return
    const normalized = value.replace(/^0+(\d)/, '$1')
    if (value === '' || /^\d{1,7}$/.test(normalized)) {
      setCustomAmount(normalized)
    }
  }

  const handleCustomAmountBlur = () => {
    if (!Number.isFinite(customAmountValue) || customAmountValue <= 0) {
      setCustomAmount('')
      return
    }

    setCustomAmount(formatYuanAmount(customAmountValue))
  }

  const handlePay = () => {
    if (!canPay) {
      return
    }

    setPayVisible(true)
  }

  const displayName = userInfo?.userName || (userInfo?.phoneNo ? `User_${userInfo.phoneNo.slice(-4)}` : 'User')
  const avatarUrl = userInfo?.avatarUrl || 'https://web-gpt-assets-cdn.idealead.com/static-assets-tool/png/20260731-113037-3fb3f4def4432a80.png'
  const disabledTip = purchaseReason || '当前暂不可购买'

  return (
    <ResponsiveView
      mobileWrapper={children => (
        <div className='h-screen w-screen flex flex-col'>
          <MobileFullscreenDialogHeader title='加油包充值' onBack={onClose} />
          <div className='w-full h-full flex flex-col flex-1 px-4 overflow-auto bg-cover bg-no-repeat bg-center bg-[url("https://web-gpt-assets-cdn.idealead.com/static-assets-tool/jpg/a8f51d94eb537163.jpg?x-oss-process=image/format,webp")]'>
            <UserPointDisplay point={point} />
            {children}
          </div>
        </div>
      )}
      pcWrapper={children => (
        <motion.div
          className='relative w-[800px] overflow-hidden rounded-[14px] bg-[#242424] text-white shadow-[0_24px_80px_rgba(0,0,0,0.55)] max-[900px]:w-[calc(100vw-32px)]'
          initial={{ opacity: 0, y: 12, scale: 0.98 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          transition={{ duration: 0.24, ease: [0.22, 1, 0.36, 1] }}
          onKeyDown={event => event.stopPropagation()}
        >
          <div className="relative px-8 py-5 bg-cover bg-no-repeat bg-center bg-[url('https://web-gpt-assets-cdn.idealead.com/static-assets-tool/jpg/ecfde390281f4592.jpg?x-oss-process=image/format,webp')]">
            <button
              type='button'
              className='hidden md:block absolute right-6 top-5 z-[2] rounded-md p-1 text-white/78 transition-colors hover:bg-white/12 hover:text-white'
              onClick={onClose}
              aria-label='关闭'
            >
              <X size={22} />
            </button>

            <div className='relative z-1 flex items-center justify-between md:pr-12'>
              <div className='flex items-center gap-3'>
                <Avatar className='h-10 w-10 border border-white/45'>
                  <AvatarImage src={avatarUrl} alt='user avatar' />
                </Avatar>
                <div>
                  <div className='flex items-center gap-2'>
                    <span className='text-base font-bold leading-none'>{displayName}</span>
                    <span className='rounded-full border border-white/35 bg-white/16 px-2 py-0.5 text-[11px] text-white/85'>专业版</span>
                  </div>
                  <div className='mt-1 text-xs text-white/72'>{userInfo?.phoneNo || '-'}</div>
                </div>
              </div>

              <UserPointDisplay point={point} />
            </div>
          </div>
          <div className='px-[92px] py-9 mobile:px-4 bg-cover bg-no-repeat bg-center bg-[url("https://web-gpt-assets-cdn.idealead.com/static-assets-tool/jpg/a8f51d94eb537163.jpg?x-oss-process=image/format,webp")]'>
            {children}
          </div>
        </motion.div>
      )}
    >
      <h3 className='hidden md:block text-center text-lg font-semibold text-white/95'>{insufficientPoints ? '您的赛点不足，请充值赛点' : '加油包充值'}</h3>

      {showModeTabs && (
        <div className='relative mx-auto mt-4 mobile:mx-0 mobile:max-w-full grid h-10 max-w-[568px] grid-cols-2 rounded-lg p-0.5 bg-black/35'>
          {RECHARGE_MODES.map((mode) => {
            const selected = activeMode === mode

            return (
              <button
                key={mode}
                type='button'
                className={cn('relative z-[1] rounded-md font-semibold transition-colors duration-200', selected ? 'text-white' : 'text-white/70 hover:text-white/90')}
                onClick={() => setActiveMode(mode)}
              >
                {selected && (
                  <motion.span
                    layoutId='point-recharge-mode-thumb'
                    className='absolute inset-0 -z-[1] rounded-md bg-foreground/10 shadow-[0_8px_18px_rgba(0,0,0,0.24)]'
                    transition={{ type: 'spring', stiffness: 360, damping: 34 }}
                  />
                )}
                {RECHARGE_MODE_LABELS[mode]}
              </button>
            )
          })}
        </div>
      )}

      <div className={cn('min-h-[230px]', showModeTabs ? 'mt-8' : 'mt-4')}>
        {loading && (
          <div className='grid grid-cols-3 gap-2.5 max-[760px]:grid-cols-1'>
            {Array.from({ length: 6 }).map((_, index) => (
              <Skeleton key={index} className='h-[110px] rounded-md bg-white/[0.10]' />
            ))}
          </div>
        )}

        {!loading && error && (
          <div className='flex h-[210px] flex-col items-center justify-center gap-3 text-sm text-white/60'>
            <span>{error}</span>
            <Button variant='ghost' className='h-8 text-white/75 hover:bg-white/10 hover:text-white' onClick={loadPointPackages}>
              <RefreshCcw size={14} />
              重新加载
            </Button>
          </div>
        )}

        {!loading && !error && packages.length === 0 && <div className='flex h-[210px] items-center justify-center text-sm text-white/60'>暂无可购买赛点包</div>}

        {!loading && !error && packages.length > 0 && activeMode === 'FIXED' && fixedPackages.length === 0 && (
          <div className='flex h-[210px] items-center justify-center text-sm text-white/60'>暂无固定充值赛点包</div>
        )}

        {!loading && !error && packages.length > 0 && activeMode === 'FIXED' && fixedPackages.length > 0 && (
          <div className='grid grid-cols-3 gap-2.5 max-[760px]:grid-cols-1'>
            {fixedPackages.map((item, index) => {
              const selected = item.id === selectedPackageId

              return (
                <motion.button
                  key={item.id}
                  type='button'
                  className={cn(
                    'relative flex h-[110px] flex-col items-center justify-center rounded-md border text-center transition-[background,border-color,box-shadow] duration-200',
                    selected
                      ? 'border-[#5975c8] bg-[linear-gradient(0deg,rgba(96,154,255,0.57)_1%,rgba(96,154,255,0.285)_30%,rgba(96,154,255,0.19)_54%,rgba(96,154,255,0.19)_98%)] shadow-[inset_0_0_0_1px_rgba(255,255,255,0.08)]'
                      : 'border-transparent bg-white/[0.10] hover:bg-white/[0.16]',
                  )}
                  initial={{ opacity: 0, y: 12 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.2, delay: index * 0.03 }}
                  onClick={() => setSelectedPackageId(item.id)}
                >
                  <div className='flex items-center gap-1.5 text-[22px] font-bold leading-none'>
                    <img className='w-4 h-4' src='//web-gpt-assets-cdn.idealead.com/base-platform/test/images/pay/pointLogo.png' />
                    {item.point2 ? formatPoint(item.point1) : formatPoint(item.points)}
                    {item.point2 ? (
                      <div className='bg-[linear-gradient(90deg,#62eefd_18%,#3da1ff_86%),linear-gradient(270deg,#fa1b1b_7%,#f9886f_74%,#f09e8c_93%)] bg-clip-text text-transparent'>
                        +{formatPoint(item.point2)}
                      </div>
                    ) : (
                      ''
                    )}
                  </div>
                  <div className='mt-2 text-sm text-white/95'>¥ {formatFenPrice(item.sale_price)}</div>
                </motion.button>
              )
            })}
          </div>
        )}

        {!loading && !error && packages.length > 0 && activeMode === 'RATIO' && ratioPackage && (
          <motion.div
            key='ratio-recharge'
            className='mx-auto flex max-w-[568px] min-h-[230px] flex-col justify-between'
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
          >
            <div className='flex items-end justify-center gap-16 text-center pt-9 max-[760px]:gap-9'>
              <div>
                <div className='text-sm font-semibold text-white/65'>金额 / 元</div>
                <div className='mt-4 text-[32px] font-bold  leading-none  tracking-[2px] text-white'>{formatYuanAmount(customAmountValue)}</div>
              </div>
              <div className='pb-1 text-base font-semibold text-white/65'>=</div>
              <div>
                <div className='text-sm font-semibold text-white/65'>可充值赛点</div>
                <div className='mt-4 text-[32px] font-bold leading-none tracking-[2px] text-white'>{formatPoint(customPoints)}</div>
              </div>
            </div>

            <div>
              <label className='mt-12 text-sm font-semibold text-white/95' htmlFor='point-ratio-amount'>
                {minimumRechargeYuan > 0 ? `请输入充值金额(起充额${formatYuanAmount(minimumRechargeYuan)}元)` : '请输入充值金额'}
              </label>
              <div className='relative mt-3'>
                <input
                  id='point-ratio-amount'
                  value={customAmount}
                  inputMode='numeric'
                  className={cn(
                    'h-10 w-full px-4 pr-10 text-center text-sm rounded-md text-white outline-none bg-black/35 duration-200 placeholder:text-white/25',
                    customAmountFen > 0 && customAmountFen < minimumRechargeFen
                      ? 'border border-[#ff6b6b] focus:border-[#ff6b6b] focus:shadow-[0_0_0_2px_rgba(255,107,107,0.48)]'
                      : 'focus:border-[#5d82ff] focus:shadow-[0_0_0_2px_rgba(53,109,255,0.68)]',
                  )}
                  placeholder='请输入金额'
                  onChange={event => handleCustomAmountChange(event.target.value)}
                  onBlur={handleCustomAmountBlur}
                />
                <span className='pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-sm'>元</span>
              </div>
            </div>
          </motion.div>
        )}
      </div>

      {loading ? (
        <>
          <Skeleton className='mt-8 h-10 w-full rounded-md bg-white/[0.10]' />
          <Skeleton className='mx-auto mt-4 h-3 w-[260px] rounded-full bg-white/[0.08]' />
        </>
      ) : (
        <>
          {!canPurchase && <div className='mt-3 text-center text-xs text-[#ffb0b0]'>{disabledTip}</div>}

          <Button
            disabled={!canPay}
            className='mt-8 h-10 w-full rounded-md bg-[#4358f4] text-sm font-semibold text-white transition-all hover:bg-[#5669ff] hover:shadow-[0_10px_24px_rgba(67,88,244,0.28)] disabled:cursor-not-allowed disabled:bg-white/12 disabled:text-white/40'
            onClick={handlePay}
          >
            立即支付
          </Button>

          <div className='mt-4 text-center text-xs text-white/50'>所售为虚拟商品，一经付费，不支持提现或退款</div>
        </>
      )}
      <Dialog open={payVisible} onOpenChange={setPayVisible}>
        <DialogContent
          className='w-[385px] border-none bg-transparent p-0 shadow-none'
          overlayClassName='bg-black/80'
          overlayStyle={{ zIndex: PAYMENT_NESTED_OVERLAY_Z_INDEX }}
          style={{ zIndex: PAYMENT_NESTED_CONTENT_Z_INDEX }}
          showCloseButton={false}
        >
          {activePayPackage && (
            <PopPointPayCodeV2
              createOrderPayload={{
                productType: 'POINT_PACKAGE',
                paymentMethod: payWayData,
                pointPackageId: activePayPackage.id,
                ...(activeMode === 'RATIO' ? { amount: customAmountFen } : {}),
              }}
              displayInfo={{
                title: activeMode === 'RATIO' ? activePayPackage.package_name || '自定义充值' : activePayPackage.package_name || `${formatPoint(activePayPackage.points)}赛点包`,
                pointsText: activeMode === 'RATIO' ? `${formatPoint(customPoints)} 赛点` : `${formatPoint(activePayPackage.points)} 赛点`,
                priceText: activeMode === 'RATIO' ? `¥${formatYuanAmount(customAmountValue)}` : `¥${formatFenPrice(activePayPackage.sale_price)}`,
              }}
              onClose={(shouldClose) => {
                setPayVisible(false)
                if (shouldClose === true) {
                  onClose?.()
                }
              }}
            />
          )}
        </DialogContent>
      </Dialog>
    </ResponsiveView>
  )
}
