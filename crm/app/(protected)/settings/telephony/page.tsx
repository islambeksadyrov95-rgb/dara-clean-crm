'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { ArrowLeft, Phone, Shield, UserCheck, Settings } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { getSettings, getManagersProfiles, updateTelephonySettings, type ManagerProfile } from '../actions'

export default function TelephonySettingsPage() {
  const router = useRouter()
  const [vpbxToken, setVpbxToken] = useState('')
  const [vpbxUrl, setVpbxUrl] = useState('https://cloudpbx.beeline.kz/VPBX')
  const [managers, setManagers] = useState<ManagerProfile[]>([])
  
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    async function loadData() {
      try {
        const settings = await getSettings()
        setVpbxToken(settings.vpbxToken || '')
        setVpbxUrl(settings.vpbxUrl || 'https://cloudpbx.beeline.kz/VPBX')

        const profiles = await getManagersProfiles()
        setManagers(profiles)
      } catch (err: any) {
        toast.error(`Ошибка загрузки данных: ${err.message}`)
      } finally {
        setLoading(false)
      }
    }
    loadData()
  }, [])

  const handleSave = async () => {
    if (!vpbxUrl.trim()) {
      toast.error('URL АТС не может быть пустым')
      return
    }

    setSaving(true)
    try {
      const payload = {
        vpbxToken: vpbxToken.trim(),
        vpbxUrl: vpbxUrl.trim(),
        managers: managers.map((m) => ({
          id: m.id,
          sip_extension: m.sip_extension || '',
          is_active: m.is_active,
        })),
      }

      const res = await updateTelephonySettings(payload)
      if (res.success) {
        toast.success('Настройки телефонии успешно сохранены')
      } else {
        toast.error(res.error || 'Не удалось сохранить настройки')
      }
    } catch (err: any) {
      toast.error(`Внутренняя ошибка: ${err.message}`)
    } finally {
      setSaving(false)
    }
  }

  const handleSipChange = (id: string, value: string) => {
    setManagers((prev) =>
      prev.map((m) => (m.id === id ? { ...m, sip_extension: value } : m))
    )
  }

  const handleActiveToggle = (id: string, checked: boolean) => {
    setManagers((prev) =>
      prev.map((m) => (m.id === id ? { ...m, is_active: checked } : m))
    )
  }

  if (loading) {
    return (
      <div className="flex h-[200px] items-center justify-center text-muted-foreground text-sm">
        Загрузка настроек телефонии...
      </div>
    )
  }

  return (
    <div className="max-w-4xl space-y-6 animate-in fade-in duration-200">
      {/* Кнопка назад */}
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
          Управление токенами интеграции Beeline VPBX, распределением звонков и внутренними номерами менеджеров.
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {/* Левая часть - Общие настройки API */}
        <div className="md:col-span-1 space-y-6">
          <Card className="border-[#ebe9e4] bg-white shadow-sm rounded-xl">
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-1.5">
                <Settings className="w-4 h-4 text-blue-500" /> API ATS Beeline
              </CardTitle>
              <CardDescription className="text-xs">
                Подключение к облачной телефонии
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="vpbx-url" className="text-xs font-semibold">URL-адрес API АТС</Label>
                <Input
                  id="vpbx-url"
                  type="text"
                  placeholder="https://cloudpbx.beeline.kz/VPBX"
                  value={vpbxUrl}
                  onChange={(e) => setVpbxUrl(e.target.value)}
                  className="h-9 focus-visible:ring-1 focus-visible:ring-primary text-sm"
                />
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
                  Ключ авторизации АТС (`X-VPBX-API-AUTH-TOKEN`), используемый для совершения исходящих звонков.
                </p>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Правая часть - Таблица номеров и распределения */}
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
                    <TableHead className="w-40 text-center">Автораспределение</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {managers.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={3} className="text-center py-6 text-muted-foreground text-xs">
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

      {/* Кнопка сохранения в самом низу */}
      <div className="flex justify-end pt-4 border-t border-[#ebe9e4]">
        <Button onClick={handleSave} disabled={saving} className="px-6">
          {saving ? 'Сохранение...' : 'Сохранить настройки'}
        </Button>
      </div>
    </div>
  )
}
