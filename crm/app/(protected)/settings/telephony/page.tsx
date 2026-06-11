'use client'

import { useEffect, useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { ArrowLeft, UserCheck, Settings, Webhook, Copy, CheckCircle2, AlertTriangle, RefreshCw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { getSettings, getManagersProfiles, updateTelephonySettings, type ManagerProfile } from '../actions'
import {
  getVpbxSubscriptionStatus,
  subscribeVpbx,
  unsubscribeVpbx,
  type VpbxSubscriptionStatus,
} from '@/lib/vpbx/actions'
import { RecordingFolderSync } from './recording-folder-sync'

const DEFAULT_VPBX_URL = 'https://cloudpbx.beeline.kz/VPBX'

export default function TelephonySettingsPage() {
  const router = useRouter()
  const [vpbxToken, setVpbxToken] = useState('')
  const [vpbxUrl, setVpbxUrl] = useState(DEFAULT_VPBX_URL)
  const [vpbxProfileId, setVpbxProfileId] = useState('')
  const [vpbxWebhookSecret, setVpbxWebhookSecret] = useState('')
  const [managers, setManagers] = useState<ManagerProfile[]>([])
  const [subStatus, setSubStatus] = useState<VpbxSubscriptionStatus | null>(null)

  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [subscribing, setSubscribing] = useState(false)

  const loadSubscription = useCallback(async () => {
    try {
      setSubStatus(await getVpbxSubscriptionStatus())
    } catch (err) {
      // Non-admins or unconfigured integrations: leave status empty silently.
      console.warn('Не удалось загрузить статус подписки', err)
    }
  }, [])

  useEffect(() => {
    async function loadData() {
      try {
        const settings = await getSettings()
        setVpbxToken(settings.vpbxToken || '')
        setVpbxUrl(settings.vpbxUrl || DEFAULT_VPBX_URL)
        setVpbxProfileId(settings.vpbxProfileId || '')
        setVpbxWebhookSecret(settings.vpbxWebhookSecret || '')
        setManagers(await getManagersProfiles())
        await loadSubscription()
      } catch (err) {
        toast.error(`Ошибка загрузки данных: ${err instanceof Error ? err.message : 'неизвестно'}`)
      } finally {
        setLoading(false)
      }
    }
    loadData()
  }, [loadSubscription])

  const handleSave = async () => {
    if (!vpbxUrl.trim()) {
      toast.error('URL АТС не может быть пустым')
      return
    }

    setSaving(true)
    try {
      const res = await updateTelephonySettings({
        vpbxToken: vpbxToken.trim(),
        vpbxUrl: vpbxUrl.trim(),
        vpbxProfileId: vpbxProfileId.trim(),
        vpbxWebhookSecret: vpbxWebhookSecret.trim(),
        managers: managers.map((m) => ({
          id: m.id,
          sip_extension: m.sip_extension || '',
          is_active: m.is_active,
          can_call: m.can_call,
        })),
      })
      if (res.success) {
        toast.success('Настройки телефонии сохранены')
        // Reload to pick up an auto-generated webhook secret + refreshed URL.
        const settings = await getSettings()
        setVpbxWebhookSecret(settings.vpbxWebhookSecret || '')
        await loadSubscription()
      } else {
        toast.error(res.error || 'Не удалось сохранить настройки')
      }
    } catch (err) {
      toast.error(`Внутренняя ошибка: ${err instanceof Error ? err.message : 'неизвестно'}`)
    } finally {
      setSaving(false)
    }
  }

  const handleSubscribe = async () => {
    setSubscribing(true)
    try {
      const res = await subscribeVpbx()
      if (res.success) {
        toast.success('Подписка на события включена')
        await loadSubscription()
      } else {
        toast.error(res.error || 'Не удалось включить подписку')
      }
    } finally {
      setSubscribing(false)
    }
  }

  const handleUnsubscribe = async () => {
    setSubscribing(true)
    try {
      const res = await unsubscribeVpbx()
      if (res.success) {
        toast.success('Подписка отключена')
        await loadSubscription()
      } else {
        toast.error(res.error || 'Не удалось отключить подписку')
      }
    } finally {
      setSubscribing(false)
    }
  }

  const handleCopyWebhook = async () => {
    if (!subStatus?.webhookUrl) return
    try {
      await navigator.clipboard.writeText(subStatus.webhookUrl)
      toast.success('URL вебхука скопирован')
    } catch {
      toast.error('Не удалось скопировать')
    }
  }

  const handleSipChange = (id: string, value: string) => {
    setManagers((prev) => prev.map((m) => (m.id === id ? { ...m, sip_extension: value } : m)))
  }

  const handleActiveToggle = (id: string, checked: boolean) => {
    setManagers((prev) => prev.map((m) => (m.id === id ? { ...m, is_active: checked } : m)))
  }

  const handleCanCallToggle = (id: string, checked: boolean) => {
    setManagers((prev) => prev.map((m) => (m.id === id ? { ...m, can_call: checked } : m)))
  }

  if (loading) {
    return (
      <div className="flex h-[200px] items-center justify-center text-muted-foreground text-sm">
        Загрузка настроек телефонии...
      </div>
    )
  }

  const hasSubscription = (subStatus?.subscriptions.length ?? 0) > 0

  return (
    <div className="max-w-4xl space-y-6 animate-in fade-in duration-200">
      <div className="flex items-center justify-between">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => router.push('/settings')}
          className="flex items-center gap-1.5 text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="w-4 h-4" /> Назад в настройки
        </Button>
      </div>

      <div className="flex flex-col gap-2">
        <h1 className="text-2xl font-bold tracking-tight">Настройки телефонии</h1>
        <p className="text-muted-foreground text-sm">
          Интеграция Beeline VPBX: токен API, профиль компании, подписка на события звонков и внутренние номера.
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {/* API настройки */}
        <div className="md:col-span-1 space-y-6">
          <Card className="border-[#ebe9e4] bg-white shadow-sm rounded-xl">
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-1.5">
                <Settings className="w-4 h-4 text-blue-500" /> API ATS Beeline
              </CardTitle>
              <CardDescription className="text-xs">Подключение к облачной телефонии</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="vpbx-url" className="text-xs font-semibold">URL-адрес API АТС</Label>
                <Input
                  id="vpbx-url"
                  type="text"
                  placeholder={DEFAULT_VPBX_URL}
                  value={vpbxUrl}
                  onChange={(e) => setVpbxUrl(e.target.value)}
                  className="h-9 focus-visible:ring-1 focus-visible:ring-primary text-sm"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="vpbx-profile" className="text-xs font-semibold">profileID компании</Label>
                <Input
                  id="vpbx-profile"
                  type="text"
                  placeholder="например, 38"
                  value={vpbxProfileId}
                  onChange={(e) => setVpbxProfileId(e.target.value)}
                  className="h-9 focus-visible:ring-1 focus-visible:ring-primary text-sm"
                />
                <p className="text-[10px] text-muted-foreground leading-normal">
                  ID профиля в ЛК VPBX. Нужен для подписки на события звонков.
                </p>
              </div>

              <div className="space-y-2">
                <Label htmlFor="vpbx-token" className="text-xs font-semibold">API Ключ (Токен)</Label>
                <Input
                  id="vpbx-token"
                  type="password"
                  placeholder="Токен АТС"
                  value={vpbxToken}
                  onChange={(e) => setVpbxToken(e.target.value)}
                  className="h-9 focus-visible:ring-1 focus-visible:ring-primary text-sm font-mono"
                />
                <p className="text-[10px] text-muted-foreground leading-normal">
                  Интеграционный токен <code>X-VPBX-API-AUTH-TOKEN</code> для звонков, подписки и записей.
                </p>
              </div>
            </CardContent>
          </Card>

          {/* Подписка на события */}
          <Card className="border-[#ebe9e4] bg-white shadow-sm rounded-xl">
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-1.5">
                <Webhook className="w-4 h-4 text-violet-500" /> Подписка на события
              </CardTitle>
              <CardDescription className="text-xs">
                Входящие/исходящие звонки и записи через webhook
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label className="text-xs font-semibold">URL вебхука</Label>
                <div className="flex items-center gap-1.5">
                  <Input
                    readOnly
                    value={subStatus?.webhookUrl ?? ''}
                    placeholder="Сохраните настройки, чтобы сгенерировать"
                    className="h-9 text-[11px] font-mono bg-[#fcfcfb]"
                  />
                  <Button
                    type="button"
                    variant="outline"
                    size="icon"
                    className="h-9 w-9 shrink-0"
                    onClick={handleCopyWebhook}
                    disabled={!subStatus?.webhookUrl}
                  >
                    <Copy className="w-3.5 h-3.5" />
                  </Button>
                </div>
              </div>

              <div className="flex items-center gap-2 text-xs">
                {hasSubscription ? (
                  <span className="inline-flex items-center gap-1.5 text-emerald-600 font-medium">
                    <CheckCircle2 className="w-4 h-4" /> Подписка активна
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1.5 text-amber-600 font-medium">
                    <AlertTriangle className="w-4 h-4" /> Подписка не активна
                  </span>
                )}
              </div>

              {hasSubscription && (
                <ul className="space-y-1 text-[11px] text-muted-foreground">
                  {subStatus?.subscriptions.map((s) => (
                    <li key={s.subscriptionId} className="leading-tight">
                      <span className="font-mono">{s.applicationId || 'app'}</span>
                      {s.expiresAt ? ` — до ${new Date(s.expiresAt).toLocaleString('ru-RU')}` : ''}
                    </li>
                  ))}
                </ul>
              )}

              <div className="flex gap-2">
                <Button
                  type="button"
                  size="sm"
                  className="flex-1"
                  onClick={handleSubscribe}
                  disabled={subscribing || !subStatus?.configured}
                >
                  <RefreshCw className={`w-3.5 h-3.5 mr-1.5 ${subscribing ? 'animate-spin' : ''}`} />
                  {hasSubscription ? 'Продлить' : 'Включить'}
                </Button>
                {hasSubscription && (
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={handleUnsubscribe}
                    disabled={subscribing}
                  >
                    Отключить
                  </Button>
                )}
              </div>

              {!subStatus?.configured && (
                <p className="text-[10px] text-amber-600 leading-normal">
                  Заполните токен и profileID, сохраните настройки — затем включите подписку.
                </p>
              )}
            </CardContent>
          </Card>

          {/* Запись звонков из локальной папки MicroSIP */}
          <RecordingFolderSync />
        </div>

        {/* Внутренние номера */}
        <div className="md:col-span-2">
          <Card className="border-[#ebe9e4] bg-white shadow-sm rounded-xl">
            <CardHeader className="pb-3 border-b border-[#ebe9e4]/60">
              <CardTitle className="text-base flex items-center gap-1.5">
                <UserCheck className="w-4 h-4 text-emerald-500" /> Внутренние номера и автораспределение
              </CardTitle>
              <CardDescription className="text-xs">
                Назначение SIP-номеров и управление очередью автораспределения клиентов
              </CardDescription>
            </CardHeader>
            <CardContent className="p-0">
              <Table>
                <TableHeader className="bg-[#fcfcfb]">
                  <TableRow className="hover:bg-transparent border-[#ebe9e4]">
                    <TableHead>Менеджер</TableHead>
                    <TableHead className="w-32">Внутр. SIP</TableHead>
                    <TableHead className="w-36 text-center">Может звонить</TableHead>
                    <TableHead className="w-40 text-center">Автораспределение</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {managers.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={4} className="text-center py-6 text-muted-foreground text-xs">
                        Нет менеджеров в системе
                      </TableCell>
                    </TableRow>
                  ) : (
                    managers.map((m) => (
                      <TableRow key={m.id} className="border-[#ebe9e4]/60 hover:bg-[#fcfcfb]/30">
                        <TableCell className="py-3">
                          <div className="font-semibold text-sm text-foreground">{m.name || 'Без имени'}</div>
                          <div className="text-[11px] text-muted-foreground leading-none">{m.email}</div>
                        </TableCell>
                        <TableCell className="py-3">
                          <Input
                            type="text"
                            placeholder="например, 101"
                            value={m.sip_extension || ''}
                            onChange={(e) => handleSipChange(m.id, e.target.value)}
                            className="h-8 w-24 text-xs text-center focus-visible:ring-1 focus-visible:ring-primary"
                          />
                        </TableCell>
                        <TableCell className="py-3 text-center">
                          <label className="inline-flex items-center cursor-pointer select-none">
                            <input
                              type="checkbox"
                              checked={m.can_call}
                              onChange={(e) => handleCanCallToggle(m.id, e.target.checked)}
                              className="rounded border-gray-300 text-blue-600 focus:ring-blue-500 h-4 w-4"
                            />
                            <span className="ml-2 text-xs text-muted-foreground">
                              {m.can_call ? 'Может' : 'Запрещён'}
                            </span>
                          </label>
                        </TableCell>
                        <TableCell className="py-3 text-center">
                          <label className="inline-flex items-center cursor-pointer select-none">
                            <input
                              type="checkbox"
                              checked={m.is_active}
                              onChange={(e) => handleActiveToggle(m.id, e.target.checked)}
                              className="rounded border-gray-300 text-emerald-600 focus:ring-emerald-500 h-4 w-4"
                            />
                            <span className="ml-2 text-xs text-muted-foreground">
                              {m.is_active ? 'Активен' : 'Отключен'}
                            </span>
                          </label>
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </div>
      </div>

      <div className="flex justify-end pt-4 border-t border-[#ebe9e4]">
        <Button onClick={handleSave} disabled={saving} className="px-6">
          {saving ? 'Сохранение...' : 'Сохранить настройки'}
        </Button>
      </div>
    </div>
  )
}
