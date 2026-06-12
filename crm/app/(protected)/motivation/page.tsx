import { createClient } from '@/lib/supabase/server'
import { getUserRole } from '@/lib/auth/get-user-role'
import { getManagerPerformance } from './actions'
import { MotivationClient } from './motivation-client'
import { BonusPayrollClient } from './bonus-payroll-client'

export const dynamic = 'force-dynamic'

export default async function MotivationPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (getUserRole(user) === 'admin') {
    return <BonusPayrollClient />
  }

  const data = await getManagerPerformance()
  return <MotivationClient initialData={data} />
}
