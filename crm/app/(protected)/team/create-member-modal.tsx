'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { createEmployee } from './actions'

export function CreateMemberModal() {
  const router = useRouter()
  const [isOpen, setIsOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [role, setRole] = useState<'manager' | 'admin'>('manager')

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)

    try {
      const res = await createEmployee({
        email: email.trim(),
        name: name.trim(),
        role,
        password
      })

      if (res.success) {
        toast.success('Сотрудник успешно добавлен в систему')
        setName('')
        setEmail('')
        setPassword('')
        setRole('manager')
        setIsOpen(false)
        router.refresh()
      } else {
        toast.error(res.error || 'Не удалось создать сотрудника')
      }
    } catch (err: any) {
      toast.error(err.message || 'Произошла непредвиденная ошибка')
    } finally {
      setLoading(false)
    }
  }

  return (
    <>
      <Button 
        onClick={() => setIsOpen(true)} 
        className="bg-[#1f2937] hover:bg-gray-800 text-white rounded-lg px-4 py-2 text-sm font-semibold shadow-sm"
      >
        + Добавить сотрудника
      </Button>

      {isOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-xs animate-in fade-in duration-200">
          <div className="w-full max-w-md bg-white rounded-xl border border-[#ebe9e4] shadow-xl p-6 space-y-4 animate-in zoom-in-95 duration-200">
            <div className="flex justify-between items-start">
              <div>
                <h3 className="text-lg font-bold text-foreground">Новый сотрудник</h3>
                <p className="text-xs text-muted-foreground">Заполните данные для создания аккаунта</p>
              </div>
              <button 
                onClick={() => setIsOpen(false)} 
                className="text-[#a8a49a] hover:text-foreground text-lg"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleSubmit} className="space-y-3">
              <div>
                <Label className="text-xs mb-1 block">Имя сотрудника</Label>
                <Input
                  type="text"
                  required
                  placeholder="Например, Алия"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="h-9 focus-visible:ring-1 focus-visible:ring-primary"
                  disabled={loading}
                />
              </div>

              <div>
                <Label className="text-xs mb-1 block">Email</Label>
                <Input
                  type="email"
                  required
                  placeholder="example@daraclean.ru"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="h-9 focus-visible:ring-1 focus-visible:ring-primary"
                  disabled={loading}
                />
              </div>

              <div>
                <Label className="text-xs mb-1 block">Пароль (мин. 6 символов)</Label>
                <Input
                  type="password"
                  required
                  placeholder="••••••"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="h-9 focus-visible:ring-1 focus-visible:ring-primary"
                  disabled={loading}
                />
              </div>

              <div>
                <Label className="text-xs mb-1 block">Роль в системе</Label>
                <select
                  value={role}
                  onChange={(e) => setRole(e.target.value as 'manager' | 'admin')}
                  className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-xs transition-colors file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-hidden focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
                  disabled={loading}
                >
                  <option value="manager">Менеджер</option>
                  <option value="admin">Администратор</option>
                </select>
              </div>

              <div className="flex gap-2 pt-2 justify-end">
                <Button 
                  type="button" 
                  variant="outline" 
                  onClick={() => setIsOpen(false)}
                  disabled={loading}
                  className="h-9"
                >
                  Отмена
                </Button>
                <Button 
                  type="submit" 
                  disabled={loading}
                  className="bg-[#1f2937] hover:bg-gray-800 text-white h-9"
                >
                  {loading ? 'Создание...' : 'Добавить'}
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  )
}
